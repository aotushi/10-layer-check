import type { KVNamespace } from "@cloudflare/workers-types";
import type { Env } from "../env";
import type { ProbeRequest, SiteScanJobEnvelope } from "./scan-orchestrator";
import {
  githubBrowserRuntimeResult,
  githubBrowserRuntimeStatus,
  githubLighthouseResult,
  githubLighthouseStatus,
  githubLiveTlsResult,
  githubLiveTlsStatus,
} from "./github-actions";
import { webPageTestResult, webPageTestStatus } from "./performance-providers";
import {
  applyProviderResultEnvelopes,
  createScanJobArtifact,
  type ProviderJob,
  type ProviderJobStatus,
  type ScanError,
  type ScanJob,
} from "../../src/scan/job";
import {
  createPersistedScanJobMeta,
  createStorageNotConfiguredResponse,
  redactSensitiveHeaders,
  type PersistedAiNarrativeReport,
  type PersistedScanJobMeta,
  type ScanArtifactStore,
  type ScanJobStore,
} from "../../src/scan/storage";
import type { ScanExportArtifact } from "../../src/reporters/artifact";
import type { AiNarrativeReportResult } from "../../src/providers/narrative-report/contract";

export type WorkerScanStorage = {
  jobStore: ScanJobStore;
  artifactStore: ScanArtifactStore;
  ttlSeconds: number;
};

const DEFAULT_SCAN_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_SCAN_JOB_MAX_OBJECT_BYTES = 2_000_000;

export function createWorkerScanStorage(env: Env): WorkerScanStorage | null {
  if (!env.SCAN_JOB_KV) return null;

  const ttlSeconds = parsePositiveInteger(env.SCAN_JOB_TTL_SECONDS, DEFAULT_SCAN_JOB_TTL_SECONDS, "SCAN_JOB_TTL_SECONDS");
  const maxObjectBytes = parsePositiveInteger(env.SCAN_JOB_MAX_OBJECT_BYTES, DEFAULT_SCAN_JOB_MAX_OBJECT_BYTES, "SCAN_JOB_MAX_OBJECT_BYTES");
  const kvStore = new KvScanStore(env.SCAN_JOB_KV, {
    ttlSeconds,
    maxObjectBytes,
    now: () => new Date(),
  });

  return {
    jobStore: kvStore,
    artifactStore: kvStore,
    ttlSeconds,
  };
}

export async function persistScanJobEnvelope(input: {
  env: Env;
  envelope: SiteScanJobEnvelope;
}): Promise<SiteScanJobEnvelope | Record<string, unknown>> {
  const storage = createWorkerScanStorage(input.env);
  if (!storage) return input.envelope;

  const meta = await persistScanJob({
    storage,
    job: input.envelope.job,
    artifactRef: input.envelope.job.artifact_ref,
  });

  return {
    ...input.envelope,
    boundaries: {
      ...input.envelope.boundaries,
      storage_persisted: true,
    },
    persisted: {
      meta_ref: createMetaRef(input.envelope.job.id),
      raw_ref: meta.raw_ref,
      artifact_ref: meta.artifact_ref,
      ttl_expires_at: meta.ttl_expires_at,
    },
  };
}

export async function getPersistedScanJob(env: Env, id: string): Promise<{ body: unknown; status: number }> {
  const storage = createWorkerScanStorage(env);
  if (!storage) return { body: createStorageNotConfiguredResponse("job_store"), status: 503 };

  const meta = await storage.jobStore.getJobMeta(id);
  if (!meta) return { body: createScanJobNotFoundResponse(id), status: 404 };

  return {
    status: 200,
    body: {
      ok: true,
      schema_version: "site-10-layer-persisted-scan-job/v0.1",
      boundaries: {
        storage_persisted: true,
        frontend_state_mutated: false,
      },
      meta,
    },
  };
}

export async function collectPersistedScanJob(input: {
  env: Env;
  id: string;
  body: ProbeRequest;
}): Promise<{ body: unknown; status: number }> {
  const storage = createWorkerScanStorage(input.env);
  if (!storage) return { body: createStorageNotConfiguredResponse("job_store"), status: 503 };

  const jobResult = await loadPersistedScanJob(storage, input.id);
  if (!jobResult.job) return { body: jobResult.error, status: jobResult.status };

  const updatedAt = new Date().toISOString();
  const updatedJob = applyProviderResultEnvelopes(jobResult.job, {
    asyncResultEnvelopes: parseAsyncResultEnvelopes(input.body.async_result_envelopes),
    updatedAt,
  });
  await persistScanJob({
    storage,
    job: updatedJob,
    artifactRef: jobResult.meta?.artifact_ref ?? updatedJob.artifact_ref,
  });

  return {
    status: 200,
    body: createPersistedJobEnvelope(updatedJob, updatedAt),
  };
}

export async function pollPersistedScanJob(input: {
  env: Env;
  id: string;
  requestUrl: URL;
}): Promise<{ body: unknown; status: number }> {
  const storage = createWorkerScanStorage(input.env);
  if (!storage) return { body: createStorageNotConfiguredResponse("job_store"), status: 503 };

  const jobResult = await loadPersistedScanJob(storage, input.id);
  if (!jobResult.job) return { body: jobResult.error, status: jobResult.status };

  const updatedAt = new Date().toISOString();
  const pollResults = await Promise.all(
    jobResult.job.provider_jobs.map((providerJob) => pollProviderJob(input.env, providerJob, input.requestUrl)),
  );
  const asyncResultEnvelopes = Object.fromEntries(
    pollResults
      .filter((result) => result.resultEnvelope !== undefined)
      .map((result) => [result.capability, result.resultEnvelope]),
  );
  const baseJob =
    Object.keys(asyncResultEnvelopes).length > 0
      ? applyProviderResultEnvelopes(jobResult.job, {
          asyncResultEnvelopes,
          updatedAt,
        })
      : jobResult.job;
  const providerJobs = baseJob.provider_jobs.map((providerJob) => {
    const pollResult = pollResults.find((result) => result.capability === providerJob.capability);
    if (!pollResult || pollResult.resultEnvelope !== undefined) return providerJob;
    return {
      ...providerJob,
      status: pollResult.status,
      error: pollResult.error,
      completed_at: isTerminalProviderJobStatus(pollResult.status) ? updatedAt : providerJob.completed_at,
    };
  });
  const polledJob: ScanJob = {
    ...baseJob,
    provider_jobs: providerJobs,
    status: resolvePersistedJobStatus(baseJob.status, providerJobs),
    updated_at: updatedAt,
  };

  await persistScanJob({
    storage,
    job: polledJob,
    artifactRef: jobResult.meta?.artifact_ref ?? polledJob.artifact_ref,
  });

  return {
    status: 200,
    body: {
      ...createPersistedJobEnvelope(polledJob, updatedAt),
      poll: {
        checked_provider_jobs: pollResults.map((result) => ({
          capability: result.capability,
          status: result.status,
          result_collected: result.resultEnvelope !== undefined,
          error: result.error,
        })),
      },
    },
  };
}

export async function cancelPersistedScanJob(env: Env, id: string): Promise<{ body: unknown; status: number }> {
  const storage = createWorkerScanStorage(env);
  if (!storage) return { body: createStorageNotConfiguredResponse("job_store"), status: 503 };

  const jobResult = await loadPersistedScanJob(storage, id);
  if (!jobResult.job) return { body: jobResult.error, status: jobResult.status };

  const updatedAt = new Date().toISOString();
  const cancelledJob: ScanJob = {
    ...jobResult.job,
    status: "cancelled",
    updated_at: updatedAt,
    completed_at: updatedAt,
    error: {
      code: "scan_job_cancelled",
      message: "Scan job was cancelled.",
      retryable: false,
    },
    provider_jobs: jobResult.job.provider_jobs.map((providerJob) =>
      providerJob.status === "completed" || providerJob.status === "failed" || providerJob.status === "skipped"
        ? providerJob
        : {
            ...providerJob,
            status: "cancelled",
            completed_at: updatedAt,
            error: {
              code: "provider_job_cancelled",
              message: "Provider job was cancelled with the scan job.",
              retryable: false,
            },
          },
    ),
  };
  await persistScanJob({
    storage,
    job: cancelledJob,
    artifactRef: jobResult.meta?.artifact_ref ?? cancelledJob.artifact_ref,
  });

  return {
    status: 200,
    body: createPersistedJobEnvelope(cancelledJob, updatedAt),
  };
}

export async function getPersistedScanJobArtifact(env: Env, id: string): Promise<{ body: unknown; status: number }> {
  const storage = createWorkerScanStorage(env);
  if (!storage) return { body: createStorageNotConfiguredResponse("artifact_store"), status: 503 };

  const jobResult = await loadPersistedScanJob(storage, id);
  if (!jobResult.job) return { body: jobResult.error, status: jobResult.status };

  if (jobResult.meta?.artifact_ref) {
    const existingArtifact = await storage.artifactStore.getArtifact(jobResult.meta.artifact_ref);
    if (existingArtifact) {
      return {
        status: 200,
        body: {
          ...markArtifactPersisted(existingArtifact),
          persisted: {
            meta_ref: createMetaRef(id),
            raw_ref: jobResult.meta.raw_ref,
            artifact_ref: jobResult.meta.artifact_ref,
            ttl_expires_at: jobResult.meta.ttl_expires_at,
          },
        },
      };
    }
  }

  const generatedAt = new Date().toISOString();
  const artifact = createScanJobArtifact(jobResult.job, {
    generatedAt,
    source: "provider",
  });
  const artifactRef = createArtifactRef(id);
  await storage.artifactStore.putArtifact(artifactRef, artifact);
  const meta = await persistScanJob({
    storage,
    job: {
      ...jobResult.job,
      artifact_ref: artifactRef,
      updated_at: generatedAt,
    },
    artifactRef,
  });

  return {
    status: 200,
    body: {
      ...markArtifactPersisted(artifact),
      persisted: {
        meta_ref: createMetaRef(id),
        raw_ref: meta.raw_ref,
        artifact_ref: meta.artifact_ref,
        ttl_expires_at: meta.ttl_expires_at,
      },
    },
  };
}

export async function getPersistedAiNarrativeReport(input: {
  env: Env;
  id: string;
  artifactRef: string | null;
}): Promise<PersistedAiNarrativeReport | null> {
  if (!input.artifactRef) return null;
  const storage = createWorkerScanStorage(input.env);
  if (!storage) return null;

  const existing = await storage.artifactStore.getAiReport(createAiReportRef(input.id));
  if (!existing || existing.artifact_ref !== input.artifactRef) return null;
  return existing;
}

export async function putPersistedAiNarrativeReport(input: {
  env: Env;
  id: string;
  artifactRef: string | null;
  result: AiNarrativeReportResult;
  generatedAt?: string;
}): Promise<PersistedAiNarrativeReport | null> {
  if (!input.artifactRef) return null;
  const storage = createWorkerScanStorage(input.env);
  if (!storage) return null;

  const report: PersistedAiNarrativeReport = {
    schema_version: "site-10-layer-persisted-ai-narrative-report/v0.1",
    job_id: input.id,
    artifact_ref: input.artifactRef,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    provider: input.result.provider,
    result: input.result,
  };
  await storage.artifactStore.putAiReport(createAiReportRef(input.id), report);
  return report;
}

class KvScanStore implements ScanJobStore, ScanArtifactStore {
  private readonly kv: KVNamespace;
  private readonly ttlSeconds: number;
  private readonly maxObjectBytes: number;
  private readonly now: () => Date;

  constructor(
    kv: KVNamespace,
    options: {
      ttlSeconds: number;
      maxObjectBytes: number;
      now: () => Date;
    },
  ) {
    this.kv = kv;
    this.ttlSeconds = options.ttlSeconds;
    this.maxObjectBytes = options.maxObjectBytes;
    this.now = options.now;
  }

  async putJobMeta(meta: PersistedScanJobMeta): Promise<void> {
    await this.putJson(createMetaRef(meta.id), meta);
  }

  async getJobMeta(id: string): Promise<PersistedScanJobMeta | null> {
    const meta = await this.getJson<PersistedScanJobMeta>(createMetaRef(id));
    if (!meta) return null;
    if (new Date(meta.ttl_expires_at).getTime() <= this.now().getTime()) {
      await this.deleteJobMeta(id);
      await this.deleteObject(meta.raw_ref);
      if (meta.artifact_ref) await this.deleteObject(meta.artifact_ref);
      return null;
    }
    return meta;
  }

  async deleteJobMeta(id: string): Promise<void> {
    await this.kv.delete(createMetaRef(id));
  }

  async putRawEnvelope(ref: string, value: unknown): Promise<void> {
    await this.putJson(ref, redactSensitiveHeaders(value));
  }

  async getRawEnvelope(ref: string): Promise<unknown | null> {
    return this.getJson(ref);
  }

  async putArtifact(ref: string, artifact: ScanExportArtifact): Promise<void> {
    await this.putJson(ref, redactSensitiveHeaders(artifact));
  }

  async getArtifact(ref: string): Promise<ScanExportArtifact | null> {
    return this.getJson<ScanExportArtifact>(ref);
  }

  async putAiReport(ref: string, report: PersistedAiNarrativeReport): Promise<void> {
    await this.putJson(ref, redactSensitiveHeaders(report));
  }

  async getAiReport(ref: string): Promise<PersistedAiNarrativeReport | null> {
    return this.getJson<PersistedAiNarrativeReport>(ref);
  }

  async deleteObject(ref: string): Promise<void> {
    await this.kv.delete(ref);
  }

  private async putJson(ref: string, value: unknown): Promise<void> {
    const text = JSON.stringify(value);
    const size = new TextEncoder().encode(text).byteLength;
    if (size > this.maxObjectBytes) {
      throw new Error(`Stored scan object exceeds SCAN_JOB_MAX_OBJECT_BYTES (${size} > ${this.maxObjectBytes}).`);
    }
    await this.kv.put(ref, text, {
      expirationTtl: this.ttlSeconds,
    });
  }

  private async getJson<T>(ref: string): Promise<T | null> {
    const text = await this.kv.get(ref);
    if (!text) return null;
    return JSON.parse(text) as T;
  }
}

async function persistScanJob(input: {
  storage: WorkerScanStorage;
  job: ScanJob;
  artifactRef?: string | null;
}): Promise<PersistedScanJobMeta> {
  const rawRef = createRawRef(input.job.id);
  await input.storage.artifactStore.putRawEnvelope(rawRef, input.job);
  const meta = createPersistedScanJobMeta({
    job: input.job,
    rawRef,
    artifactRef: input.artifactRef ?? null,
    ttlSeconds: input.storage.ttlSeconds,
  });
  await input.storage.jobStore.putJobMeta(meta);
  return meta;
}

async function pollProviderJob(
  env: Env,
  providerJob: ProviderJob,
  requestUrl: URL,
): Promise<{
  capability: string;
  status: ProviderJobStatus;
  resultEnvelope?: unknown;
  error: ScanError | null;
}> {
  if (isTerminalProviderJobStatus(providerJob.status)) {
    return { capability: providerJob.capability, status: providerJob.status, error: providerJob.error };
  }

  try {
    const statusUrl = createProviderPollUrl(requestUrl, providerJob);
    const statusEnvelope = await readProviderStatus(env, providerJob.capability, statusUrl);
    if (isProviderStatusFailed(statusEnvelope)) {
      return {
        capability: providerJob.capability,
        status: "failed",
        error: createScanError(
          readString(statusEnvelope, "error_code") ?? "provider_status_failed",
          readString(statusEnvelope, "error") ?? "Provider status request failed.",
          true,
        ),
      };
    }

    if (!isProviderStatusCompleted(statusEnvelope)) {
      return {
        capability: providerJob.capability,
        status: readProviderJobStatus(statusEnvelope, providerJob.status),
        error: null,
      };
    }

    const resultEnvelope = await readProviderResult(env, providerJob.capability, statusUrl);
    return {
      capability: providerJob.capability,
      status: "completed",
      resultEnvelope,
      error: null,
    };
  } catch (error) {
    return {
      capability: providerJob.capability,
      status: "failed",
      error: createScanError("provider_poll_failed", error instanceof Error ? error.message : String(error), true),
    };
  }
}

function createProviderPollUrl(requestUrl: URL, providerJob: ProviderJob): URL {
  const url = new URL(requestUrl.toString());
  url.search = "";
  const payload = isRecord(providerJob.request_payload) ? providerJob.request_payload : {};
  const requestId = readString(payload, "request_id");
  const runId = readNumber(payload, "run_id");
  if (requestId) url.searchParams.set("id", requestId);
  if (runId !== null) url.searchParams.set("run_id", String(runId));
  return url;
}

async function readProviderStatus(env: Env, capability: string, url: URL): Promise<unknown> {
  if (capability === "browser_runtime") return githubBrowserRuntimeStatus(env, url);
  if (capability === "live_tls") return githubLiveTlsStatus(env, url);
  if (capability === "lighthouse") return githubLighthouseStatus(env, url);
  if (capability === "webpagetest") return webPageTestStatus(env, url);
  return { ok: true, status: "completed", complete: true };
}

async function readProviderResult(env: Env, capability: string, url: URL): Promise<unknown> {
  if (capability === "browser_runtime") return githubBrowserRuntimeResult(env, url);
  if (capability === "live_tls") return githubLiveTlsResult(env, url);
  if (capability === "lighthouse") return githubLighthouseResult(env, url);
  if (capability === "webpagetest") return webPageTestResult(env, url);
  return null;
}

function isProviderStatusCompleted(envelope: unknown): boolean {
  const record = isRecord(envelope) ? envelope : {};
  if (record.complete === true) return true;
  return readString(record, "status") === "completed";
}

function isProviderStatusFailed(envelope: unknown): boolean {
  const record = isRecord(envelope) ? envelope : {};
  if (record.ok === false) return true;
  const status = readString(record, "status");
  return status === "failed" || status === "error" || Boolean(readString(record, "error") ?? readString(record, "error_code"));
}

function readProviderJobStatus(envelope: unknown, fallback: ProviderJobStatus): ProviderJobStatus {
  const record = isRecord(envelope) ? envelope : {};
  const status = readString(record, "status");
  if (status === "queued") return "queued";
  if (status === "dispatching") return "dispatching";
  if (status === "running" || status === "in_progress") return "running";
  if (status === "polling") return "polling";
  return fallback === "queued" || fallback === "dispatching" ? "polling" : fallback;
}

function resolvePersistedJobStatus(currentStatus: ScanJob["status"], providerJobs: ProviderJob[]): ScanJob["status"] {
  if (currentStatus === "cancelled" || currentStatus === "failed") return currentStatus;
  if (providerJobs.length === 0) return currentStatus;
  const terminalJobs = providerJobs.filter((job) => isTerminalProviderJobStatus(job.status));
  if (terminalJobs.length !== providerJobs.length) return "async_pending";
  return providerJobs.every((job) => job.status === "completed") ? "completed" : "partial";
}

function isTerminalProviderJobStatus(status: ProviderJobStatus): boolean {
  return status === "completed" || status === "failed" || status === "skipped" || status === "cancelled";
}

function createScanError(code: string, message: string, retryable: boolean): ScanError {
  return { code, message, retryable };
}

async function loadPersistedScanJob(
  storage: WorkerScanStorage,
  id: string,
): Promise<
  | {
      job: ScanJob;
      meta: PersistedScanJobMeta;
      error?: never;
      status?: never;
    }
  | {
      job: null;
      meta: null;
      error: unknown;
      status: number;
    }
> {
  const meta = await storage.jobStore.getJobMeta(id);
  if (!meta) return { job: null, meta: null, error: createScanJobNotFoundResponse(id), status: 404 };

  const rawJob = await storage.artifactStore.getRawEnvelope(meta.raw_ref);
  if (!isScanJob(rawJob)) {
    return {
      job: null,
      meta: null,
      status: 500,
      error: {
        ok: false,
        schema_version: "site-10-layer-storage-status/v0.1",
        error_code: "scan_job_raw_payload_missing",
        error: "Persisted scan job metadata exists but the raw job payload is missing or invalid.",
        id,
        raw_ref: meta.raw_ref,
      },
    };
  }

  return { job: rawJob, meta };
}

function createPersistedJobEnvelope(job: ScanJob, generatedAt: string): Record<string, unknown> {
  return {
    schema_version: "site-10-layer-scan-job/v0.1",
    generated_at: generatedAt,
    boundaries: {
      storage_persisted: true,
      frontend_state_mutated: false,
      v1_scan_start_preserved: true,
    },
    job,
    raw_scan_start: job.raw_inputs.scan_start_envelope,
    persisted: {
      meta_ref: createMetaRef(job.id),
      raw_ref: createRawRef(job.id),
      artifact_ref: job.artifact_ref,
    },
  };
}

function markArtifactPersisted(artifact: ScanExportArtifact): Record<string, unknown> {
  return {
    ...artifact,
    boundaries: {
      ...artifact.boundaries,
      storage_persisted: true,
    },
  };
}

function createScanJobNotFoundResponse(id: string) {
  return {
    ok: false,
    schema_version: "site-10-layer-storage-status/v0.1",
    error_code: "scan_job_not_found",
    error: "Persisted scan job was not found.",
    id,
  };
}

function createMetaRef(id: string): string {
  return `scan-jobs/meta/${id}.json`;
}

function createRawRef(id: string): string {
  return `scan-jobs/raw/${id}.json`;
}

function createArtifactRef(id: string): string {
  return `scan-jobs/artifacts/${id}.json`;
}

function createAiReportRef(id: string): string {
  return `scan-jobs/ai-reports/${id}.json`;
}

function parseAsyncResultEnvelopes(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("async_result_envelopes must be an object when provided.");
  return value;
}

function isScanJob(value: unknown): value is ScanJob {
  const record = isRecord(value) ? value : null;
  return Boolean(record && typeof record.id === "string" && typeof record.target === "string" && isRecord(record.raw_inputs));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parsePositiveInteger(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

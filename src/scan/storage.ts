import type { ScanExportArtifact } from "../reporters/artifact";
import type { AiNarrativeReportResult } from "../providers/narrative-report/contract";
import type { ProviderJob, ScanError, ScanJob, ScanJobStatus } from "./job";
import type { ScanPolicy } from "./policy";

export type PersistedScanJobMeta = {
  schema_version: "site-10-layer-persisted-scan-job-meta/v0.1";
  id: string;
  target: string;
  normalized_target: string;
  status: ScanJobStatus;
  scan_policy: ScanPolicy;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  requested_sync_probes: string[];
  requested_async_providers: string[];
  provider_jobs: ProviderJob[];
  raw_ref: string;
  artifact_ref: string | null;
  error: ScanError | null;
  ttl_expires_at: string;
};

export type CreatePersistedScanJobMetaInput = {
  job: ScanJob;
  rawRef: string;
  artifactRef?: string | null;
  ttlSeconds: number;
  now?: Date;
};

export type ScanJobStore = {
  putJobMeta(meta: PersistedScanJobMeta): Promise<void>;
  getJobMeta(id: string): Promise<PersistedScanJobMeta | null>;
  deleteJobMeta(id: string): Promise<void>;
};

export type ScanArtifactStore = {
  putRawEnvelope(ref: string, value: unknown): Promise<void>;
  getRawEnvelope(ref: string): Promise<unknown | null>;
  putArtifact(ref: string, artifact: ScanExportArtifact): Promise<void>;
  getArtifact(ref: string): Promise<ScanExportArtifact | null>;
  putAiReport(ref: string, report: PersistedAiNarrativeReport): Promise<void>;
  getAiReport(ref: string): Promise<PersistedAiNarrativeReport | null>;
  deleteObject(ref: string): Promise<void>;
};

export type PersistedAiNarrativeReport = {
  schema_version: "site-10-layer-persisted-ai-narrative-report/v0.1";
  job_id: string;
  artifact_ref: string;
  generated_at: string;
  provider: AiNarrativeReportResult["provider"];
  result: AiNarrativeReportResult;
};

export type InMemoryScanStoreOptions = {
  now?: () => Date;
  maxObjectBytes?: number;
};

const DEFAULT_MAX_OBJECT_BYTES = 2_000_000;
const SENSITIVE_HEADER_NAMES = new Set(["authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization"]);

export function createPersistedScanJobMeta(input: CreatePersistedScanJobMetaInput): PersistedScanJobMeta {
  const now = input.now ?? new Date();
  return {
    schema_version: "site-10-layer-persisted-scan-job-meta/v0.1",
    id: input.job.id,
    target: input.job.target,
    normalized_target: input.job.normalized_target,
    status: input.job.status,
    scan_policy: input.job.scan_policy,
    created_at: input.job.created_at,
    updated_at: input.job.updated_at,
    completed_at: input.job.completed_at,
    requested_sync_probes: input.job.requested_sync_probes,
    requested_async_providers: input.job.requested_async_providers,
    provider_jobs: input.job.provider_jobs,
    raw_ref: input.rawRef,
    artifact_ref: input.artifactRef ?? null,
    error: input.job.error,
    ttl_expires_at: new Date(now.getTime() + input.ttlSeconds * 1000).toISOString(),
  };
}

export class InMemoryScanJobStore implements ScanJobStore {
  private readonly jobs = new Map<string, PersistedScanJobMeta>();
  private readonly now: () => Date;

  constructor(options: InMemoryScanStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async putJobMeta(meta: PersistedScanJobMeta): Promise<void> {
    this.jobs.set(meta.id, structuredClone(meta));
  }

  async getJobMeta(id: string): Promise<PersistedScanJobMeta | null> {
    const meta = this.jobs.get(id);
    if (!meta) return null;
    if (new Date(meta.ttl_expires_at).getTime() <= this.now().getTime()) {
      this.jobs.delete(id);
      return null;
    }
    return structuredClone(meta);
  }

  async deleteJobMeta(id: string): Promise<void> {
    this.jobs.delete(id);
  }
}

export class InMemoryScanArtifactStore implements ScanArtifactStore {
  private readonly objects = new Map<string, unknown>();
  private readonly maxObjectBytes: number;

  constructor(options: InMemoryScanStoreOptions = {}) {
    this.maxObjectBytes = options.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES;
  }

  async putRawEnvelope(ref: string, value: unknown): Promise<void> {
    this.putObject(ref, redactSensitiveHeaders(value));
  }

  async getRawEnvelope(ref: string): Promise<unknown | null> {
    return this.getObject(ref);
  }

  async putArtifact(ref: string, artifact: ScanExportArtifact): Promise<void> {
    this.putObject(ref, redactSensitiveHeaders(artifact));
  }

  async getArtifact(ref: string): Promise<ScanExportArtifact | null> {
    return this.getObject(ref) as ScanExportArtifact | null;
  }

  async putAiReport(ref: string, report: PersistedAiNarrativeReport): Promise<void> {
    this.putObject(ref, redactSensitiveHeaders(report));
  }

  async getAiReport(ref: string): Promise<PersistedAiNarrativeReport | null> {
    return this.getObject(ref) as PersistedAiNarrativeReport | null;
  }

  async deleteObject(ref: string): Promise<void> {
    this.objects.delete(ref);
  }

  private putObject(ref: string, value: unknown): void {
    const size = estimateJsonBytes(value);
    if (size > this.maxObjectBytes) {
      throw new Error(`Stored scan object exceeds maxObjectBytes (${size} > ${this.maxObjectBytes}).`);
    }
    this.objects.set(ref, structuredClone(value));
  }

  private getObject(ref: string): unknown | null {
    const value = this.objects.get(ref);
    return value === undefined ? null : structuredClone(value);
  }
}

export function createStorageNotConfiguredResponse(resource: "job_store" | "artifact_store") {
  return {
    ok: false,
    schema_version: "site-10-layer-storage-status/v0.1",
    error_code: "storage_not_configured",
    error: `${resource} is not configured for persisted scan jobs.`,
    resource,
  };
}

export function redactSensitiveHeaders(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveHeaders);
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => {
      if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
        if (entryValue === null || entryValue === undefined) return [key, entryValue];
        return [key, "[redacted]"];
      }
      return [key, redactSensitiveHeaders(entryValue)];
    }),
  );
}

function estimateJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

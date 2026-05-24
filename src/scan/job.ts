import type { ProviderConfig, Run, SnapshotRecord } from "../core/types";
import { createScanExportArtifact, type ScanExportArtifact } from "../reporters/artifact";
import { normalizeProviderResult, normalizeSiteScanProviderResults } from "../providers/results/normalize";
import { createDefaultScanPolicy, type ScanPolicy } from "./policy";

export type ScanJobStatus =
  | "created"
  | "running_sync"
  | "async_pending"
  | "collecting_async"
  | "normalizing"
  | "report_ready"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export type ProviderJobStatus =
  | "queued"
  | "dispatching"
  | "running"
  | "polling"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type ProviderPolicy = {
  requires_secret: string[];
  requires_permission: boolean;
  timeout_ms: number;
  retry_limit: number;
  rate_limit_key: string;
  max_result_bytes: number;
  quota_cost_hint: string | null;
};

export type ScanError = {
  code: string;
  message: string;
  provider?: string;
  retryable: boolean;
  retry_after_seconds?: number | null;
};

export type ProviderJob = {
  id: string;
  scan_id: string;
  provider: string;
  capability: string;
  status: ProviderJobStatus;
  attempt_count: number;
  request_payload: unknown;
  result_envelope: unknown | null;
  normalized_record_count: number;
  error: ScanError | null;
  policy: ProviderPolicy;
  started_at: string | null;
  completed_at: string | null;
};

export type ScanJob = {
  id: string;
  target: string;
  normalized_target: string;
  scan_policy: ScanPolicy;
  status: ScanJobStatus;
  requested_sync_probes: string[];
  requested_async_providers: string[];
  provider_jobs: ProviderJob[];
  records: SnapshotRecord[];
  artifact_ref: string | null;
  error: ScanError | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  raw_inputs: {
    scan_start_envelope: unknown;
    async_result_envelopes: Record<string, unknown>;
  };
  providers: ProviderConfig[];
};

export type CreateScanJobFromStartEnvelopeInput = {
  id: string;
  target: string;
  normalizedTarget?: string;
  createdAt?: string;
  updatedAt?: string;
  providers?: ProviderConfig[];
  scanStartEnvelope: unknown;
};

export type ApplyProviderResultEnvelopesInput = {
  asyncResultEnvelopes: Record<string, unknown>;
  updatedAt?: string;
};

export type CreateScanJobArtifactInput = {
  generatedAt?: string;
  source?: Run["source"];
};

type SiteScanAsyncJob = {
  capability: string;
  provider: string;
  provider_schema_version: string | null;
  request_id: string | null;
  run_id: number | null;
  status: string;
  status_code: number | null;
  conclusion: string | null;
  html_url: string | null;
  endpoints: unknown;
  error_code: string | null;
  error: string | null;
  retryable: boolean | null;
  retry_after_seconds: number | null;
  missing_config: string[];
  result_envelope: unknown;
};

export function createScanJobFromStartEnvelope(input: CreateScanJobFromStartEnvelopeInput): ScanJob {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const updatedAt = input.updatedAt ?? createdAt;
  const normalizedTarget = input.normalizedTarget ?? normalizeTargetLabel(input.target);
  const envelope = asRecord(input.scanStartEnvelope);
  const requestedSyncProbes = getStringArray(envelope, "sync_probes");
  const requestedAsyncProviders = getStringArray(envelope, "async_providers");
  const asyncJobs = readSiteScanAsyncJobs(envelope?.async_jobs);
  const providers = input.providers ?? [];
  const asyncResultEnvelopes = readEmbeddedAsyncResultEnvelopes(asyncJobs);
  const scanPolicy =
    isScanPolicy(envelope?.scan_policy)
      ? envelope.scan_policy
      : createDefaultScanPolicy({
          target: input.target,
          normalizedTarget,
          requestedSyncProbes,
          requestedAsyncProviders,
          createdAt,
        });
  const records = normalizeSiteScanProviderResults({
    target: input.target,
    normalizedTarget,
    snapshotAt: createdAt,
    providers,
    scanStartEnvelope: input.scanStartEnvelope,
    asyncResultEnvelopes,
  });
  const providerJobs = asyncJobs.map((job) =>
    createProviderJobFromAsyncJob({
      scanId: input.id,
      job,
      createdAt,
      updatedAt,
      target: input.target,
      normalizedTarget,
      providers,
      asyncResultEnvelopes,
    }),
  );

  return {
    id: input.id,
    target: input.target,
    normalized_target: normalizedTarget,
    scan_policy: scanPolicy,
    status: resolveScanJobStatus(records, providerJobs, "initial"),
    requested_sync_probes: requestedSyncProbes,
    requested_async_providers: requestedAsyncProviders,
    provider_jobs: providerJobs,
    records,
    artifact_ref: null,
    error: records.length > 0 ? null : createScanError("scan_job_has_no_records", "Scan job did not produce usable records.", false),
    created_at: createdAt,
    updated_at: updatedAt,
    completed_at: resolveCompletedAt(resolveScanJobStatus(records, providerJobs, "initial"), providerJobs, updatedAt),
    raw_inputs: {
      scan_start_envelope: input.scanStartEnvelope,
      async_result_envelopes: asyncResultEnvelopes,
    },
    providers,
  };
}

export function applyProviderResultEnvelopes(job: ScanJob, input: ApplyProviderResultEnvelopesInput): ScanJob {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const asyncResultEnvelopes = {
    ...job.raw_inputs.async_result_envelopes,
    ...input.asyncResultEnvelopes,
  };
  const records = normalizeSiteScanProviderResults({
    target: job.target,
    normalizedTarget: job.normalized_target,
    snapshotAt: job.created_at,
    providers: job.providers,
    scanStartEnvelope: job.raw_inputs.scan_start_envelope,
    asyncResultEnvelopes,
  });
  const providerJobs = job.provider_jobs.map((providerJob) =>
    updateProviderJobWithResultEnvelope({
      providerJob,
      envelope: asyncResultEnvelopes[providerJob.capability],
      updatedAt,
      target: job.target,
      normalizedTarget: job.normalized_target,
      providers: job.providers,
    }),
  );
  const status = resolveScanJobStatus(records, providerJobs, "collected");

  return {
    ...job,
    status,
    provider_jobs: providerJobs,
    records,
    error: records.length > 0 ? null : createScanError("scan_job_has_no_records", "Scan job did not produce usable records.", false),
    updated_at: updatedAt,
    completed_at: resolveCompletedAt(status, providerJobs, updatedAt),
    raw_inputs: {
      ...job.raw_inputs,
      async_result_envelopes: asyncResultEnvelopes,
    },
  };
}

export function createScanJobArtifact(job: ScanJob, input: CreateScanJobArtifactInput = {}): ScanExportArtifact {
  return createScanExportArtifact({
    id: job.id,
    target: job.target,
    normalizedTarget: job.normalized_target,
    createdAt: job.created_at,
    generatedAt: input.generatedAt,
    source: input.source ?? "provider",
    providers: job.providers,
    scanStartEnvelope: job.raw_inputs.scan_start_envelope,
    asyncResultEnvelopes: job.raw_inputs.async_result_envelopes,
    scanPolicy: job.scan_policy,
  });
}

function createProviderJobFromAsyncJob(input: {
  scanId: string;
  job: SiteScanAsyncJob;
  createdAt: string;
  updatedAt: string;
  target: string;
  normalizedTarget: string;
  providers: ProviderConfig[];
  asyncResultEnvelopes: Record<string, unknown>;
}): ProviderJob {
  const envelope = input.asyncResultEnvelopes[input.job.capability];
  const normalizedRecordCount = envelope
    ? countPositiveProviderRecords({
        target: input.target,
        normalizedTarget: input.normalizedTarget,
        snapshotAt: input.createdAt,
        providers: input.providers,
        envelope,
      })
    : 0;
  const status = envelope ? "completed" : mapProviderJobStatus(input.job.status, input.job.error_code, input.job.error);

  return {
    id: `${input.scanId}:${input.job.capability}:${input.job.request_id ?? "no-request"}`,
    scan_id: input.scanId,
    provider: input.job.provider,
    capability: input.job.capability,
    status,
    attempt_count: 1,
    request_payload: {
      request_id: input.job.request_id,
      run_id: input.job.run_id,
      status_url: readEndpoint(input.job.endpoints, "status"),
      result_url: readEndpoint(input.job.endpoints, "result"),
      html_url: input.job.html_url,
      provider_schema_version: input.job.provider_schema_version,
    },
    result_envelope: envelope ?? null,
    normalized_record_count: normalizedRecordCount,
    error:
      status === "failed"
        ? createScanError(
            input.job.error_code ?? "provider_job_failed",
            input.job.error ?? "Provider job failed.",
            input.job.retryable ?? true,
            input.job.retry_after_seconds,
          )
        : null,
    policy: createProviderPolicy(input.job.capability),
    started_at: input.createdAt,
    completed_at: status === "completed" || status === "failed" || status === "skipped" ? input.updatedAt : null,
  };
}

function updateProviderJobWithResultEnvelope(input: {
  providerJob: ProviderJob;
  envelope: unknown;
  updatedAt: string;
  target: string;
  normalizedTarget: string;
  providers: ProviderConfig[];
}): ProviderJob {
  if (input.envelope === undefined) {
    return input.providerJob;
  }

  const normalizedRecordCount = countPositiveProviderRecords({
    target: input.target,
    normalizedTarget: input.normalizedTarget,
    snapshotAt: input.providerJob.started_at ?? input.updatedAt,
    providers: input.providers,
    envelope: input.envelope,
  });
  const envelopeRecord = asRecord(input.envelope);
  const failed = envelopeRecord
    ? getBoolean(envelopeRecord, "ok") === false || Boolean(getString(envelopeRecord, "error") ?? getString(envelopeRecord, "error_code"))
    : true;

  return {
    ...input.providerJob,
    status: failed ? "failed" : "completed",
    result_envelope: input.envelope,
    normalized_record_count: normalizedRecordCount,
    error: failed ? createScanError(getString(envelopeRecord, "error_code") ?? "provider_result_failed", getString(envelopeRecord, "error") ?? "Provider result failed.", true) : null,
    completed_at: input.updatedAt,
  };
}

function countPositiveProviderRecords(input: {
  target: string;
  normalizedTarget: string;
  snapshotAt: string;
  providers: ProviderConfig[];
  envelope: unknown;
}): number {
  return normalizeProviderResult({
    target: input.target,
    normalizedTarget: input.normalizedTarget,
    snapshotAt: input.snapshotAt,
    providers: input.providers,
    envelope: input.envelope,
  }).filter((record) => record.probe !== "provider_result_status" && record.status !== "error").length;
}

function resolveScanJobStatus(records: SnapshotRecord[], providerJobs: ProviderJob[], phase: "initial" | "collected"): ScanJobStatus {
  if (records.length === 0) return "failed";
  if (providerJobs.length === 0) return "completed";

  const terminalJobs = providerJobs.filter((job) => job.status === "completed" || job.status === "failed" || job.status === "skipped");
  if (terminalJobs.length === providerJobs.length) {
    return providerJobs.every((job) => job.status === "completed") ? "completed" : "partial";
  }

  return phase === "initial" ? "async_pending" : "partial";
}

function resolveCompletedAt(status: ScanJobStatus, providerJobs: ProviderJob[], updatedAt: string): string | null {
  if (status !== "completed" && status !== "partial" && status !== "failed" && status !== "cancelled") return null;
  if (providerJobs.length === 0) return updatedAt;
  return updatedAt;
}

function createProviderPolicy(capability: string): ProviderPolicy {
  const base = {
    requires_permission: false,
    timeout_ms: 120_000,
    retry_limit: 1,
    rate_limit_key: capability,
    max_result_bytes: 2_000_000,
    quota_cost_hint: null,
  };

  if (capability === "browser_runtime" || capability === "live_tls" || capability === "lighthouse") {
    return {
      ...base,
      requires_secret: ["GITHUB_TOKEN"],
      timeout_ms: 20 * 60 * 1000,
      quota_cost_hint: "github_actions_minutes",
    };
  }

  if (capability === "pagespeed") {
    return {
      ...base,
      requires_secret: ["PAGESPEED_API_KEY"],
      quota_cost_hint: "pagespeed_api_quota",
    };
  }

  if (capability === "webpagetest") {
    return {
      ...base,
      requires_secret: ["WEBPAGETEST_API_KEY"],
      timeout_ms: 30 * 60 * 1000,
      retry_limit: 0,
      quota_cost_hint: "webpagetest_api_quota",
    };
  }

  if (capability === "ai_classifier") {
    return {
      ...base,
      requires_secret: ["AI binding or AI_PROVIDER_API_KEY"],
      quota_cost_hint: "ai_provider_tokens",
    };
  }

  return {
    ...base,
    requires_secret: [],
  };
}

function mapProviderJobStatus(status: string, errorCode: string | null, error: string | null): ProviderJobStatus {
  if (errorCode || error) return "failed";
  if (status === "completed" || status === "success") return "completed";
  if (status === "dispatching") return "dispatching";
  if (status === "running" || status === "in_progress") return "running";
  if (status === "polling") return "polling";
  if (status === "skipped") return "skipped";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "error") return "failed";
  return "queued";
}

function readSiteScanAsyncJobs(value: unknown): SiteScanAsyncJob[] {
  if (!Array.isArray(value)) return [];
  return value.map(readSiteScanAsyncJob).filter((job): job is SiteScanAsyncJob => Boolean(job));
}

function readSiteScanAsyncJob(value: unknown): SiteScanAsyncJob | null {
  const job = asRecord(value);
  if (!job) return null;

  const capability = getString(job, "capability");
  if (!capability) return null;

  return {
    capability,
    provider: getString(job, "provider") ?? `site_scan_async_${capability}`,
    provider_schema_version: getString(job, "provider_schema_version"),
    request_id: getString(job, "request_id"),
    run_id: getNumber(job, "run_id"),
    status: getString(job, "status") ?? "queued",
    status_code: getNumber(job, "status_code"),
    conclusion: getString(job, "conclusion"),
    html_url: getString(job, "html_url"),
    endpoints: job.endpoints,
    error_code: getString(job, "error_code"),
    error: getString(job, "error"),
    retryable: getBoolean(job, "retryable"),
    retry_after_seconds: getNumber(job, "retry_after_seconds"),
    missing_config: getStringArray(job, "missing_config"),
    result_envelope: job.result_envelope,
  };
}

function readEmbeddedAsyncResultEnvelopes(asyncJobs: SiteScanAsyncJob[]): Record<string, unknown> {
  return Object.fromEntries(
    asyncJobs
      .filter((job) => job.result_envelope !== null && job.result_envelope !== undefined)
      .map((job) => [job.capability, job.result_envelope]),
  );
}

function readEndpoint(value: unknown, key: string): string | null {
  const endpoints = asRecord(value);
  if (!endpoints) return null;
  return getString(endpoints, key);
}

function createScanError(code: string, message: string, retryable: boolean, retryAfterSeconds?: number | null): ScanError {
  return { code, message, retryable, ...(retryAfterSeconds !== undefined ? { retry_after_seconds: retryAfterSeconds } : {}) };
}

function normalizeTargetLabel(value: string): string {
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return value.trim().toLowerCase() || "target";
  }
}

function getStringArray(record: Record<string, unknown> | null | undefined, key: string): string[] {
  if (!record) return [];
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNumber(record: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getBoolean(record: Record<string, unknown> | null | undefined, key: string): boolean | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isScanPolicy(value: unknown): value is ScanPolicy {
  const record = asRecord(value);
  return record?.schema_version === "site-10-layer-scan-policy/v0.1";
}

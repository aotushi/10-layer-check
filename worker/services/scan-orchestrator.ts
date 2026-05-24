import { createScanExportArtifact } from "../../src/reporters/artifact";
import { createDefaultScanPolicy, type ScanPolicy } from "../../src/scan/policy";
import {
  applyProviderResultEnvelopes,
  createScanJobArtifact,
  createScanJobFromStartEnvelope,
  type ScanJob,
} from "../../src/scan/job";
import {
  createSignedJobHandle,
  verifySignedJobHandle,
  type SignedJobHandle,
  type SignedJobHandleConfig,
} from "../../src/scan/signed-job-handle";

export type ProbeRequest = {
  target?: unknown;
  max_redirects?: unknown;
  strategy?: unknown;
  location?: unknown;
  sync_probes?: unknown;
  async_providers?: unknown;
  job?: unknown;
  job_handle?: unknown;
  async_result_envelopes?: unknown;
  generated_at?: unknown;
};

export type SiteScanSyncProbe =
  | "dns_infrastructure"
  | "tls_certificate"
  | "subdomain_attack_surface"
  | "service_fingerprint"
  | "public_host_fingerprint"
  | "public_security_details"
  | "public_content_surface"
  | "public_content_detail"
  | "public_spa_metadata"
  | "organization_intelligence"
  | "api_reachability"
  | "remote_fetch"
  | "performance_basic";

export type SiteScanAsyncProvider = "browser_runtime" | "live_tls" | "lighthouse" | "pagespeed" | "webpagetest";

export type SiteScanResultEnvelope<T> =
  | {
      status: "fulfilled";
      result: T;
    }
  | {
      status: "rejected";
      error: string;
    };

export type SiteScanAsyncJob = {
  capability: SiteScanAsyncProvider;
  provider: string;
  provider_schema_version?: string | null;
  request_id: string | null;
  run_id: number | null;
  status: string;
  status_code?: number | null;
  conclusion: string | null;
  html_url: string | null;
  endpoints: {
    status: string | null;
    result: string | null;
  };
  error_code?: string | null;
  error?: string;
  retryable?: boolean;
  retry_after_seconds?: number | null;
  missing_config?: string[];
  result_envelope?: unknown;
};

export type SiteScanStartEnvelope = {
  schema_version: "site-10-layer-scan-start/v0.1";
  provider: "cloudflare_worker_site_scan";
  requested_url: string;
  normalized_url: string;
  normalized_target: string;
  status: "ok" | "partial";
  sync_probes: SiteScanSyncProbe[];
  async_providers: SiteScanAsyncProvider[];
  scan_policy: ScanPolicy;
  sync_results: Record<string, SiteScanResultEnvelope<unknown>>;
  async_jobs: SiteScanAsyncJob[];
  coverage: {
    collected: string[];
    pending: string[];
    failed: string[];
    limitations: string[];
  };
};

export type SiteScanJobEnvelope = {
  schema_version: "site-10-layer-scan-job/v0.1";
  generated_at: string;
  boundaries: {
    storage_persisted: false;
    frontend_state_mutated: false;
    v1_scan_start_preserved: true;
    signed_handle?: true;
  };
  job: ScanJob;
  job_handle?: SignedJobHandle;
  raw_scan_start: SiteScanStartEnvelope;
};

export type SiteScanPerformanceOptions = {
  strategy: "mobile" | "desktop";
  location: string | null;
};

export type ScanOrchestratorDependencies<TEnv> = {
  executeSyncProbe(probe: SiteScanSyncProbe, target: string, maxRedirects: number): Promise<unknown>;
  executeAsyncProvider(
    env: TEnv,
    provider: SiteScanAsyncProvider,
    target: string,
    requestUrl: URL,
    options: SiteScanPerformanceOptions,
  ): Promise<unknown>;
  createRunId(normalizedTarget: string): string;
};

export type ScanJobHandleEnv = {
  SCAN_JOB_HANDLE_SECRET?: string;
  SCAN_JOB_HANDLE_KID?: string;
  SCAN_JOB_HANDLE_TTL_SECONDS?: string;
  SCAN_JOB_HANDLE_MAX_PAYLOAD_BYTES?: string;
  SCAN_JOB_HANDLE_MAX_TOKEN_BYTES?: string;
};

const DEFAULT_MAX_REDIRECTS = 10;

export async function createSiteScanStart<TEnv>(input: {
  env: TEnv;
  target: string;
  body: ProbeRequest;
  requestUrl: URL;
  dependencies: ScanOrchestratorDependencies<TEnv>;
}): Promise<SiteScanStartEnvelope> {
  const normalizedUrl = normalizeTargetUrl(input.target);
  const normalizedTarget = new URL(normalizedUrl).hostname.toLowerCase();
  const syncProbes = parseSiteScanSyncProbes(input.body.sync_probes);
  const asyncProviders = parseSiteScanAsyncProviders(input.body.async_providers);
  const maxRedirects = parseMaxRedirects(input.body.max_redirects);
  const performanceOptions = {
    strategy: parseLighthouseStrategy(input.body.strategy),
    location: typeof input.body.location === "string" && input.body.location.trim() ? input.body.location.trim() : null,
  };
  const syncEntries = await Promise.all(
    syncProbes.map(async (probe) => [
      probe,
      await runSiteScanSyncProbe(input.dependencies, probe, input.target, maxRedirects),
    ] as const),
  );
  const asyncJobs = await Promise.all(
    asyncProviders.map((provider) =>
      runSiteScanAsyncProvider(input.dependencies, input.env, provider, input.target, input.requestUrl, performanceOptions),
    ),
  );
  const syncResults = Object.fromEntries(syncEntries) as Record<string, SiteScanResultEnvelope<unknown>>;
  const collected = Object.entries(syncResults)
    .filter(([, result]) => result.status === "fulfilled")
    .map(([probe]) => probe);
  const failed = Object.entries(syncResults)
    .filter(([, result]) => result.status === "rejected")
    .map(([probe]) => probe);
  const pending = asyncJobs
    .filter((job) => !job.error && job.status !== "error")
    .filter((job) => job.status !== "completed")
    .map((job) => job.capability);
  const completedAsync = asyncJobs
    .filter((job) => job.status === "completed" && !job.error)
    .map((job) => job.capability);
  const failedAsync = asyncJobs
    .filter((job) => job.error || job.status === "error")
    .map((job) => job.capability);

  return {
    schema_version: "site-10-layer-scan-start/v0.1",
    provider: "cloudflare_worker_site_scan",
    requested_url: input.target,
    normalized_url: normalizedUrl,
    normalized_target: normalizedTarget,
    status: failed.length > 0 ? "partial" : "ok",
    sync_probes: syncProbes,
    async_providers: asyncProviders,
    scan_policy: createDefaultScanPolicy({
      target: input.target,
      normalizedTarget,
      requestedSyncProbes: syncProbes,
      requestedAsyncProviders: asyncProviders,
      maxRedirects,
    }),
    sync_results: syncResults,
    async_jobs: asyncJobs,
    coverage: {
      collected: [...collected, ...completedAsync],
      pending,
      failed: [...failed, ...failedAsync],
      limitations: [
        "This backend contract returns raw provider results and async job descriptors; SnapshotRecord normalization remains in the Web App/core adapter layer.",
        "Long-running GitHub Actions providers are started asynchronously and must be polled through their status/result endpoints.",
        "PageSpeed is a synchronous external provider and may return a completed result envelope directly inside async_jobs.",
      ],
    },
  };
}

export async function createSiteScanExport<TEnv>(input: {
  env: TEnv;
  target: string;
  body: ProbeRequest;
  requestUrl: URL;
  dependencies: ScanOrchestratorDependencies<TEnv>;
}) {
  const createdAt = new Date().toISOString();
  const scanStartEnvelope = await createSiteScanStart(input);

  return createScanExportArtifact({
    id: input.dependencies.createRunId(scanStartEnvelope.normalized_target),
    target: input.target,
    normalizedTarget: scanStartEnvelope.normalized_target,
    createdAt,
    generatedAt: new Date().toISOString(),
    source: "provider",
    providers: [],
    scanStartEnvelope,
  });
}

export async function createSiteScanJob<TEnv>(input: {
  env: TEnv;
  target: string;
  body: ProbeRequest;
  requestUrl: URL;
  dependencies: ScanOrchestratorDependencies<TEnv>;
}): Promise<SiteScanJobEnvelope> {
  const createdAt = new Date().toISOString();
  const scanStartEnvelope = await createSiteScanStart(input);
  const job = createScanJobFromStartEnvelope({
    id: input.dependencies.createRunId(scanStartEnvelope.normalized_target),
    target: input.target,
    normalizedTarget: scanStartEnvelope.normalized_target,
    createdAt,
    updatedAt: new Date().toISOString(),
    providers: [],
    scanStartEnvelope,
  });

  return {
    ...(await createSiteScanJobEnvelope(job, new Date().toISOString(), false, createSignedJobHandleConfig(input.env))),
    raw_scan_start: scanStartEnvelope,
  };
}

export async function collectSiteScanJob(input: { body: ProbeRequest; env: ScanJobHandleEnv }): Promise<SiteScanJobEnvelope> {
  const handleConfig = createSignedJobHandleConfig(input.env);
  const job = await parseCallerOwnedScanJob(input.body, handleConfig);
  const asyncResultEnvelopes = parseAsyncResultEnvelopes(input.body.async_result_envelopes);
  const updatedAt = new Date().toISOString();
  const updatedJob = applyProviderResultEnvelopes(job, {
    asyncResultEnvelopes,
    updatedAt,
  });

  return createSiteScanJobEnvelope(updatedJob, updatedAt, true, handleConfig);
}

export async function createCallerOwnedSiteScanJobArtifact(input: { body: ProbeRequest; env: ScanJobHandleEnv }) {
  const job = await parseCallerOwnedScanJob(input.body, createSignedJobHandleConfig(input.env));
  const generatedAt = getString(input.body as Record<string, unknown>, "generated_at") ?? new Date().toISOString();

  return createScanJobArtifact(job, {
    generatedAt,
    source: "provider",
  });
}

async function runSiteScanSyncProbe<TEnv>(
  dependencies: ScanOrchestratorDependencies<TEnv>,
  probe: SiteScanSyncProbe,
  target: string,
  maxRedirects: number,
): Promise<SiteScanResultEnvelope<unknown>> {
  try {
    const result = await dependencies.executeSyncProbe(probe, target, maxRedirects);
    return {
      status: "fulfilled",
      result,
    };
  } catch (error) {
    return {
      status: "rejected",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runSiteScanAsyncProvider<TEnv>(
  dependencies: ScanOrchestratorDependencies<TEnv>,
  env: TEnv,
  provider: SiteScanAsyncProvider,
  target: string,
  requestUrl: URL,
  options: SiteScanPerformanceOptions,
): Promise<SiteScanAsyncJob> {
  try {
    const result = await dependencies.executeAsyncProvider(env, provider, target, requestUrl, options);
    if (!isPlainObject(result)) {
      throw new Error(`${provider} provider returned a non-object result.`);
    }

    if (result.ok === false) {
      return createFailedAsyncProviderJob(provider, result);
    }

    if (provider === "pagespeed") {
      return {
        capability: provider,
        provider: getString(result, "provider") ?? "pagespeed",
        provider_schema_version: getString(result, "schema_version"),
        request_id: null,
        run_id: null,
        status: "completed",
        status_code: null,
        conclusion: "success",
        html_url: null,
        endpoints: {
          status: null,
          result: null,
        },
        result_envelope: result,
      };
    }

    const requestId = typeof result.request_id === "string" ? result.request_id : null;
    const providerName = getString(result, "provider") ?? providerToResultProviderName(provider);
    const resultEndpoints = isPlainObject(result.endpoints) ? result.endpoints : null;
    return {
      capability: provider,
      provider: providerName,
      provider_schema_version: getString(result, "schema_version"),
      request_id: requestId,
      run_id: typeof result.run_id === "number" ? result.run_id : null,
      status: getString(result, "status") ?? "queued",
      status_code: getNumber(result, "status_code"),
      conclusion: getString(result, "conclusion"),
      html_url: getString(result, "html_url"),
      endpoints: {
        status: getString(resultEndpoints ?? {}, "status") ?? createAsyncProviderEndpoints(requestUrl, provider, requestId).status,
        result: getString(resultEndpoints ?? {}, "result") ?? createAsyncProviderEndpoints(requestUrl, provider, requestId).result,
      },
    };
  } catch (error) {
    return {
      capability: provider,
      provider: providerToResultProviderName(provider),
      provider_schema_version: null,
      request_id: null,
      run_id: null,
      status: "error",
      status_code: null,
      conclusion: null,
      html_url: null,
      endpoints: {
        status: null,
        result: null,
      },
      error_code: "site_scan_async_provider_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createAsyncProviderEndpoints(requestUrl: URL, provider: SiteScanAsyncProvider, requestId: string | null) {
  if (!requestId) {
    return {
      status: null,
      result: null,
    };
  }

  const basePath =
    provider === "browser_runtime"
      ? "/provider/github/browser-runtime"
      : provider === "live_tls"
        ? "/provider/github/live-tls"
        : provider === "lighthouse"
          ? "/provider/github/lighthouse"
          : provider === "webpagetest"
            ? "/provider/performance/webpagetest"
            : null;
  if (!basePath) {
    return {
      status: null,
      result: null,
    };
  }
  const statusUrl = new URL(requestUrl.toString());
  statusUrl.pathname = `${basePath}/status`;
  statusUrl.search = "";
  statusUrl.searchParams.set("id", requestId);

  const resultUrl = new URL(requestUrl.toString());
  resultUrl.pathname = `${basePath}/result`;
  resultUrl.search = "";
  resultUrl.searchParams.set("id", requestId);

  return {
    status: statusUrl.toString(),
    result: resultUrl.toString(),
  };
}

function providerToResultProviderName(provider: SiteScanAsyncProvider): string {
  if (provider === "browser_runtime") return "github_actions_browser_runtime";
  if (provider === "live_tls") return "github_actions_live_tls";
  if (provider === "lighthouse") return "github_actions_lighthouse";
  return provider;
}

function createFailedAsyncProviderJob(provider: SiteScanAsyncProvider, result: Record<string, unknown>): SiteScanAsyncJob {
  return {
    capability: provider,
    provider: getString(result, "provider") ?? providerToResultProviderName(provider),
    provider_schema_version: getString(result, "schema_version"),
    request_id: getString(result, "request_id"),
    run_id: null,
    status: "error",
    status_code: getNumber(result, "status"),
    conclusion: null,
    html_url: getString(result, "html_url"),
    endpoints: {
      status: null,
      result: null,
    },
    error_code: getString(result, "error_code") ?? "provider_request_failed",
    error: getString(result, "error") ?? "Provider returned an error result.",
    retryable: getBoolean(result, "retryable") ?? true,
    retry_after_seconds: getNumber(result, "retry_after_seconds"),
    missing_config: getStringArray(result, "missing_config"),
  };
}

async function createSiteScanJobEnvelope(
  job: ScanJob,
  generatedAt: string,
  callerOwnedState: boolean,
  handleConfig: SignedJobHandleConfig | null,
): Promise<SiteScanJobEnvelope> {
  const jobHandle = handleConfig ? await createSignedJobHandle(job, handleConfig) : null;
  return {
    schema_version: "site-10-layer-scan-job/v0.1",
    generated_at: generatedAt,
    boundaries: {
      storage_persisted: false,
      frontend_state_mutated: false,
      v1_scan_start_preserved: true,
      ...(callerOwnedState ? { caller_owned_state: true } : {}),
      ...(jobHandle ? { signed_handle: true } : {}),
    },
    job,
    ...(jobHandle ? { job_handle: jobHandle } : {}),
    raw_scan_start: job.raw_inputs.scan_start_envelope,
  };
}

async function parseCallerOwnedScanJob(body: ProbeRequest, handleConfig: SignedJobHandleConfig | null): Promise<ScanJob> {
  if (body.job_handle !== undefined) {
    if (!handleConfig) {
      throw new Error("Signed job handles require SCAN_JOB_HANDLE_SECRET and SCAN_JOB_HANDLE_KID.");
    }
    return verifySignedJobHandle(body.job_handle, handleConfig);
  }

  const job = isPlainObject(body.job) ? body.job : null;
  if (!job) {
    throw new Error("Request body requires a caller-owned job object or job_handle.");
  }
  if (typeof job.id !== "string" || typeof job.target !== "string" || typeof job.normalized_target !== "string") {
    throw new Error("Caller-owned job must include id, target, and normalized_target.");
  }
  if (!isPlainObject(job.raw_inputs)) {
    throw new Error("Caller-owned job must include raw_inputs.");
  }
  return job as unknown as ScanJob;
}

function createSignedJobHandleConfig(env: ScanJobHandleEnv): SignedJobHandleConfig | null {
  if (!env.SCAN_JOB_HANDLE_SECRET && !env.SCAN_JOB_HANDLE_KID) return null;
  if (!env.SCAN_JOB_HANDLE_SECRET || !env.SCAN_JOB_HANDLE_KID) {
    throw new Error("Signed job handles require both SCAN_JOB_HANDLE_SECRET and SCAN_JOB_HANDLE_KID.");
  }

  return {
    secret: env.SCAN_JOB_HANDLE_SECRET,
    kid: env.SCAN_JOB_HANDLE_KID,
    ttlSeconds: parsePositiveInteger(env.SCAN_JOB_HANDLE_TTL_SECONDS, 3600, "SCAN_JOB_HANDLE_TTL_SECONDS"),
    maxPayloadBytes: parsePositiveInteger(env.SCAN_JOB_HANDLE_MAX_PAYLOAD_BYTES, 1_000_000, "SCAN_JOB_HANDLE_MAX_PAYLOAD_BYTES"),
    maxTokenBytes: parsePositiveInteger(env.SCAN_JOB_HANDLE_MAX_TOKEN_BYTES, 1_500_000, "SCAN_JOB_HANDLE_MAX_TOKEN_BYTES"),
  };
}

function parsePositiveInteger(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseAsyncResultEnvelopes(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new Error("async_result_envelopes must be an object when provided.");
  }
  return value;
}

function parseMaxRedirects(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_REDIRECTS;
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 20) {
    throw new Error("max_redirects must be an integer between 0 and 20.");
  }

  return parsed;
}

function parseSiteScanSyncProbes(value: unknown): SiteScanSyncProbe[] {
  const allowed: SiteScanSyncProbe[] = [
    "dns_infrastructure",
    "tls_certificate",
    "subdomain_attack_surface",
    "service_fingerprint",
    "public_host_fingerprint",
    "public_security_details",
    "public_content_surface",
    "public_content_detail",
    "public_spa_metadata",
    "organization_intelligence",
    "api_reachability",
    "remote_fetch",
    "performance_basic",
  ];

  if (value === undefined) return allowed;
  if (!Array.isArray(value)) {
    throw new Error("sync_probes must be an array when provided.");
  }

  const probes = value.map((item) => {
    if (typeof item !== "string" || !allowed.includes(item as SiteScanSyncProbe)) {
      throw new Error(`sync_probes values must be one of: ${allowed.join(", ")}.`);
    }
    return item as SiteScanSyncProbe;
  });

  return Array.from(new Set(probes));
}

function parseSiteScanAsyncProviders(value: unknown): SiteScanAsyncProvider[] {
  const allowed: SiteScanAsyncProvider[] = ["browser_runtime", "live_tls", "lighthouse", "pagespeed", "webpagetest"];

  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("async_providers must be an array when provided.");
  }

  const providers = value.map((item) => {
    if (typeof item !== "string" || !allowed.includes(item as SiteScanAsyncProvider)) {
      throw new Error(`async_providers values must be one of: ${allowed.join(", ")}.`);
    }
    return item as SiteScanAsyncProvider;
  });

  return Array.from(new Set(providers));
}

function parseLighthouseStrategy(value: unknown): "mobile" | "desktop" {
  return value === "desktop" ? "desktop" : "mobile";
}

function normalizeTargetUrl(value: string): string {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https targets are supported. Received: ${url.protocol}`);
  }

  url.hash = "";
  return url.toString();
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function getStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

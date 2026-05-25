import type { LayerProbeContext } from "../../core/probe-contract";
import type { ProviderConfig, SnapshotRecord, SnapshotStatus } from "../../core/types";
import type {
  DnsInfrastructureResult,
  OrganizationIntelligenceResult,
  PublicHostFingerprintResult,
  ServiceFingerprintResult,
  SubdomainAttackSurfaceResult,
  TlsCertificateResult,
} from "../dns-tls/types";
import type { BasicPerformanceResult, PerformanceMetric, PerformanceProviderResult } from "../performance/types";
import type { ApiReachabilityResult } from "../api-reachability/types";
import type { PublicSecurityDetailsResult } from "../public-security-details/types";
import type { PublicContentSurfaceResult } from "../public-content-surface/types";
import type { PublicContentDetailResult } from "../public-content-detail/types";
import type { PublicSpaMetadataResult } from "../public-spa-metadata/types";
import type { RemoteFetchResult } from "../remote-fetch/types";
import { createBrowserRuntimeDerivedRecords } from "../../probes/layer-04-browser-runtime";
import { createCdnHeaderEvidenceRecord, createNetworkLayerRecords } from "../../probes/layer-01-network";
import { createTlsLayerRecords } from "../../probes/layer-02-tls";
import { createHttpLayerRecords } from "../../probes/layer-03-http";
import { createFrontendLayerRecords } from "../../probes/layer-04-frontend";
import { createPublicContentSurfaceLayerRecords } from "../../probes/layer-04-public-content";
import { createPublicContentDetailLayerRecords } from "../../probes/layer-04-public-content-detail";
import { createPublicSpaMetadataLayerRecords } from "../../probes/layer-04-spa-metadata";
import { createBasicPerformanceLayerRecords, createPerformanceLayerRecords } from "../../probes/layer-05-performance";
import { createApiLayerRecords, createApiReachabilityLayerRecords, createPublicSecurityDetailsLayerRecords } from "../../probes/layer-06-api";
import { createPublicHostFingerprintLayerRecords, createServiceFingerprintLayerRecords, createSubdomainLayerRecords } from "../../probes/layer-07-subdomains";
import { createAppFingerprintRecords } from "../../probes/layer-08-app-fingerprint";
import { createOrganizationLayerRecords } from "../../probes/layer-09-organization";
import { createSecurityHeaderRecords } from "../../probes/layer-10-security";

export type ProviderResultNormalizationInput = {
  target: string;
  normalizedTarget?: string;
  snapshotAt?: string;
  providers?: ProviderConfig[];
  envelope: unknown;
};

export type SiteScanProviderResultsNormalizationInput = Omit<ProviderResultNormalizationInput, "envelope"> & {
  scanStartEnvelope: unknown;
  asyncResultEnvelopes?: Record<string, unknown>;
};

type ProviderResultStatusValue = {
  schema_version: "site-10-layer-provider-result-status/v0.1";
  provider: string;
  provider_schema_version: string | null;
  request_id: string | null;
  status: string | number | boolean | null;
  conclusion: string | null;
  status_code: number | null;
  status_text: string | null;
  error_code: string | null;
  error: string | null;
  missing_config: string[];
  coverage: unknown;
  next_step: string | null;
  html_url: string | null;
};

type WebPageTestResultSummary = {
  provider: "webpagetest";
  request_id: string | null;
  url: string | null;
  summary: string | null;
  location: string | null;
  metrics: Array<{
    id: string;
    label: string;
    value: number | null;
    unit: string;
  }>;
  limitations?: string[];
};

type SiteScanAsyncJobSummary = {
  capability: string;
  provider: string;
  provider_schema_version: string | null;
  request_id: string | null;
  run_id: number | null;
  status: string;
  status_code: number | null;
  conclusion: string | null;
  html_url: string | null;
  error_code: string | null;
  error: string | null;
  missing_config: string[];
  result_envelope: unknown;
};

export function normalizeProviderResult(input: ProviderResultNormalizationInput): SnapshotRecord[] {
  const context = createContext(input);
  const envelope = asRecord(input.envelope);

  if (!envelope) {
    return [
      createProviderStatusRecord(context, {
        provider: "unknown_provider",
        providerSchemaVersion: null,
        source: input.envelope,
        status: "error",
        errorCode: "invalid_provider_result",
        error: "Provider result envelope must be an object.",
      }),
    ];
  }

  const importedRecords = readSnapshotRecords(envelope.records);
  if (importedRecords.length > 0) {
    return [...importedRecords, ...createBrowserRuntimeDerivedRecords(importedRecords)].sort(sortRecords);
  }

  if (isSiteScanStartEnvelope(envelope)) {
    return normalizeSiteScanStartEnvelope(context, envelope);
  }

  if (isPerformanceProviderEnvelope(envelope)) {
    return createPerformanceLayerRecords(context, envelope.result);
  }

  if (isWebPageTestResultEnvelope(envelope)) {
    return createPerformanceLayerRecords(context, mapWebPageTestResult(context, envelope.result));
  }

  return [createProviderStatusRecord(context, createStatusRecordInput(envelope))];
}

export function normalizeSiteScanProviderResults(input: SiteScanProviderResultsNormalizationInput): SnapshotRecord[] {
  const context = createContext(input);
  const scanRecords = normalizeProviderResult({
    ...input,
    envelope: input.scanStartEnvelope,
  });
  const scanEnvelope = asRecord(input.scanStartEnvelope);
  const siteScanAsyncJobs = readSiteScanAsyncJobs(scanEnvelope?.async_jobs);
  const embeddedAsyncResultEnvelopes = Object.fromEntries(
    siteScanAsyncJobs
      .filter((job) => job.result_envelope !== null && job.result_envelope !== undefined)
      .map((job) => [job.capability, job.result_envelope]),
  );
  const asyncResultEnvelopes = {
    ...embeddedAsyncResultEnvelopes,
    ...(input.asyncResultEnvelopes ?? {}),
  };
  const asyncRecords = Object.values(asyncResultEnvelopes).flatMap((envelope) =>
    normalizeProviderResult({
      ...input,
      envelope,
    }),
  );
  const completedAsyncCapabilities = new Set(Object.keys(asyncResultEnvelopes));
  const asyncJobStatusRecords = siteScanAsyncJobs
    .filter((job) => !completedAsyncCapabilities.has(job.capability))
    .map((job) => createAsyncJobStatusRecord(context, job));

  return [...scanRecords, ...asyncRecords, ...asyncJobStatusRecords].sort(sortRecords);
}

function normalizeSiteScanStartEnvelope(
  context: LayerProbeContext,
  envelope: Record<string, unknown> & { sync_results: Record<string, unknown> },
): SnapshotRecord[] {
  return Object.entries(envelope.sync_results).flatMap(([probe, resultEnvelope]) =>
    normalizeSiteScanSyncResult(context, probe, resultEnvelope),
  ).sort(sortRecords);
}

function createAsyncJobStatusRecord(context: LayerProbeContext, job: SiteScanAsyncJobSummary): SnapshotRecord {
  const isError = job.status === "error" || Boolean(job.error);
  return createProviderStatusRecord(context, {
    provider: job.provider || `site_scan_async_${job.capability}`,
    providerSchemaVersion: job.provider_schema_version ?? "site-10-layer-scan-start/v0.1",
    source: {
      request_id: job.request_id,
      run_id: job.run_id,
      status: job.status,
      status_code: job.status_code,
      conclusion: job.conclusion,
      html_url: job.html_url,
      error_code: job.error_code,
      error: job.error,
      missing_config: job.missing_config,
    },
    status: isError ? "error" : "skipped",
    errorCode: isError ? (job.error_code ?? "site_scan_async_provider_failed") : null,
    error: job.error,
  });
}

function normalizeSiteScanSyncResult(context: LayerProbeContext, probe: string, resultEnvelope: unknown): SnapshotRecord[] {
  const envelope = asRecord(resultEnvelope);

  if (!envelope) {
    return [
      createProviderStatusRecord(context, {
        provider: `site_scan_sync_${probe}`,
        providerSchemaVersion: "site-10-layer-scan-start/v0.1",
        source: {
          status: "rejected",
          error: "Sync result envelope must be an object.",
        },
        status: "error",
        errorCode: "invalid_site_scan_sync_result",
        error: "Sync result envelope must be an object.",
      }),
    ];
  }

  if (envelope.status === "fulfilled") {
    return normalizeFulfilledSiteScanSyncResult(context, probe, envelope.result);
  }

  return [
    createProviderStatusRecord(context, {
      provider: `site_scan_sync_${probe}`,
      providerSchemaVersion: "site-10-layer-scan-start/v0.1",
      source: {
        status: "rejected",
        error: getString(envelope, "error"),
      },
      status: "error",
      errorCode: "site_scan_sync_probe_failed",
      error: getString(envelope, "error") ?? "Site scan sync probe failed.",
    }),
  ];
}

function normalizeFulfilledSiteScanSyncResult(context: LayerProbeContext, probe: string, result: unknown): SnapshotRecord[] {
  if (probe === "dns_infrastructure" && isDnsInfrastructureResult(result)) {
    return createNetworkLayerRecords(context, result);
  }

  if (probe === "tls_certificate" && isTlsCertificateResult(result)) {
    return createTlsLayerRecords(context, result);
  }

  if (probe === "remote_fetch" && isRemoteFetchResult(result)) {
    return createRemoteFetchDerivedRecords(context, result);
  }

  if (probe === "performance_basic" && isBasicPerformanceResult(result)) {
    return createBasicPerformanceLayerRecords(context, result);
  }

  if (probe === "subdomain_attack_surface" && isSubdomainAttackSurfaceResult(result)) {
    return createSubdomainLayerRecords(context, result);
  }

  if (probe === "service_fingerprint" && isServiceFingerprintResult(result)) {
    return createServiceFingerprintLayerRecords(context, result);
  }

  if (probe === "public_host_fingerprint" && isPublicHostFingerprintResult(result)) {
    return createPublicHostFingerprintLayerRecords(context, result);
  }

  if (probe === "organization_intelligence" && isOrganizationIntelligenceResult(result)) {
    return createOrganizationLayerRecords(context, result);
  }

  if (probe === "api_reachability" && isApiReachabilityResult(result)) {
    return createApiReachabilityLayerRecords(context, result);
  }

  if (probe === "public_security_details" && isPublicSecurityDetailsResult(result)) {
    return createPublicSecurityDetailsLayerRecords(context, result);
  }

  if (probe === "public_content_surface" && isPublicContentSurfaceResult(result)) {
    return createPublicContentSurfaceLayerRecords(context, result);
  }

  if (probe === "public_content_detail" && isPublicContentDetailResult(result)) {
    return createPublicContentDetailLayerRecords(context, result);
  }

  if (probe === "public_spa_metadata" && isPublicSpaMetadataResult(result)) {
    return createPublicSpaMetadataLayerRecords(context, result);
  }

  return [
    createProviderStatusRecord(context, {
      provider: `site_scan_sync_${probe}`,
      providerSchemaVersion: "site-10-layer-scan-start/v0.1",
      source: {
        status: "fulfilled",
      },
      status: "skipped",
      errorCode: "unsupported_site_scan_sync_result",
      error: `No SnapshotRecord normalizer is available for fulfilled ${probe} sync results yet.`,
    }),
  ];
}

function isApiReachabilityResult(value: unknown): value is ApiReachabilityResult {
  const result = asRecord(value);
  if (!result) return false;

  const limits = asRecord(result.limits);
  const coverage = asRecord(result.coverage);

  return (
    typeof result.requested_url === "string" &&
    typeof result.final_url === "string" &&
    typeof result.host === "string" &&
    Array.isArray(result.candidates) &&
    Array.isArray(result.checks) &&
    Array.isArray(result.skipped) &&
    typeof limits?.max_candidates === "number" &&
    typeof limits?.checked_count === "number" &&
    limits?.same_origin_only === true &&
    Array.isArray(limits?.methods) &&
    typeof limits?.preview_bytes === "number" &&
    Array.isArray(coverage?.collected) &&
    Array.isArray(coverage?.missing) &&
    Array.isArray(coverage?.limitations) &&
    typeof result.duration_ms === "number" &&
    result.provider_id === "cloudflare_worker_api_reachability" &&
    result.source === "cloudflare_worker_api_reachability"
  );
}

function isPublicSecurityDetailsResult(value: unknown): value is PublicSecurityDetailsResult {
  const result = asRecord(value);
  if (!result) return false;

  const limits = asRecord(result.limits);
  const coverage = asRecord(result.coverage);

  return (
    typeof result.requested_url === "string" &&
    typeof result.host === "string" &&
    Array.isArray(result.checks) &&
    typeof limits?.max_hosts === "number" &&
    typeof limits?.checked_hosts === "number" &&
    typeof limits?.max_requests_per_host === "number" &&
    typeof limits?.max_concurrency === "number" &&
    typeof limits?.timeout_ms === "number" &&
    typeof limits?.preview_bytes === "number" &&
    Array.isArray(coverage?.collected) &&
    Array.isArray(coverage?.missing) &&
    Array.isArray(coverage?.limitations) &&
    typeof result.duration_ms === "number" &&
    result.provider_id === "cloudflare_worker_public_security_details" &&
    result.source === "cloudflare_worker_public_security_details"
  );
}

function isPublicContentSurfaceResult(value: unknown): value is PublicContentSurfaceResult {
  const result = asRecord(value);
  if (!result) return false;

  const limits = asRecord(result.limits);
  const coverage = asRecord(result.coverage);

  return (
    typeof result.requested_url === "string" &&
    typeof result.host === "string" &&
    Array.isArray(result.candidate_urls) &&
    Array.isArray(result.surfaces) &&
    typeof limits?.max_candidate_urls === "number" &&
    typeof limits?.max_pages === "number" &&
    typeof limits?.max_concurrency === "number" &&
    typeof limits?.timeout_ms === "number" &&
    typeof limits?.max_page_bytes === "number" &&
    typeof limits?.max_index_bytes === "number" &&
    Array.isArray(coverage?.collected) &&
    Array.isArray(coverage?.missing) &&
    Array.isArray(coverage?.limitations) &&
    typeof result.duration_ms === "number" &&
    result.provider_id === "cloudflare_worker_public_content_surface" &&
    result.source === "cloudflare_worker_public_content_surface"
  );
}

function isPublicContentDetailResult(value: unknown): value is PublicContentDetailResult {
  const result = asRecord(value);
  if (!result) return false;

  const limits = asRecord(result.limits);
  const coverage = asRecord(result.coverage);

  return (
    typeof result.requested_url === "string" &&
    typeof result.host === "string" &&
    Array.isArray(result.candidate_urls) &&
    Array.isArray(result.detail_pages) &&
    typeof limits?.max_seed_pages === "number" &&
    typeof limits?.max_candidate_urls === "number" &&
    typeof limits?.max_detail_pages === "number" &&
    typeof limits?.max_concurrency === "number" &&
    typeof limits?.timeout_ms === "number" &&
    typeof limits?.max_seed_page_bytes === "number" &&
    typeof limits?.max_detail_page_bytes === "number" &&
    typeof limits?.max_index_bytes === "number" &&
    Array.isArray(coverage?.collected) &&
    Array.isArray(coverage?.missing) &&
    Array.isArray(coverage?.limitations) &&
    typeof result.duration_ms === "number" &&
    result.provider_id === "cloudflare_worker_public_content_detail" &&
    result.source === "cloudflare_worker_public_content_detail"
  );
}

function isPublicSpaMetadataResult(value: unknown): value is PublicSpaMetadataResult {
  const result = asRecord(value);
  if (!result) return false;

  const limits = asRecord(result.limits);
  const coverage = asRecord(result.coverage);
  const htmlShell = asRecord(result.html_shell);

  return (
    typeof result.requested_url === "string" &&
    typeof result.host === "string" &&
    isRecord(htmlShell) &&
    Array.isArray(result.declared_assets) &&
    Array.isArray(result.fetched_asset_previews) &&
    Array.isArray(result.route_candidates) &&
    Array.isArray(result.component_candidates) &&
    Array.isArray(result.detected_signals) &&
    typeof limits?.max_declared_assets === "number" &&
    typeof limits?.max_asset_previews === "number" &&
    typeof limits?.max_asset_preview_bytes === "number" &&
    typeof limits?.max_entry_asset_preview_bytes === "number" &&
    typeof limits?.max_referenced_asset_previews === "number" &&
    typeof limits?.max_referenced_asset_preview_bytes === "number" &&
    typeof limits?.max_route_candidates === "number" &&
    typeof limits?.max_component_candidates === "number" &&
    typeof limits?.timeout_ms === "number" &&
    Array.isArray(coverage?.collected) &&
    Array.isArray(coverage?.missing) &&
    Array.isArray(coverage?.limitations) &&
    typeof result.duration_ms === "number" &&
    result.provider_id === "cloudflare_worker_public_spa_metadata" &&
    result.source === "cloudflare_worker_public_spa_metadata"
  );
}

function createRemoteFetchDerivedRecords(context: LayerProbeContext, result: RemoteFetchResult): SnapshotRecord[] {
  const cdnHeaderRecord = createCdnHeaderEvidenceRecord(context, [
    {
      url: result.final_url,
      scope: "main_response",
      headers: result.headers,
      source: result.source,
    },
  ]);

  return [
    ...(cdnHeaderRecord ? [cdnHeaderRecord] : []),
    ...createHttpLayerRecords(context, result),
    ...createFrontendLayerRecords(context, result),
    ...createApiLayerRecords(context, result),
    ...createAppFingerprintRecords(context, result),
    ...createSecurityHeaderRecords(context, result),
  ].sort(sortRecords);
}

function createContext(input: {
  target: string;
  normalizedTarget?: string;
  snapshotAt?: string;
  providers?: ProviderConfig[];
}): LayerProbeContext {
  return {
    target: input.target,
    normalizedTarget: input.normalizedTarget ?? normalizeTargetLabel(input.target),
    snapshotAt: input.snapshotAt ?? new Date().toISOString(),
    providers: input.providers ?? [],
  };
}

function createStatusRecordInput(envelope: Record<string, unknown>) {
  const provider = getString(envelope, "provider") ?? "unknown_provider";
  const hasError = getBoolean(envelope, "ok") === false || Boolean(getString(envelope, "error_code") ?? getString(envelope, "error"));

  return {
    provider,
    providerSchemaVersion: getString(envelope, "schema_version"),
    source: envelope,
    status: hasError ? ("error" as const) : ("skipped" as const),
    errorCode: getString(envelope, "error_code"),
    error: getString(envelope, "error"),
  };
}

function createProviderStatusRecord(
  context: LayerProbeContext,
  input: {
    provider: string;
    providerSchemaVersion: string | null;
    source: unknown;
    status: SnapshotStatus;
    errorCode: string | null;
    error: string | null;
  },
): SnapshotRecord<ProviderResultStatusValue> {
  const source = asRecord(input.source) ?? {};
  const isError = input.status === "error";

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "provider_result_status",
    layer: resolveProviderLayer(input.provider, input.providerSchemaVersion),
    item: "provider_result_status",
    probe_type: "external_provider",
    source: input.provider,
    status: input.status,
    value: {
      schema_version: "site-10-layer-provider-result-status/v0.1",
      provider: input.provider,
      provider_schema_version: input.providerSchemaVersion,
      request_id: getString(source, "request_id"),
      status: readEnvelopeStatus(source),
      conclusion: getString(source, "conclusion"),
      status_code: getNumber(source, "status_code") ?? getNumber(source, "status"),
      status_text: getString(source, "status_text"),
      error_code: input.errorCode,
      error: input.error,
      missing_config: getStringArray(source, "missing_config"),
      coverage: source.coverage,
      next_step: getString(source, "next_step"),
      html_url: getString(source, "html_url"),
    },
    risk: {
      level: "info",
      summary: isError
        ? `${input.provider} provider did not return usable target evidence: ${input.errorCode ?? "provider_error"}.`
        : `${input.provider} provider result is not completed evidence yet.`,
    },
    evidence: [
      {
        type: isError ? "provider_error" : "provider_status",
        name: input.errorCode ?? input.provider,
        value: {
          provider: input.provider,
          provider_schema_version: input.providerSchemaVersion,
          request_id: getString(source, "request_id"),
          status: readEnvelopeStatus(source),
          status_code: getNumber(source, "status_code") ?? getNumber(source, "status"),
          error_code: input.errorCode,
          error: input.error,
          missing_config: getStringArray(source, "missing_config"),
        },
      },
    ],
    evidence_metadata: {
      origin: "external_provider",
      role: "derived",
      method: "external_api",
      limitations: [
        "Provider status records describe provider state only.",
        "They are not positive target evidence and must not be counted as layer coverage.",
      ],
    },
  };
}

function isPerformanceProviderEnvelope(
  envelope: Record<string, unknown>,
): envelope is Record<string, unknown> & { result: PerformanceProviderResult } {
  return (
    envelope.ok === true &&
    envelope.schema_version === "site-10-layer-performance-provider-result/v0.1" &&
    isPerformanceProviderResult(envelope.result)
  );
}

function isPerformanceProviderResult(value: unknown): value is PerformanceProviderResult {
  const result = asRecord(value);
  if (!result) return false;

  return (
    typeof result.requested_url === "string" &&
    (typeof result.final_url === "string" || result.final_url === null) &&
    (result.provider === "pagespeed" || result.provider === "lighthouse" || result.provider === "webpagetest" || result.provider === "manual") &&
    Array.isArray(result.metrics) &&
    Array.isArray(result.opportunities) &&
    isRecord(result.raw_summary) &&
    typeof result.provider_id === "string" &&
    typeof result.source === "string"
  );
}

function isWebPageTestResultEnvelope(
  envelope: Record<string, unknown>,
): envelope is Record<string, unknown> & { result: WebPageTestResultSummary } {
  const result = asRecord(envelope.result);
  return (
    envelope.ok === true &&
    envelope.schema_version === "site-10-layer-webpagetest-result/v0.1" &&
    result?.provider === "webpagetest" &&
    Array.isArray(result.metrics)
  );
}

function isSiteScanStartEnvelope(
  envelope: Record<string, unknown>,
): envelope is Record<string, unknown> & { sync_results: Record<string, unknown> } {
  return envelope.schema_version === "site-10-layer-scan-start/v0.1" && isRecord(envelope.sync_results);
}

function isRemoteFetchResult(value: unknown): value is RemoteFetchResult {
  const result = asRecord(value);
  if (!result) return false;

  return (
    typeof result.requested_url === "string" &&
    typeof result.final_url === "string" &&
    typeof result.status_code === "number" &&
    typeof result.ok === "boolean" &&
    typeof result.redirected === "boolean" &&
    Array.isArray(result.redirect_chain) &&
    isRecord(result.headers) &&
    typeof result.html === "string" &&
    typeof result.duration_ms === "number" &&
    typeof result.provider_id === "string" &&
    typeof result.source === "string"
  );
}

function isDnsInfrastructureResult(value: unknown): value is DnsInfrastructureResult {
  const result = asRecord(value);
  if (!result) return false;

  const dns = asRecord(result.dns);
  const ipAddresses = asRecord(result.ip_addresses);
  const cdn = asRecord(result.cdn);
  const asn = asRecord(result.asn);
  const protocolReachability = asRecord(result.protocol_reachability);

  return (
    typeof result.requested_url === "string" &&
    typeof result.host === "string" &&
    isDnsQueryResult(dns?.a, "A") &&
    isDnsQueryResult(dns?.aaaa, "AAAA") &&
    isDnsQueryResult(dns?.cname, "CNAME") &&
    isDnsQueryResult(dns?.https, "HTTPS") &&
    Array.isArray(ipAddresses?.ipv4) &&
    Array.isArray(ipAddresses?.ipv6) &&
    typeof cdn?.detected === "boolean" &&
    Array.isArray(cdn?.providers) &&
    Array.isArray(cdn?.evidence) &&
    typeof asn?.provider === "string" &&
    Array.isArray(asn?.records) &&
    isProtocolReachability(protocolReachability?.http) &&
    isProtocolReachability(protocolReachability?.https) &&
    typeof result.duration_ms === "number" &&
    typeof result.provider_id === "string" &&
    typeof result.source === "string"
  );
}

function isTlsCertificateResult(value: unknown): value is TlsCertificateResult {
  const result = asRecord(value);
  if (!result) return false;

  const hsts = asRecord(result.hsts);
  const ctLog = asRecord(result.ct_log);
  const currentCertificate = asRecord(result.current_certificate);
  const coverage = asRecord(result.coverage);

  return (
    typeof result.requested_url === "string" &&
    typeof result.host === "string" &&
    isProtocolReachability(result.https_reachability) &&
    typeof hsts?.present === "boolean" &&
    (typeof hsts?.raw === "string" || hsts?.raw === null) &&
    typeof hsts?.include_subdomains === "boolean" &&
    typeof hsts?.preload === "boolean" &&
    typeof ctLog?.provider === "string" &&
    Array.isArray(ctLog?.certificates) &&
    isRecord(currentCertificate) &&
    Array.isArray(coverage?.collected) &&
    Array.isArray(coverage?.missing) &&
    typeof result.duration_ms === "number" &&
    typeof result.provider_id === "string" &&
    typeof result.source === "string"
  );
}

function isSubdomainAttackSurfaceResult(value: unknown): value is SubdomainAttackSurfaceResult {
  const result = asRecord(value);
  if (!result) return false;

  const ctLog = asRecord(result.ct_log);
  const limits = asRecord(result.limits);

  return (
    typeof result.requested_url === "string" &&
    typeof result.host === "string" &&
    typeof ctLog?.provider === "string" &&
    typeof ctLog?.status === "string" &&
    Array.isArray(result.discovered_subdomains) &&
    Array.isArray(result.reachability) &&
    Array.isArray(result.exposed_surface_hints) &&
    typeof limits?.max_reachability_checks === "number" &&
    typeof limits?.checked_count === "number" &&
    typeof result.duration_ms === "number" &&
    typeof result.provider_id === "string" &&
    typeof result.source === "string"
  );
}

function isServiceFingerprintResult(value: unknown): value is ServiceFingerprintResult {
  const result = asRecord(value);
  if (!result) return false;

  const limits = asRecord(result.limits);
  const coverage = asRecord(result.coverage);

  return (
    typeof result.requested_url === "string" &&
    typeof result.host === "string" &&
    Array.isArray(result.checked_hosts) &&
    typeof limits?.max_hosts === "number" &&
    typeof limits?.checked_hosts === "number" &&
    typeof limits?.max_requests_per_host === "number" &&
    typeof limits?.max_concurrency === "number" &&
    typeof limits?.timeout_ms === "number" &&
    Array.isArray(coverage?.collected) &&
    Array.isArray(coverage?.missing) &&
    Array.isArray(coverage?.limitations) &&
    typeof result.duration_ms === "number" &&
    typeof result.provider_id === "string" &&
    typeof result.source === "string"
  );
}

function isPublicHostFingerprintResult(value: unknown): value is PublicHostFingerprintResult {
  const result = asRecord(value);
  if (!result) return false;

  const limits = asRecord(result.limits);
  const coverage = asRecord(result.coverage);

  return (
    typeof result.requested_url === "string" &&
    typeof result.host === "string" &&
    Array.isArray(result.candidate_hosts) &&
    Array.isArray(result.checked_hosts) &&
    typeof limits?.max_hosts === "number" &&
    typeof limits?.checked_hosts === "number" &&
    typeof limits?.max_requests_per_host === "number" &&
    typeof limits?.max_concurrency === "number" &&
    typeof limits?.timeout_ms === "number" &&
    typeof limits?.max_sitemap_bytes === "number" &&
    Array.isArray(coverage?.collected) &&
    Array.isArray(coverage?.missing) &&
    Array.isArray(coverage?.limitations) &&
    typeof result.duration_ms === "number" &&
    result.provider_id === "cloudflare_worker_public_host_fingerprint" &&
    result.source === "cloudflare_worker_public_host_fingerprint"
  );
}

function isOrganizationIntelligenceResult(value: unknown): value is OrganizationIntelligenceResult {
  const result = asRecord(value);
  if (!result) return false;

  const dns = asRecord(result.dns);

  return (
    typeof result.requested_url === "string" &&
    typeof result.host === "string" &&
    isDnsQueryResult(dns?.mx, "MX") &&
    isDnsQueryResult(dns?.ns, "NS") &&
    isDnsQueryResult(dns?.txt, "TXT") &&
    isDnsQueryResult(dns?.caa, "CAA") &&
    Array.isArray(result.mail_providers) &&
    Array.isArray(result.social_links) &&
    Array.isArray(result.related_domain_candidates) &&
    isRecord(result.external_intelligence) &&
    typeof result.duration_ms === "number" &&
    typeof result.provider_id === "string" &&
    typeof result.source === "string"
  );
}

function isDnsQueryResult(value: unknown, type: string): boolean {
  const result = asRecord(value);
  return result?.type === type && typeof result.status === "number" && Array.isArray(result.answers);
}

function isProtocolReachability(value: unknown): boolean {
  const result = asRecord(value);
  return (
    typeof result?.url === "string" &&
    typeof result.reachable === "boolean" &&
    (typeof result.status_code === "number" || result.status_code === null) &&
    (typeof result.redirected_to === "string" || result.redirected_to === null) &&
    (typeof result.error === "string" || result.error === null)
  );
}

function isBasicPerformanceResult(value: unknown): value is BasicPerformanceResult {
  const result = asRecord(value);
  if (!result) return false;

  return (
    typeof result.requested_url === "string" &&
    typeof result.final_url === "string" &&
    typeof result.status_code === "number" &&
    typeof result.ok === "boolean" &&
    isRecord(result.timings) &&
    isRecord(result.document) &&
    isRecord(result.declared_resources) &&
    Array.isArray(result.sampled_resources) &&
    isRecord(result.page_weight_estimate) &&
    isRecord(result.coverage) &&
    typeof result.duration_ms === "number" &&
    typeof result.provider_id === "string" &&
    typeof result.source === "string"
  );
}

function mapWebPageTestResult(context: LayerProbeContext, result: WebPageTestResultSummary): PerformanceProviderResult {
  return {
    requested_url: result.url ?? context.target,
    final_url: result.url,
    strategy: "unknown",
    provider: "webpagetest",
    metrics: result.metrics.map(mapWebPageTestMetric),
    opportunities: [],
    raw_summary: {
      performance_score: null,
    },
    duration_ms: 0,
    provider_id: "webpagetest",
    source: "webpagetest_api",
  };
}

function mapWebPageTestMetric(metric: WebPageTestResultSummary["metrics"][number]): PerformanceMetric {
  return {
    id: metric.id,
    label: metric.label,
    value: metric.value,
    unit: mapMetricUnit(metric.unit),
    rating: "unknown",
  };
}

function readSnapshotRecords(value: unknown): SnapshotRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSnapshotRecord);
}

function readSiteScanAsyncJobs(value: unknown): SiteScanAsyncJobSummary[] {
  if (!Array.isArray(value)) return [];

  return value.map(readSiteScanAsyncJob).filter((job): job is SiteScanAsyncJobSummary => Boolean(job));
}

function readSiteScanAsyncJob(value: unknown): SiteScanAsyncJobSummary | null {
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
    status: getString(job, "status") ?? "unknown",
    status_code: getNumber(job, "status_code"),
    conclusion: getString(job, "conclusion"),
    html_url: getString(job, "html_url"),
    error_code: getString(job, "error_code"),
    error: getString(job, "error"),
    missing_config: getStringArray(job, "missing_config"),
    result_envelope: job.result_envelope,
  };
}

function isSnapshotRecord(value: unknown): value is SnapshotRecord {
  const record = asRecord(value);
  if (!record) return false;

  return (
    typeof record.target === "string" &&
    typeof record.normalized_target === "string" &&
    typeof record.snapshot_at === "string" &&
    typeof record.probe === "string" &&
    typeof record.layer === "number" &&
    typeof record.item === "string" &&
    typeof record.status === "string" &&
    isRecord(record.risk) &&
    Array.isArray(record.evidence)
  );
}

function resolveProviderLayer(provider: string, schemaVersion: string | null): number {
  const text = `${provider} ${schemaVersion ?? ""}`.toLowerCase();
  if (text.includes("dns_infrastructure")) return 1;
  if (text.includes("live_tls") || text.includes("tls")) return 2;
  if (text.includes("remote_fetch")) return 3;
  if (text.includes("browser_runtime")) return 4;
  if (text.includes("lighthouse") || text.includes("pagespeed") || text.includes("webpagetest") || text.includes("performance")) {
    return 5;
  }
  if (text.includes("public_security_details")) return 6;
  if (text.includes("public_content_surface")) return 4;
  if (text.includes("public_content_detail")) return 4;
  if (text.includes("public_spa_metadata")) return 4;
  if (text.includes("subdomain") || text.includes("service_fingerprint") || text.includes("public_host_fingerprint")) return 7;
  if (text.includes("ai_classifier")) return 4;
  if (text.includes("organization")) return 9;
  return 0;
}

function mapMetricUnit(value: string): PerformanceMetric["unit"] {
  if (value === "score" || value === "ms" || value === "bytes" || value === "count") return value;
  return "unknown";
}

function readEnvelopeStatus(source: Record<string, unknown>): string | number | boolean | null {
  const raw = source.status ?? source.status_code ?? source.ok ?? null;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
  return null;
}

function sortRecords(a: SnapshotRecord, b: SnapshotRecord): number {
  return a.layer - b.layer || a.probe.localeCompare(b.probe);
}

function normalizeTargetLabel(value: string): string {
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return value.trim().toLowerCase() || "target";
  }
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

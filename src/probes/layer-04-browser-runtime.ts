import type { Evidence, RiskLevel, SnapshotRecord, SnapshotStatus } from "../core/types";
import { createCdnHeaderEvidenceRecord } from "./layer-01-network";

type RuntimeResource = {
  url: string;
  method: string;
  resource_type: string;
  status_code: number | null;
  failure: string | null;
  request_id?: string;
  domain?: string | null;
  same_origin?: boolean | null;
  content_type?: string | null;
  cache_control?: string | null;
  cdn_headers?: Record<string, string>;
  transfer_size?: number | null;
  encoded_body_size?: number | null;
  decoded_body_size?: number | null;
  duration_ms?: number | null;
  start_time_ms?: number | null;
  timing_source?: string;
};

type RuntimeConsoleMessage = {
  type: string;
  text: string;
  location?: string | null;
};

type RuntimeSecuritySummary = {
  mixed_content_candidates?: Array<{
    url: string;
    resource_type: string;
    reason: string;
  }>;
  failed_request_count?: number;
  console_error_count?: number;
};

type BrowserPageValue = {
  final_url: string;
  status_code: number | null;
  title: string;
  html_bytes: number;
  visible_text_bytes: number;
  resource_counts: Record<string, number>;
  resources: RuntimeResource[];
  console_messages?: RuntimeConsoleMessage[];
  page_errors?: string[];
  runtime_security?: RuntimeSecuritySummary;
  screenshot_path: string | null;
  access_barrier: {
    detected: boolean;
    types: string[];
    title: string;
    visible_text_sample: string;
  };
};

export function createBrowserRuntimeDerivedRecords(records: SnapshotRecord[]): SnapshotRecord[] {
  const alreadyDerived = new Set(records.map((record) => record.probe));
  const derived: SnapshotRecord[] = [];

  for (const record of records) {
    if (record.probe !== "browser_page_probe" || !isBrowserPageValue(record.value)) continue;

    if (!alreadyDerived.has("browser_runtime_page_probe")) {
      derived.push(createRuntimePageRecord(record, record.value));
    }

    if (!alreadyDerived.has("cdn_header_evidence_probe")) {
      const cdnHeaderRecord = createRuntimeCdnHeaderEvidenceRecord(record, record.value);
      if (cdnHeaderRecord) {
        derived.push(cdnHeaderRecord);
      }
    }

    if (!alreadyDerived.has("runtime_resource_summary_probe")) {
      derived.push(createRuntimeResourceSummaryRecord(record, record.value));
    }

    if (!alreadyDerived.has("runtime_resource_waterfall_probe")) {
      derived.push(createRuntimeResourceWaterfallRecord(record, record.value));
    }

    if (!alreadyDerived.has("runtime_resource_bytes_probe") && hasRuntimeSizeFields(record.value.resources)) {
      derived.push(createRuntimeResourceBytesRecord(record, record.value));
    }

    if (!alreadyDerived.has("runtime_asset_cache_policy_probe") && hasRuntimeCachePolicyFields(record.value.resources)) {
      derived.push(createRuntimeAssetCachePolicyRecord(record, record.value));
    }

    if (!alreadyDerived.has("runtime_third_party_resources_probe")) {
      derived.push(createRuntimeThirdPartyRecord(record, record.value));
    }

    if (!alreadyDerived.has("runtime_api_requests_probe")) {
      derived.push(createRuntimeApiRequestsRecord(record, record.value));
    }

    if (!alreadyDerived.has("runtime_security_events_probe") && hasRuntimeSecurityFields(record.value)) {
      derived.push(createRuntimeSecurityEventsRecord(record, record.value));
    }

    if (record.value.screenshot_path && !alreadyDerived.has("runtime_screenshot_evidence_probe")) {
      derived.push(createRuntimeScreenshotRecord(record, record.value));
    }
  }

  return derived;
}

function createRuntimeCdnHeaderEvidenceRecord(sourceRecord: SnapshotRecord, value: BrowserPageValue): SnapshotRecord | null {
  return createCdnHeaderEvidenceRecord(
    {
      target: sourceRecord.target,
      normalizedTarget: sourceRecord.normalized_target,
      snapshotAt: sourceRecord.snapshot_at,
      providers: [],
    },
    value.resources
      .filter((resource) => resource.cdn_headers && Object.keys(resource.cdn_headers).length > 0)
      .map((resource) => ({
        url: resource.url,
        scope: "runtime_resource",
        resource_type: resource.resource_type,
        headers: resource.cdn_headers ?? {},
        source: `${sourceRecord.source} + browser_runtime_import_adapter`,
      })),
  );
}

function createRuntimePageRecord(sourceRecord: SnapshotRecord, value: BrowserPageValue): SnapshotRecord {
  const barrierDetected = value.access_barrier.detected;

  return createDerivedRecord(sourceRecord, {
    probe: "browser_runtime_page_probe",
    item: "browser_runtime_page",
    status: barrierDetected ? "warning" : "ok",
    riskLevel: barrierDetected ? "medium" : "info",
    summary: barrierDetected
      ? `Browser runtime detected an access barrier: ${value.access_barrier.types.join(", ")}.`
      : "Browser runtime loaded the page and captured rendered-page evidence.",
    value: {
      final_url: value.final_url,
      status_code: value.status_code,
      title: value.title,
      html_bytes: value.html_bytes,
      visible_text_bytes: value.visible_text_bytes,
      access_barrier: value.access_barrier,
      browser: sourceRecord.browser ?? null,
    },
    evidence: [
      { type: "final_url", value: value.final_url },
      { type: "status_code", value: value.status_code },
      { type: "html_title", value: value.title },
      ...(barrierDetected ? [{ type: "barrier_type", value: value.access_barrier.types }] : []),
    ],
  });
}

function createRuntimeResourceSummaryRecord(sourceRecord: SnapshotRecord, value: BrowserPageValue): SnapshotRecord {
  const totalResources = value.resources.length;
  const risk = classifyResourceCountRisk(totalResources);

  return createDerivedRecord(sourceRecord, {
    probe: "runtime_resource_summary_probe",
    item: "runtime_resource_summary",
    status: risk.level === "info" ? "ok" : "warning",
    riskLevel: risk.level,
    summary: risk.summary,
    value: {
      final_url: value.final_url,
      total_resources: totalResources,
      resource_counts: value.resource_counts,
      failed_resources: value.resources.filter((resource) => resource.failure || isErrorStatus(resource.status_code)).length,
      limitation:
        hasRuntimeSizeFields(value.resources)
          ? "Browser timing sizes can be null when browser privacy, caching, or Timing-Allow-Origin hides transfer details."
          : "This imported browser artifact does not include transfer size / encoded body size / decoded body size.",
    },
    evidence: [
      { type: "runtime_resource_count", value: totalResources },
      { type: "runtime_resource_counts", value: value.resource_counts },
    ],
  });
}

function createRuntimeResourceBytesRecord(sourceRecord: SnapshotRecord, value: BrowserPageValue): SnapshotRecord {
  const byResourceType = summarizeResourceBytes(value.resources);
  const totals = byResourceType.reduce(
    (acc, group) => ({
      transfer_size: acc.transfer_size + group.transfer_size,
      encoded_body_size: acc.encoded_body_size + group.encoded_body_size,
      decoded_body_size: acc.decoded_body_size + group.decoded_body_size,
      known_transfer_count: acc.known_transfer_count + group.known_transfer_count,
      unknown_transfer_count: acc.unknown_transfer_count + group.unknown_transfer_count,
    }),
    {
      transfer_size: 0,
      encoded_body_size: 0,
      decoded_body_size: 0,
      known_transfer_count: 0,
      unknown_transfer_count: 0,
    },
  );
  const risk = classifyRuntimeBytesRisk(totals.transfer_size, totals.unknown_transfer_count);

  return createDerivedRecord(sourceRecord, {
    probe: "runtime_resource_bytes_probe",
    layer: 4,
    item: "runtime_resource_bytes",
    status: risk.level === "info" ? "ok" : "warning",
    riskLevel: risk.level,
    summary: risk.summary,
    value: {
      final_url: value.final_url,
      resource_count: value.resources.length,
      totals,
      by_resource_type: byResourceType,
      limitations: [
        "Transfer and body sizes come from browser Performance APIs when available.",
        "Some resources can report null sizes because of browser privacy, caching, or Timing-Allow-Origin boundaries.",
        "The browser runtime environment is the provider runner, not the user's device or geography.",
      ],
    },
    evidence: [
      { type: "runtime_transfer_size_total", value: totals.transfer_size },
      { type: "runtime_transfer_size_known_count", value: totals.known_transfer_count },
      { type: "runtime_transfer_size_unknown_count", value: totals.unknown_transfer_count },
    ],
  });
}

function createRuntimeAssetCachePolicyRecord(sourceRecord: SnapshotRecord, value: BrowserPageValue): SnapshotRecord {
  const assetResources = value.resources.filter(isCacheRelevantAsset);
  const policies = assetResources.map((resource) => analyzeRuntimeAssetCachePolicy(resource));
  const knownPolicies = policies.filter((policy) => policy.cache_control);
  const unknownPolicies = policies.filter((policy) => !policy.cache_control);
  const summary = summarizeAssetCachePolicies(policies);
  const risk = classifyRuntimeAssetCacheRisk(summary);

  return createDerivedRecord(sourceRecord, {
    probe: "runtime_asset_cache_policy_probe",
    layer: 4,
    item: "runtime_asset_cache_policy",
    status: risk.level === "info" ? "ok" : "warning",
    riskLevel: risk.level,
    summary: risk.summary,
    value: {
      final_url: value.final_url,
      asset_count: assetResources.length,
      known_policy_count: knownPolicies.length,
      unknown_policy_count: unknownPolicies.length,
      cacheability_counts: summary.cacheability_counts,
      long_lived_count: summary.long_lived_count,
      immutable_count: summary.immutable_count,
      no_store_count: summary.no_store_count,
      no_cache_count: summary.no_cache_count,
      unversioned_long_lived_count: summary.unversioned_long_lived_count,
      policies: policies.slice(0, 120),
      limitations: [
        "This record analyzes runtime resource response headers, not the main document response.",
        "Only resources observed during one browser page load are included.",
        "Some browser/provider environments may omit resource response headers.",
      ],
    },
    evidence: [
      { type: "runtime_asset_cache_known_count", value: knownPolicies.length },
      { type: "runtime_asset_cache_unknown_count", value: unknownPolicies.length },
      { type: "runtime_asset_cache_long_lived_count", value: summary.long_lived_count },
      { type: "runtime_asset_cache_unversioned_long_lived_count", value: summary.unversioned_long_lived_count },
    ],
  });
}

function createRuntimeResourceWaterfallRecord(sourceRecord: SnapshotRecord, value: BrowserPageValue): SnapshotRecord {
  const failedResources = value.resources.filter((resource) => resource.failure || isErrorStatus(resource.status_code));
  const apiLikeResources = value.resources.filter((resource) => ["xhr", "fetch"].includes(resource.resource_type));
  const risk = classifyWaterfallRisk(failedResources.length, apiLikeResources.length);

  return createDerivedRecord(sourceRecord, {
    probe: "runtime_resource_waterfall_probe",
    item: "runtime_resource_waterfall",
    status: risk.level === "info" ? "ok" : "warning",
    riskLevel: risk.level,
    summary: risk.summary,
    value: {
      final_url: value.final_url,
      resource_count: value.resources.length,
      failed_count: failedResources.length,
      api_like_count: apiLikeResources.length,
      resources: value.resources.slice(0, 200),
      failed_resources: failedResources.slice(0, 50),
      api_like_resources: apiLikeResources.slice(0, 50),
    },
    evidence: [
      { type: "failed_resource_count", value: failedResources.length },
      { type: "api_like_resource_count", value: apiLikeResources.length },
    ],
  });
}

function createRuntimeApiRequestsRecord(sourceRecord: SnapshotRecord, value: BrowserPageValue): SnapshotRecord {
  const apiResources = value.resources.filter(isRuntimeApiLikeResource);
  const failedResources = apiResources.filter((resource) => resource.failure || isErrorStatus(resource.status_code));
  const sameOriginCount = apiResources.filter((resource) => isSameOriginResource(value.final_url, resource)).length;
  const thirdPartyCount = apiResources.filter((resource) => isThirdPartyResource(value.final_url, resource)).length;
  const risk = classifyRuntimeApiRisk(apiResources.length, failedResources.length, thirdPartyCount);

  return createDerivedRecord(sourceRecord, {
    probe: "runtime_api_requests_probe",
    layer: 6,
    item: "runtime_api_requests",
    status: risk.level === "info" ? "ok" : "warning",
    riskLevel: risk.level,
    summary: risk.summary,
    value: {
      final_url: value.final_url,
      request_count: apiResources.length,
      xhr_fetch_count: apiResources.filter((resource) => ["xhr", "fetch"].includes(resource.resource_type)).length,
      same_origin_count: sameOriginCount,
      third_party_count: thirdPartyCount,
      failed_count: failedResources.length,
      requests: apiResources.slice(0, 100).map((resource) => ({
        url: resource.url,
        method: resource.method,
        resource_type: resource.resource_type,
        status_code: resource.status_code,
        failure: resource.failure,
        domain: resource.domain ?? safeHostname(resource.url),
        same_origin: resource.same_origin ?? isSameOriginResource(value.final_url, resource),
        content_type: resource.content_type ?? null,
      })),
      limitations: [
        "Runtime API requests are observed during one browser page load only.",
        "This record does not validate endpoint reachability beyond the observed request result.",
        "Hidden, authenticated, delayed, or interaction-triggered APIs may not appear.",
      ],
    },
    evidence: [
      { type: "runtime_api_request_count", value: apiResources.length },
      { type: "runtime_api_failed_count", value: failedResources.length },
      { type: "runtime_api_third_party_count", value: thirdPartyCount },
    ],
  });
}

function createRuntimeThirdPartyRecord(sourceRecord: SnapshotRecord, value: BrowserPageValue): SnapshotRecord {
  const origin = safeOrigin(value.final_url);
  const thirdParty = value.resources
    .map((resource) => ({ ...resource, domain: safeHostname(resource.url), same_origin: safeOrigin(resource.url) === origin }))
    .filter((resource) => resource.domain && !resource.same_origin);
  const scriptResources = thirdParty.filter((resource) => resource.resource_type === "script");
  const risk = classifyThirdPartyRisk(scriptResources.length, thirdParty.length);

  return createDerivedRecord(sourceRecord, {
    probe: "runtime_third_party_resources_probe",
    item: "runtime_third_party_resources",
    status: risk.level === "info" ? "ok" : "warning",
    riskLevel: risk.level,
    summary: risk.summary,
    value: {
      final_url: value.final_url,
      third_party_resource_count: thirdParty.length,
      third_party_script_count: scriptResources.length,
      domains: countBy(thirdParty.map((resource) => resource.domain).filter((domain): domain is string => Boolean(domain))),
      resources: thirdParty.slice(0, 100),
    },
    evidence: thirdParty.slice(0, 20).map((resource) => ({
      type: "third_party_resource",
      name: resource.resource_type,
      value: resource.url,
    })),
  });
}

function createRuntimeSecurityEventsRecord(sourceRecord: SnapshotRecord, value: BrowserPageValue): SnapshotRecord {
  const runtimeSecurity = value.runtime_security ?? {};
  const failedResources = value.resources.filter((resource) => resource.failure || isErrorStatus(resource.status_code));
  const consoleMessages = value.console_messages ?? [];
  const consoleErrors = consoleMessages.filter((message) => message.type === "error");
  const pageErrors = value.page_errors ?? [];
  const mixedContentCandidates = runtimeSecurity.mixed_content_candidates ?? inferMixedContentCandidates(value.final_url, value.resources, consoleMessages);
  const risk = classifyRuntimeSecurityRisk(mixedContentCandidates.length, failedResources.length, consoleErrors.length, pageErrors.length);

  return createDerivedRecord(sourceRecord, {
    probe: "runtime_security_events_probe",
    layer: 10,
    item: "runtime_security_events",
    status: risk.level === "info" ? "ok" : "warning",
    riskLevel: risk.level,
    summary: risk.summary,
    value: {
      final_url: value.final_url,
      mixed_content_candidates: mixedContentCandidates.slice(0, 50),
      failed_request_count: runtimeSecurity.failed_request_count ?? failedResources.length,
      failed_requests: failedResources.slice(0, 50).map((resource) => ({
        url: resource.url,
        resource_type: resource.resource_type,
        status_code: resource.status_code,
        failure: resource.failure,
      })),
      console_error_count: runtimeSecurity.console_error_count ?? consoleErrors.length,
      console_errors: consoleErrors.slice(0, 50),
      page_errors: pageErrors.slice(0, 20),
      limitations: [
        "Runtime security events are captured from one browser load only.",
        "Console and page errors are review evidence, not automatically confirmed vulnerabilities.",
        "Authenticated flows, user interactions, and route-specific issues are outside this record.",
      ],
    },
    evidence: [
      { type: "runtime_mixed_content_candidate_count", value: mixedContentCandidates.length },
      { type: "runtime_failed_request_count", value: runtimeSecurity.failed_request_count ?? failedResources.length },
      { type: "runtime_console_error_count", value: runtimeSecurity.console_error_count ?? consoleErrors.length },
      { type: "runtime_page_error_count", value: pageErrors.length },
    ],
  });
}

function createRuntimeScreenshotRecord(sourceRecord: SnapshotRecord, value: BrowserPageValue): SnapshotRecord {
  return createDerivedRecord(sourceRecord, {
    probe: "runtime_screenshot_evidence_probe",
    layer: 4,
    item: "runtime_screenshot",
    status: "ok",
    riskLevel: "info",
    summary:
      "Browser runtime produced a screenshot path. If imported from GitHub Actions, the image file must be imported from the same artifact to render locally.",
    value: {
      final_url: value.final_url,
      screenshot_path: value.screenshot_path,
      artifact_note:
        "GitHub Actions screenshot paths are runner-local absolute paths; a zip artifact importer should rewrite them to artifact-relative paths.",
    },
    evidence: [{ type: "screenshot", value: value.screenshot_path }],
  });
}

function createDerivedRecord(
  sourceRecord: SnapshotRecord,
  input: {
    probe: string;
    layer?: number;
    item: string;
    status: SnapshotStatus;
    riskLevel: RiskLevel;
    summary: string;
    value: unknown;
    evidence: Evidence[];
  },
): SnapshotRecord {
  return {
    target: sourceRecord.target,
    normalized_target: sourceRecord.normalized_target,
    snapshot_at: sourceRecord.snapshot_at,
    probe: input.probe,
    layer: input.layer ?? 4,
    item: input.item,
    probe_type: "manual",
    source: `${sourceRecord.source} + browser_runtime_import_adapter`,
    status: input.status,
    value: input.value,
    risk: {
      level: input.riskLevel,
      summary: input.summary,
    },
    evidence: input.evidence,
    evidence_metadata: {
      origin: "runtime_observation",
      role: "derived",
      method: "browser_runtime",
      limitations: [
        "Browser runtime records are derived from imported runtime artifacts.",
        "Artifact paths, network visibility, and timing depend on the browser provider environment.",
        "Runtime resource records may still contain null transfer size, encoded body size, or decoded body size values.",
      ],
    },
    browser: sourceRecord.browser,
    duration_ms: sourceRecord.duration_ms,
  };
}

function isBrowserPageValue(value: unknown): value is BrowserPageValue {
  if (!isRecord(value)) return false;
  return (
    typeof value.final_url === "string" &&
    typeof value.title === "string" &&
    typeof value.html_bytes === "number" &&
    typeof value.visible_text_bytes === "number" &&
    isRecord(value.resource_counts) &&
    Array.isArray(value.resources) &&
    value.resources.every(isRuntimeResource) &&
    (typeof value.screenshot_path === "string" || value.screenshot_path === null) &&
    isRecord(value.access_barrier)
  );
}

function isRuntimeResource(value: unknown): value is RuntimeResource {
  if (!isRecord(value)) return false;
  return (
    typeof value.url === "string" &&
    typeof value.method === "string" &&
    typeof value.resource_type === "string" &&
    (typeof value.status_code === "number" || value.status_code === null) &&
    (typeof value.failure === "string" || value.failure === null)
  );
}

function hasRuntimeSizeFields(resources: RuntimeResource[]): boolean {
  return resources.some(
    (resource) =>
      "transfer_size" in resource ||
      "encoded_body_size" in resource ||
      "decoded_body_size" in resource ||
      "duration_ms" in resource ||
      "start_time_ms" in resource,
  );
}

function hasRuntimeCachePolicyFields(resources: RuntimeResource[]): boolean {
  return resources.some((resource) => "cache_control" in resource || "content_type" in resource);
}

function hasRuntimeSecurityFields(value: BrowserPageValue): boolean {
  return Array.isArray(value.console_messages) || Array.isArray(value.page_errors) || isRecord(value.runtime_security);
}

function analyzeRuntimeAssetCachePolicy(resource: RuntimeResource) {
  const directives = parseCacheControl(resource.cache_control ?? null);
  const maxAgeSeconds = parseDirectiveSeconds(directives, "max-age");
  const sharedMaxAgeSeconds = parseDirectiveSeconds(directives, "s-maxage");
  const effectiveMaxAgeSeconds = Math.max(maxAgeSeconds ?? 0, sharedMaxAgeSeconds ?? 0);
  const immutable = directives.has("immutable");
  const noStore = directives.has("no-store");
  const noCache = directives.has("no-cache");
  const cacheability = classifyAssetCacheability({
    cacheControl: resource.cache_control ?? null,
    maxAgeSeconds,
    sharedMaxAgeSeconds,
    noStore,
    noCache,
  });
  const versioned_url = hasVersionedAssetUrl(resource.url);

  return {
    url: resource.url,
    resource_type: resource.resource_type,
    content_type: resource.content_type ?? null,
    cache_control: resource.cache_control ?? null,
    cacheability,
    max_age_seconds: maxAgeSeconds,
    shared_max_age_seconds: sharedMaxAgeSeconds,
    effective_max_age_seconds: effectiveMaxAgeSeconds > 0 ? effectiveMaxAgeSeconds : null,
    immutable,
    no_store: noStore,
    no_cache: noCache,
    versioned_url,
    long_lived: effectiveMaxAgeSeconds >= 2_592_000,
    directives: Object.fromEntries(directives),
  };
}

function summarizeAssetCachePolicies(policies: ReturnType<typeof analyzeRuntimeAssetCachePolicy>[]) {
  return {
    cacheability_counts: countBy(policies.map((policy) => policy.cacheability)),
    long_lived_count: policies.filter((policy) => policy.long_lived).length,
    immutable_count: policies.filter((policy) => policy.immutable).length,
    no_store_count: policies.filter((policy) => policy.no_store).length,
    no_cache_count: policies.filter((policy) => policy.no_cache).length,
    unversioned_long_lived_count: policies.filter((policy) => policy.long_lived && !policy.versioned_url).length,
  };
}

function classifyRuntimeAssetCacheRisk(input: ReturnType<typeof summarizeAssetCachePolicies>): { level: RiskLevel; summary: string } {
  if (input.no_store_count > 0 || input.no_cache_count > 0) {
    return {
      level: "low",
      summary: `Runtime assets include ${input.no_store_count + input.no_cache_count} resource(s) that disable caching or require revalidation.`,
    };
  }

  if (input.unversioned_long_lived_count > 0) {
    return {
      level: "low",
      summary: `Runtime assets include ${input.unversioned_long_lived_count} long-lived resource(s) without obvious versioned URLs.`,
    };
  }

  if (input.long_lived_count > 0) {
    return {
      level: "info",
      summary: `Runtime assets include ${input.long_lived_count} long-lived cached resource(s).`,
    };
  }

  return {
    level: "info",
    summary: "Runtime asset cache headers were collected without obvious cache policy issues.",
  };
}

function summarizeResourceBytes(resources: RuntimeResource[]) {
  const groups = new Map<
    string,
    {
      resource_type: string;
      count: number;
      known_transfer_count: number;
      unknown_transfer_count: number;
      transfer_size: number;
      encoded_body_size: number;
      decoded_body_size: number;
    }
  >();

  for (const resource of resources) {
    const group = groups.get(resource.resource_type) ?? {
      resource_type: resource.resource_type,
      count: 0,
      known_transfer_count: 0,
      unknown_transfer_count: 0,
      transfer_size: 0,
      encoded_body_size: 0,
      decoded_body_size: 0,
    };

    group.count += 1;

    if (typeof resource.transfer_size === "number") {
      group.known_transfer_count += 1;
      group.transfer_size += resource.transfer_size;
    } else {
      group.unknown_transfer_count += 1;
    }

    if (typeof resource.encoded_body_size === "number") {
      group.encoded_body_size += resource.encoded_body_size;
    }

    if (typeof resource.decoded_body_size === "number") {
      group.decoded_body_size += resource.decoded_body_size;
    }

    groups.set(resource.resource_type, group);
  }

  return Array.from(groups.values()).sort((a, b) => b.transfer_size - a.transfer_size || b.count - a.count);
}

function classifyResourceCountRisk(count: number): { level: RiskLevel; summary: string } {
  if (count >= 120) {
    return { level: "medium", summary: `Browser runtime observed ${count} resources, which may indicate a heavy page.` };
  }
  if (count >= 60) {
    return { level: "low", summary: `Browser runtime observed ${count} resources.` };
  }
  return { level: "info", summary: `Browser runtime observed ${count} resources.` };
}

function classifyWaterfallRisk(failedCount: number, apiLikeCount: number): { level: RiskLevel; summary: string } {
  if (failedCount > 0) {
    return { level: "low", summary: `Browser runtime observed ${failedCount} failed resource(s).` };
  }
  if (apiLikeCount > 0) {
    return { level: "info", summary: `Browser runtime observed ${apiLikeCount} XHR/fetch resource(s) for later API analysis.` };
  }
  return { level: "info", summary: "Browser runtime resource waterfall was imported without failed resources." };
}

function classifyRuntimeBytesRisk(totalTransferSize: number, unknownTransferCount: number): { level: RiskLevel; summary: string } {
  const mib = totalTransferSize / 1024 / 1024;

  if (mib >= 5) {
    return { level: "medium", summary: `Browser runtime observed ${mib.toFixed(2)} MiB of known transfer size.` };
  }
  if (mib >= 2 || unknownTransferCount > 20) {
    return {
      level: "low",
      summary: `Browser runtime observed ${mib.toFixed(2)} MiB of known transfer size with ${unknownTransferCount} unknown resource size(s).`,
    };
  }
  return {
    level: "info",
    summary: `Browser runtime observed ${mib.toFixed(2)} MiB of known transfer size with ${unknownTransferCount} unknown resource size(s).`,
  };
}

function classifyRuntimeApiRisk(totalCount: number, failedCount: number, thirdPartyCount: number): { level: RiskLevel; summary: string } {
  if (failedCount > 0) {
    return { level: "low", summary: `Browser runtime observed ${failedCount} failed API-like request(s).` };
  }
  if (totalCount > 0) {
    return {
      level: "info",
      summary: `Browser runtime observed ${totalCount} API-like request(s), including ${thirdPartyCount} third-party request(s).`,
    };
  }
  return { level: "info", summary: "Browser runtime did not observe XHR/fetch/API-like requests during this page load." };
}

function classifyThirdPartyRisk(scriptCount: number, resourceCount: number): { level: RiskLevel; summary: string } {
  if (scriptCount >= 10) {
    return {
      level: "medium",
      summary: `Browser runtime observed ${scriptCount} third-party scripts and ${resourceCount} third-party resources.`,
    };
  }
  if (scriptCount >= 4 || resourceCount >= 20) {
    return {
      level: "low",
      summary: `Browser runtime observed ${scriptCount} third-party scripts and ${resourceCount} third-party resources.`,
    };
  }
  return {
    level: "info",
    summary: `Browser runtime observed ${scriptCount} third-party scripts and ${resourceCount} third-party resources.`,
  };
}

function classifyRuntimeSecurityRisk(
  mixedContentCount: number,
  failedRequestCount: number,
  consoleErrorCount: number,
  pageErrorCount: number,
): { level: RiskLevel; summary: string } {
  if (mixedContentCount > 0 || pageErrorCount > 0) {
    return {
      level: "medium",
      summary: `Browser runtime observed ${mixedContentCount} mixed-content candidate(s), ${pageErrorCount} page error(s), ${consoleErrorCount} console error(s), and ${failedRequestCount} failed request(s).`,
    };
  }
  if (failedRequestCount > 0 || consoleErrorCount > 0) {
    return {
      level: "low",
      summary: `Browser runtime observed ${consoleErrorCount} console error(s) and ${failedRequestCount} failed request(s).`,
    };
  }
  return { level: "info", summary: "Browser runtime did not observe mixed content, console errors, page errors, or failed requests." };
}

function isErrorStatus(statusCode: number | null): boolean {
  return typeof statusCode === "number" && statusCode >= 400;
}

function isRuntimeApiLikeResource(resource: RuntimeResource): boolean {
  if (["xhr", "fetch"].includes(resource.resource_type)) {
    return true;
  }

  try {
    const url = new URL(resource.url);
    return /\/(api|graphql|rpc|rest|v\d+)(\/|$)|\.json($|\?)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isCacheRelevantAsset(resource: RuntimeResource): boolean {
  if (["script", "stylesheet", "image", "font"].includes(resource.resource_type)) {
    return true;
  }

  const contentType = resource.content_type?.toLowerCase() ?? "";
  if (/javascript|css|image\/|font\/|application\/font|application\/wasm/.test(contentType)) {
    return true;
  }

  return /\.(?:js|mjs|css|png|jpe?g|webp|gif|svg|ico|avif|woff2?|ttf|otf|map)(?:$|\?)/i.test(safePathname(resource.url));
}

function parseCacheControl(value: string | null): Map<string, string | true> {
  const directives = new Map<string, string | true>();
  if (!value) return directives;

  for (const part of value.split(",")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    const name = rawName.trim().toLowerCase();
    if (!name) continue;

    const rawValue = rawValueParts.join("=").trim();
    directives.set(name, rawValue ? rawValue.replace(/^"|"$/g, "") : true);
  }

  return directives;
}

function parseDirectiveSeconds(directives: Map<string, string | true>, name: string): number | null {
  const value = directives.get(name);
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function classifyAssetCacheability(input: {
  cacheControl: string | null;
  maxAgeSeconds: number | null;
  sharedMaxAgeSeconds: number | null;
  noStore: boolean;
  noCache: boolean;
}): "cacheable" | "revalidate" | "disabled" | "unclear" {
  if (input.noStore) return "disabled";
  if (input.noCache) return "revalidate";
  if ((input.maxAgeSeconds ?? 0) > 0 || (input.sharedMaxAgeSeconds ?? 0) > 0) return "cacheable";
  if (input.cacheControl) return "revalidate";
  return "unclear";
}

function isSameOriginResource(finalUrl: string, resource: RuntimeResource): boolean {
  if (typeof resource.same_origin === "boolean") {
    return resource.same_origin;
  }

  return safeOrigin(resource.url) === safeOrigin(finalUrl);
}

function isThirdPartyResource(finalUrl: string, resource: RuntimeResource): boolean {
  return !isSameOriginResource(finalUrl, resource);
}

function inferMixedContentCandidates(
  finalUrl: string,
  resources: RuntimeResource[],
  consoleMessages: RuntimeConsoleMessage[],
): Array<{ url: string; resource_type: string; reason: string }> {
  const candidates = new Map<string, { url: string; resource_type: string; reason: string }>();
  const finalProtocol = safeProtocol(finalUrl);

  if (finalProtocol === "https:") {
    for (const resource of resources) {
      if (safeProtocol(resource.url) === "http:") {
        candidates.set(resource.url, {
          url: resource.url,
          resource_type: resource.resource_type,
          reason: "HTTP resource observed from an HTTPS page.",
        });
      }
    }
  }

  for (const message of consoleMessages) {
    if (/mixed content/i.test(message.text)) {
      const key = `${message.location ?? "console"}:${message.text}`;
      candidates.set(key, {
        url: message.location ?? "",
        resource_type: "console",
        reason: message.text.slice(0, 240),
      });
    }
  }

  return Array.from(candidates.values());
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function safePathname(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

function safeProtocol(value: string): string | null {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
}

function hasVersionedAssetUrl(value: string): boolean {
  const pathname = safePathname(value);
  return /(?:[.-][a-f0-9]{8,}|[?&](?:v|ver|version|hash)=)/i.test(pathname) || /[?&](?:v|ver|version|hash)=/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

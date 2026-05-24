import type { LayerProbeContext } from "../core/probe-contract";
import type { Evidence, RiskLevel, SnapshotRecord, SnapshotStatus } from "../core/types";
import type { RemoteFetchResult } from "../providers/remote-fetch/types";

type AccessBarrierType =
  | "cloudflare_challenge"
  | "captcha"
  | "http_401"
  | "http_403"
  | "http_429"
  | "generic_access_denied";

type Cacheability = "cacheable" | "revalidate" | "disabled" | "unclear";

type ResponseKind = "html" | "static_asset" | "other";

export function createHttpLayerRecords(context: LayerProbeContext, fetchResult: RemoteFetchResult): SnapshotRecord[] {
  return [
    createHttpHeadersRecord(context, fetchResult),
    createAccessBarrierRecord(context, fetchResult),
    createCachePolicyRecord(context, fetchResult),
  ];
}

function createHttpHeadersRecord(context: LayerProbeContext, fetchResult: RemoteFetchResult): SnapshotRecord {
  const evidence: Evidence[] = Object.entries(fetchResult.headers)
    .filter(([name]) => ["server", "x-powered-by", "cache-control", "content-type", "location"].includes(name))
    .map(([name, value]) => ({
      type: "http_header",
      name,
      value,
    }));

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "http_headers_probe",
    layer: 3,
    item: "http_headers",
    probe_type: "active_request",
    source: fetchResult.source,
    status: fetchResult.ok ? "ok" : "warning",
    value: {
      requested_url: fetchResult.requested_url,
      final_url: fetchResult.final_url,
      status_code: fetchResult.status_code,
      redirected: fetchResult.redirected,
      redirect_chain: fetchResult.redirect_chain,
      headers: fetchResult.headers,
    },
    risk: {
      level: fetchResult.ok ? "info" : "low",
      summary: fetchResult.ok
        ? `Final response returned HTTP ${fetchResult.status_code}.`
        : `Final response returned non-2xx HTTP ${fetchResult.status_code}.`,
    },
    evidence,
    evidence_metadata: {
      origin: "direct_observation",
      role: "raw",
      method: "fetch",
      limitations: [
        "HTTP response evidence applies to the probed main URL only.",
        "Other routes, assets, APIs, and subdomains may return different headers or status codes.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function createAccessBarrierRecord(context: LayerProbeContext, fetchResult: RemoteFetchResult): SnapshotRecord {
  const title = extractTitle(fetchResult.html);
  const barrierTypes = detectBarrierTypes(fetchResult, title);
  const barrierDetected = barrierTypes.length > 0;
  const riskLevel: RiskLevel = barrierDetected ? (barrierTypes.includes("http_429") ? "high" : "medium") : "info";
  const status: SnapshotStatus = barrierDetected ? "warning" : "ok";

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "access_barrier_probe",
    layer: 3,
    item: "access_barrier",
    probe_type: "active_request",
    source: `${fetchResult.source} + header_html_rules`,
    status,
    value: {
      final_url: fetchResult.final_url,
      status_code: fetchResult.status_code,
      barrier_detected: barrierDetected,
      barrier_types: barrierTypes,
      title,
      response_hints: {
        server: getHeader(fetchResult, "server"),
        cf_mitigated: getHeader(fetchResult, "cf-mitigated"),
        retry_after: getHeader(fetchResult, "retry-after"),
        content_type: getHeader(fetchResult, "content-type"),
      },
      impact: barrierDetected
        ? "The response may be an interstitial or challenge page. Downstream results may describe the barrier page instead of the intended target page."
        : "No common access barrier signal was detected in the first response.",
    },
    risk: {
      level: riskLevel,
      summary: barrierDetected
        ? `Access barrier detected: ${barrierTypes.join(", ")}.`
        : "No common access barrier signal detected.",
    },
    evidence: buildBarrierEvidence(fetchResult, title, barrierTypes),
    evidence_metadata: {
      origin: "static_heuristic",
      role: "derived",
      method: "static_parse",
      limitations: [
        "Access-barrier detection is based on status codes, response headers, title, and static HTML patterns.",
        "It does not prove whether a human browser session would pass or fail the barrier.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function createCachePolicyRecord(context: LayerProbeContext, fetchResult: RemoteFetchResult): SnapshotRecord {
  const cacheControl = getHeader(fetchResult, "cache-control");
  const directives = parseCacheControl(cacheControl);
  const expires = getHeader(fetchResult, "expires");
  const pragma = getHeader(fetchResult, "pragma");
  const etag = getHeader(fetchResult, "etag");
  const lastModified = getHeader(fetchResult, "last-modified");
  const vary = getHeader(fetchResult, "vary");
  const age = parseIntegerHeader(getHeader(fetchResult, "age"));
  const responseKind = detectResponseKind(fetchResult);
  const browserMaxAgeSeconds = parseDirectiveSeconds(directives, "max-age");
  const sharedMaxAgeSeconds = parseDirectiveSeconds(directives, "s-maxage");
  const immutable = directives.has("immutable");
  const noStore = directives.has("no-store");
  const noCache = directives.has("no-cache") || pragma?.toLowerCase() === "no-cache";
  const hasValidator = Boolean(etag || lastModified);
  const cdnCacheStatus = getCdnCacheStatus(fetchResult);
  const cacheability = classifyCacheability({
    noStore,
    noCache,
    browserMaxAgeSeconds,
    sharedMaxAgeSeconds,
    expires,
  });
  const risk = classifyCacheRisk({
    responseKind,
    cacheability,
    browserMaxAgeSeconds,
    sharedMaxAgeSeconds,
    immutable,
    hasValidator,
    finalUrl: fetchResult.final_url,
  });

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "cache_policy_probe",
    layer: 3,
    item: "cache_policy",
    probe_type: "active_request",
    source: `${fetchResult.source} + cache_header_rules`,
    status: risk.level === "info" ? "ok" : "warning",
    value: {
      requested_url: fetchResult.requested_url,
      final_url: fetchResult.final_url,
      status_code: fetchResult.status_code,
      response_kind: responseKind,
      cacheability,
      browser_max_age_seconds: browserMaxAgeSeconds,
      shared_max_age_seconds: sharedMaxAgeSeconds,
      immutable,
      has_validator: hasValidator,
      validator: etag ? "etag" : lastModified ? "last-modified" : null,
      cdn_cache_status: cdnCacheStatus,
      age_seconds: age,
      vary,
      directives: Object.fromEntries(directives),
      raw_headers: {
        "cache-control": cacheControl,
        pragma,
        expires,
        etag,
        "last-modified": lastModified,
        vary,
        age: getHeader(fetchResult, "age"),
        "cf-cache-status": getHeader(fetchResult, "cf-cache-status"),
        "x-cache": getHeader(fetchResult, "x-cache"),
        "x-cache-hits": getHeader(fetchResult, "x-cache-hits"),
        "server-timing": getHeader(fetchResult, "server-timing"),
      },
    },
    risk,
    evidence: buildCacheEvidence(fetchResult),
    evidence_metadata: {
      origin: "direct_observation",
      role: "derived",
      method: "fetch",
      limitations: [
        "Cache policy is interpreted from the probed main response headers.",
        "Asset-level cache behavior requires resource waterfall or direct asset probes.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function detectBarrierTypes(fetchResult: RemoteFetchResult, title: string | null): AccessBarrierType[] {
  const types = new Set<AccessBarrierType>();
  const lowerHtml = fetchResult.html.toLowerCase();
  const lowerTitle = title?.toLowerCase() ?? "";
  const cfMitigated = getHeader(fetchResult, "cf-mitigated");
  const server = getHeader(fetchResult, "server");

  if (cfMitigated?.toLowerCase() === "challenge" || (/cloudflare/i.test(server ?? "") && /just a moment/i.test(title ?? ""))) {
    types.add("cloudflare_challenge");
  }

  if (fetchResult.status_code === 401) types.add("http_401");
  if (fetchResult.status_code === 403) types.add("http_403");
  if (fetchResult.status_code === 429) types.add("http_429");

  if (/captcha|hcaptcha|recaptcha|turnstile|challenge-platform/.test(lowerHtml)) {
    types.add("captcha");
  }

  if (
    /access denied|forbidden|request blocked|bot detection/.test(lowerHtml) ||
    /access denied|forbidden|just a moment/.test(lowerTitle)
  ) {
    types.add("generic_access_denied");
  }

  return Array.from(types);
}

function buildBarrierEvidence(fetchResult: RemoteFetchResult, title: string | null, barrierTypes: AccessBarrierType[]): Evidence[] {
  const evidence: Evidence[] = [{ type: "http_status", value: fetchResult.status_code }];

  for (const headerName of ["server", "cf-mitigated", "retry-after", "content-type"]) {
    const value = getHeader(fetchResult, headerName);
    if (value) {
      evidence.push({ type: "http_header", name: headerName, value });
    }
  }

  if (title) evidence.push({ type: "html_title", value: title });
  if (barrierTypes.length > 0) evidence.push({ type: "barrier_type", value: barrierTypes });

  return evidence;
}

function extractTitle(html: string): string | null {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}

function getHeader(fetchResult: RemoteFetchResult, name: string): string | null {
  return fetchResult.headers[name.toLowerCase()] ?? null;
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

function parseIntegerHeader(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function detectResponseKind(fetchResult: RemoteFetchResult): ResponseKind {
  const contentType = getHeader(fetchResult, "content-type")?.toLowerCase() ?? "";
  const pathname = safePathname(fetchResult.final_url);

  if (contentType.includes("text/html")) return "html";
  if (/\.(?:js|mjs|css|png|jpe?g|webp|gif|svg|ico|avif|woff2?|ttf|otf|map)(?:$|\?)/i.test(pathname)) {
    return "static_asset";
  }

  if (
    /(?:javascript|css|image\/|font\/|application\/font|application\/wasm|application\/octet-stream)/i.test(contentType)
  ) {
    return "static_asset";
  }

  return "other";
}

function classifyCacheability(input: {
  noStore: boolean;
  noCache: boolean;
  browserMaxAgeSeconds: number | null;
  sharedMaxAgeSeconds: number | null;
  expires: string | null;
}): Cacheability {
  if (input.noStore) return "disabled";
  if (input.noCache) return "revalidate";
  if ((input.browserMaxAgeSeconds ?? 0) > 0 || (input.sharedMaxAgeSeconds ?? 0) > 0) return "cacheable";
  if (input.expires) return "cacheable";
  return "unclear";
}

function classifyCacheRisk(input: {
  responseKind: ResponseKind;
  cacheability: Cacheability;
  browserMaxAgeSeconds: number | null;
  sharedMaxAgeSeconds: number | null;
  immutable: boolean;
  hasValidator: boolean;
  finalUrl: string;
}): { level: RiskLevel; summary: string } {
  const effectiveMaxAge = Math.max(input.browserMaxAgeSeconds ?? 0, input.sharedMaxAgeSeconds ?? 0);

  if (input.responseKind === "html") {
    if (effectiveMaxAge > 3600) {
      return {
        level: "medium",
        summary: `HTML response is cacheable for ${formatDuration(effectiveMaxAge)}, which may serve stale page shells after deploys.`,
      };
    }

    if (input.cacheability === "disabled" || input.cacheability === "revalidate") {
      return {
        level: "info",
        summary: "HTML response disables caching or requires revalidation, which is usually appropriate for page shells.",
      };
    }
  }

  if (input.responseKind === "static_asset") {
    const hasVersionedUrl = hasVersionedAssetUrl(input.finalUrl);

    if (effectiveMaxAge >= 2_592_000 && (input.immutable || hasVersionedUrl)) {
      return {
        level: "info",
        summary: `Static asset has long-lived caching for ${formatDuration(effectiveMaxAge)} and appears versioned or immutable.`,
      };
    }

    if (input.cacheability === "disabled" || effectiveMaxAge === 0) {
      return {
        level: "low",
        summary: "Static asset is not cacheable or has no positive max-age, which may waste repeat-visit bandwidth.",
      };
    }

    if (effectiveMaxAge >= 2_592_000 && !hasVersionedUrl) {
      return {
        level: "low",
        summary: "Static asset has long-lived caching but does not obviously use a versioned URL.",
      };
    }
  }

  if (input.cacheability === "unclear" && !input.hasValidator) {
    return {
      level: "low",
      summary: "Response does not expose clear cache directives or validators.",
    };
  }

  if (input.cacheability === "cacheable") {
    return {
      level: "info",
      summary: `Response is cacheable${effectiveMaxAge > 0 ? ` for ${formatDuration(effectiveMaxAge)}` : ""}.`,
    };
  }

  return {
    level: "info",
    summary: "Response cache policy is explicit and does not show an obvious issue for the main response.",
  };
}

function getCdnCacheStatus(fetchResult: RemoteFetchResult): string | null {
  return (
    getHeader(fetchResult, "cf-cache-status") ??
    getHeader(fetchResult, "x-cache") ??
    getHeader(fetchResult, "x-cache-hits") ??
    null
  );
}

function buildCacheEvidence(fetchResult: RemoteFetchResult): Evidence[] {
  const evidence: Evidence[] = [{ type: "http_status", value: fetchResult.status_code }];
  const headerNames = [
    "cache-control",
    "pragma",
    "expires",
    "etag",
    "last-modified",
    "vary",
    "age",
    "cf-cache-status",
    "x-cache",
    "x-cache-hits",
    "server-timing",
    "content-type",
  ];

  for (const name of headerNames) {
    const value = getHeader(fetchResult, name);
    if (value) {
      evidence.push({ type: "http_header", name, value });
    }
  }

  return evidence;
}

function safePathname(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

function hasVersionedAssetUrl(value: string): boolean {
  const pathname = safePathname(value);
  return /(?:[.-][a-f0-9]{8,}|[?&](?:v|ver|version|hash)=)/i.test(pathname) || /[?&](?:v|ver|version|hash)=/i.test(value);
}

function formatDuration(seconds: number): string {
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)}d`;
  if (seconds >= 3_600) return `${Math.round(seconds / 3_600)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
}

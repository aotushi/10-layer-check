import type { LayerProbeContext } from "../core/probe-contract";
import type { Evidence, RiskLevel, SnapshotRecord, SnapshotStatus } from "../core/types";
import type { RemoteFetchResult } from "../providers/remote-fetch/types";

type HeaderCheck = {
  header: string;
  present: boolean;
  value?: string;
  severity_if_missing: RiskLevel;
};

const REQUIRED_HEADERS: Array<{ header: string; severity_if_missing: RiskLevel }> = [
  { header: "content-security-policy", severity_if_missing: "medium" },
  { header: "strict-transport-security", severity_if_missing: "medium" },
  { header: "x-frame-options", severity_if_missing: "low" },
  { header: "x-content-type-options", severity_if_missing: "low" },
  { header: "referrer-policy", severity_if_missing: "low" },
  { header: "permissions-policy", severity_if_missing: "low" },
];

export function createSecurityHeaderRecords(context: LayerProbeContext, fetchResult: RemoteFetchResult): SnapshotRecord[] {
  const checks: HeaderCheck[] = REQUIRED_HEADERS.map((definition) => {
    const value = getHeader(fetchResult, definition.header) ?? undefined;

    return {
      header: definition.header,
      present: Boolean(value),
      value,
      severity_if_missing: definition.severity_if_missing,
    };
  });

  const missing = checks.filter((check) => !check.present).map((check) => check.header);
  const hasMediumMissing = checks.some((check) => !check.present && check.severity_if_missing === "medium");
  const status: SnapshotStatus = missing.length === 0 ? "ok" : "warning";
  const riskLevel: RiskLevel = missing.length === 0 ? "info" : hasMediumMissing ? "medium" : "low";
  const evidence: Evidence[] = checks
    .filter((check) => check.present)
    .map((check) => ({
      type: "http_header",
      name: check.header,
      value: check.value,
    }));

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "security_headers_probe",
      layer: 10,
      item: "security_headers",
      probe_type: "active_request",
      source: fetchResult.source,
      status,
      value: {
        final_url: fetchResult.final_url,
        checks,
        missing,
      },
      risk: {
        level: riskLevel,
        summary:
          missing.length === 0
            ? "Common security headers are present."
            : `Missing security headers: ${missing.join(", ")}`,
      },
      evidence,
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: [
          "Security-header checks apply to the probed main response only.",
          "They do not validate every route, subdomain, API endpoint, or browser-enforced runtime behavior.",
        ],
      },
      duration_ms: fetchResult.duration_ms,
    },
    createCookieSecurityRecord(context, fetchResult),
    createIframeEmbeddingRecord(context, fetchResult),
    createMixedContentRecord(context, fetchResult),
    createLeakageSignalRecord(context, fetchResult),
  ];
}

function getHeader(fetchResult: RemoteFetchResult, name: string): string | null {
  return fetchResult.headers[name.toLowerCase()] ?? null;
}

function createCookieSecurityRecord(context: LayerProbeContext, fetchResult: RemoteFetchResult): SnapshotRecord {
  const cookies = parseSetCookieHeaders(getHeader(fetchResult, "set-cookie"));
  const insecureCookies = cookies.filter((cookie) => !cookie.secure || !cookie.http_only || cookie.same_site === null);

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "cookie_security_probe",
    layer: 10,
    item: "cookie_security",
    probe_type: "remote_fetch",
    source: fetchResult.source,
    status: insecureCookies.length > 0 ? "warning" : "ok",
    value: {
      cookies,
      insecure_cookies: insecureCookies,
      limitation: "Static fetch can only inspect Set-Cookie headers exposed to the Worker response.",
    },
    risk: {
      level: insecureCookies.length > 0 ? "medium" : "info",
      summary:
        cookies.length === 0
          ? "No Set-Cookie header was observed on the main response."
          : insecureCookies.length > 0
            ? `${insecureCookies.length} cookie(s) are missing Secure, HttpOnly, or SameSite.`
            : "Observed cookies include Secure, HttpOnly, and SameSite attributes.",
    },
    evidence: [{ type: "http_header", name: "set-cookie", value: getHeader(fetchResult, "set-cookie") }],
    evidence_metadata: {
      origin: "direct_observation",
      role: "derived",
      method: "fetch",
      limitations: [
        "Static fetch can only inspect Set-Cookie headers exposed on the probed main response.",
        "Cookie posture may differ across login, API, and application routes.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function createIframeEmbeddingRecord(context: LayerProbeContext, fetchResult: RemoteFetchResult): SnapshotRecord {
  const csp = getHeader(fetchResult, "content-security-policy");
  const xFrameOptions = getHeader(fetchResult, "x-frame-options");
  const frameAncestors = csp?.match(/frame-ancestors\s+([^;]+)/i)?.[1]?.trim() ?? null;
  const iframeSources = extractTagUrls(fetchResult, "iframe", "src");
  const hasFrameDefense = Boolean(xFrameOptions || frameAncestors);

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "iframe_embedding_probe",
    layer: 10,
    item: "iframe_embedding",
    probe_type: "remote_fetch",
    source: fetchResult.source,
    status: hasFrameDefense ? "ok" : "warning",
    value: {
      x_frame_options: xFrameOptions,
      frame_ancestors: frameAncestors,
      iframe_sources: iframeSources,
      has_frame_defense: hasFrameDefense,
    },
    risk: {
      level: hasFrameDefense ? "info" : "low",
      summary: hasFrameDefense
        ? "Frame embedding policy is present."
        : "No X-Frame-Options or CSP frame-ancestors policy was found.",
    },
    evidence: [
      { type: "http_header", name: "x-frame-options", value: xFrameOptions },
      { type: "http_header", name: "content-security-policy", value: csp },
      { type: "html", name: "iframe_sources", value: iframeSources },
    ],
    evidence_metadata: {
      origin: "direct_observation",
      role: "derived",
      method: "fetch",
      limitations: [
        "Frame embedding assessment is based on response headers and static iframe tags from the main response.",
        "It does not test browser embedding behavior from external origins.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function createMixedContentRecord(context: LayerProbeContext, fetchResult: RemoteFetchResult): SnapshotRecord {
  const pageIsHttps = fetchResult.final_url.startsWith("https://");
  const insecureUrls = pageIsHttps
    ? Array.from(fetchResult.html.matchAll(/\bhttp:\/\/[^"'\s<>)]+/gi))
        .map((match) => match[0])
        .filter((url, index, list) => list.indexOf(url) === index)
        .slice(0, 40)
    : [];

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "mixed_content_probe",
    layer: 10,
    item: "mixed_content",
    probe_type: "remote_fetch",
    source: fetchResult.source,
    status: insecureUrls.length > 0 ? "warning" : "ok",
    value: {
      page_is_https: pageIsHttps,
      insecure_url_count: insecureUrls.length,
      insecure_urls: insecureUrls,
      limitation: "Static HTML scan only; runtime mixed content requires browser_runtime.",
    },
    risk: {
      level: insecureUrls.length > 0 ? "medium" : "info",
      summary:
        insecureUrls.length > 0
          ? `Found ${insecureUrls.length} insecure http:// URL(s) in an HTTPS page.`
          : "No static mixed-content URLs were found in the main HTML.",
    },
    evidence: [{ type: "html", name: "http_urls", value: insecureUrls }],
    evidence_metadata: {
      origin: "static_heuristic",
      role: "derived",
      method: "static_parse",
      limitations: [
        "Static mixed-content detection scans the main HTML only.",
        "Runtime mixed content from JavaScript, CSS, or iframe activity requires browser_runtime evidence.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function createLeakageSignalRecord(context: LayerProbeContext, fetchResult: RemoteFetchResult): SnapshotRecord {
  const signals = detectLeakageSignals(fetchResult.html);

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "leakage_signal_probe",
    layer: 10,
    item: "leakage_signals",
    probe_type: "remote_fetch",
    source: fetchResult.source,
    status: signals.length > 0 ? "warning" : "ok",
    value: {
      signals,
      limitation: "Patterns are conservative static checks. Confirm findings manually before treating them as secrets.",
    },
    risk: {
      level: signals.length > 0 ? "medium" : "info",
      summary:
        signals.length > 0
          ? `Found ${signals.length} potential static leakage signal(s).`
          : "No obvious static leakage signals were found in the main HTML.",
    },
    evidence: [{ type: "html", name: "leakage_signals", value: signals }],
    evidence_metadata: {
      origin: "static_heuristic",
      role: "derived",
      method: "static_parse",
      limitations: [
        "Leakage patterns are conservative static checks and can produce false positives.",
        "Potential secrets must be manually confirmed before being reported as exposed credentials.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function parseSetCookieHeaders(value: string | null) {
  return splitSetCookieHeader(value).map((raw) => {
    const [nameValue, ...attributes] = raw.split(";").map((part) => part.trim());
    const name = nameValue?.split("=")[0] ?? "";
    const normalizedAttributes = attributes.map((attribute) => attribute.toLowerCase());
    const sameSiteAttribute = normalizedAttributes.find((attribute) => attribute.startsWith("samesite="));

    return {
      name,
      secure: normalizedAttributes.includes("secure"),
      http_only: normalizedAttributes.includes("httponly"),
      same_site: sameSiteAttribute?.split("=")[1] ?? null,
      raw_attribute_count: attributes.length,
    };
  });
}

function splitSetCookieHeader(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/,(?=\s*[^;,=\s]+=[^;,]+)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractTagUrls(fetchResult: RemoteFetchResult, tagName: string, attribute: string): string[] {
  const urls = new Set<string>();
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\s${attribute}\\s*=\\s*["']([^"']+)["'][^>]*>`, "gi");
  const origin = new URL(fetchResult.final_url).origin;

  for (const match of fetchResult.html.matchAll(pattern)) {
    const value = match[1];
    if (!value) continue;
    try {
      urls.add(new URL(value, origin).toString());
    } catch {
      urls.add(value);
    }
  }

  return Array.from(urls).slice(0, 40);
}

function detectLeakageSignals(html: string) {
  const rules: Array<{ name: string; pattern: RegExp }> = [
    { name: "aws_access_key_id", pattern: /AKIA[0-9A-Z]{16}/g },
    { name: "google_api_key", pattern: /AIza[0-9A-Za-z_-]{35}/g },
    { name: "openai_key_like", pattern: /sk-[A-Za-z0-9_-]{20,}/g },
    { name: "source_map_reference", pattern: /sourceMappingURL=[^\s<]+/g },
  ];

  return rules.flatMap((rule) =>
    Array.from(html.matchAll(rule.pattern))
      .slice(0, 10)
      .map((match) => ({
        type: rule.name,
        sample: maskSensitiveSample(match[0]),
      })),
  );
}

function maskSensitiveSample(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

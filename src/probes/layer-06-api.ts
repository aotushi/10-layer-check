import type { LayerProbeContext } from "../core/probe-contract";
import type { SnapshotRecord } from "../core/types";
import type { ApiReachabilityResult } from "../providers/api-reachability/types";
import type { PublicSecurityDetailsResult } from "../providers/public-security-details/types";
import type { RemoteFetchResult } from "../providers/remote-fetch/types";

type EndpointCandidate = {
  url: string;
  source: string;
  reason: string;
};

type FormEndpoint = {
  action: string;
  method: string;
};

export function createApiLayerRecords(context: LayerProbeContext, result: RemoteFetchResult): SnapshotRecord[] {
  const endpoints = extractEndpointCandidates(result);
  const forms = extractForms(result);
  const cors = parseCorsPolicy(result.headers);
  const errorSurface = analyzeErrorSurface(result);
  const protocol = analyzeProtocolClues(result.headers);

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "api_endpoint_probe",
      layer: 6,
      item: "api_endpoints",
      probe_type: "remote_fetch",
      source: result.source,
      status: endpoints.length > 0 || forms.length > 0 ? "ok" : "skipped",
      value: {
        endpoint_candidates: endpoints,
        forms,
        limitations: [
          "Static HTML scan only. JS bundle parsing and runtime XHR/fetch observation require browser_runtime enrichment.",
        ],
      },
      risk: {
        level: endpoints.length > 0 ? "low" : "info",
        summary:
          endpoints.length > 0
            ? `Found ${endpoints.length} API-like endpoint candidate(s) in the main HTML.`
            : "No API-like endpoint candidates were found in the main HTML.",
      },
      evidence: [{ type: "html", name: "api_candidates", value: endpoints }],
      evidence_metadata: {
        origin: "static_heuristic",
        role: "derived",
        method: "static_parse",
        limitations: [
          "API endpoint candidates are extracted from static HTML only.",
          "Runtime XHR/fetch calls, bundled route constants, and hidden authenticated endpoints may be missed.",
          "Candidates are not reachability-tested by this record.",
        ],
      },
      duration_ms: result.duration_ms,
    },
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "cors_policy_probe",
      layer: 6,
      item: "cors_policy",
      probe_type: "remote_fetch",
      source: result.source,
      status: assessCorsRisk(cors) === "high" || assessCorsRisk(cors) === "medium" ? "warning" : "ok",
      value: cors,
      risk: {
        level: assessCorsRisk(cors),
        summary: summarizeCors(cors),
      },
      evidence: [{ type: "http_headers", name: "cors", value: cors.raw_headers }],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: [
          "CORS policy is read from the probed main response headers only.",
          "A complete CORS assessment requires targeted OPTIONS/preflight tests against API endpoints and origins.",
        ],
      },
      duration_ms: result.duration_ms,
    },
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "api_error_surface_probe",
      layer: 6,
      item: "api_error_surface",
      probe_type: "remote_fetch",
      source: result.source,
      status: errorSurface.exposed ? "warning" : "ok",
      value: errorSurface,
      risk: {
        level: errorSurface.exposed ? "medium" : "info",
        summary: errorSurface.exposed
          ? "The main response exposes error-like signals that should be reviewed."
          : "No obvious API or server error surface was detected in the main response.",
      },
      evidence: [{ type: "http_response", name: "error_surface", value: errorSurface }],
      evidence_metadata: {
        origin: "static_heuristic",
        role: "derived",
        method: "static_parse",
        limitations: [
          "Error-surface detection uses conservative patterns from the main response.",
          "Findings should be confirmed against the relevant API or route before being treated as exposed internals.",
        ],
      },
      duration_ms: result.duration_ms,
    },
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "api_protocol_probe",
      layer: 6,
      item: "api_protocol",
      probe_type: "remote_fetch",
      source: result.source,
      status: protocol.clues.length > 0 ? "ok" : "skipped",
      value: protocol,
      risk: {
        level: "info",
        summary:
          protocol.clues.length > 0
            ? `Found ${protocol.clues.length} protocol or platform clue(s) from response headers.`
            : "No protocol or platform clues were found from response headers.",
      },
      evidence: [{ type: "http_headers", name: "protocol_clues", value: protocol.raw_headers }],
      evidence_metadata: {
        origin: "static_heuristic",
        role: "derived",
        method: "fetch",
        limitations: [
          "Protocol clues are inferred from visible response headers.",
          "Absence of a clue does not prove absence of REST, GraphQL, RPC, WebSocket, or SSE interfaces.",
        ],
      },
      duration_ms: result.duration_ms,
    },
  ];
}

export function createApiReachabilityLayerRecords(
  context: LayerProbeContext,
  result: ApiReachabilityResult,
): SnapshotRecord[] {
  const warningChecks = result.checks.filter(
    (check) => check.error || (typeof check.status_code === "number" && check.status_code >= 400) || check.error_surface_signals.length > 0,
  );

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "api_reachability_probe",
      layer: 6,
      item: "api_reachability",
      probe_type: "active_request",
      source: result.source,
      status: warningChecks.length > 0 ? "warning" : result.checks.length > 0 ? "ok" : "skipped",
      value: {
        requested_url: result.requested_url,
        final_url: result.final_url,
        host: result.host,
        candidates: result.candidates,
        checks: result.checks,
        skipped: result.skipped,
        limits: result.limits,
        coverage: result.coverage,
      },
      risk: {
        level: warningChecks.length > 0 ? "low" : "info",
        summary:
          result.checks.length > 0
            ? `Sampled ${result.checks.length} same-origin API-like candidate(s); ${warningChecks.length} need review.`
            : "No same-origin API-like candidates were sampled.",
      },
      evidence: [
        { type: "api_reachability", name: "checks", value: result.checks },
        { type: "api_reachability_skipped", name: "skipped", value: result.skipped },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: [
          "Only same-origin API-like candidates discovered in static HTML or supplied by the caller are sampled.",
          "Only HEAD and safe GET requests are used; no credentials, bodies, mutations, or path brute forcing are performed.",
          "A reachable candidate does not prove the full API surface, authentication behavior, or security posture.",
        ],
      },
      duration_ms: result.duration_ms,
    },
  ];
}

export function createPublicSecurityDetailsLayerRecords(
  context: LayerProbeContext,
  result: PublicSecurityDetailsResult,
): SnapshotRecord[] {
  const corsChecks = result.checks.filter((check) => check.kind === "cors" || check.headers["access-control-allow-origin"]);
  const cookieChecks = result.checks.filter((check) => check.kind === "cookie" || check.headers["set-cookie"]);
  const apiChecks = result.checks.filter((check) => check.kind === "api_endpoint");
  const metadataChecks = result.checks.filter((check) => check.kind === "cms_metadata" || check.kind === "forum_metadata" || check.kind === "route_presence");
  const appHeaderChecks = result.checks.filter((check) => hasPublicAppHeaderMetadata(check));
  const corsSignals = result.checks.filter((check) =>
    check.signals.some((signal) => signal.startsWith("cors_allow_origin") || signal === "cors_allow_credentials:true"),
  );
  const cookieSignals = result.checks.filter((check) => check.signals.includes("set_cookie_observed"));
  const apiSignals = apiChecks.filter((check) =>
    check.signals.includes("api_error_preview_observed") || check.signals.includes("request_id_header_observed"),
  );
  const metadataSignals = result.checks.filter((check) =>
    check.signals.includes("wordpress_public_metadata_observed") ||
    check.signals.includes("wordpress_asset_version_observed") ||
    check.signals.includes("discourse_header_observed") ||
    check.signals.includes("discourse_runtime_header_observed") ||
    check.signals.includes("discourse_csp_header_observed") ||
    check.signals.includes("mintlify_header_observed") ||
    check.signals.includes("vercel_header_observed") ||
    check.signals.includes("next_rsc_header_observed") ||
    check.signals.includes("llms_txt_link_observed") ||
    check.signals.includes("public_route_presence_observed"),
  );
  const appHeaderSignals = appHeaderChecks.filter((check) =>
    check.signals.includes("discourse_header_observed") ||
    check.signals.includes("discourse_runtime_header_observed") ||
    check.signals.includes("discourse_csp_header_observed") ||
    check.signals.includes("mintlify_header_observed") ||
    check.signals.includes("vercel_header_observed") ||
    check.signals.includes("next_rsc_header_observed") ||
    check.signals.includes("llms_txt_link_observed") ||
    check.signals.includes("wordpress_asset_version_observed"),
  );

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "bounded_cors_header_validation_probe",
      layer: 6,
      item: "bounded_cors_header_validation",
      probe_type: "active_request",
      source: result.source,
      status: corsSignals.length > 0 ? "warning" : corsChecks.length > 0 ? "ok" : "skipped",
      value: {
        checks: summarizeSecurityChecks(corsChecks),
        signal_count: corsSignals.length,
        limits: result.limits,
        coverage: result.coverage,
      },
      risk: {
        level: corsSignals.some((check) => check.signals.includes("cors_allow_credentials:true")) ? "medium" : corsSignals.length > 0 ? "low" : "info",
        summary:
          corsSignals.length > 0
            ? `Observed CORS response header signal(s) on ${corsSignals.length} bounded public check(s).`
            : "No CORS allow-origin signal was observed on bounded public checks.",
      },
      evidence: [
        { type: "cors_header", name: "bounded_cors_checks", value: summarizeSecurityChecks(corsChecks) },
        { type: "limit", name: "public_security_detail_limits", value: result.limits },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: result.coverage.limitations,
      },
      duration_ms: result.duration_ms,
    },
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "bounded_public_api_endpoint_inventory_probe",
      layer: 6,
      item: "bounded_public_api_endpoint_inventory",
      probe_type: "active_request",
      source: result.source,
      status: apiChecks.length > 0 ? "ok" : "skipped",
      value: {
        endpoints: summarizePublicApiEndpoints(apiChecks),
        endpoint_count: apiChecks.length,
        limits: result.limits,
        coverage: result.coverage,
      },
      risk: {
        level: "info",
        summary:
          apiChecks.length > 0
            ? `Preserved ${apiChecks.length} bounded public API endpoint observation(s): ${summarizeEndpointPaths(apiChecks)}.`
            : "No bounded public API endpoint observations were preserved.",
      },
      evidence: [
        { type: "api_endpoint", name: "public_api_endpoint_inventory", value: summarizePublicApiEndpoints(apiChecks) },
        { type: "limit", name: "public_security_detail_limits", value: result.limits },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: result.coverage.limitations,
      },
      duration_ms: result.duration_ms,
    },
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "bounded_public_api_error_surface_probe",
      layer: 6,
      item: "bounded_public_api_error_surface",
      probe_type: "active_request",
      source: result.source,
      status: apiSignals.length > 0 || apiChecks.some((check) => typeof check.status_code === "number" && check.status_code >= 400) ? "warning" : apiChecks.length > 0 ? "ok" : "skipped",
      value: {
        checks: summarizeSecurityChecks(apiChecks),
        signal_count: apiSignals.length,
        limits: result.limits,
        coverage: result.coverage,
      },
      risk: {
        level: apiSignals.length > 0 ? "low" : "info",
        summary:
          apiChecks.length > 0
            ? `Checked ${apiChecks.length} bounded public API endpoint candidate(s); ${apiSignals.length} exposed error/request-id signal(s).`
            : "No bounded public API endpoint candidates were checked.",
      },
      evidence: [
        { type: "api_reachability", name: "bounded_public_api_checks", value: summarizeSecurityChecks(apiChecks) },
        { type: "limit", name: "public_security_detail_limits", value: result.limits },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: result.coverage.limitations,
      },
      duration_ms: result.duration_ms,
    },
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "bounded_public_app_header_metadata_probe",
      layer: 8,
      item: "bounded_public_app_header_metadata",
      probe_type: "active_request",
      source: result.source,
      status: appHeaderSignals.length > 0 ? "ok" : appHeaderChecks.length > 0 ? "skipped" : "skipped",
      value: {
        checks: summarizeAppHeaderMetadata(appHeaderChecks),
        signal_count: appHeaderSignals.length,
        limits: result.limits,
        coverage: result.coverage,
      },
      risk: {
        level: "info",
        summary:
          appHeaderSignals.length > 0
            ? `Observed public app header metadata signal(s) on ${appHeaderSignals.length} bounded check(s): ${summarizeAppHeaderHighlights(appHeaderSignals)}.`
            : "No public app header metadata signal was observed in bounded checks.",
      },
      evidence: [
        { type: "app_header_metadata", name: "public_app_header_metadata", value: summarizeAppHeaderMetadata(appHeaderChecks) },
        { type: "limit", name: "public_security_detail_limits", value: result.limits },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: result.coverage.limitations,
      },
      duration_ms: result.duration_ms,
    },
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "bounded_public_metadata_probe",
      layer: 8,
      item: "bounded_public_metadata",
      probe_type: "active_request",
      source: result.source,
      status: metadataSignals.length > 0 ? "ok" : metadataChecks.length > 0 ? "skipped" : "skipped",
      value: {
        checks: summarizeSecurityChecks(metadataChecks),
        signal_count: metadataSignals.length,
        limits: result.limits,
        coverage: result.coverage,
      },
      risk: {
        level: "info",
        summary:
          metadataSignals.length > 0
            ? `Observed public CMS/forum metadata signal(s) on ${metadataSignals.length} bounded check(s).`
            : "No public CMS/forum metadata signal was observed in bounded checks.",
      },
      evidence: [
        { type: "app_marker", name: "bounded_public_metadata_checks", value: summarizeSecurityChecks(metadataChecks) },
        { type: "limit", name: "public_security_detail_limits", value: result.limits },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: result.coverage.limitations,
      },
      duration_ms: result.duration_ms,
    },
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "bounded_cookie_attribute_observation_probe",
      layer: 10,
      item: "bounded_cookie_attribute_observation",
      probe_type: "active_request",
      source: result.source,
      status: cookieSignals.length > 0 ? "warning" : cookieChecks.length > 0 ? "ok" : "skipped",
      value: {
        checks: summarizeSecurityChecks(cookieChecks),
        signal_count: cookieSignals.length,
        limits: result.limits,
        coverage: result.coverage,
      },
      risk: {
        level: cookieSignals.length > 0 ? "low" : "info",
        summary:
          cookieSignals.length > 0
            ? `Observed Set-Cookie header(s) on ${cookieSignals.length} bounded public check(s).`
            : "No Set-Cookie header was observed on bounded public checks.",
      },
      evidence: [
        { type: "cookie", name: "bounded_cookie_checks", value: summarizeSecurityChecks(cookieChecks) },
        { type: "limit", name: "public_security_detail_limits", value: result.limits },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: result.coverage.limitations,
      },
      duration_ms: result.duration_ms,
    },
  ];
}

function summarizePublicApiEndpoints(checks: PublicSecurityDetailsResult["checks"]) {
  return checks.map((check) => ({
    host: check.host,
    role_hint: check.role_hint,
    method: check.method,
    path: check.path,
    endpoint: `${check.method} ${check.path}`,
    status_code: check.status_code,
    content_type: check.content_type,
    allow_origin: check.headers["access-control-allow-origin"],
    allow_credentials: check.headers["access-control-allow-credentials"],
    api_error: stringField(check.parsed, "api_error"),
    api_message: stringField(check.parsed, "api_message"),
    api_request_id: stringField(check.parsed, "api_request_id"),
    api_type: stringField(check.parsed, "api_type"),
    signals: check.signals,
    error: check.error,
  }));
}

function summarizeEndpointPaths(checks: PublicSecurityDetailsResult["checks"]): string {
  const paths = Array.from(new Set(checks.map((check) => check.path))).filter(Boolean);
  return paths.slice(0, 5).join(", ");
}

function summarizeAppHeaderMetadata(checks: PublicSecurityDetailsResult["checks"]) {
  return checks.map((check) => ({
    host: check.host,
    role_hint: check.role_hint,
    kind: check.kind,
    method: check.method,
    path: check.path,
    status_code: check.status_code,
    content_type: check.content_type,
    server: check.headers.server,
    discourse_route: stringField(check.parsed, "discourse_route"),
    discourse_cached: stringField(check.parsed, "discourse_cached"),
    discourse_runtime: stringField(check.parsed, "discourse_runtime"),
    discourse_csp_policy: check.parsed.discourse_csp_policy,
    mint_proxy_version: stringField(check.parsed, "mint_proxy_version"),
    mintlify_client_version: stringField(check.parsed, "mintlify_client_version"),
    vercel_cache: stringField(check.parsed, "vercel_cache"),
    vercel_id: stringField(check.parsed, "vercel_id"),
    vercel_served_version: stringField(check.parsed, "vercel_served_version"),
    vercel_project_id: stringField(check.parsed, "vercel_project_id"),
    next_rsc_vary: stringField(check.parsed, "next_rsc_vary"),
    llms_txt_link: stringField(check.parsed, "llms_txt_link"),
    wordpress_asset_versions: Array.isArray(check.parsed.wordpress_asset_versions) ? check.parsed.wordpress_asset_versions : [],
    signals: check.signals,
    error: check.error,
  }));
}

function summarizeAppHeaderHighlights(checks: PublicSecurityDetailsResult["checks"]): string {
  const highlights: string[] = [];

  for (const check of checks) {
    const host = check.host;
    const parsed = check.parsed;
    const wordpressVersions = Array.isArray(parsed.wordpress_asset_versions)
      ? parsed.wordpress_asset_versions.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];

    if (wordpressVersions.length > 0) {
      highlights.push(`${host} WordPress asset version(s) ${wordpressVersions.slice(0, 3).join(",")}`);
    }
    if (typeof parsed.discourse_route === "string") highlights.push(`${host} Discourse route ${parsed.discourse_route}`);
    if (typeof parsed.discourse_runtime === "string") highlights.push(`${host} x-runtime ${parsed.discourse_runtime}`);
    if (typeof parsed.mintlify_client_version === "string") highlights.push(`${host} Mintlify client ${parsed.mintlify_client_version}`);
    if (typeof parsed.mint_proxy_version === "string") highlights.push(`${host} Mint proxy ${parsed.mint_proxy_version}`);
    if (typeof parsed.vercel_cache === "string") highlights.push(`${host} Vercel cache ${parsed.vercel_cache}`);
    if (typeof parsed.next_rsc_vary === "string") highlights.push(`${host} Next/RSC vary header`);
    if (typeof parsed.llms_txt_link === "string") highlights.push(`${host} llms.txt link`);
  }

  return highlights.length > 0 ? Array.from(new Set(highlights)).slice(0, 8).join("; ") : "metadata headers observed";
}

function hasPublicAppHeaderMetadata(check: PublicSecurityDetailsResult["checks"][number]): boolean {
  return (
    check.kind === "app_header_metadata" ||
    check.kind === "forum_metadata" ||
    check.kind === "cms_metadata" ||
    check.signals.some((signal) =>
      [
        "discourse_header_observed",
        "discourse_runtime_header_observed",
        "discourse_csp_header_observed",
        "mintlify_header_observed",
        "vercel_header_observed",
        "next_rsc_header_observed",
        "llms_txt_link_observed",
        "wordpress_asset_version_observed",
      ].includes(signal),
    )
  );
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function summarizeSecurityChecks(checks: PublicSecurityDetailsResult["checks"]) {
  return checks.map((check) => ({
    host: check.host,
    role_hint: check.role_hint,
    kind: check.kind,
    method: check.method,
    path: check.path,
    status_code: check.status_code,
    redirected_to: check.redirected_to,
    content_type: check.content_type,
    headers: check.headers,
    parsed: check.parsed,
    signals: check.signals,
    error: check.error,
  }));
}

function extractEndpointCandidates(result: RemoteFetchResult): EndpointCandidate[] {
  const origin = new URL(result.final_url).origin;
  const candidates = new Map<string, EndpointCandidate>();
  const patterns = [
    { pattern: /\b(?:https?:)?\/\/[^"'\s<>]+/gi, source: "absolute_url" },
    { pattern: /["'`](\/[^"'`\s<>]*(?:api|graphql|trpc|rpc|v\d+|json)[^"'`\s<>]*)["'`]/gi, source: "path_literal" },
  ];

  for (const { pattern, source } of patterns) {
    for (const match of result.html.matchAll(pattern)) {
      const raw = match[1] ?? match[0];
      const normalized = normalizeCandidateUrl(raw, origin);
      if (!normalized || !looksLikeApiEndpoint(normalized)) continue;

      candidates.set(normalized, {
        url: normalized,
        source,
        reason: classifyEndpointReason(normalized),
      });
    }
  }

  return Array.from(candidates.values()).slice(0, 40);
}

function extractForms(result: RemoteFetchResult): FormEndpoint[] {
  const origin = new URL(result.final_url).origin;
  return Array.from(result.html.matchAll(/<form\b[^>]*>/gi))
    .map((match) => match[0])
    .map((tag) => {
      const action = getAttribute(tag, "action");
      const method = getAttribute(tag, "method") ?? "get";
      return {
        action: action ? normalizeCandidateUrl(action, origin) ?? action : result.final_url,
        method: method.toUpperCase(),
      };
    })
    .slice(0, 20);
}

function parseCorsPolicy(headers: Record<string, string>) {
  const rawHeaders = {
    "access-control-allow-origin": headers["access-control-allow-origin"] ?? null,
    "access-control-allow-methods": headers["access-control-allow-methods"] ?? null,
    "access-control-allow-headers": headers["access-control-allow-headers"] ?? null,
    "access-control-allow-credentials": headers["access-control-allow-credentials"] ?? null,
    "access-control-expose-headers": headers["access-control-expose-headers"] ?? null,
  };

  return {
    present: Object.values(rawHeaders).some(Boolean),
    allow_origin: rawHeaders["access-control-allow-origin"],
    allow_methods: splitHeaderList(rawHeaders["access-control-allow-methods"]),
    allow_headers: splitHeaderList(rawHeaders["access-control-allow-headers"]),
    allow_credentials: rawHeaders["access-control-allow-credentials"]?.toLowerCase() === "true",
    expose_headers: splitHeaderList(rawHeaders["access-control-expose-headers"]),
    raw_headers: rawHeaders,
  };
}

function analyzeErrorSurface(result: RemoteFetchResult) {
  const lowerHtml = result.html.toLowerCase();
  const signals = [
    { name: "status_error", present: result.status_code >= 400, value: result.status_code },
    { name: "stack_trace", present: /stack trace|traceback|exception|runtimeerror|typeerror|referenceerror/.test(lowerHtml), value: null },
    { name: "debug_keyword", present: /debug|development mode|internal server error/.test(lowerHtml), value: null },
    { name: "json_error_body", present: /application\/json/i.test(result.headers["content-type"] ?? "") && /"error"|"message"/i.test(result.html), value: null },
  ].filter((signal) => signal.present);

  return {
    exposed: signals.length > 0,
    status_code: result.status_code,
    content_type: result.headers["content-type"] ?? null,
    signals,
  };
}

function analyzeProtocolClues(headers: Record<string, string>) {
  const rawHeaders = {
    server: headers.server ?? null,
    "x-powered-by": headers["x-powered-by"] ?? null,
    "alt-svc": headers["alt-svc"] ?? null,
    via: headers.via ?? null,
    "cf-ray": headers["cf-ray"] ?? null,
    "x-vercel-id": headers["x-vercel-id"] ?? null,
  };
  const clues = Object.entries(rawHeaders)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => ({ name, value }));

  return {
    clues,
    supports_http3_hint: Boolean(headers["alt-svc"]?.includes("h3")),
    raw_headers: rawHeaders,
  };
}

function normalizeCandidateUrl(value: string, origin: string): string | null {
  try {
    if (value.startsWith("//")) return new URL(`https:${value}`).toString();
    return new URL(value, origin).toString();
  } catch {
    return null;
  }
}

function looksLikeApiEndpoint(url: string): boolean {
  return /\/(?:api|graphql|trpc|rpc|rest|v\d+)(?:\/|$)|\.json(?:$|[?#])/i.test(url);
}

function classifyEndpointReason(url: string): string {
  if (/graphql/i.test(url)) return "graphql";
  if (/trpc/i.test(url)) return "trpc";
  if (/\/api(?:\/|$)/i.test(url)) return "api_path";
  if (/\/v\d+(?:\/|$)/i.test(url)) return "versioned_api_path";
  if (/\.json(?:$|[?#])/i.test(url)) return "json_resource";
  return "api_like_url";
}

function getAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return tag.match(pattern)?.[1] ?? null;
}

function splitHeaderList(value: string | null): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function assessCorsRisk(cors: ReturnType<typeof parseCorsPolicy>): "info" | "low" | "medium" | "high" {
  if (cors.allow_origin === "*" && cors.allow_credentials) return "high";
  if (cors.allow_origin === "*") return "medium";
  if (cors.present) return "low";
  return "info";
}

function summarizeCors(cors: ReturnType<typeof parseCorsPolicy>): string {
  if (!cors.present) return "No CORS headers were found on the main response.";
  if (cors.allow_origin === "*" && cors.allow_credentials) return "CORS allows wildcard origin together with credentials.";
  if (cors.allow_origin === "*") return "CORS allows wildcard origin on the main response.";
  return "CORS headers are present on the main response.";
}

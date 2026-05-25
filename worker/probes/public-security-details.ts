import type {
  PublicSecurityCheck,
  PublicSecurityDetailsResult,
  PublicSecurityHeaderMap,
  PublicSecurityHostRole,
} from "../../src/providers/public-security-details/types";

type CandidateHost = {
  host: string;
  role_hint: PublicSecurityHostRole;
};

type PlannedCheck = CandidateHost & {
  kind: PublicSecurityCheck["kind"];
  method: PublicSecurityCheck["method"];
  path: string;
  headers?: Record<string, string>;
};

export type PublicSecurityDetailsOptions = {
  maxHosts?: unknown;
};

const DEFAULT_MAX_HOSTS = 6;
const MAX_ALLOWED_HOSTS = 8;
const MAX_REQUESTS_PER_HOST = 5;
const MAX_CONCURRENCY = 3;
const TIMEOUT_MS = 10_000;
const PREVIEW_BYTES = 1_200;
const MODEL_LIST_PREVIEW_BYTES = 64_000;

export async function publicSecurityDetailsProbe(
  target: string,
  options: PublicSecurityDetailsOptions = {},
): Promise<PublicSecurityDetailsResult> {
  const startedAt = Date.now();
  const normalizedUrl = normalizeTargetUrl(target);
  const host = new URL(normalizedUrl).hostname.toLowerCase();
  const maxHosts = parseMaxHosts(options.maxHosts);
  const candidates = createCandidateHosts(host).slice(0, maxHosts);
  const plannedChecks = candidates.flatMap(createPlannedChecks);
  const checks = await runWithConcurrency(plannedChecks, MAX_CONCURRENCY, runPlannedCheck);

  return {
    requested_url: target,
    host,
    checks,
    limits: {
      max_hosts: maxHosts,
      checked_hosts: candidates.length,
      max_requests_per_host: MAX_REQUESTS_PER_HOST,
      max_concurrency: MAX_CONCURRENCY,
      timeout_ms: TIMEOUT_MS,
      preview_bytes: PREVIEW_BYTES,
      model_list_preview_bytes: MODEL_LIST_PREVIEW_BYTES,
    },
    coverage: {
      collected: [
        "bounded_cors_header_validation",
        "bounded_cookie_attribute_observation",
        "bounded_public_api_error_surface",
        "bounded_public_api_model_list_metadata",
        "bounded_public_cms_metadata",
      ],
      missing: [
        "wordpress_user_enumeration",
        "login_rate_limit_validation",
        "deep_port_service_inventory",
        "credentialed_authenticated_behavior",
      ],
      limitations: [
        "This provider uses a small fixed set of public GET/HEAD/OPTIONS-style observations.",
        "It does not send credentials, request bodies, login attempts, exploit payloads, or repeated rate-limit traffic.",
        "It does not enumerate WordPress users and does not scan ports.",
      ],
    },
    duration_ms: Date.now() - startedAt,
    provider_id: "cloudflare_worker_public_security_details",
    source: "cloudflare_worker_public_security_details",
  };
}

function createCandidateHosts(rootHost: string): CandidateHost[] {
  return [
    { host: rootHost, role_hint: "root" },
    { host: `api.${rootHost}`, role_hint: "api" },
    { host: `blog.${rootHost}`, role_hint: "blog" },
    { host: `community.${rootHost}`, role_hint: "community" },
    { host: `docs.${rootHost}`, role_hint: "docs" },
    { host: `status.${rootHost}`, role_hint: "status" },
  ];
}

function createPlannedChecks(candidate: CandidateHost): PlannedCheck[] {
  const originHeader = { origin: "https://site-10-layer-check.invalid" };
  const checks: PlannedCheck[] = [
    { ...candidate, kind: "cors", method: "GET", path: "/", headers: originHeader },
    { ...candidate, kind: "cookie", method: "GET", path: "/" },
  ];

  if (candidate.role_hint === "api") {
    checks.push(
      { ...candidate, kind: "api_endpoint", method: "GET", path: "/health", headers: originHeader },
      { ...candidate, kind: "api_endpoint", method: "GET", path: "/v1/models", headers: originHeader },
      { ...candidate, kind: "cors", method: "OPTIONS", path: "/v1/models", headers: createPreflightHeaders() },
    );
  }

  if (candidate.role_hint === "blog") {
    checks.push(
      { ...candidate, kind: "cms_metadata", method: "GET", path: "/wp-json/" },
      { ...candidate, kind: "route_presence", method: "HEAD", path: "/wp-login.php" },
    );
  }

  if (candidate.role_hint === "community") {
    checks.push({ ...candidate, kind: "forum_metadata", method: "GET", path: "/latest.json" });
  }

  if (candidate.role_hint === "docs") {
    checks.push({ ...candidate, kind: "app_header_metadata", method: "HEAD", path: "/" });
  }

  return checks.slice(0, MAX_REQUESTS_PER_HOST);
}

function createPreflightHeaders(): Record<string, string> {
  return {
    origin: "https://site-10-layer-check.invalid",
    "access-control-request-method": "GET",
    "access-control-request-headers": "authorization,content-type",
  };
}

function previewBytesForPlan(plan: PlannedCheck): number {
  return plan.kind === "api_endpoint" && plan.method === "GET" && plan.path === "/v1/models"
    ? MODEL_LIST_PREVIEW_BYTES
    : PREVIEW_BYTES;
}

async function runPlannedCheck(plan: PlannedCheck): Promise<PublicSecurityCheck> {
  const url = `https://${plan.host}${plan.path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: plan.method,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "application/json,text/html,*/*;q=0.8",
        ...(plan.headers ?? {}),
      },
    });
    const contentType = response.headers.get("content-type");
    const bodyPreview = plan.method === "HEAD" ? null : await readLimitedText(response, previewBytesForPlan(plan));
    const bodyPreviewText = bodyPreview?.text ?? null;
    const headers = readHeaders(response.headers);
    return {
      host: plan.host,
      role_hint: plan.role_hint,
      kind: plan.kind,
      method: plan.method,
      path: plan.path,
      url,
      status_code: response.status,
      redirected_to: response.headers.get("location"),
      content_type: contentType,
      headers,
      body_preview: bodyPreviewText,
      body_preview_bytes: bodyPreview?.bytes ?? null,
      body_preview_truncated: bodyPreview?.truncated ?? false,
      parsed: parsePublicBody(plan, bodyPreviewText, headers),
      signals: detectSignals(plan, response.status, headers, bodyPreviewText),
      error: null,
    };
  } catch (error) {
    return {
      host: plan.host,
      role_hint: plan.role_hint,
      kind: plan.kind,
      method: plan.method,
      path: plan.path,
      url,
      status_code: null,
      redirected_to: null,
      content_type: null,
      headers: emptyHeaders(),
      body_preview: null,
      body_preview_bytes: null,
      body_preview_truncated: false,
      parsed: {},
      signals: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parsePublicBody(plan: PlannedCheck, bodyPreview: string | null, headers: PublicSecurityHeaderMap): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  if (headers["access-control-allow-origin"]) parsed.allow_origin = headers["access-control-allow-origin"];
  if (headers["access-control-allow-credentials"]) parsed.allow_credentials = headers["access-control-allow-credentials"];
  if (headers["set-cookie"]) parsed.set_cookie_attributes = summarizeSetCookie(headers["set-cookie"]);
  if (headers["x-request-id"]) parsed.request_id_header = headers["x-request-id"];
  if (headers["x-discourse-route"]) parsed.discourse_route = headers["x-discourse-route"];
  if (headers["x-discourse-cached"]) parsed.discourse_cached = headers["x-discourse-cached"];
  if (headers["x-runtime"]) parsed.discourse_runtime = headers["x-runtime"];
  if (headers["content-security-policy"] && plan.role_hint === "community") {
    parsed.discourse_csp_policy = summarizeCsp(headers["content-security-policy"]);
  }
  if (headers["x-mint-proxy-version"]) parsed.mint_proxy_version = headers["x-mint-proxy-version"];
  if (headers["x-mintlify-client-version"]) parsed.mintlify_client_version = headers["x-mintlify-client-version"];
  if (headers["x-vercel-cache"]) parsed.vercel_cache = headers["x-vercel-cache"];
  if (headers["x-vercel-id"]) parsed.vercel_id = headers["x-vercel-id"];
  if (headers["x-served-version"]) parsed.vercel_served_version = headers["x-served-version"];
  if (headers["x-vercel-project-id"]) parsed.vercel_project_id = headers["x-vercel-project-id"];
  if (headers.vary && /\brsc\b|next-router/i.test(headers.vary)) parsed.next_rsc_vary = headers.vary;
  if (headers.link && /llms\.txt/i.test(headers.link)) parsed.llms_txt_link = headers.link;

  if (!bodyPreview) return parsed;
  const json = tryParseJson(bodyPreview);
  if (json && plan.kind === "cms_metadata") {
    parsed.wordpress_name = readString(json, "name");
    parsed.wordpress_description = readString(json, "description");
    parsed.wordpress_timezone = readString(json, "timezone_string");
    parsed.wordpress_gmt_offset = readNumber(json, "gmt_offset");
    const namespaces = Array.isArray(json.namespaces) ? json.namespaces.filter((item) => typeof item === "string").slice(0, 20) : [];
    if (namespaces.length > 0) parsed.wordpress_namespaces = namespaces;
  }
  if (!json && plan.kind === "cms_metadata") {
    parsed.wordpress_name = matchJsonString(bodyPreview, "name");
    parsed.wordpress_description = matchJsonString(bodyPreview, "description");
    parsed.wordpress_timezone = matchJsonString(bodyPreview, "timezone_string");
    parsed.wordpress_gmt_offset = matchJsonNumber(bodyPreview, "gmt_offset");
    const namespaces = matchJsonStringArray(bodyPreview, "namespaces").slice(0, 20);
    if (namespaces.length > 0) parsed.wordpress_namespaces = namespaces;
  }
  if (json && plan.kind === "api_endpoint") {
    parsed.api_error = readString(json, "error");
    parsed.api_message = readString(json, "message");
    parsed.api_request_id = readString(json, "request_id");
    parsed.api_type = readString(json, "type");
    if (plan.path === "/v1/models") Object.assign(parsed, extractModelListMetadata(json));
  }
  if (!json && plan.kind === "api_endpoint" && plan.path === "/v1/models") {
    const sample = extractModelSampleFromText(bodyPreview).slice(0, 8);
    if (sample.length > 0) parsed.model_sample = sample;
  }
  if (json && plan.kind === "forum_metadata") {
    parsed.discourse_latest_topics_visible = Array.isArray((json as Record<string, unknown>).topic_list);
  }
  if ((plan.kind === "cookie" || plan.kind === "app_header_metadata") && /wp-(?:includes|content)\/[^"']+\?ver=([^"'&<>\s]+)/i.test(bodyPreview)) {
    parsed.wordpress_asset_versions = Array.from(bodyPreview.matchAll(/wp-(?:includes|content)\/[^"']+\?ver=([^"'&<>\s]+)/gi))
      .map((match) => match[1])
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 10);
  }

  return parsed;
}

function detectSignals(
  plan: PlannedCheck,
  statusCode: number,
  headers: PublicSecurityHeaderMap,
  bodyPreview: string | null,
): string[] {
  const signals: string[] = [];
  const allowOrigin = headers["access-control-allow-origin"];
  if (allowOrigin) signals.push(`cors_allow_origin:${allowOrigin}`);
  if (headers["access-control-allow-credentials"]?.toLowerCase() === "true") signals.push("cors_allow_credentials:true");
  if (headers["set-cookie"]) signals.push("set_cookie_observed");
  if (headers["x-request-id"]) signals.push("request_id_header_observed");
  if (headers["x-discourse-route"] || headers["x-discourse-cached"]) signals.push("discourse_header_observed");
  if (headers["x-runtime"] && plan.role_hint === "community") signals.push("discourse_runtime_header_observed");
  if (headers["content-security-policy"] && plan.role_hint === "community") signals.push("discourse_csp_header_observed");
  if (headers["x-mint-proxy-version"] || headers["x-mintlify-client-version"]) signals.push("mintlify_header_observed");
  if (headers["x-vercel-cache"] || headers["x-vercel-id"] || headers["x-served-version"] || headers["x-vercel-project-id"]) {
    signals.push("vercel_header_observed");
  }
  if (headers.vary && /\brsc\b|next-router/i.test(headers.vary)) signals.push("next_rsc_header_observed");
  if (headers.link && /llms\.txt/i.test(headers.link)) signals.push("llms_txt_link_observed");
  if (plan.kind === "api_endpoint" && statusCode >= 400 && /request[_-]?id|error|message/i.test(bodyPreview ?? "")) {
    signals.push("api_error_preview_observed");
  }
  if (plan.kind === "api_endpoint" && plan.path === "/v1/models" && /"data"|"models"|"id"/i.test(bodyPreview ?? "")) {
    signals.push("public_model_list_observed");
  }
  if (plan.kind === "cms_metadata" && /"namespaces"|"timezone_string"|"gmt_offset"/i.test(bodyPreview ?? "")) {
    signals.push("wordpress_public_metadata_observed");
  }
  if (/wp-(?:includes|content)\/[^"']+\?ver=/i.test(bodyPreview ?? "")) signals.push("wordpress_asset_version_observed");
  if (plan.kind === "route_presence" && statusCode > 0 && statusCode < 500) signals.push("public_route_presence_observed");
  return signals;
}

function summarizeSetCookie(value: string): string[] {
  return value
    .split(/,(?=[^;,=\s]+=[^;,]+)/)
    .slice(0, 5)
    .map((cookie) => {
      const parts = cookie.split(";").map((part) => part.trim());
      const name = parts[0]?.split("=")[0] ?? "cookie";
      const attrs = parts.slice(1).map((attr) => attr.split("=")[0]?.toLowerCase()).filter(Boolean);
      return `${name}: ${attrs.join(",") || "no attributes observed"}`;
    });
}

function readHeaders(headers: Headers): PublicSecurityHeaderMap {
  return {
    server: headers.get("server"),
    "content-type": headers.get("content-type"),
    "access-control-allow-origin": headers.get("access-control-allow-origin"),
    "access-control-allow-credentials": headers.get("access-control-allow-credentials"),
    "access-control-allow-methods": headers.get("access-control-allow-methods"),
    "access-control-allow-headers": headers.get("access-control-allow-headers"),
    "set-cookie": headers.get("set-cookie"),
    "x-request-id": headers.get("x-request-id"),
    "cf-ray": headers.get("cf-ray"),
    "x-discourse-route": headers.get("x-discourse-route"),
    "x-discourse-cached": headers.get("x-discourse-cached"),
    "x-mint-proxy-version": headers.get("x-mint-proxy-version"),
    "x-mintlify-client-version": headers.get("x-mintlify-client-version"),
    "x-vercel-cache": headers.get("x-vercel-cache"),
    "x-vercel-id": headers.get("x-vercel-id"),
    "x-served-version": headers.get("x-served-version"),
    "x-vercel-project-id": headers.get("x-vercel-project-id"),
    "x-runtime": headers.get("x-runtime"),
    "content-security-policy": headers.get("content-security-policy"),
    vary: headers.get("vary"),
    link: headers.get("link"),
  };
}

function emptyHeaders(): PublicSecurityHeaderMap {
  return {
    server: null,
    "content-type": null,
    "access-control-allow-origin": null,
    "access-control-allow-credentials": null,
    "access-control-allow-methods": null,
    "access-control-allow-headers": null,
    "set-cookie": null,
    "x-request-id": null,
    "cf-ray": null,
    "x-discourse-route": null,
    "x-discourse-cached": null,
    "x-mint-proxy-version": null,
    "x-mintlify-client-version": null,
    "x-vercel-cache": null,
    "x-vercel-id": null,
    "x-served-version": null,
    "x-vercel-project-id": null,
    "x-runtime": null,
    "content-security-policy": null,
    vary: null,
    link: null,
  };
}

function summarizeCsp(value: string): Record<string, boolean> {
  return {
    has_nonce: /\bnonce-/i.test(value),
    has_strict_dynamic: /\bstrict-dynamic\b/i.test(value),
    has_frame_ancestors: /\bframe-ancestors\b/i.test(value),
  };
}

type LimitedText = {
  text: string;
  bytes: number;
  truncated: boolean;
};

async function readLimitedText(response: Response, maxBytes: number): Promise<LimitedText> {
  if (!response.body) return { text: "", bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - total;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (value.byteLength > remaining) {
        truncated = true;
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const contentLength = response.headers.get("content-length");
  const declaredBytes = contentLength ? Number.parseInt(contentLength, 10) : Number.NaN;
  if (Number.isFinite(declaredBytes) && declaredBytes > total) truncated = true;
  if (total >= maxBytes) truncated = true;
  return { text: new TextDecoder().decode(bytes), bytes: total, truncated };
}

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function extractModelListMetadata(json: Record<string, unknown>): Record<string, unknown> {
  const models = modelRowsFromJson(json);
  if (models.length === 0) return {};
  const modelSample = models
    .map(modelIdentifier)
    .filter((value): value is string => Boolean(value))
    .slice(0, 8);

  return {
    model_count: models.length,
    ...(modelSample.length > 0 ? { model_sample: modelSample } : {}),
    ...(readString(json, "object") ? { model_object: readString(json, "object") } : {}),
  };
}

function modelRowsFromJson(json: Record<string, unknown>): Record<string, unknown>[] {
  const directData = recordArray(json.data);
  if (directData.length > 0) return directData;
  const directModels = recordArray(json.models);
  if (directModels.length > 0) return directModels;
  const data = isRecord(json.data) ? json.data : null;
  return data ? recordArray(data.models) : [];
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function modelIdentifier(value: Record<string, unknown>): string | null {
  return readString(value, "id") ?? readString(value, "name") ?? readString(value, "model");
}

function extractModelSampleFromText(value: string): string[] {
  const matches = Array.from(value.matchAll(/"(?:id|name|model)"\s*:\s*"([^"]+)"/gi))
    .map((match) => match[1])
    .filter((item) => item && !/^(list|model)$/i.test(item));
  return Array.from(new Set(matches));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function runNext() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
  return results;
}

function parseMaxHosts(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_HOSTS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ALLOWED_HOSTS) {
    throw new Error(`max_hosts must be an integer between 1 and ${MAX_ALLOWED_HOSTS}.`);
  }
  return parsed;
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

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function matchJsonString(value: string, key: string): string | null {
  return value.match(new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"([^"]*)"`, "i"))?.[1] ?? null;
}

function matchJsonNumber(value: string, key: string): number | null {
  const raw = value.match(new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"))?.[1];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchJsonStringArray(value: string, key: string): string[] {
  const body = value.match(new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*\\[([^\\]]*)\\]`, "i"))?.[1];
  if (!body) return [];
  return Array.from(body.matchAll(/"([^"]+)"/g)).map((match) => match[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

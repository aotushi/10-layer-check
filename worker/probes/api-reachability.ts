import { remoteFetch } from "./remote-fetch";
import type {
  ApiReachabilityCandidate,
  ApiReachabilityCheck,
  ApiReachabilityResult,
  ApiReachabilitySkipped,
} from "../../src/providers/api-reachability/types";

const DEFAULT_MAX_CANDIDATES = 5;
const MAX_CANDIDATES_LIMIT = 10;
const PREVIEW_BYTES = 2048;

export async function apiReachabilityProbe(
  target: string,
  options: { maxCandidates?: unknown; candidates?: unknown } = {},
): Promise<ApiReachabilityResult> {
  const startedAt = Date.now();
  const main = await remoteFetch(target, 10);
  const finalUrl = new URL(main.final_url);
  const maxCandidates = parseMaxCandidates(options.maxCandidates);
  const discovered = readProvidedCandidates(options.candidates, finalUrl.origin);
  const candidates = discovered.length > 0 ? discovered : extractEndpointCandidates(main.html, finalUrl.origin);
  const { selected, skipped } = selectSafeSameOriginCandidates(candidates, finalUrl, maxCandidates);
  const checks = await Promise.all(selected.map(checkCandidate));

  return {
    requested_url: main.requested_url,
    final_url: main.final_url,
    host: finalUrl.hostname,
    candidates,
    checks,
    skipped,
    limits: {
      max_candidates: maxCandidates,
      checked_count: checks.length,
      same_origin_only: true,
      methods: ["HEAD", "GET"],
      preview_bytes: PREVIEW_BYTES,
    },
    coverage: {
      collected: ["same_origin_api_like_candidate_discovery", "bounded_head_get_reachability"],
      missing: [
        "authenticated_api_behavior",
        "cross_origin_api_reachability",
        "runtime_interaction_api_calls",
        "graphql_introspection",
      ],
      limitations: [
        "Only same-origin API-like candidates discovered in static HTML or supplied by the caller are sampled.",
        "Only HEAD and safe GET requests are used; no credentials, bodies, mutations, or path brute forcing are performed.",
        "Admin, logout, destructive, payment, and account action-like paths are skipped by default.",
      ],
    },
    duration_ms: Date.now() - startedAt,
    provider_id: "cloudflare_worker_api_reachability",
    source: "cloudflare_worker_api_reachability",
  };
}

function extractEndpointCandidates(html: string, origin: string): ApiReachabilityCandidate[] {
  const candidates = new Map<string, ApiReachabilityCandidate>();
  const patterns = [
    { pattern: /\b(?:https?:)?\/\/[^"'\s<>]+/gi, source: "absolute_url" },
    { pattern: /["'`](\/[^"'`\s<>]*(?:api|graphql|trpc|rpc|v\d+|json)[^"'`\s<>]*)["'`]/gi, source: "path_literal" },
  ];

  for (const { pattern, source } of patterns) {
    for (const match of html.matchAll(pattern)) {
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

function readProvidedCandidates(value: unknown, origin: string): ApiReachabilityCandidate[] {
  if (!Array.isArray(value)) return [];
  const candidates = new Map<string, ApiReachabilityCandidate>();

  for (const item of value) {
    const raw = typeof item === "string" ? item : isRecord(item) && typeof item.url === "string" ? item.url : null;
    if (!raw) continue;
    const normalized = normalizeCandidateUrl(raw, origin);
    if (!normalized || !looksLikeApiEndpoint(normalized)) continue;
    candidates.set(normalized, {
      url: normalized,
      source: "provided_candidate",
      reason: classifyEndpointReason(normalized),
    });
  }

  return Array.from(candidates.values()).slice(0, 40);
}

function selectSafeSameOriginCandidates(
  candidates: ApiReachabilityCandidate[],
  finalUrl: URL,
  maxCandidates: number,
): { selected: ApiReachabilityCandidate[]; skipped: ApiReachabilitySkipped[] } {
  const selected: ApiReachabilityCandidate[] = [];
  const skipped: ApiReachabilitySkipped[] = [];

  for (const candidate of candidates) {
    const url = new URL(candidate.url);
    const reason = getSkipReason(url, finalUrl);
    if (reason) {
      skipped.push({ url: candidate.url, reason });
      continue;
    }
    if (selected.length >= maxCandidates) {
      skipped.push({ url: candidate.url, reason: "max_candidates_reached" });
      continue;
    }
    selected.push(candidate);
  }

  return { selected, skipped };
}

async function checkCandidate(candidate: ApiReachabilityCandidate): Promise<ApiReachabilityCheck> {
  const head = await requestCandidate(candidate.url, "HEAD", false);
  if (head.status_code !== 405 && head.status_code !== 501 && !head.error) {
    return head;
  }

  return requestCandidate(candidate.url, "GET", true);
}

async function requestCandidate(url: string, method: "HEAD" | "GET", readPreview: boolean): Promise<ApiReachabilityCheck> {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method,
      redirect: "manual",
      headers: {
        accept: "application/json,text/plain,*/*;q=0.8",
      },
    });
    const preview = readPreview ? await readLimitedText(response, PREVIEW_BYTES) : null;
    return {
      url,
      method,
      status_code: response.status,
      ok: response.ok,
      redirected_to: response.headers.get("location"),
      content_type: response.headers.get("content-type"),
      cache_control: response.headers.get("cache-control"),
      cors: {
        allow_origin: response.headers.get("access-control-allow-origin"),
        allow_methods: response.headers.get("access-control-allow-methods"),
        allow_headers: response.headers.get("access-control-allow-headers"),
        allow_credentials: response.headers.get("access-control-allow-credentials"),
      },
      response_preview: preview ? preview.slice(0, 500) : null,
      error_surface_signals: detectErrorSurface(response.status, response.headers.get("content-type"), preview),
      duration_ms: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      url,
      method,
      status_code: null,
      ok: false,
      redirected_to: null,
      content_type: null,
      cache_control: null,
      cors: {
        allow_origin: null,
        allow_methods: null,
        allow_headers: null,
        allow_credentials: null,
      },
      response_preview: null,
      error_surface_signals: [],
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getSkipReason(url: URL, finalUrl: URL): string | null {
  if (url.origin !== finalUrl.origin) return "cross_origin_candidate";
  if (!["http:", "https:"].includes(url.protocol)) return "unsupported_protocol";
  if (isDestructiveOrSensitivePath(url.pathname)) return "sensitive_or_destructive_path";
  return null;
}

function isDestructiveOrSensitivePath(pathname: string): boolean {
  return /(?:^|\/)(admin|logout|delete|remove|destroy|payment|checkout|account|settings|password|session)(?:\/|$)/i.test(
    pathname,
  );
}

function detectErrorSurface(status: number, contentType: string | null, preview: string | null): string[] {
  const signals: string[] = [];
  const text = (preview ?? "").toLowerCase();
  if (status >= 500) signals.push("server_error_status");
  if (status >= 400 && status < 500) signals.push("client_error_status");
  if (contentType?.includes("application/json") && /"error"|"message"|"trace"/i.test(preview ?? "")) {
    signals.push("json_error_shape");
  }
  if (/stack trace|traceback|exception|runtimeerror|typeerror|referenceerror/.test(text)) {
    signals.push("stack_trace_keyword");
  }
  return signals;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
  }
  return new TextDecoder().decode(concatBytes(chunks, Math.min(size, maxBytes)));
}

function concatBytes(chunks: Uint8Array[], maxBytes: number): Uint8Array {
  const output = new Uint8Array(maxBytes);
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.min(chunk.byteLength, maxBytes - offset));
    output.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= maxBytes) break;
  }
  return output;
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

function parseMaxCandidates(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_CANDIDATES;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_CANDIDATES_LIMIT) {
    throw new Error(`max_candidates must be an integer between 0 and ${MAX_CANDIDATES_LIMIT}.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type PublicHostRoleHint = "root" | "docs" | "api" | "blog" | "community" | "status" | "unknown";
type PublicHostCandidateSource = "root_domain" | "sitemap" | "user_input";

type PublicHostCandidate = {
  host: string;
  role_hint: PublicHostRoleHint;
  sources: PublicHostCandidateSource[];
};

type PublicHostAppMarker = {
  name: "Mintlify" | "WordPress" | "Discourse" | "wp-json" | "docs" | "api" | "blog" | "community" | "status";
  category: "docs" | "api" | "blog" | "community" | "status" | "cms" | "forum";
  confidence: "high" | "medium" | "low";
  evidence: Array<{
    type: "host_label" | "html" | "html_meta" | "html_link" | "header" | "marker_path" | "title";
    name: string;
    value: string;
  }>;
};

type PublicHostMarkerCheck = {
  marker: "wp-json";
  path: string;
  url: string;
  status_code: number | null;
  content_type: string | null;
  matched: boolean;
  error: string | null;
};

type CheckedPublicHost = {
  host: string;
  role_hint: PublicHostRoleHint;
  sources: PublicHostCandidateSource[];
  root_observation: {
    url: string;
    status_code: number | null;
    final_url: string | null;
    redirected_to: string | null;
    content_type: string | null;
    server: string | null;
    x_powered_by: string | null;
    title: string | null;
    canonical_url: string | null;
    error: string | null;
  };
  marker_checks: PublicHostMarkerCheck[];
  app_markers: PublicHostAppMarker[];
  limitations: string[];
};

type InternalRootObservation = CheckedPublicHost["root_observation"] & {
  html_sample: string;
};

export type PublicHostFingerprintResult = {
  requested_url: string;
  host: string;
  candidate_hosts: PublicHostCandidate[];
  checked_hosts: CheckedPublicHost[];
  limits: {
    max_hosts: number;
    checked_hosts: number;
    max_requests_per_host: number;
    max_concurrency: number;
    timeout_ms: number;
    max_sitemap_bytes: number;
  };
  coverage: {
    collected: string[];
    missing: string[];
    limitations: string[];
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export type PublicHostFingerprintOptions = {
  hosts?: unknown;
  maxHosts?: unknown;
};

const DEFAULT_MAX_HOSTS = 8;
const MAX_ALLOWED_HOSTS = 12;
const MAX_CONCURRENCY = 3;
const TIMEOUT_MS = 10_000;
const MAX_SITEMAP_BYTES = 64_000;
const ROLE_LABELS = ["docs", "api", "blog", "community", "status"] as const;

export async function publicHostFingerprintProbe(
  target: string,
  options: PublicHostFingerprintOptions = {},
): Promise<PublicHostFingerprintResult> {
  const startedAt = Date.now();
  const normalizedUrl = normalizeTargetUrl(target);
  const targetHost = new URL(normalizedUrl).hostname.toLowerCase();
  const maxHosts = parseMaxHosts(options.maxHosts);
  const sitemapHosts = await discoverSitemapHosts(normalizedUrl, targetHost);
  const candidates = createCandidateHosts(targetHost, options.hosts, sitemapHosts).slice(0, maxHosts);
  const checkedHosts = await runWithConcurrency(candidates, MAX_CONCURRENCY, inspectPublicHost);

  return {
    requested_url: target,
    host: targetHost,
    candidate_hosts: candidates,
    checked_hosts: checkedHosts,
    limits: {
      max_hosts: maxHosts,
      checked_hosts: checkedHosts.length,
      max_requests_per_host: 2,
      max_concurrency: MAX_CONCURRENCY,
      timeout_ms: TIMEOUT_MS,
      max_sitemap_bytes: MAX_SITEMAP_BYTES,
    },
    coverage: {
      collected: [
        "bounded_public_host_candidates",
        "root_document_observation",
        "selected_headers",
        "html_title",
        "canonical_url",
        "public_app_markers",
      ],
      missing: [
        "permissioned_authenticated_surface_check",
        "permissioned_deep_port_service_inventory",
        "permissioned_security_validation",
      ],
      limitations: [
        "This probe checks a small bounded set of same-domain public HTTP(S) hosts only.",
        "It does not perform directory brute forcing, port scanning, authentication workflows, vulnerability probing, or user enumeration.",
        "App markers are candidates from headers, root HTML, and one public marker path; absence is not proof that a technology is unused.",
      ],
    },
    duration_ms: Date.now() - startedAt,
    provider_id: "cloudflare_worker_public_host_fingerprint",
    source: "cloudflare_worker_public_host_fingerprint",
  };
}

async function inspectPublicHost(candidate: PublicHostCandidate): Promise<CheckedPublicHost> {
  const rootUrl = `https://${candidate.host}/`;
  const root = await fetchRootObservation(rootUrl);
  const markerChecks = await runMarkerChecks(candidate.host, candidate.role_hint);
  const appMarkers = detectAppMarkers(candidate, root, markerChecks);

  return {
    host: candidate.host,
    role_hint: candidate.role_hint,
    sources: candidate.sources,
    root_observation: omitHtmlSample(root),
    marker_checks: markerChecks,
    app_markers: appMarkers,
    limitations: [
      "One bounded GET request to the root document.",
      "At most one additional public marker request for blog/CMS evidence.",
      "Redirects are observed but not recursively followed for deeper fingerprinting.",
    ],
  };
}

async function fetchRootObservation(url: string): Promise<InternalRootObservation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,*/*;q=0.8",
      },
    });
    const contentType = response.headers.get("content-type");
    const html = contentType?.toLowerCase().includes("text/html")
      ? await readLimitedText(response, 48_000)
      : "";
    return {
      url,
      status_code: response.status,
      final_url: response.url || url,
      redirected_to: response.headers.get("location"),
      content_type: contentType,
      server: response.headers.get("server"),
      x_powered_by: response.headers.get("x-powered-by"),
      title: extractTitle(html),
      canonical_url: extractCanonicalUrl(html),
      error: null,
      html_sample: html,
    };
  } catch (error) {
    return {
      url,
      status_code: null,
      final_url: null,
      redirected_to: null,
      content_type: null,
      server: null,
      x_powered_by: null,
      title: null,
      canonical_url: null,
      error: error instanceof Error ? error.message : String(error),
      html_sample: "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runMarkerChecks(host: string, roleHint: PublicHostRoleHint): Promise<PublicHostMarkerCheck[]> {
  if (roleHint !== "blog" && roleHint !== "root") return [];
  return [await fetchMarkerPath(host, "/wp-json/", "wp-json")];
}

async function fetchMarkerPath(host: string, path: string, marker: "wp-json"): Promise<PublicHostMarkerCheck> {
  const url = `https://${host}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "application/json,text/html,*/*;q=0.8",
      },
    });
    const contentType = response.headers.get("content-type");
    return {
      marker,
      path,
      url,
      status_code: response.status,
      content_type: contentType,
      matched: response.status >= 200 && response.status < 400 && Boolean(contentType?.toLowerCase().includes("json")),
      error: null,
    };
  } catch (error) {
    return {
      marker,
      path,
      url,
      status_code: null,
      content_type: null,
      matched: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function detectAppMarkers(
  candidate: PublicHostCandidate,
  root: InternalRootObservation,
  markerChecks: PublicHostMarkerCheck[],
): PublicHostAppMarker[] {
  const markers: PublicHostAppMarker[] = [];
  const html = root.html_sample ?? "";
  const text = `${candidate.host} ${root.title ?? ""} ${root.server ?? ""} ${root.x_powered_by ?? ""} ${html}`.toLowerCase();

  if (candidate.role_hint !== "unknown" && candidate.role_hint !== "root") {
    markers.push({
      name: candidate.role_hint,
      category: candidate.role_hint,
      confidence: candidate.sources.includes("sitemap") ? "medium" : "low",
      evidence: [{ type: "host_label", name: "role_hint", value: candidate.role_hint }],
    });
  }

  if (/mintlify|mintlify-assets|mintlify\.app/.test(text)) {
    markers.push({
      name: "Mintlify",
      category: "docs",
      confidence: "medium",
      evidence: [{ type: "html", name: "mintlify", value: "root HTML or headers mention Mintlify" }],
    });
  }

  const generator = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? null;
  if (generator && /wordpress/i.test(generator)) {
    markers.push({
      name: "WordPress",
      category: "cms",
      confidence: "high",
      evidence: [{ type: "html_meta", name: "generator", value: generator.slice(0, 160) }],
    });
  } else if (/wp-content|wp-includes|wordpress/.test(text)) {
    markers.push({
      name: "WordPress",
      category: "cms",
      confidence: "medium",
      evidence: [{ type: "html", name: "wordpress_static_marker", value: "root HTML contains WordPress-style asset markers" }],
    });
  }

  if (/discourse|data-discourse|discourse-/.test(text)) {
    markers.push({
      name: "Discourse",
      category: "forum",
      confidence: "medium",
      evidence: [{ type: "html", name: "discourse", value: "root HTML or headers mention Discourse" }],
    });
  }

  const wpJson = markerChecks.find((check) => check.marker === "wp-json" && check.matched);
  if (wpJson) {
    markers.push({
      name: "wp-json",
      category: "cms",
      confidence: "high",
      evidence: [{ type: "marker_path", name: "/wp-json/", value: `status ${wpJson.status_code}` }],
    });
  }

  return dedupeMarkers(markers);
}

function omitHtmlSample(root: InternalRootObservation): CheckedPublicHost["root_observation"] {
  return {
    url: root.url,
    status_code: root.status_code,
    final_url: root.final_url,
    redirected_to: root.redirected_to,
    content_type: root.content_type,
    server: root.server,
    x_powered_by: root.x_powered_by,
    title: root.title,
    canonical_url: root.canonical_url,
    error: root.error,
  };
}

function createCandidateHosts(
  targetHost: string,
  userHosts: unknown,
  sitemapHosts: PublicHostCandidate[],
): PublicHostCandidate[] {
  const candidates = new Map<string, PublicHostCandidate>();
  const addCandidate = (host: string, source: PublicHostCandidateSource) => {
    const normalized = normalizeAllowedHost(host, targetHost);
    if (!normalized) return;
    const current = candidates.get(normalized) ?? {
      host: normalized,
      role_hint: inferRoleHint(normalized, targetHost),
      sources: [],
    };
    current.sources = Array.from(new Set([...current.sources, source])).sort();
    candidates.set(normalized, current);
  };

  addCandidate(targetHost, "root_domain");
  for (const label of ROLE_LABELS) addCandidate(`${label}.${targetHost}`, "root_domain");
  for (const candidate of sitemapHosts) addCandidate(candidate.host, "sitemap");
  for (const host of parseUserHosts(userHosts)) addCandidate(host, "user_input");

  return Array.from(candidates.values()).sort((left, right) => scoreCandidate(right) - scoreCandidate(left) || left.host.localeCompare(right.host));
}

async function discoverSitemapHosts(normalizedUrl: string, targetHost: string): Promise<PublicHostCandidate[]> {
  const url = new URL(normalizedUrl);
  url.pathname = "/sitemap.xml";
  url.search = "";
  url.hash = "";

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/xml,text/xml,text/plain,*/*;q=0.8" },
    });
    if (!response.ok) return [];
    const text = await readLimitedText(response, MAX_SITEMAP_BYTES);
    return Array.from(text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi))
      .map((match) => safeHostname(match[1]))
      .filter((host): host is string => Boolean(host && (host === targetHost || host.endsWith(`.${targetHost}`))))
      .map((host) => ({
        host,
        role_hint: inferRoleHint(host, targetHost),
        sources: ["sitemap" as const],
      }));
  } catch {
    return [];
  }
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - total;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (value.byteLength > remaining) break;
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

  return new TextDecoder().decode(bytes);
}

function inferRoleHint(host: string, targetHost: string): PublicHostRoleHint {
  if (host === targetHost) return "root";
  const label = host.slice(0, -targetHost.length - 1).split(".").pop() ?? "";
  if (label === "docs" || label === "developers" || label === "developer" || label === "reference") return "docs";
  if (label === "api") return "api";
  if (label === "blog" || label === "news") return "blog";
  if (label === "community" || label === "forum") return "community";
  if (label === "status") return "status";
  return "unknown";
}

function scoreCandidate(candidate: PublicHostCandidate): number {
  if (candidate.role_hint === "root") return 100;
  if (candidate.sources.includes("sitemap")) return 90;
  if (candidate.role_hint !== "unknown") return 80;
  return 10;
}

function parseUserHosts(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("hosts must be an array when provided.");
  }
  return value.filter((item): item is string => typeof item === "string");
}

function parseMaxHosts(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_HOSTS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ALLOWED_HOSTS) {
    throw new Error(`max_hosts must be an integer between 1 and ${MAX_ALLOWED_HOSTS}.`);
  }
  return parsed;
}

function normalizeAllowedHost(host: string, targetHost: string): string | null {
  const normalized = host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+$/.test(normalized)) return null;
  if (normalized !== targetHost && !normalized.endsWith(`.${targetHost}`)) return null;
  return normalized;
}

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]{0,240})<\/title>/i);
  if (!match) return null;
  return decodeHtmlText(match[1].replace(/\s+/g, " ").trim()).slice(0, 160) || null;
}

function extractCanonicalUrl(html: string): string | null {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  return match?.[1]?.slice(0, 300) ?? null;
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function dedupeMarkers(markers: PublicHostAppMarker[]): PublicHostAppMarker[] {
  const byKey = new Map<string, PublicHostAppMarker>();
  for (const marker of markers) {
    const key = `${marker.name}:${marker.category}`;
    if (!byKey.has(key)) byKey.set(key, marker);
  }
  return Array.from(byKey.values()).slice(0, 12);
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

function normalizeTargetUrl(value: string): string {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https targets are supported. Received: ${url.protocol}`);
  }

  url.hash = "";
  return url.toString();
}

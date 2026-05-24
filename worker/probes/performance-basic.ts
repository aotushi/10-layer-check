const MAX_HTML_BYTES = 512_000;
const MAX_PERFORMANCE_RESOURCE_PROBES = 12;

type PerformanceResourceCandidate = {
  url: string;
  kind: "script" | "stylesheet" | "image" | "preload" | "other";
  same_origin: boolean;
};

type BasicPerformanceResource = PerformanceResourceCandidate & {
  status_code: number | null;
  content_length: number | null;
  content_type: string | null;
  cache_control: string | null;
  cdn_cache_status: string | null;
  duration_ms: number | null;
  error: string | null;
};

export type BasicPerformanceResult = {
  requested_url: string;
  final_url: string;
  status_code: number;
  ok: boolean;
  timings: {
    ttfb_ms: number;
    total_ms: number;
    body_read_ms: number;
    redirect_count: number;
  };
  document: {
    html_bytes: number;
    encoded_content_length: number | null;
    content_type: string | null;
    content_encoding: string | null;
    cache_control: string | null;
    cdn_cache_status: string | null;
  };
  declared_resources: {
    scripts: number;
    stylesheets: number;
    images: number;
    preloads: number;
    total: number;
  };
  sampled_resources: BasicPerformanceResource[];
  page_weight_estimate: {
    known_bytes: number;
    html_bytes: number;
    sampled_resource_bytes: number;
    unknown_sampled_resources: number;
    sampled_resource_count: number;
    declared_resource_count: number;
    note: string;
  };
  coverage: {
    collected: string[];
    missing: string[];
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export async function performanceBasicProbe(target: string): Promise<BasicPerformanceResult> {
  const startedAt = Date.now();
  const requestedUrl = normalizeTargetUrl(target);
  const responseStart = Date.now();
  const response = await fetch(requestedUrl, {
    method: "GET",
    redirect: "follow",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  const ttfbMs = Date.now() - responseStart;
  const bodyStart = Date.now();
  const html = await readLimitedText(response, MAX_HTML_BYTES);
  const bodyReadMs = Date.now() - bodyStart;
  const finalUrl = response.url || requestedUrl;
  const headers = normalizeHeaders(response.headers);
  const htmlBytes = byteLength(html);
  const resources = extractPerformanceResourceCandidates(html, finalUrl);
  const sampledResources = await Promise.all(
    resources.slice(0, MAX_PERFORMANCE_RESOURCE_PROBES).map((resource) => probePerformanceResource(resource)),
  );
  const sampledResourceBytes = sampledResources.reduce((sum, resource) => sum + (resource.content_length ?? 0), 0);
  const unknownSampledResources = sampledResources.filter((resource) => resource.content_length === null).length;

  return {
    requested_url: requestedUrl,
    final_url: finalUrl,
    status_code: response.status,
    ok: response.ok,
    timings: {
      ttfb_ms: ttfbMs,
      total_ms: Date.now() - startedAt,
      body_read_ms: bodyReadMs,
      redirect_count: response.redirected && response.url !== requestedUrl ? 1 : 0,
    },
    document: {
      html_bytes: htmlBytes,
      encoded_content_length: parseContentLength(headers["content-length"]),
      content_type: headers["content-type"] ?? null,
      content_encoding: headers["content-encoding"] ?? null,
      cache_control: headers["cache-control"] ?? null,
      cdn_cache_status: getFirstHeader(headers, ["cf-cache-status", "x-cache", "x-cache-hits"]),
    },
    declared_resources: countDeclaredResources(resources),
    sampled_resources: sampledResources,
    page_weight_estimate: {
      known_bytes: htmlBytes + sampledResourceBytes,
      html_bytes: htmlBytes,
      sampled_resource_bytes: sampledResourceBytes,
      unknown_sampled_resources: unknownSampledResources,
      sampled_resource_count: sampledResources.length,
      declared_resource_count: resources.length,
      note:
        "Known bytes include fetched HTML plus sampled declared resources with content-length. It is not a full browser transfer-size measurement.",
    },
    coverage: {
      collected: [
        "worker_fetch_ttfb",
        "document_html_bytes",
        "declared_resource_counts",
        "sampled_resource_content_length",
        "document_cache_headers",
      ],
      missing: [
        "lighthouse_score",
        "core_web_vitals_field_data",
        "browser_resource_waterfall",
        "javascript_runtime_resource_injection",
      ],
    },
    duration_ms: Date.now() - startedAt,
    provider_id: "worker-fetch",
    source: "cloudflare_worker_fetch",
  };
}

async function probePerformanceResource(resource: PerformanceResourceCandidate): Promise<BasicPerformanceResource> {
  const startedAt = Date.now();

  try {
    const response = await fetch(resource.url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        accept: "*/*",
      },
    });
    const headers = normalizeHeaders(response.headers);

    return {
      ...resource,
      status_code: response.status,
      content_length: parseContentLength(headers["content-length"]),
      content_type: headers["content-type"] ?? null,
      cache_control: headers["cache-control"] ?? null,
      cdn_cache_status: getFirstHeader(headers, ["cf-cache-status", "x-cache", "x-cache-hits"]),
      duration_ms: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      ...resource,
      status_code: null,
      content_length: null,
      content_type: null,
      cache_control: null,
      cdn_cache_status: null,
      duration_ms: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractPerformanceResourceCandidates(html: string, finalUrl: string): PerformanceResourceCandidate[] {
  const base = new URL(finalUrl);
  const candidates: PerformanceResourceCandidate[] = [];

  for (const tag of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    pushResourceCandidate(candidates, tag[1], "script", base);
  }

  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const rawTag = tag[0] ?? "";
    const href = extractAttribute(rawTag, "href");
    if (!href) continue;

    const rel = extractAttribute(rawTag, "rel")?.toLowerCase() ?? "";
    if (rel.includes("stylesheet")) {
      pushResourceCandidate(candidates, href, "stylesheet", base);
    } else if (rel.includes("preload") || rel.includes("modulepreload") || rel.includes("prefetch")) {
      pushResourceCandidate(candidates, href, "preload", base);
    }
  }

  for (const tag of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    pushResourceCandidate(candidates, tag[1], "image", base);
  }

  return dedupeResourceCandidates(candidates);
}

function pushResourceCandidate(
  candidates: PerformanceResourceCandidate[],
  rawUrl: string | undefined,
  kind: PerformanceResourceCandidate["kind"],
  base: URL,
): void {
  if (!rawUrl || rawUrl.startsWith("data:") || rawUrl.startsWith("blob:") || rawUrl.startsWith("javascript:")) return;

  try {
    const url = new URL(rawUrl, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    candidates.push({
      url: url.toString(),
      kind,
      same_origin: url.origin === base.origin,
    });
  } catch {
    // Ignore invalid resource URLs in static HTML.
  }
}

function dedupeResourceCandidates(candidates: PerformanceResourceCandidate[]): PerformanceResourceCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractAttribute(tag: string, attribute: string): string | null {
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function countDeclaredResources(resources: PerformanceResourceCandidate[]): BasicPerformanceResult["declared_resources"] {
  const scripts = resources.filter((resource) => resource.kind === "script").length;
  const stylesheets = resources.filter((resource) => resource.kind === "stylesheet").length;
  const images = resources.filter((resource) => resource.kind === "image").length;
  const preloads = resources.filter((resource) => resource.kind === "preload").length;

  return {
    scripts,
    stylesheets,
    images,
    preloads,
    total: resources.length,
  };
}

function parseContentLength(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getFirstHeader(headers: Record<string, string>, names: string[]): string | null {
  for (const name of names) {
    const value = headers[name];
    if (value) return value;
  }
  return null;
}

function normalizeTargetUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Target URL is required.");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP(S) targets are supported.");
  return url.toString();
}

function normalizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
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

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

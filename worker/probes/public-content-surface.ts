import type {
  PublicContentClassification,
  PublicContentControlledHint,
  PublicContentDiscoverySource,
  PublicContentSurface,
  PublicContentSurfaceResult,
} from "../../src/providers/public-content-surface/types";

type CandidateUrl = {
  url: string;
  sources: PublicContentSurface["discovered_from"];
};

type LinkCandidate = {
  url: string;
  source: PublicContentDiscoverySource;
  fromUrl: string | null;
  label: string | null;
};

type InternalPublicContentSurface = PublicContentSurface & {
  html_sample: string;
};

export type PublicContentSurfaceOptions = {
  maxPages?: unknown;
  maxCandidateUrls?: unknown;
};

const DEFAULT_MAX_PAGES = 8;
const MAX_ALLOWED_PAGES = 12;
const DEFAULT_MAX_CANDIDATE_URLS = 24;
const MAX_ALLOWED_CANDIDATE_URLS = 40;
const MAX_CONCURRENCY = 3;
const TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 48_000;
const MAX_INDEX_BYTES = 64_000;

export async function publicContentSurfaceProbe(
  target: string,
  options: PublicContentSurfaceOptions = {},
): Promise<PublicContentSurfaceResult> {
  const startedAt = Date.now();
  const normalizedUrl = normalizeTargetUrl(target);
  const rootUrl = new URL(normalizedUrl);
  rootUrl.pathname = rootUrl.pathname || "/";
  rootUrl.search = "";
  rootUrl.hash = "";
  const rootHost = rootUrl.hostname.toLowerCase();
  const maxPages = parseLimit(options.maxPages, DEFAULT_MAX_PAGES, MAX_ALLOWED_PAGES, "max_pages");
  const maxCandidateUrls = parseLimit(
    options.maxCandidateUrls,
    DEFAULT_MAX_CANDIDATE_URLS,
    MAX_ALLOWED_CANDIDATE_URLS,
    "max_candidate_urls",
  );

  const root = await fetchSurfaceCandidate(rootUrl.toString(), rootHost, [
    { source: "root_document", url: null, label: "submitted target" },
  ]);
  const discovered = [
    ...createHostCandidateLinks(rootHost),
    ...discoverHtmlLinks(root),
    ...(await discoverRobotsSitemapLinks(rootUrl, rootHost)),
    ...(await discoverDefaultSitemapLinks(rootUrl, rootHost)),
  ];
  const candidates = createCandidateUrls(root.url, rootHost, discovered, maxCandidateUrls);
  const selected = candidates.slice(0, maxPages);
  const remaining = selected.filter((candidate) => candidate.url !== root.url);
  const fetched = await runWithConcurrency(remaining, MAX_CONCURRENCY, (candidate) =>
    fetchSurfaceCandidate(candidate.url, rootHost, candidate.sources),
  );
  const surfaces = [root, ...fetched].slice(0, maxPages).map(omitHtmlSample);

  return {
    requested_url: target,
    host: rootHost,
    candidate_urls: candidates,
    surfaces,
    limits: {
      max_candidate_urls: maxCandidateUrls,
      max_pages: maxPages,
      max_concurrency: MAX_CONCURRENCY,
      timeout_ms: TIMEOUT_MS,
      max_page_bytes: MAX_PAGE_BYTES,
      max_index_bytes: MAX_INDEX_BYTES,
    },
    coverage: {
      collected: [
        "bounded_public_content_candidates",
        "public_page_title",
        "public_page_meta_description",
        "public_page_headings",
        "public_visible_text_excerpt",
        "public_schema_type_hints",
        "bounded_same_root_public_host_candidates",
        "open_content_classification_hints",
      ],
      missing: [
        "authenticated_content",
        "form_submission_results",
        "deep_crawl_content",
        "unlinked_public_pages",
      ],
      limitations: [
        "This provider discovers a small bounded set of public same-site pages from root HTML and public indexes.",
        "It does not submit forms, use credentials, execute private workflows, brute-force paths, or perform a deep crawl.",
        "Open classification labels are weak evidence for report organization; unknown labels preserve the raw page evidence.",
      ],
    },
    duration_ms: Date.now() - startedAt,
    provider_id: "cloudflare_worker_public_content_surface",
    source: "cloudflare_worker_public_content_surface",
  };
}

async function fetchSurfaceCandidate(
  url: string,
  rootHost: string,
  discoveredFrom: PublicContentSurface["discovered_from"],
): Promise<InternalPublicContentSurface> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const requestedUrl = new URL(url);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
    const finalUrl = response.url || url;
    const final = new URL(finalUrl);
    const contentType = response.headers.get("content-type");
    const isSameSite = final.hostname.toLowerCase() === rootHost || final.hostname.toLowerCase().endsWith(`.${rootHost}`);
    const isHtml = Boolean(contentType?.toLowerCase().includes("html"));
    const html = isSameSite && isHtml ? await readLimitedText(response, MAX_PAGE_BYTES) : "";
    const title = extractTitle(html);
    const metaDescription = extractMetaDescription(html);
    const headings = extractHeadings(html);
    const schemaTypes = extractSchemaTypes(html);
    const excerpt = extractVisibleTextExcerpt(html);
    const classification = classifySurface({
      url: finalUrl,
      rootHost,
      title,
      metaDescription,
      headings,
      excerpt,
      discoveredFrom,
    });

    return {
      url,
      final_url: finalUrl,
      host: final.hostname.toLowerCase(),
      path: final.pathname || "/",
      status_code: response.status,
      content_type: contentType,
      title,
      meta_description: metaDescription,
      headings,
      schema_types: schemaTypes,
      visible_text_excerpt: excerpt,
      discovered_from: discoveredFrom,
      classification,
      error: isSameSite ? null : "Final URL left the submitted target host scope.",
      limitations: [
        "Only a bounded public HTML preview was read.",
        "Classification is heuristic and does not prove business function by itself.",
      ],
      html_sample: html,
    };
  } catch (error) {
    return {
      url,
      final_url: null,
      host: requestedUrl.hostname.toLowerCase(),
      path: requestedUrl.pathname || "/",
      status_code: null,
      content_type: null,
      title: null,
      meta_description: null,
      headings: [],
      schema_types: [],
      visible_text_excerpt: null,
      discovered_from: discoveredFrom,
      classification: {
        label: inferLabelFromUrl(requestedUrl, rootHost, discoveredFrom),
        controlled_hint: "unknown",
        confidence: "low",
        basis: ["fetch failed before content classification"],
      },
      error: error instanceof Error ? error.message : String(error),
      limitations: [
        "The page was selected as a bounded public candidate but did not return usable content in this run.",
      ],
      html_sample: "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function discoverHtmlLinks(root: InternalPublicContentSurface): LinkCandidate[] {
  const html = root.html_sample;
  const fromUrl = root.final_url ?? root.url;
  const links: LinkCandidate[] = [];

  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  if (canonical?.[1]) links.push({ url: canonical[1], source: "canonical", fromUrl, label: "canonical" });

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/rel=["'][^"']*alternate/i.test(tag)) continue;
    const href = readHtmlAttribute(tag, "href");
    if (!href) continue;
    const type = readHtmlAttribute(tag, "type");
    const label = readHtmlAttribute(tag, "title") ?? type ?? "alternate";
    links.push({ url: href, source: "alternate", fromUrl, label });
  }

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decodeHtmlText(stripTags(match[2]).replace(/\s+/g, " ").trim()).slice(0, 80) || null;
    links.push({ url: match[1], source: "html_link", fromUrl, label });
    if (links.length >= DEFAULT_MAX_CANDIDATE_URLS) break;
  }

  return links;
}

function createHostCandidateLinks(rootHost: string): LinkCandidate[] {
  return ["docs", "blog", "community", "status", "support", "help", "developers", "developer"]
    .map((label) => ({
      url: `https://${label}.${rootHost}/`,
      source: "host_candidate" as const,
      fromUrl: null,
      label,
    }));
}

function omitHtmlSample(surface: InternalPublicContentSurface): PublicContentSurface {
  const { html_sample: _htmlSample, ...publicSurface } = surface;
  return publicSurface;
}

async function discoverRobotsSitemapLinks(rootUrl: URL, rootHost: string): Promise<LinkCandidate[]> {
  const robots = new URL(rootUrl.toString());
  robots.pathname = "/robots.txt";
  robots.search = "";
  robots.hash = "";

  try {
    const response = await fetch(robots.toString(), {
      method: "GET",
      redirect: "follow",
      headers: { accept: "text/plain,*/*;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const text = await readLimitedText(response, MAX_INDEX_BYTES);
    const sitemapUrls = Array.from(text.matchAll(/^sitemap:\s*(\S+)/gim))
      .map((match) => normalizeSameSiteUrl(match[1], rootUrl.toString(), rootHost))
      .filter((value): value is string => Boolean(value));
    return (await fetchSitemapCandidates(sitemapUrls, rootHost, "robots_sitemap")).slice(0, DEFAULT_MAX_CANDIDATE_URLS);
  } catch {
    return [];
  }
}

async function discoverDefaultSitemapLinks(rootUrl: URL, rootHost: string): Promise<LinkCandidate[]> {
  const sitemap = new URL(rootUrl.toString());
  sitemap.pathname = "/sitemap.xml";
  sitemap.search = "";
  sitemap.hash = "";
  return fetchSitemapCandidates([sitemap.toString()], rootHost, "sitemap");
}

async function fetchSitemapCandidates(
  sitemapUrls: string[],
  rootHost: string,
  source: PublicContentDiscoverySource,
): Promise<LinkCandidate[]> {
  const candidates: LinkCandidate[] = [];
  for (const sitemapUrl of uniqueStrings(sitemapUrls).slice(0, 3)) {
    try {
      const response = await fetch(sitemapUrl, {
        method: "GET",
        redirect: "follow",
        headers: { accept: "application/xml,text/xml,text/plain,*/*;q=0.8" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const text = await readLimitedText(response, MAX_INDEX_BYTES);
      for (const match of text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        const normalized = normalizeSameSiteUrl(match[1], sitemapUrl, rootHost);
        if (!normalized || !looksLikeContentPage(normalized)) continue;
        candidates.push({ url: normalized, source, fromUrl: sitemapUrl, label: null });
        if (candidates.length >= DEFAULT_MAX_CANDIDATE_URLS) return candidates;
      }
    } catch {
      continue;
    }
  }
  return candidates;
}

function createCandidateUrls(
  rootUrl: string,
  rootHost: string,
  discovered: LinkCandidate[],
  maxCandidateUrls: number,
): CandidateUrl[] {
  const candidates = new Map<string, CandidateUrl>();
  const add = (url: string, source: PublicContentDiscoverySource, fromUrl: string | null, label: string | null) => {
    const normalized = normalizeSameSiteUrl(url, rootUrl, rootHost);
    if (!normalized || !looksLikeContentPage(normalized)) return;
    const current = candidates.get(normalized) ?? { url: normalized, sources: [] };
    current.sources.push({ source, url: fromUrl, label });
    current.sources = dedupeDiscoverySources(current.sources);
    candidates.set(normalized, current);
  };

  add(rootUrl, "root_document", null, "submitted target");
  for (const item of discovered) add(item.url, item.source, item.fromUrl, item.label);

  return Array.from(candidates.values())
    .sort((left, right) => scoreCandidate(right) - scoreCandidate(left) || left.url.localeCompare(right.url))
    .slice(0, maxCandidateUrls);
}

function scoreCandidate(candidate: CandidateUrl): number {
  const url = new URL(candidate.url);
  const path = url.pathname.toLowerCase();
  const sourceScore = candidate.sources.reduce((score, item) => {
    if (item.source === "root_document") return Math.max(score, 100);
    if (item.source === "canonical") return Math.max(score, 90);
    if (item.source === "html_link") return Math.max(score, 70);
    if (item.source === "host_candidate") return Math.max(score, 65);
    if (item.source === "alternate") return Math.max(score, 55);
    if (item.source === "sitemap" || item.source === "robots_sitemap") return Math.max(score, 45);
    return score;
  }, 0);
  const depth = path.split("/").filter(Boolean).length;
  const shallowScore = Math.max(0, 20 - depth * 4);
  const contentScore = /(product|pricing|docs?|guide|blog|news|changelog|support|help|about|contact|legal|privacy|terms|security|community|platform|solution|feature|case)/i.test(path)
    ? 20
    : 0;
  return sourceScore + shallowScore + contentScore;
}

function classifySurface(input: {
  url: string;
  rootHost: string;
  title: string | null;
  metaDescription: string | null;
  headings: string[];
  excerpt: string | null;
  discoveredFrom: PublicContentSurface["discovered_from"];
}): PublicContentClassification {
  const url = new URL(input.url);
  const text = [
    url.hostname,
    url.pathname,
    input.title,
    input.metaDescription,
    ...input.headings.slice(0, 6),
    input.excerpt,
    ...input.discoveredFrom.map((item) => item.label),
  ].filter(Boolean).join(" ").toLowerCase();
  const basis: string[] = [];
  const pathLabel = inferLabelFromUrl(url, input.rootHost, input.discoveredFrom);
  if (pathLabel !== "unknown") basis.push(`url or host suggests ${pathLabel}`);
  if (input.title) basis.push(`title observed: ${input.title.slice(0, 80)}`);
  if (input.headings.length > 0) basis.push(`heading observed: ${input.headings[0].slice(0, 80)}`);

  const controlled = inferControlledHint(text);
  if (controlled !== "unknown") basis.push(`content hint matched ${controlled}`);

  return {
    label: pathLabel,
    controlled_hint: controlled,
    confidence: controlled !== "unknown" && basis.length >= 3 ? "high" : basis.length >= 2 ? "medium" : "low",
    basis: basis.length > 0 ? basis.slice(0, 6) : ["no strong path, title, heading, or schema signal"],
  };
}

function inferControlledHint(text: string): PublicContentControlledHint {
  if (/\b(docs?|documentation|developer|developers|api reference|reference|guide|quickstart|sdk)\b/.test(text)) return "technical_documentation";
  if (/\b(pricing|price|plans?|enterprise|billing|subscription)\b/.test(text)) return "commercial";
  if (/\b(support|help|faq|contact|ticket|customer service)\b/.test(text)) return "support";
  if (/\b(privacy|terms|legal|security|trust|compliance|policy)\b/.test(text)) return "legal";
  if (/\b(community|forum|discuss|discord|slack)\b/.test(text)) return "community";
  if (/\b(blog|news|changelog|release|press|article)\b/.test(text)) return "news";
  if (/\b(product|products|feature|features|solution|solutions|platform|use case|customers|case study)\b/.test(text)) return "product";
  if (/\b(home|about|company|overview)\b/.test(text)) return "business_overview";
  return "unknown";
}

function inferLabelFromUrl(url: URL, rootHost: string, discoveredFrom: PublicContentSurface["discovered_from"]): string {
  if (url.hostname.toLowerCase() !== rootHost) {
    const label = url.hostname.toLowerCase().slice(0, -rootHost.length - 1).split(".").pop();
    if (label) return sanitizeLabel(label);
  }

  const pathParts = url.pathname.split("/").map(sanitizeLabel).filter(Boolean);
  if (pathParts.length === 0) return "homepage";
  const sourceLabel = discoveredFrom.map((item) => item.label).find((item): item is string => Boolean(item && item.length <= 40));
  return sanitizeLabel(sourceLabel ?? pathParts[0]) || "unknown";
}

function normalizeSameSiteUrl(value: string, baseUrl: string, rootHost: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host !== rootHost && !host.endsWith(`.${rootHost}`)) return null;
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return null;
  }
}

function looksLikeContentPage(value: string): boolean {
  const url = new URL(value);
  if (url.search && url.search.length > 120) return false;
  return !/\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|pdf|zip|tar|gz|mp4|webm|mp3|xml|json)(?:$|\?)/i.test(url.pathname);
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

function extractTitle(html: string): string | null {
  return decodeHtmlText(html.match(/<title[^>]*>([\s\S]{0,240})<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "").slice(0, 160) || null;
}

function extractMetaDescription(html: string): string | null {
  const match = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i);
  return decodeHtmlText(match?.[1]?.replace(/\s+/g, " ").trim() ?? "").slice(0, 240) || null;
}

function extractHeadings(html: string): string[] {
  return uniqueStrings(
    Array.from(html.matchAll(/<h[1-3]\b[^>]*>([\s\S]{0,300})<\/h[1-3]>/gi))
      .map((match) => stripTags(match[1]))
      .map((text) => decodeHtmlText(text.replace(/\s+/g, " ").trim()))
      .filter(Boolean),
  ).slice(0, 12);
}

function extractSchemaTypes(html: string): string[] {
  const types: string[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectSchemaTypes(JSON.parse(match[1]), types);
    } catch {
      continue;
    }
    if (types.length >= 12) break;
  }
  return uniqueStrings(types).slice(0, 12);
}

function collectSchemaTypes(value: unknown, output: string[]): void {
  if (!value || output.length >= 20) return;
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaTypes(item, output);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") output.push(type);
  if (Array.isArray(type)) output.push(...type.filter((item): item is string => typeof item === "string"));
  for (const child of Object.values(record)) collectSchemaTypes(child, output);
}

function extractVisibleTextExcerpt(html: string): string | null {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const text = decodeHtmlText(stripTags(withoutScripts).replace(/\s+/g, " ").trim());
  return text ? text.slice(0, 1_200) : null;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function readHtmlAttribute(tag: string, name: string): string | null {
  return tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ?? null;
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function sanitizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function dedupeDiscoverySources(sources: PublicContentSurface["discovered_from"]): PublicContentSurface["discovered_from"] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.source}:${source.url ?? ""}:${source.label ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
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

function parseLimit(value: unknown, fallback: number, max: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${label} must be an integer between 1 and ${max}.`);
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

import type {
  PublicContentClassification,
  PublicContentControlledHint,
  PublicContentDiscoverySource,
} from "../../src/providers/public-content-surface/types";
import type {
  PublicContentDetailKind,
  PublicContentDetailPage,
  PublicContentDetailResult,
} from "../../src/providers/public-content-detail/types";

type DiscoverySource = PublicContentDetailPage["link_context"][number];

type LinkCandidate = {
  url: string;
  source: PublicContentDiscoverySource;
  from_url: string | null;
  label: string | null;
};

type CandidateUrl = {
  url: string;
  sources: DiscoverySource[];
};

type SeedPage = {
  url: string;
  final_url: string | null;
  host: string;
  path: string;
  status_code: number | null;
  content_type: string | null;
  html_sample: string;
  links: LinkCandidate[];
  error: string | null;
};

export type PublicContentDetailOptions = {
  maxSeedPages?: unknown;
  maxCandidateUrls?: unknown;
  maxDetailPages?: unknown;
};

const DEFAULT_MAX_SEED_PAGES = 5;
const MAX_ALLOWED_SEED_PAGES = 8;
const DEFAULT_MAX_CANDIDATE_URLS = 36;
const MAX_ALLOWED_CANDIDATE_URLS = 60;
const DEFAULT_MAX_DETAIL_PAGES = 8;
const MAX_ALLOWED_DETAIL_PAGES = 12;
const MAX_CONCURRENCY = 3;
const TIMEOUT_MS = 10_000;
const MAX_SEED_PAGE_BYTES = 56_000;
const MAX_DETAIL_PAGE_BYTES = 72_000;
const MAX_INDEX_BYTES = 64_000;

export async function publicContentDetailProbe(
  target: string,
  options: PublicContentDetailOptions = {},
): Promise<PublicContentDetailResult> {
  const startedAt = Date.now();
  const normalizedUrl = normalizeTargetUrl(target);
  const rootUrl = new URL(normalizedUrl);
  rootUrl.pathname = rootUrl.pathname || "/";
  rootUrl.search = "";
  rootUrl.hash = "";
  const rootHost = rootUrl.hostname.toLowerCase();
  const maxSeedPages = parseLimit(options.maxSeedPages, DEFAULT_MAX_SEED_PAGES, MAX_ALLOWED_SEED_PAGES, "max_seed_pages");
  const maxCandidateUrls = parseLimit(
    options.maxCandidateUrls,
    DEFAULT_MAX_CANDIDATE_URLS,
    MAX_ALLOWED_CANDIDATE_URLS,
    "max_candidate_urls",
  );
  const maxDetailPages = parseLimit(
    options.maxDetailPages,
    DEFAULT_MAX_DETAIL_PAGES,
    MAX_ALLOWED_DETAIL_PAGES,
    "max_detail_pages",
  );

  const rootSeed = await fetchSeedPage(rootUrl.toString(), rootHost, [
    { source: "root_document", from_url: null, label: "submitted target" },
  ]);
  const firstPassLinks = [
    ...createHostCandidateLinks(rootHost),
    ...rootSeed.links,
    ...(await discoverKnownPublicIndexLinks(rootHost)),
    ...(await discoverRobotsSitemapLinks(rootUrl, rootHost)),
    ...(await discoverDefaultSitemapLinks(rootUrl, rootHost)),
  ];
  const seedCandidates = createCandidateUrls(rootSeed.final_url ?? rootSeed.url, rootHost, firstPassLinks, maxCandidateUrls)
    .filter((candidate) => candidate.url !== rootSeed.url)
    .sort((left, right) => scoreSeedCandidate(right) - scoreSeedCandidate(left) || left.url.localeCompare(right.url))
    .slice(0, Math.max(0, maxSeedPages - 1));
  const seedPages = await runWithConcurrency(seedCandidates, MAX_CONCURRENCY, (candidate) =>
    fetchSeedPage(candidate.url, rootHost, candidate.sources),
  );
  const allSeeds = [rootSeed, ...seedPages];
  const allLinks = [
    ...firstPassLinks,
    ...seedPages.flatMap((page) => page.links),
    ...seedPages.map((page) => ({
      url: page.final_url ?? page.url,
      source: "html_link" as const,
      from_url: rootSeed.final_url ?? rootSeed.url,
      label: inferSeedLabel(page),
    })),
  ];
  const detailCandidates = createCandidateUrls(rootSeed.final_url ?? rootSeed.url, rootHost, allLinks, maxCandidateUrls)
    .filter((candidate) => candidate.url !== rootSeed.url)
    .filter((candidate) => looksLikeDetailCandidate(candidate.url, candidate.sources))
    .sort((left, right) => scoreDetailCandidate(right) - scoreDetailCandidate(left) || left.url.localeCompare(right.url));
  const selectedDetailCandidates = selectDiverseDetailCandidates(detailCandidates, maxDetailPages);
  const detailPages = await runWithConcurrency(selectedDetailCandidates, MAX_CONCURRENCY, (candidate) =>
    fetchDetailPage(candidate.url, rootHost, candidate.sources),
  );

  return {
    requested_url: target,
    host: rootHost,
    candidate_urls: selectedDetailCandidates,
    detail_pages: detailPages,
    limits: {
      max_seed_pages: maxSeedPages,
      max_candidate_urls: maxCandidateUrls,
      max_detail_pages: maxDetailPages,
      max_concurrency: MAX_CONCURRENCY,
      timeout_ms: TIMEOUT_MS,
      max_seed_page_bytes: MAX_SEED_PAGE_BYTES,
      max_detail_page_bytes: MAX_DETAIL_PAGE_BYTES,
      max_index_bytes: MAX_INDEX_BYTES,
    },
    coverage: {
      collected: [
        "bounded_public_detail_page_candidates",
        "public_docs_blog_article_headings",
        "public_article_or_documentation_text_snippets",
        "public_link_context",
        "public_schema_and_date_hints",
        "public_llms_txt_and_wordpress_post_index_hints",
        "open_content_classification_hints",
      ],
      missing: [
        "authenticated_content",
        "form_submission_results",
        "complete_docs_or_blog_corpus",
        "unlinked_public_pages",
        "business_model_validation_beyond_public_text",
      ],
      limitations: [
        `This provider uses at most ${maxSeedPages} seed page(s), ${maxCandidateUrls} candidate URL(s), and ${maxDetailPages} detail page(s).`,
        "It reads public HTML only and does not execute app workflows, submit forms, use credentials, or brute-force routes.",
        "Open labels and coarse hints organize evidence but do not prove ownership, internal workflows, or business model by themselves.",
      ],
    },
    duration_ms: Date.now() - startedAt,
    provider_id: "cloudflare_worker_public_content_detail",
    source: "cloudflare_worker_public_content_detail",
  };
}

async function fetchSeedPage(url: string, rootHost: string, sources: DiscoverySource[]): Promise<SeedPage> {
  const requestedUrl = new URL(url);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const finalUrl = response.url || url;
    const final = new URL(finalUrl);
    const host = final.hostname.toLowerCase();
    const contentType = response.headers.get("content-type");
    const html = isSameRootHost(host, rootHost) && isHtml(contentType)
      ? await readLimitedText(response, MAX_SEED_PAGE_BYTES)
      : "";
    return {
      url,
      final_url: finalUrl,
      host,
      path: final.pathname || "/",
      status_code: response.status,
      content_type: contentType,
      html_sample: html,
      links: html ? discoverHtmlLinks(html, finalUrl, sources) : [],
      error: isSameRootHost(host, rootHost) ? null : "Final URL left the submitted target host scope.",
    };
  } catch (error) {
    return {
      url,
      final_url: null,
      host: requestedUrl.hostname.toLowerCase(),
      path: requestedUrl.pathname || "/",
      status_code: null,
      content_type: null,
      html_sample: "",
      links: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchDetailPage(
  url: string,
  rootHost: string,
  sources: DiscoverySource[],
): Promise<PublicContentDetailPage> {
  const requestedUrl = new URL(url);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const finalUrl = response.url || url;
    const final = new URL(finalUrl);
    const host = final.hostname.toLowerCase();
    const contentType = response.headers.get("content-type");
    const isHtmlContent = isHtml(contentType);
    const content = isSameRootHost(host, rootHost) && isReadableContent(contentType)
      ? await readLimitedText(response, MAX_DETAIL_PAGE_BYTES)
      : "";
    const readableContent = isHtmlContent ? content : normalizeMarkdownContent(content);
    const title = isHtmlContent ? extractTitle(readableContent) : extractMarkdownTitle(readableContent);
    const metaDescription = isHtmlContent ? extractMetaDescription(readableContent) : extractMarkdownDescription(readableContent);
    const headings = isHtmlContent ? extractHeadings(readableContent) : extractMarkdownHeadings(readableContent);
    const schemaTypes = isHtmlContent ? extractSchemaTypes(content) : [];
    const excerpt = isHtmlContent ? extractVisibleTextExcerpt(readableContent) : extractMarkdownExcerpt(readableContent);
    const classification = classifyDetail({
      url: finalUrl,
      rootHost,
      title,
      metaDescription,
      headings,
      excerpt,
      sources,
      schemaTypes,
    });
    const detailKind = inferDetailKind(classification.controlled_hint, schemaTypes, final, sources);

    return {
      url,
      final_url: finalUrl,
      host,
      path: final.pathname || "/",
      status_code: response.status,
      content_type: contentType,
      title,
      meta_description: metaDescription,
      headings,
      schema_types: schemaTypes,
      published_time: isHtmlContent ? extractDateMeta(content, ["article:published_time", "datePublished", "pubdate"]) : null,
      modified_time: isHtmlContent ? extractDateMeta(content, ["article:modified_time", "dateModified", "lastmod"]) : null,
      detail_kind: detailKind,
      classification,
      link_context: sources,
      excerpt,
      evidence_snippets: createEvidenceSnippets({ title, metaDescription, headings, excerpt }),
      error: isSameRootHost(host, rootHost) ? null : "Final URL left the submitted target host scope.",
      limitations: [
        "Only a bounded public HTML detail preview was read.",
        "Content snippets are evidence for public messaging only, not proof of authenticated behavior or internal business logic.",
      ],
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
      published_time: null,
      modified_time: null,
      detail_kind: "unknown",
      classification: {
        label: inferLabelFromUrl(requestedUrl, rootHost, sources),
        controlled_hint: "unknown",
        confidence: "low",
        basis: ["fetch failed before detail classification"],
      },
      link_context: sources,
      excerpt: null,
      evidence_snippets: [],
      error: error instanceof Error ? error.message : String(error),
      limitations: ["The page was selected as a bounded public detail candidate but did not return usable content in this run."],
    };
  }
}

function discoverHtmlLinks(html: string, fromUrl: string, inheritedSources: DiscoverySource[]): LinkCandidate[] {
  const links: LinkCandidate[] = [];

  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  if (canonical?.[1]) links.push({ url: canonical[1], source: "canonical", from_url: fromUrl, label: "canonical" });

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/rel=["'][^"']*alternate/i.test(tag)) continue;
    const href = readHtmlAttribute(tag, "href");
    if (!href) continue;
    const type = readHtmlAttribute(tag, "type");
    const label = readHtmlAttribute(tag, "title") ?? type ?? "alternate";
    links.push({ url: href, source: "alternate", from_url: fromUrl, label });
  }

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decodeHtmlText(stripTags(match[2]).replace(/\s+/g, " ").trim()).slice(0, 100) || null;
    links.push({ url: match[1], source: "html_link", from_url: fromUrl, label });
    if (links.length >= DEFAULT_MAX_CANDIDATE_URLS) break;
  }

  for (const source of inheritedSources) {
    if (source.label) links.push({ url: fromUrl, source: source.source, from_url: source.from_url, label: source.label });
  }

  return links;
}

function createHostCandidateLinks(rootHost: string): LinkCandidate[] {
  return ["docs", "blog", "community", "support", "help", "developers", "developer", "news", "changelog"]
    .map((label) => ({
      url: `https://${label}.${rootHost}/`,
      source: "host_candidate" as const,
      from_url: null,
      label,
    }));
}

async function discoverKnownPublicIndexLinks(rootHost: string): Promise<LinkCandidate[]> {
  const llmsUrls = ["docs", "developer", "developers"].map((label) => `https://${label}.${rootHost}/llms.txt`);
  const wordpressUrls = ["blog"].map(
    (label) => `https://${label}.${rootHost}/wp-json/wp/v2/posts?per_page=6&_fields=link,title,excerpt,date,slug`,
  );
  const [llmsLinks, wordpressLinks] = await Promise.all([
    runWithConcurrency(llmsUrls, MAX_CONCURRENCY, fetchLlmsTxtCandidates),
    runWithConcurrency(wordpressUrls, MAX_CONCURRENCY, fetchWordPressPostCandidates),
  ]);
  return [...llmsLinks.flat(), ...wordpressLinks.flat()]
    .sort((left, right) => scoreLinkCandidateRetention(right) - scoreLinkCandidateRetention(left) || left.url.localeCompare(right.url))
    .slice(0, DEFAULT_MAX_CANDIDATE_URLS);
}

async function fetchLlmsTxtCandidates(url: string): Promise<LinkCandidate[]> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "text/plain,text/markdown,*/*;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const finalUrl = response.url || url;
    const text = await readLimitedText(response, MAX_INDEX_BYTES);
    const links: LinkCandidate[] = [];
    for (const match of text.matchAll(/\[([^\]]{1,120})\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)|(^|\s)(https?:\/\/[^\s)]+)/gim)) {
      const label = decodeHtmlText(match[1] ?? "llms.txt").slice(0, 100);
      const href = match[2] ?? match[4];
      if (!href) continue;
      links.push({ url: href, source: "llms_txt", from_url: finalUrl, label });
      if (links.length >= MAX_ALLOWED_CANDIDATE_URLS) break;
    }
    return links
      .sort((left, right) => scoreLinkCandidateRetention(right) - scoreLinkCandidateRetention(left) || left.url.localeCompare(right.url))
      .slice(0, DEFAULT_MAX_CANDIDATE_URLS);
  } catch {
    return [];
  }
}

async function fetchWordPressPostCandidates(url: string): Promise<LinkCandidate[]> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "application/json,*/*;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const text = await readLimitedText(response, MAX_INDEX_BYTES);
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((post): LinkCandidate | null => {
        if (!post || typeof post !== "object") return null;
        const record = post as Record<string, unknown>;
        const link = typeof record.link === "string" ? record.link : null;
        if (!link) return null;
        const title = isRecord(record.title) && typeof record.title.rendered === "string"
          ? decodeHtmlText(stripTags(record.title.rendered).replace(/\s+/g, " ").trim())
          : "WordPress post";
        return { url: link, source: "wordpress_rest", from_url: response.url || url, label: title.slice(0, 100) };
      })
      .filter((candidate): candidate is LinkCandidate => Boolean(candidate))
      .slice(0, DEFAULT_MAX_CANDIDATE_URLS);
  } catch {
    return [];
  }
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
        if (!normalized || !looksLikePublicContentPage(normalized)) continue;
        candidates.push({ url: normalized, source, from_url: sitemapUrl, label: null });
        if (candidates.length >= DEFAULT_MAX_CANDIDATE_URLS) return candidates;
      }
    } catch {
      continue;
    }
  }
  return candidates;
}

function createCandidateUrls(
  baseUrl: string,
  rootHost: string,
  links: LinkCandidate[],
  maxCandidateUrls: number,
): CandidateUrl[] {
  const candidates = new Map<string, CandidateUrl>();
  for (const link of links) {
    const normalized = normalizeSameSiteUrl(link.url, link.from_url ?? baseUrl, rootHost);
    if (!normalized || !looksLikePublicContentPage(normalized)) continue;
    const current = candidates.get(normalized) ?? { url: normalized, sources: [] };
    current.sources.push({ source: link.source, from_url: link.from_url, label: link.label });
    current.sources = dedupeSources(current.sources);
    candidates.set(normalized, current);
  }
  return Array.from(candidates.values())
    .sort((left, right) => scoreCandidateRetention(right) - scoreCandidateRetention(left) || left.url.localeCompare(right.url))
    .slice(0, maxCandidateUrls);
}

function scoreCandidateRetention(candidate: CandidateUrl): number {
  const url = new URL(candidate.url);
  const labelText = candidate.sources.map((source) => source.label).filter(Boolean).join(" ");
  const text = `${url.hostname} ${url.pathname} ${labelText}`;
  const sourceBonus = sourceScore(candidate);
  const businessBonus = scoreBusinessDetailSignal(text);
  const contentBonus = /(docs?|documentation|guide|quickstart|blog|article|post|community|support|help|product|pricing|vendor|marketplace|api)/i.test(text)
    ? 30
    : 0;
  const hostRootPenalty = url.pathname === "/" ? 12 : 0;
  return sourceBonus + businessBonus + contentBonus - hostRootPenalty;
}

function scoreLinkCandidateRetention(candidate: LinkCandidate): number {
  const urlText = candidate.url.toLowerCase();
  const labelText = candidate.label?.toLowerCase() ?? "";
  const sourceBonus = candidate.source === "llms_txt" || candidate.source === "wordpress_rest" ? 20 : 0;
  return sourceBonus + scoreBusinessDetailSignal(`${urlText} ${labelText}`);
}

function scoreSeedCandidate(candidate: CandidateUrl): number {
  const url = new URL(candidate.url);
  const path = url.pathname.toLowerCase();
  const labelText = candidate.sources.map((source) => source.label).filter(Boolean).join(" ").toLowerCase();
  const hostLabel = url.hostname.split(".")[0].toLowerCase();
  const detailish = /(docs?|documentation|developer|blog|community|support|help|news|changelog|learn|guide|article)/i.test(
    `${hostLabel} ${path} ${labelText}`,
  ) ? 60 : 0;
  const depth = path.split("/").filter(Boolean).length;
  return detailish + Math.max(0, 20 - depth * 4) + sourceScore(candidate);
}

function scoreDetailCandidate(candidate: CandidateUrl): number {
  const url = new URL(candidate.url);
  const path = url.pathname.toLowerCase();
  const hostLabel = url.hostname.split(".")[0].toLowerCase();
  const labelText = candidate.sources.map((source) => source.label).filter(Boolean).join(" ").toLowerCase();
  const text = `${hostLabel} ${path} ${labelText}`;
  const detailScore = /(docs?|documentation|guide|quickstart|reference|api|blog|article|post|news|changelog|release|community|forum|support|help|faq|product|feature|solution|pricing|case)/i.test(text)
    ? 80
    : 0;
  const businessDetailScore = scoreBusinessDetailSignal(text);
  const genericApiPenalty = /\b(api[-_/ ]?reference|reference|api)\b/i.test(text)
    && !/(compatib|openai|anthropic|model|provider|vendor|marketplace|platform|pricing|billing|settlement|route|routing|quickstart|recharge|log|兼容|模型|供应|供应商|市场|平台|价格|计费|结算|路由|充值|日志)/i.test(text)
    ? 18
    : 0;
  const depth = path.split("/").filter(Boolean).length;
  const depthScore = depth >= 2 ? 20 : depth === 1 ? 8 : -10;
  const sourceBonus = sourceScore(candidate);
  return detailScore + businessDetailScore + depthScore + sourceBonus - genericApiPenalty;
}

function scoreBusinessDetailSignal(text: string): number {
  let score = 0;
  const normalized = text.toLowerCase();
  const weightedSignals: Array<[RegExp, number]> = [
    [/\bvendors?\b|供应商|服务商|商家|入驻/, 32],
    [/\bonboarding\b/, 32],
    [/\bpayouts?\b|\bwithdraw(?:al)?s?\b|提现/, 32],
    [/\bsettlement\b|结算/, 28],
    [/\bmarketplace\b|市场/, 24],
    [/\bcreate[-_/ ]?token\b|创建令牌|令牌/, 22],
    [/\brecharge\b|充值/, 22],
    [/\blogs?\b|日志/, 20],
    [/\bbilling\b|计费/, 20],
    [/\bdiscounts?\b|折扣/, 20],
    [/\babout\b|关于/, 18],
    [/\bquick[-_/ ]?start\b|\bget[-_/ ]?started\b|快速开始|入门/, 18],
    [/\brout(?:e|ing)\b|路由/, 18],
    [/\bprovider(s)?\b|\bsupplier(s)?\b/, 18],
    [/\bpricing\b|价格/, 16],
    [/\bplatform\b|平台/, 14],
    [/\bopenai\b|\banthropic\b/, 14],
    [/\bcompatib(?:le|ility)\b|兼容/, 14],
    [/\bmodel(s)?\b|模型/, 10],
  ];
  for (const [pattern, weight] of weightedSignals) {
    if (pattern.test(normalized)) score += weight;
  }
  return Math.min(score, 120);
}

function sourceScore(candidate: CandidateUrl): number {
  return candidate.sources.reduce((score, source) => {
    if (source.source === "html_link") return Math.max(score, 35);
    if (source.source === "llms_txt" || source.source === "wordpress_rest") return Math.max(score, 45);
    if (source.source === "sitemap" || source.source === "robots_sitemap") return Math.max(score, 30);
    if (source.source === "canonical") return Math.max(score, 25);
    if (source.source === "alternate") return Math.max(score, 20);
    if (source.source === "host_candidate") return Math.max(score, 15);
    return score;
  }, 0);
}

function selectDiverseDetailCandidates(candidates: CandidateUrl[], maxDetailPages: number): CandidateUrl[] {
  const selected: CandidateUrl[] = [];
  const hostCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const addIfAllowed = (candidate: CandidateUrl, maxPerHost: number, maxPerSource: number) => {
    const host = new URL(candidate.url).hostname.toLowerCase();
    const source = candidate.sources[0]?.source ?? "unknown";
    if ((hostCounts.get(host) ?? 0) >= maxPerHost) return false;
    if ((sourceCounts.get(source) ?? 0) >= maxPerSource) return false;
    selected.push(candidate);
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    return true;
  };

  for (const candidate of candidates) {
    if (selected.length >= maxDetailPages) break;
    addIfAllowed(candidate, 4, 4);
  }
  for (const candidate of candidates) {
    if (selected.length >= maxDetailPages) break;
    if (selected.some((item) => item.url === candidate.url)) continue;
    addIfAllowed(candidate, maxDetailPages, maxDetailPages);
  }
  return selected;
}

function looksLikeDetailCandidate(value: string, sources: DiscoverySource[]): boolean {
  const url = new URL(value);
  const depth = url.pathname.split("/").filter(Boolean).length;
  const text = `${url.hostname} ${url.pathname} ${sources.map((source) => source.label).join(" ")}`.toLowerCase();
  if (depth === 0 && !/(docs?|blog|community|support|help|developer|news|changelog)/.test(text)) return false;
  if (/(login|signin|signup|register|admin|wp-login|account|auth|password|cart|checkout)(?:\/|$)/i.test(url.pathname)) return false;
  return true;
}

function looksLikePublicContentPage(value: string): boolean {
  const url = new URL(value);
  if (url.search && url.search.length > 120) return false;
  return !/\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|pdf|zip|tar|gz|mp4|webm|mp3|xml|json|map|rss|atom)(?:$|\?)/i.test(url.pathname);
}

function classifyDetail(input: {
  url: string;
  rootHost: string;
  title: string | null;
  metaDescription: string | null;
  headings: string[];
  excerpt: string | null;
  sources: DiscoverySource[];
  schemaTypes: string[];
}): PublicContentClassification {
  const url = new URL(input.url);
  const text = [
    url.hostname,
    url.pathname,
    input.title,
    input.metaDescription,
    ...input.headings.slice(0, 8),
    input.excerpt,
    ...input.sources.map((source) => source.label),
    ...input.schemaTypes,
  ].filter(Boolean).join(" ").toLowerCase();
  const label = inferLabelFromUrl(url, input.rootHost, input.sources);
  const controlled = inferControlledHint(text);
  const basis: string[] = [];
  if (label !== "unknown") basis.push(`url, host, or link context suggests ${label}`);
  if (input.title) basis.push(`title observed: ${input.title.slice(0, 90)}`);
  if (input.headings.length > 0) basis.push(`heading observed: ${input.headings[0].slice(0, 90)}`);
  if (input.schemaTypes.length > 0) basis.push(`schema type observed: ${input.schemaTypes.slice(0, 3).join(", ")}`);
  if (controlled !== "unknown") basis.push(`content hint matched ${controlled}`);
  return {
    label,
    controlled_hint: controlled,
    confidence: controlled !== "unknown" && basis.length >= 3 ? "high" : basis.length >= 2 ? "medium" : "low",
    basis: basis.length > 0 ? basis.slice(0, 6) : ["no strong path, title, heading, schema, or excerpt signal"],
  };
}

function inferControlledHint(text: string): PublicContentControlledHint {
  if (/\b(product|products|feature|features|solution|solutions|platform|use case|customers|case study|vendor|merchant|marketplace|provider|supplier|settlement|payout|withdrawal|billing|recharge|discount)\b|供应商|服务商|商家|市场|平台|结算|提现|充值|折扣/.test(text)) return "product";
  if (/\b(pricing|price|plans?|enterprise|billing|subscription)\b|价格|计费|套餐|企业/.test(text)) return "commercial";
  if (/\b(docs?|documentation|developer|developers|api reference|reference|guide|quickstart|sdk|tutorial)\b/.test(text)) return "technical_documentation";
  if (/\b(support|help|faq|contact|ticket|customer service)\b/.test(text)) return "support";
  if (/\b(privacy|terms|legal|security|trust|compliance|policy)\b/.test(text)) return "legal";
  if (/\b(community|forum|discuss|discord|slack|topic)\b/.test(text)) return "community";
  if (/\b(blog|news|changelog|release|press|article|post)\b/.test(text)) return "news";
  if (/\b(home|about|company|overview)\b/.test(text)) return "business_overview";
  return "unknown";
}

function inferDetailKind(
  hint: PublicContentControlledHint,
  schemaTypes: string[],
  url: URL,
  sources: DiscoverySource[],
): PublicContentDetailKind {
  const text = `${url.hostname} ${url.pathname} ${sources.map((source) => source.label).join(" ")} ${schemaTypes.join(" ")}`.toLowerCase();
  if (/(article|blogposting|newsarticle|blog|post|changelog|release)/i.test(text)) return "article";
  if (hint === "technical_documentation") return "documentation";
  if (hint === "community") return "community";
  if (hint === "support") return "support";
  if (hint === "product" || hint === "business_overview") return "product";
  if (hint === "commercial") return "commercial";
  if (hint === "legal") return "legal";
  if (hint === "news") return "article";
  return "unknown";
}

function inferLabelFromUrl(url: URL, rootHost: string, sources: DiscoverySource[]): string {
  if (url.hostname.toLowerCase() !== rootHost) {
    const label = url.hostname.toLowerCase().slice(0, -rootHost.length - 1).split(".").pop();
    if (label) return sanitizeLabel(label);
  }
  const sourceLabel = sources.map((source) => source.label).find((label): label is string => Boolean(label && label.length <= 60));
  const pathParts = url.pathname.split("/").map(sanitizeLabel).filter(Boolean);
  if (sourceLabel) return sanitizeLabel(sourceLabel) || "unknown";
  if (pathParts.length === 0) return "homepage";
  return pathParts[0] || "unknown";
}

function inferSeedLabel(page: SeedPage): string | null {
  if (page.path && page.path !== "/") return page.path.split("/").map(sanitizeLabel).filter(Boolean)[0] ?? null;
  const hostLabel = page.host.split(".")[0];
  return sanitizeLabel(hostLabel) || null;
}

function normalizeSameSiteUrl(value: string, baseUrl: string, rootHost: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!isSameRootHost(host, rootHost)) return null;
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return null;
  }
}

function isSameRootHost(host: string, rootHost: string): boolean {
  return host === rootHost || host.endsWith(`.${rootHost}`);
}

function isHtml(contentType: string | null): boolean {
  return Boolean(contentType?.toLowerCase().includes("html"));
}

function isReadableContent(contentType: string | null): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  return normalized.includes("html") || normalized.includes("markdown") || normalized.includes("text/plain");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function extractMarkdownTitle(text: string): string | null {
  const heading = text.match(/^#\s+(.{1,180})$/m)?.[1] ?? text.match(/^title:\s*(.+)$/im)?.[1];
  return heading ? decodeHtmlText(heading.replace(/\s+/g, " ").trim()).slice(0, 160) : null;
}

function normalizeMarkdownContent(text: string): string {
  return text
    .replace(/^>\s*##\s+Documentation Index\s*\n(?:^>.*\n?){0,8}\s*/im, "")
    .trimStart();
}

function extractMetaDescription(html: string): string | null {
  const match = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i);
  return decodeHtmlText(match?.[1]?.replace(/\s+/g, " ").trim() ?? "").slice(0, 300) || null;
}

function extractMarkdownDescription(text: string): string | null {
  const frontmatter = text.match(/^description:\s*(.+)$/im)?.[1];
  if (frontmatter) return decodeHtmlText(frontmatter.replace(/\s+/g, " ").trim()).slice(0, 300);
  const paragraph = text
    .replace(/^---[\s\S]*?---/m, " ")
    .split(/\n{2,}/)
    .map((part) => part.replace(/^#+\s+/gm, "").replace(/\[[^\]]+\]\([^)]+\)/g, "").replace(/\s+/g, " ").trim())
    .find((part) => part.length >= 40);
  return paragraph ? decodeHtmlText(paragraph).slice(0, 300) : null;
}

function extractHeadings(html: string): string[] {
  return uniqueStrings(
    Array.from(html.matchAll(/<h[1-3]\b[^>]*>([\s\S]{0,400})<\/h[1-3]>/gi))
      .map((match) => stripTags(match[1]))
      .map((text) => decodeHtmlText(text.replace(/\s+/g, " ").trim()))
      .filter(Boolean),
  ).slice(0, 14);
}

function extractMarkdownHeadings(text: string): string[] {
  return uniqueStrings(
    Array.from(text.matchAll(/^#{1,3}\s+(.{1,240})$/gm))
      .map((match) => decodeHtmlText(match[1].replace(/\s+/g, " ").trim()))
      .filter(Boolean),
  ).slice(0, 14);
}

function extractSchemaTypes(html: string): string[] {
  const types: string[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectSchemaTypes(JSON.parse(match[1]), types);
    } catch {
      continue;
    }
    if (types.length >= 16) break;
  }
  return uniqueStrings(types).slice(0, 16);
}

function collectSchemaTypes(value: unknown, output: string[]): void {
  if (!value || output.length >= 24) return;
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

function extractDateMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const meta = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"))
      ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["']`, "i"));
    if (meta?.[1]) return meta[1].slice(0, 80);
  }
  const time = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  return time?.[1]?.slice(0, 80) ?? null;
}

function extractVisibleTextExcerpt(html: string): string | null {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const text = decodeHtmlText(stripTags(withoutScripts).replace(/\s+/g, " ").trim());
  return text ? text.slice(0, 1_600) : null;
}

function extractMarkdownExcerpt(text: string): string | null {
  const normalized = decodeHtmlText(
    text
      .replace(/^---[\s\S]*?---/m, " ")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
  return normalized ? normalized.slice(0, 1_600) : null;
}

function createEvidenceSnippets(input: {
  title: string | null;
  metaDescription: string | null;
  headings: string[];
  excerpt: string | null;
}): string[] {
  return uniqueStrings([
    input.title ?? "",
    input.metaDescription ?? "",
    ...input.headings.slice(0, 5),
    ...(input.excerpt ? input.excerpt.split(/(?<=[.!?。！？])\s+/).slice(0, 4) : []),
  ]).map((snippet) => snippet.slice(0, 300)).filter((snippet) => snippet.length >= 12).slice(0, 8);
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
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

function dedupeSources(sources: DiscoverySource[]): DiscoverySource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.source}:${source.from_url ?? ""}:${source.label ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
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

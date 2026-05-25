import type { LayerProbeContext } from "../core/probe-contract";
import type { Evidence, EvidenceAssessment, RiskLevel, SnapshotRecord } from "../core/types";
import type { RemoteFetchResult } from "../providers/remote-fetch/types";

type ResourceRef = {
  id: string;
  url: string;
  domain: string;
  same_origin: boolean;
};

type MetaRef = {
  id: string;
  name: string;
  value: string;
};

type TechnologySignal = {
  technology: string;
  category: string;
  confidence: "confirmed" | "likely" | "possible";
  evidence_refs: string[];
  source: "deterministic_rule";
};

type FrontendEvidencePack = {
  final_url: string;
  html_bytes: number;
  title: string | null;
  meta: MetaRef[];
  scripts: ResourceRef[];
  stylesheets: ResourceRef[];
  images: ResourceRef[];
  preload_hints: ResourceRef[];
  markers: string[];
  headers: Record<string, string | null>;
};

const THIRD_PARTY_CATEGORIES: Array<{ category: string; patterns: RegExp[] }> = [
  { category: "analytics", patterns: [/google-analytics\.com/i, /googletagmanager\.com/i, /plausible\.io/i, /analytics/i] },
  { category: "tag_manager", patterns: [/googletagmanager\.com\/gtm\.js/i, /tagmanager/i] },
  { category: "ads", patterns: [/doubleclick\.net/i, /googlesyndication\.com/i, /adservice/i] },
  { category: "cdn", patterns: [/cdn\./i, /cloudflare\.com/i, /jsdelivr\.net/i, /unpkg\.com/i, /cdnjs\.cloudflare\.com/i] },
  { category: "support_chat", patterns: [/intercom/i, /zendesk/i, /crisp\.chat/i, /tawk\.to/i] },
  { category: "monitoring", patterns: [/sentry/i, /datadog/i, /newrelic/i, /bugsnag/i] },
  { category: "ab_testing", patterns: [/optimizely/i, /vwo\.com/i, /hotjar/i] },
];

export function createFrontendLayerRecords(context: LayerProbeContext, fetchResult: RemoteFetchResult): SnapshotRecord[] {
  const evidencePack = buildEvidencePack(fetchResult);
  const technologySignals = detectTechnologySignals(evidencePack);
  const thirdParty = classifyThirdPartyScripts(evidencePack);

  return [
    createAssetsRecord(context, fetchResult, evidencePack),
    createTechnologyRecord(context, fetchResult, technologySignals),
    createThirdPartyRecord(context, fetchResult, thirdParty),
    createResourceSurfaceRecord(context, fetchResult, evidencePack),
    createRobotsSitemapRecord(context, fetchResult),
    createAiEvidencePackRecord(context, fetchResult, evidencePack, technologySignals),
  ];
}

function createAssetsRecord(
  context: LayerProbeContext,
  fetchResult: RemoteFetchResult,
  evidencePack: FrontendEvidencePack,
): SnapshotRecord {
  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "frontend_assets_probe",
    layer: 4,
    item: "frontend_assets",
    probe_type: "active_request",
    source: `${fetchResult.source} + html_asset_extractor`,
    status: "ok",
    value: {
      final_url: fetchResult.final_url,
      html_bytes: evidencePack.html_bytes,
      title: evidencePack.title,
      counts: {
        scripts: evidencePack.scripts.length,
        stylesheets: evidencePack.stylesheets.length,
        images: evidencePack.images.length,
        preload_hints: evidencePack.preload_hints.length,
        meta: evidencePack.meta.length,
      },
      scripts: evidencePack.scripts,
      stylesheets: evidencePack.stylesheets,
      images: evidencePack.images.slice(0, 25),
      preload_hints: evidencePack.preload_hints,
      meta: evidencePack.meta,
    },
    risk: {
      level: "info",
      summary: `Extracted ${evidencePack.scripts.length} scripts, ${evidencePack.stylesheets.length} stylesheets, and ${evidencePack.images.length} images from static HTML.`,
    },
    evidence: buildFrontendEvidence(evidencePack),
    evidence_metadata: {
      origin: "direct_observation",
      role: "raw",
      method: "static_parse",
      limitations: [
        "Static HTML parsing sees declared resources only.",
        "Resources injected after JavaScript execution require browser_runtime evidence.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function createTechnologyRecord(
  context: LayerProbeContext,
  fetchResult: RemoteFetchResult,
  signals: TechnologySignal[],
): SnapshotRecord {
  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "frontend_technology_probe",
    layer: 4,
    item: "frontend_technology",
    probe_type: "active_request",
    source: `${fetchResult.source} + deterministic_frontend_rules`,
    status: "ok",
    value: {
      final_url: fetchResult.final_url,
      signals,
      technology_candidates: signals,
      technology_assessment: buildTechnologyAssessment(signals),
      ai_classifier_status: "not_configured",
      ai_classifier_input: {
        evidence_pack_record: "ai_frontend_evidence_pack",
        instruction: "Classify technologies only from evidence_refs. Do not infer without evidence.",
      },
    },
    risk: {
      level: "info",
      summary:
        signals.length > 0
          ? `Found ${signals.length} deterministic frontend technology candidate(s).`
          : "No high-confidence static frontend technology candidate was found.",
    },
    evidence: evidencePackToSignalEvidence(signals),
    evidence_metadata: {
      origin: "static_heuristic",
      role: "derived",
      method: "static_parse",
      limitations: [
        "Technology detection is based on static HTML, response headers, and script URL signatures.",
        "Runtime-only globals, hydrated application state, and minified bundles may hide technologies.",
        "AI report generation should treat these as evidence-backed candidates unless corroborated by browser_runtime or bundle analysis.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function createThirdPartyRecord(
  context: LayerProbeContext,
  fetchResult: RemoteFetchResult,
  thirdParty: ReturnType<typeof classifyThirdPartyScripts>,
): SnapshotRecord {
  const risk = classifyThirdPartyRisk(thirdParty.items.length);

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "third_party_scripts_probe",
    layer: 4,
    item: "third_party_scripts",
    probe_type: "active_request",
    source: `${fetchResult.source} + domain_classifier`,
    status: risk.level === "info" ? "ok" : "warning",
    value: {
      final_url: fetchResult.final_url,
      third_party_count: thirdParty.items.length,
      categories: thirdParty.categoryCounts,
      domains: thirdParty.domainCounts,
      items: thirdParty.items,
    },
    risk,
    evidence: thirdParty.items.map((item) => ({
      type: "script_url",
      name: item.category,
      value: item.url,
    })),
    evidence_metadata: {
      origin: "static_heuristic",
      role: "derived",
      method: "static_parse",
      limitations: [
        "Third-party classification uses script URL/domain patterns only.",
        "Inline scripts, proxied vendors, and runtime-injected tags may be missed.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function createResourceSurfaceRecord(
  context: LayerProbeContext,
  fetchResult: RemoteFetchResult,
  evidencePack: FrontendEvidencePack,
): SnapshotRecord {
  const declaredResourceCount =
    evidencePack.scripts.length + evidencePack.stylesheets.length + evidencePack.images.length + evidencePack.preload_hints.length;
  const risk = classifyResourceRisk(declaredResourceCount, evidencePack.html_bytes);

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "resource_weight_probe",
    layer: 4,
    item: "resource_surface",
    probe_type: "active_request",
    source: `${fetchResult.source} + static_resource_counter`,
    status: risk.level === "info" ? "ok" : "warning",
    value: {
      final_url: fetchResult.final_url,
      html_bytes: evidencePack.html_bytes,
      declared_resource_count: declaredResourceCount,
      declared_resource_counts: {
        scripts: evidencePack.scripts.length,
        stylesheets: evidencePack.stylesheets.length,
        images: evidencePack.images.length,
        preload_hints: evidencePack.preload_hints.length,
      },
      limitation:
        "Static HTML can count declared resources but cannot measure transfer size. Use browser_runtime for network waterfall and byte sizes.",
    },
    risk,
    evidence: [
      { type: "html_bytes", value: evidencePack.html_bytes },
      { type: "declared_resource_count", value: declaredResourceCount },
    ],
    evidence_metadata: {
      origin: "direct_observation",
      role: "derived",
      method: "static_parse",
      limitations: [
        "Static HTML can count declared resources but cannot measure network transfer size.",
        "Use browser_runtime evidence for resource waterfall, compression, cache status, and byte sizes.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function createRobotsSitemapRecord(context: LayerProbeContext, fetchResult: RemoteFetchResult): SnapshotRecord {
  const robots = fetchResult.crawl_metadata?.robots_txt ?? null;
  const sitemap = fetchResult.crawl_metadata?.sitemap_xml ?? null;
  const robotsFound = robots?.found ?? false;
  const sitemapFound = sitemap?.found ?? false;
  const risk: { level: RiskLevel; summary: string } =
    robotsFound || sitemapFound
      ? {
          level: "info",
          summary: `Crawl metadata found: robots.txt=${robotsFound ? "yes" : "no"}, sitemap.xml=${sitemapFound ? "yes" : "no"}.`,
        }
      : {
          level: "low",
          summary: "No robots.txt or default sitemap.xml was found by the remote fetch provider.",
        };

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "robots_sitemap_probe",
    layer: 4,
    item: "robots_sitemap",
    probe_type: "active_request",
    source: `${fetchResult.source} + crawl_metadata_fetch`,
    status: risk.level === "info" ? "ok" : "warning",
    value: {
      final_url: fetchResult.final_url,
      robots_txt: robots,
      sitemap_xml: sitemap,
      discovered_sitemap_urls: robots?.sitemap_urls ?? [],
      limitation: "This checks robots.txt and the default /sitemap.xml URL. Full sitemap crawling is out of MVP scope.",
    },
    risk,
    evidence: [
      ...(robots ? [{ type: "robots_txt", name: robots.url, value: robots.status_code }] : []),
      ...(sitemap ? [{ type: "sitemap_xml", name: sitemap.url, value: sitemap.status_code }] : []),
    ],
    evidence_metadata: {
      origin: "direct_observation",
      role: "derived",
      method: "fetch",
      limitations: [
        "This checks robots.txt and the default /sitemap.xml URL only.",
        "Nested sitemap crawling and full crawl policy interpretation are out of MVP scope.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function createAiEvidencePackRecord(
  context: LayerProbeContext,
  fetchResult: RemoteFetchResult,
  evidencePack: FrontendEvidencePack,
  signals: TechnologySignal[],
): SnapshotRecord {
  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "ai_frontend_evidence_pack",
    layer: 4,
    item: "ai_frontend_evidence",
    probe_type: "active_request",
    source: `${fetchResult.source} + ai_ready_evidence_pack`,
    status: "ok",
    value: {
      final_url: fetchResult.final_url,
      classifier_status: "not_invoked",
      instruction:
        "AI classifier must classify technologies only from evidence IDs and return technology, category, confidence, evidence_refs, and reasoning.",
      evidence_pack: evidencePack,
      deterministic_signals: signals,
      expected_ai_output_shape: {
        technology: "Next.js",
        category: "frontend_framework",
        confidence: "likely",
        evidence_refs: ["script:1", "marker:__NEXT_DATA__"],
        reasoning: "The evidence contains Next.js static chunk URLs and __NEXT_DATA__ marker.",
      },
    },
    risk: {
      level: "info",
      summary: "Prepared an AI-ready Layer 4 evidence pack without invoking an AI provider.",
    },
    evidence: buildFrontendEvidence(evidencePack),
    evidence_metadata: {
      origin: "direct_observation",
      role: "raw",
      method: "static_parse",
      limitations: [
        "This record prepares evidence for a future AI classifier but does not invoke one.",
        "Any final technology claim must be generated by the analysis layer with evidence_refs.",
      ],
    },
    duration_ms: fetchResult.duration_ms,
  };
}

function buildEvidencePack(fetchResult: RemoteFetchResult): FrontendEvidencePack {
  const origin = getOrigin(fetchResult.final_url);
  const html = fetchResult.html;

  return {
    final_url: fetchResult.final_url,
    html_bytes: new TextEncoder().encode(html).length,
    title: extractTitle(html),
    meta: extractMeta(html),
    scripts: extractResources(html, /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, "script", fetchResult.final_url, origin),
    stylesheets: extractStylesheets(html, fetchResult.final_url, origin),
    images: extractResources(html, /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, "image", fetchResult.final_url, origin),
    preload_hints: extractPreloadHints(html, fetchResult.final_url, origin),
    markers: Array.from(new Set([...extractMarkers(html), ...extractInlineAnalyticsMarkers(html)])),
    headers: {
      server: getHeader(fetchResult, "server"),
      "x-powered-by": getHeader(fetchResult, "x-powered-by"),
      "content-type": getHeader(fetchResult, "content-type"),
      "link": getHeader(fetchResult, "link"),
    },
  };
}

function detectTechnologySignals(pack: FrontendEvidencePack): TechnologySignal[] {
  const signals: TechnologySignal[] = [];
  const scriptUrls = pack.scripts.map((item) => item.url);
  const metaGenerator = pack.meta.find((item) => item.name.toLowerCase() === "generator");

  addSignalIf(signals, scriptUrls.some((url) => /\/_next\/static\//i.test(url)) || pack.markers.includes("__NEXT_DATA__"), {
    technology: "Next.js",
    category: "frontend_framework",
    confidence: "likely",
    evidence_refs: refsFor(pack, /_next\/static|__NEXT_DATA__/i),
  });

  addSignalIf(signals, scriptUrls.some((url) => /\/_nuxt\//i.test(url)) || pack.markers.includes("__NUXT__"), {
    technology: "Nuxt",
    category: "frontend_framework",
    confidence: "likely",
    evidence_refs: refsFor(pack, /_nuxt|__NUXT__/i),
  });

  addSignalIf(signals, pack.markers.includes("__NEXT_DATA__") || pack.markers.includes("data-reactroot"), {
    technology: "React",
    category: "frontend_library",
    confidence: "possible",
    evidence_refs: refsFor(pack, /__NEXT_DATA__|data-reactroot/i),
  });

  addSignalIf(signals, pack.markers.includes("data-v-") || scriptUrls.some((url) => /vue/i.test(url)), {
    technology: "Vue",
    category: "frontend_library",
    confidence: "possible",
    evidence_refs: refsFor(pack, /data-v-|vue/i),
  });

  addSignalIf(signals, scriptUrls.some((url) => /\/assets\/[^"']+\.(?:js|css)/i.test(url)) && pack.markers.includes("type=module"), {
    technology: "Vite-like build",
    category: "build_tool",
    confidence: "possible",
    evidence_refs: refsFor(pack, /\/assets\/|type=module/i),
  });

  addSignalIf(signals, Boolean(metaGenerator?.value), {
    technology: metaGenerator?.value ?? "Meta generator",
    category: "generator",
    confidence: "confirmed",
    evidence_refs: metaGenerator ? [metaGenerator.id] : [],
  });

  addSignalIf(signals, scriptUrls.some((url) => /googletagmanager\.com\/gtm\.js/i.test(url)), {
    technology: "Google Tag Manager",
    category: "tag_manager",
    confidence: "confirmed",
    evidence_refs: refsFor(pack, /googletagmanager\.com\/gtm\.js/i),
  });

  addSignalIf(signals, scriptUrls.some((url) => /google-analytics\.com|gtag\/js/i.test(url)), {
    technology: "Google Analytics",
    category: "analytics",
    confidence: "confirmed",
    evidence_refs: refsFor(pack, /google-analytics\.com|gtag\/js/i),
  });

  addSignalIf(signals, pack.markers.some((marker) => /^matomo(?:$|:)/i.test(marker)), {
    technology: "Matomo",
    category: "analytics",
    confidence: "confirmed",
    evidence_refs: refsFor(pack, /matomo/i),
  });

  return signals.map((signal) => ({ ...signal, source: "deterministic_rule" }));
}

function classifyThirdPartyScripts(pack: FrontendEvidencePack) {
  const items = pack.scripts
    .filter((script) => !script.same_origin)
    .map((script) => ({
      id: script.id,
      url: script.url,
      domain: script.domain,
      category: classifyThirdPartyUrl(script.url),
    }));
  const categoryCounts = countBy(items.map((item) => item.category));
  const domainCounts = countBy(items.map((item) => item.domain));

  return { items, categoryCounts, domainCounts };
}

function classifyThirdPartyUrl(url: string): string {
  const match = THIRD_PARTY_CATEGORIES.find((entry) => entry.patterns.some((pattern) => pattern.test(url)));
  return match?.category ?? "external_script";
}

function extractResources(
  html: string,
  pattern: RegExp,
  prefix: string,
  baseUrl: string,
  origin: string | null,
): ResourceRef[] {
  return Array.from(html.matchAll(pattern))
    .map((match, index) => createResourceRef(`${prefix}:${index + 1}`, match[1] ?? "", baseUrl, origin))
    .filter((item): item is ResourceRef => Boolean(item));
}

function extractStylesheets(html: string, baseUrl: string, origin: string | null): ResourceRef[] {
  const refs: ResourceRef[] = [];

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = getAttr(tag, "rel")?.toLowerCase() ?? "";
    const href = getAttr(tag, "href") ?? "";
    if (!rel.includes("stylesheet") || !href) continue;

    const ref = createResourceRef(`stylesheet:${refs.length + 1}`, href, baseUrl, origin);
    if (ref) refs.push(ref);
  }

  return refs;
}

function extractPreloadHints(html: string, baseUrl: string, origin: string | null): ResourceRef[] {
  const refs: ResourceRef[] = [];

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = getAttr(tag, "rel")?.toLowerCase() ?? "";
    const href = getAttr(tag, "href") ?? "";
    if (!/(?:preload|modulepreload|preconnect|dns-prefetch)/.test(rel) || !href) continue;

    const ref = createResourceRef(`preload:${refs.length + 1}`, href, baseUrl, origin);
    if (ref) refs.push(ref);
  }

  return refs;
}

function extractMeta(html: string): MetaRef[] {
  const refs: MetaRef[] = [];

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = getAttr(tag, "name") ?? getAttr(tag, "property") ?? getAttr(tag, "http-equiv");
    const content = getAttr(tag, "content");
    if (!name || !content) continue;

    refs.push({
      id: `meta:${refs.length + 1}`,
      name,
      value: content.slice(0, 300),
    });
  }

  return refs;
}

function extractMarkers(html: string): string[] {
  const markers = new Set<string>();
  const checks: Array<[string, RegExp]> = [
    ["__NEXT_DATA__", /__NEXT_DATA__/i],
    ["__NUXT__", /__NUXT__/i],
    ["data-reactroot", /data-reactroot/i],
    ["data-v-", /\sdata-v-[a-z0-9-]+/i],
    ["type=module", /<script\b[^>]*\btype=["']module["']/i],
    ["wp-content", /\/wp-content\//i],
    ["shopify", /cdn\.shopify\.com|Shopify/i],
  ];

  for (const [name, pattern] of checks) {
    if (pattern.test(html)) markers.add(name);
  }

  return Array.from(markers);
}

function extractInlineAnalyticsMarkers(html: string): string[] {
  const markers = new Set<string>();
  if (/_paq|setTrackerUrl|matomo\.(?:php|js)/i.test(html)) {
    markers.add("matomo");
  }

  for (const match of html.matchAll(/(?:https?:)?\/\/([a-z0-9.-]*matomo[a-z0-9.-]*)\//gi)) {
    const host = match[1]?.toLowerCase();
    if (host) markers.add(`matomo-host:${host}`);
  }

  return Array.from(markers);
}

function createResourceRef(id: string, rawUrl: string, baseUrl: string, origin: string | null): ResourceRef | null {
  try {
    const url = new URL(rawUrl, baseUrl);
    const normalized = url.toString();
    return {
      id,
      url: normalized,
      domain: url.hostname,
      same_origin: origin ? url.origin === origin : false,
    };
  } catch {
    return null;
  }
}

function buildFrontendEvidence(pack: FrontendEvidencePack): Evidence[] {
  const evidence: Evidence[] = [
    { type: "html_bytes", value: pack.html_bytes },
    { type: "resource_count", name: "scripts", value: pack.scripts.length },
    { type: "resource_count", name: "stylesheets", value: pack.stylesheets.length },
    { type: "resource_count", name: "images", value: pack.images.length },
  ];

  for (const marker of pack.markers) {
    evidence.push({ type: "html_marker", value: marker });
  }

  for (const meta of pack.meta.slice(0, 10)) {
    evidence.push({ type: "meta", name: meta.name, value: meta.value });
  }

  return evidence;
}

function buildTechnologyAssessment(signals: TechnologySignal[]): EvidenceAssessment {
  const highest = signals.some((signal) => signal.confidence === "confirmed")
    ? "confirmed"
    : signals.some((signal) => signal.confidence === "likely")
      ? "likely"
      : signals.some((signal) => signal.confidence === "possible")
        ? "possible"
        : "none";
  const conclusion = highest === "none" ? "not_detected" : highest;

  return {
    label: "Frontend technology check",
    conclusion,
    confidence: highest,
    signals: signals.map((signal) => ({
      type: "technology_candidate",
      name: signal.technology,
      value: {
        category: signal.category,
        confidence: signal.confidence,
      },
      source: signal.source,
      evidence_refs: signal.evidence_refs,
    })),
    limitations: [
      "Static signatures produce technology candidates, not a complete technology inventory.",
      "Runtime-only globals, hydrated state, server-rendered markup, and minified bundles may hide technologies.",
      "Final report claims should cite these candidates and upgrade confidence only when corroborated by browser runtime, bundle analysis, or AI reasoning over evidence refs.",
    ],
  };
}

function evidencePackToSignalEvidence(signals: TechnologySignal[]): Evidence[] {
  return signals.map((signal) => ({
    type: "technology_candidate",
    name: signal.technology,
    value: {
      category: signal.category,
      confidence: signal.confidence,
      evidence_refs: signal.evidence_refs,
    },
  }));
}

function classifyThirdPartyRisk(count: number): { level: RiskLevel; summary: string } {
  if (count >= 15) {
    return {
      level: "medium",
      summary: `Static HTML references ${count} third-party scripts, which increases supply-chain and performance exposure.`,
    };
  }

  if (count >= 6) {
    return {
      level: "low",
      summary: `Static HTML references ${count} third-party scripts.`,
    };
  }

  return {
    level: "info",
    summary: count > 0 ? `Static HTML references ${count} third-party script(s).` : "No third-party script was found in static HTML.",
  };
}

function classifyResourceRisk(count: number, htmlBytes: number): { level: RiskLevel; summary: string } {
  if (count >= 100 || htmlBytes > 500_000) {
    return {
      level: "medium",
      summary: `Static HTML declares ${count} resources and weighs ${htmlBytes} bytes before browser runtime enrichment.`,
    };
  }

  if (count >= 50 || htmlBytes > 200_000) {
    return {
      level: "low",
      summary: `Static HTML declares ${count} resources and weighs ${htmlBytes} bytes.`,
    };
  }

  return {
    level: "info",
    summary: `Static HTML declares ${count} resources and weighs ${htmlBytes} bytes.`,
  };
}

function addSignalIf(
  signals: Array<Omit<TechnologySignal, "source">>,
  condition: boolean,
  signal: Omit<TechnologySignal, "source">,
): void {
  if (condition && signal.evidence_refs.length > 0) {
    signals.push(signal);
  }
}

function refsFor(pack: FrontendEvidencePack, pattern: RegExp): string[] {
  const refs: string[] = [];

  for (const script of pack.scripts) {
    if (pattern.test(script.url)) refs.push(script.id);
  }

  for (const stylesheet of pack.stylesheets) {
    if (pattern.test(stylesheet.url)) refs.push(stylesheet.id);
  }

  for (const meta of pack.meta) {
    if (pattern.test(`${meta.name}:${meta.value}`)) refs.push(meta.id);
  }

  for (const marker of pack.markers) {
    if (pattern.test(marker)) refs.push(`marker:${marker}`);
  }

  return Array.from(new Set(refs));
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function extractTitle(html: string): string | null {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}

function getAttr(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i");
  return tag.match(pattern)?.[1] ?? null;
}

function getHeader(fetchResult: RemoteFetchResult, name: string): string | null {
  return fetchResult.headers[name.toLowerCase()] ?? null;
}

function getOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

import type {
  PublicSpaAssetKind,
  PublicSpaAssetPreview,
  PublicSpaAssetRole,
  PublicSpaDeclaredAsset,
  PublicSpaMetadataResult,
  PublicSpaSignal,
} from "../../src/providers/public-spa-metadata/types";

export type PublicSpaMetadataOptions = {
  maxAssetPreviews?: unknown;
};

const DEFAULT_MAX_DECLARED_ASSETS = 80;
const DEFAULT_MAX_ASSET_PREVIEWS = 6;
const DEFAULT_MAX_REFERENCED_ASSET_PREVIEWS = 40;
const MAX_ALLOWED_ASSET_PREVIEWS = 10;
const MAX_ASSET_PREVIEW_BYTES = 768_000;
const MAX_ENTRY_ASSET_PREVIEW_BYTES = 1_800_000;
const MAX_REFERENCED_ASSET_PREVIEW_BYTES = 128_000;
const MAX_REFERENCED_ASSET_CANDIDATES = 160;
const MAX_ROUTE_CANDIDATES = 60;
const MAX_COMPONENT_CANDIDATES = 60;
const TIMEOUT_MS = 10_000;

export async function publicSpaMetadataProbe(
  target: string,
  options: PublicSpaMetadataOptions = {},
): Promise<PublicSpaMetadataResult> {
  const startedAt = Date.now();
  const normalizedUrl = normalizeTargetUrl(target);
  const rootHost = new URL(normalizedUrl).hostname.toLowerCase();
  const maxAssetPreviews = parseLimit(options.maxAssetPreviews, DEFAULT_MAX_ASSET_PREVIEWS, MAX_ALLOWED_ASSET_PREVIEWS, "max_asset_previews");
  const root = await fetchText(normalizedUrl, MAX_ASSET_PREVIEW_BYTES, "text/html,application/xhtml+xml,*/*;q=0.8");
  const finalUrl = root.finalUrl ?? normalizedUrl;
  const html = root.text;
  const declaredAssets = extractDeclaredAssets(html, finalUrl, rootHost).slice(0, DEFAULT_MAX_DECLARED_ASSETS);
  const selectedAssets = selectPreviewAssets(declaredAssets, maxAssetPreviews);
  const declaredAssetPreviews = await Promise.all(
    selectedAssets.map((asset) =>
      fetchAssetPreview(
        asset,
        rootHost,
        asset.role === "entry_bundle" ? MAX_ENTRY_ASSET_PREVIEW_BYTES : MAX_ASSET_PREVIEW_BYTES,
      ),
    ),
  );
  const referencedAssets = selectReferencedPreviewAssets(
    declaredAssetPreviews,
    finalUrl,
    rootHost,
    selectedAssets,
    DEFAULT_MAX_REFERENCED_ASSET_PREVIEWS,
  );
  const referencedAssetPreviews = await Promise.all(
    referencedAssets.map((asset) => fetchAssetPreview(asset, rootHost, MAX_REFERENCED_ASSET_PREVIEW_BYTES)),
  );
  const fetchedAssetPreviews = [...declaredAssetPreviews, ...referencedAssetPreviews];
  const routeCandidates = collectRouteCandidates(fetchedAssetPreviews);
  const componentCandidates = collectComponentCandidates(fetchedAssetPreviews);
  const htmlShell = {
    final_url: root.finalUrl,
    status_code: root.status,
    content_type: root.contentType,
    title: extractTitle(html),
    root_containers: extractRootContainers(html),
    module_script_count: countModuleScripts(html),
    declared_script_count: declaredAssets.filter((asset) => asset.kind === "script").length,
    declared_stylesheet_count: declaredAssets.filter((asset) => asset.kind === "stylesheet").length,
    has_next_data: /__NEXT_DATA__/i.test(html),
    has_nuxt_data: /__NUXT__/i.test(html),
    has_ssr_data_marker: /__NEXT_DATA__|__NUXT__|data-server-rendered|astro-island|sveltekit:data/i.test(html),
    visible_text_length: extractVisibleText(html).length,
    rendering_assessment: assessRenderingMode(html, declaredAssets),
  };
  const detectedSignals = detectSignals({
    html,
    htmlShell,
    declaredAssets,
    fetchedAssetPreviews,
    routeCandidates,
    componentCandidates,
  });

  return {
    requested_url: target,
    final_url: root.finalUrl,
    host: rootHost,
    html_shell: htmlShell,
    declared_assets: declaredAssets,
    fetched_asset_previews: fetchedAssetPreviews,
    route_candidates: routeCandidates,
    component_candidates: componentCandidates,
    detected_signals: detectedSignals,
    limits: {
      max_declared_assets: DEFAULT_MAX_DECLARED_ASSETS,
      max_asset_previews: maxAssetPreviews,
      max_asset_preview_bytes: MAX_ASSET_PREVIEW_BYTES,
      max_entry_asset_preview_bytes: MAX_ENTRY_ASSET_PREVIEW_BYTES,
      max_referenced_asset_previews: DEFAULT_MAX_REFERENCED_ASSET_PREVIEWS,
      max_referenced_asset_preview_bytes: MAX_REFERENCED_ASSET_PREVIEW_BYTES,
      max_route_candidates: MAX_ROUTE_CANDIDATES,
      max_component_candidates: MAX_COMPONENT_CANDIDATES,
      timeout_ms: TIMEOUT_MS,
    },
    coverage: {
      collected: [
        "public_html_shell_markers",
        "declared_public_spa_assets",
        "bounded_js_css_asset_previews",
        "bounded_referenced_js_chunk_previews",
        "framework_build_router_string_signals",
        "route_like_string_candidates",
        "component_like_symbol_candidates",
      ],
      missing: [
        "executed_client_route_table",
        "authenticated_route_behavior",
        "complete_minified_bundle_reverse_engineering",
        "runtime_router_state",
      ],
      limitations: [
        "This provider reads a bounded public HTML document, a small number of same-site JS/CSS previews, and a scored subset of same-site referenced JS chunks.",
        "Route candidates are string-level evidence only; they do not prove route reachability, permissions, or business workflow behavior.",
        "Minification, obfuscation, server rendering, and runtime-generated routes can hide or distort framework and route signals.",
      ],
    },
    duration_ms: Date.now() - startedAt,
    provider_id: "cloudflare_worker_public_spa_metadata",
    source: "cloudflare_worker_public_spa_metadata",
  };
}

async function fetchAssetPreview(asset: PublicSpaDeclaredAsset, rootHost: string, maxBytes: number): Promise<PublicSpaAssetPreview> {
  if (!asset.same_origin && !asset.host.endsWith(`.${rootHost}`)) {
    return {
      ...asset,
      final_url: null,
      status_code: null,
      content_type: null,
      bytes_read: 0,
      signals: [],
      referenced_assets: [],
      route_candidates: [],
      component_candidates: [],
      error: "Skipped off-target asset preview.",
    };
  }

  try {
    const response = await fetchText(asset.url, maxBytes, acceptForAsset(asset));
    const text = response.text;
    return {
      ...asset,
      final_url: response.finalUrl,
      status_code: response.status,
      content_type: response.contentType,
      bytes_read: new TextEncoder().encode(text).length,
      signals: extractAssetSignals(text, asset),
      referenced_assets: extractReferencedAssets(text, asset.url).slice(0, MAX_REFERENCED_ASSET_CANDIDATES),
      route_candidates: extractRouteLikeStrings(text).slice(0, MAX_ROUTE_CANDIDATES),
      component_candidates: extractComponentLikeSymbols(text).slice(0, MAX_COMPONENT_CANDIDATES),
      error: null,
    };
  } catch (error) {
    return {
      ...asset,
      final_url: null,
      status_code: null,
      content_type: null,
      bytes_read: 0,
      signals: [],
      referenced_assets: [],
      route_candidates: [],
      component_candidates: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractDeclaredAssets(html: string, baseUrl: string, rootHost: string): PublicSpaDeclaredAsset[] {
  const assets: PublicSpaDeclaredAsset[] = [];
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    const src = readHtmlAttribute(tag, "src");
    if (!src) continue;
    const type = readHtmlAttribute(tag, "type");
    assets.push(createAsset(src, baseUrl, rootHost, "script", inferScriptRole(src, type), null, null));
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const href = readHtmlAttribute(tag, "href");
    if (!href) continue;
    const rel = readHtmlAttribute(tag, "rel")?.toLowerCase() ?? "";
    const as = readHtmlAttribute(tag, "as");
    if (rel.includes("stylesheet")) {
      assets.push(createAsset(href, baseUrl, rootHost, "stylesheet", "style_bundle", rel, as));
    } else if (rel.includes("modulepreload")) {
      assets.push(createAsset(href, baseUrl, rootHost, "modulepreload", inferAssetRole(href, "modulepreload"), rel, as));
    } else if (rel.includes("manifest") || /manifest\.webmanifest|manifest\.json/i.test(href)) {
      assets.push(createAsset(href, baseUrl, rootHost, "manifest", "manifest", rel, as));
    } else if ((rel.includes("preload") || rel.includes("prefetch")) && /\.(?:js|mjs|css|json)(?:$|\?)/i.test(href)) {
      assets.push(createAsset(href, baseUrl, rootHost, "other", inferAssetRole(href, "other"), rel, as));
    }
  }

  return dedupeAssets(assets);
}

function createAsset(
  value: string,
  baseUrl: string,
  rootHost: string,
  kind: PublicSpaAssetKind,
  role: PublicSpaAssetRole,
  rel: string | null,
  as: string | null,
): PublicSpaDeclaredAsset {
  const url = new URL(value, baseUrl);
  return {
    url: url.toString(),
    host: url.hostname.toLowerCase(),
    path: url.pathname,
    kind,
    role,
    rel,
    as,
    same_origin: url.hostname.toLowerCase() === rootHost,
  };
}

function selectPreviewAssets(assets: PublicSpaDeclaredAsset[], limit: number): PublicSpaDeclaredAsset[] {
  return assets
    .filter((asset) => /\.(?:js|mjs|css|json|webmanifest)(?:$|\?)/i.test(asset.path))
    .sort((left, right) => scorePreviewAsset(right) - scorePreviewAsset(left) || left.path.localeCompare(right.path))
    .slice(0, limit);
}

function selectReferencedPreviewAssets(
  previews: PublicSpaAssetPreview[],
  baseUrl: string,
  rootHost: string,
  alreadySelected: PublicSpaDeclaredAsset[],
  limit: number,
): PublicSpaDeclaredAsset[] {
  const selectedUrls = new Set(alreadySelected.map((asset) => asset.url));
  const candidates = new Map<string, { asset: PublicSpaDeclaredAsset; index: number; sourceSignals: string[] }>();
  let index = 0;

  for (const preview of previews) {
    const previewBaseUrl = preview.final_url ?? preview.url ?? baseUrl;
    for (const referenced of preview.referenced_assets) {
      const asset = createReferencedAsset(referenced, previewBaseUrl, rootHost);
      if (!asset || selectedUrls.has(asset.url)) {
        index += 1;
        continue;
      }
      const current = candidates.get(asset.url);
      if (!current) {
        candidates.set(asset.url, { asset, index, sourceSignals: preview.signals });
      }
      index += 1;
    }
  }

  return Array.from(candidates.values())
    .filter(({ asset }) => asset.same_origin && /\.(?:js|mjs)(?:$|\?)/i.test(asset.path))
    .sort((left, right) =>
      scoreReferencedPreviewAsset(right.asset, right.index, right.sourceSignals)
      - scoreReferencedPreviewAsset(left.asset, left.index, left.sourceSignals)
      || left.index - right.index
      || left.asset.path.localeCompare(right.asset.path),
    )
    .slice(0, limit)
    .map(({ asset }) => asset);
}

function createReferencedAsset(value: string, baseUrl: string, rootHost: string): PublicSpaDeclaredAsset | null {
  try {
    let normalized = value.trim();
    if (!normalized) return null;
    if (/^(?:assets|static)\//i.test(normalized)) normalized = `/${normalized}`;
    const url = new URL(normalized, baseUrl);
    return {
      url: url.toString(),
      host: url.hostname.toLowerCase(),
      path: url.pathname,
      kind: "script",
      role: "lazy_chunk",
      rel: "referenced",
      as: "script",
      same_origin: url.hostname.toLowerCase() === rootHost,
    };
  } catch {
    return null;
  }
}

function scorePreviewAsset(asset: PublicSpaDeclaredAsset): number {
  let score = 0;
  if (asset.same_origin) score += 50;
  if (asset.role === "entry_bundle") score += 40;
  if (asset.kind === "script") score += 35;
  if (asset.kind === "modulepreload") score += 25;
  if (asset.role === "lazy_chunk") score += 20;
  if (/\/assets\/|\/static\/|\/_next\/static\//i.test(asset.path)) score += 15;
  if (asset.kind === "stylesheet") score += 5;
  return score;
}

function scoreReferencedPreviewAsset(asset: PublicSpaDeclaredAsset, index: number, sourceSignals: string[]): number {
  const text = asset.path.toLowerCase();
  let score = 0;
  if (/vendor|revenue|payment|withdraw|wallet|setting|model|billing|log|usage|token|dashboard|pricing|signup|auth|channel|tiers|user/.test(text)) {
    score += 100;
  }
  if (/form|application|rate|stat|earning|profile|security/.test(text)) score += 20;
  if (/\/index-[^/]+\.m?js$/i.test(asset.path)) score += 18;
  if (sourceSignals.includes("vite_map_deps") || sourceSignals.includes("lazy_chunk_ref")) score += 10;
  return score - index * 0.01;
}

function inferScriptRole(src: string, type: string | null): PublicSpaAssetRole {
  if (/\/assets\/index-[^/]+\.js|\/assets\/main-[^/]+\.js|\/static\/js\/main\./i.test(src)) return "entry_bundle";
  if (type === "module" && /\.(?:js|mjs)(?:$|\?)/i.test(src)) return "entry_bundle";
  return inferAssetRole(src, "script");
}

function inferAssetRole(value: string, kind: PublicSpaAssetKind): PublicSpaAssetRole {
  if (/manifest\.webmanifest|manifest\.json/i.test(value)) return "manifest";
  if (/\.(?:css)(?:$|\?)/i.test(value)) return "style_bundle";
  if (/chunk|lazy|pages?|route|component/i.test(value)) return "lazy_chunk";
  if (kind === "modulepreload") return "preload";
  return "unknown";
}

function assessRenderingMode(html: string, assets: PublicSpaDeclaredAsset[]): PublicSpaMetadataResult["html_shell"]["rendering_assessment"] {
  const basis: string[] = [];
  const rootContainers = extractRootContainers(html);
  if (rootContainers.length > 0) basis.push(`root container(s): ${rootContainers.join(", ")}`);
  if (countModuleScripts(html) > 0) basis.push("module script entry observed");
  if (!/__NEXT_DATA__|__NUXT__|data-server-rendered|astro-island|sveltekit:data/i.test(html)) basis.push("no common SSR hydration marker in HTML preview");
  if (assets.some((asset) => asset.role === "entry_bundle")) basis.push("entry bundle declared by HTML");

  if (rootContainers.length > 0 && countModuleScripts(html) > 0 && !/__NEXT_DATA__|__NUXT__|data-server-rendered/i.test(html)) {
    return { mode: "csr_candidate", confidence: basis.length >= 3 ? "high" : "medium", basis };
  }
  if (/__NEXT_DATA__|__NUXT__|data-server-rendered|astro-island|sveltekit:data/i.test(html)) {
    return { mode: "ssr_or_hybrid_candidate", confidence: "medium", basis: [...basis, "common SSR/hybrid marker observed"] };
  }
  return { mode: "unknown", confidence: "low", basis: basis.length > 0 ? basis : ["no strong rendering marker observed"] };
}

function detectSignals(input: {
  html: string;
  htmlShell: PublicSpaMetadataResult["html_shell"];
  declaredAssets: PublicSpaDeclaredAsset[];
  fetchedAssetPreviews: PublicSpaAssetPreview[];
  routeCandidates: PublicSpaMetadataResult["route_candidates"];
  componentCandidates: PublicSpaMetadataResult["component_candidates"];
}): PublicSpaSignal[] {
  const text = [input.html, ...input.fetchedAssetPreviews.map((asset) => asset.signals.join(" "))].join("\n");
  const assetText = input.fetchedAssetPreviews.map((asset) => [asset.path, ...asset.signals].join(" ")).join("\n");
  const signals: PublicSpaSignal[] = [];
  addSignal(signals, /react_symbol|react_dom|jsx_runtime|react-router/i.test(assetText), {
    id: "spa_signal_react",
    label: "React",
    category: "frontend_framework",
    confidence: /react_symbol|react_dom/i.test(assetText) ? "confirmed" : "likely",
    evidence: previewEvidence(input.fetchedAssetPreviews, /react_symbol|react_dom|jsx_runtime|react-router/i),
  });
  addSignal(signals, /vite_map_deps|\/assets\/[^"')]+-[A-Za-z0-9_-]+\.(?:js|css)/i.test(text), {
    id: "spa_signal_vite",
    label: "Vite-like asset pipeline",
    category: "build_tool",
    confidence: /vite_map_deps/i.test(assetText) ? "confirmed" : "likely",
    evidence: previewEvidence(input.fetchedAssetPreviews, /vite_map_deps|\/assets\//i),
  });
  addSignal(signals, /react_router|browser_router|create_browser_router|use_navigate/i.test(assetText), {
    id: "spa_signal_react_router",
    label: "React Router-like client routing",
    category: "router",
    confidence: /react_router/i.test(assetText) ? "confirmed" : "likely",
    evidence: previewEvidence(input.fetchedAssetPreviews, /react_router|browser_router|create_browser_router|use_navigate/i),
  });
  addSignal(signals, input.htmlShell.rendering_assessment.mode === "csr_candidate", {
    id: "spa_signal_csr",
    label: "CSR candidate",
    category: "rendering_mode",
    confidence: input.htmlShell.rendering_assessment.confidence === "high" ? "likely" : "possible",
    evidence: input.htmlShell.rendering_assessment.basis,
  });
  addSignal(signals, input.fetchedAssetPreviews.some((asset) => asset.referenced_assets.length > 0 || asset.signals.includes("dynamic_import") || asset.signals.includes("vite_map_deps")), {
    id: "spa_signal_code_splitting",
    label: "Code splitting / lazy chunk hints",
    category: "code_splitting",
    confidence: input.fetchedAssetPreviews.some((asset) => asset.signals.includes("vite_map_deps")) ? "likely" : "possible",
    evidence: previewEvidence(input.fetchedAssetPreviews, /vite_map_deps|dynamic_import|lazy_chunk_ref/i),
  });
  addSignal(signals, input.routeCandidates.length > 0, {
    id: "spa_signal_route_candidates",
    label: "Route-like strings in public bundle preview",
    category: "router",
    confidence: "possible",
    evidence: input.routeCandidates.slice(0, 8).map((route) => `${route.value} from ${route.source_asset}`),
  });
  addSignal(signals, input.componentCandidates.length > 0, {
    id: "spa_signal_component_candidates",
    label: "Component/page-like symbols in public bundle preview",
    category: "asset_pipeline",
    confidence: "possible",
    evidence: input.componentCandidates.slice(0, 8).map((component) => `${component.value} from ${component.source_asset}`),
  });
  return signals;
}

function extractAssetSignals(text: string, asset: PublicSpaDeclaredAsset): string[] {
  const signals = new Set<string>();
  if (/__vite__mapDeps/i.test(text)) signals.add("vite_map_deps");
  if (/import\s*\(/.test(text)) signals.add("dynamic_import");
  if (/Symbol\.for\(["']react\.(?:element|portal|fragment|strict_mode|profiler)/i.test(text)) signals.add("react_symbol");
  if (/react-dom|createRoot|hydrateRoot/i.test(text)) signals.add("react_dom");
  if (/jsx-runtime|react\/jsx-runtime/i.test(text)) signals.add("jsx_runtime");
  if (/react-router|createBrowserRouter|BrowserRouter|useNavigate|useRoutes/i.test(text)) signals.add("react_router");
  if (/webpackChunk|__webpack_require__/i.test(text)) signals.add("webpack_runtime");
  if (/\/_next\/static|next-router-state-tree|__NEXT_DATA__/i.test(text)) signals.add("next_runtime");
  if (/\/assets\/[^"')]+-[A-Za-z0-9_-]+\.(?:js|css)/i.test(text)) signals.add("hashed_asset_refs");
  if (extractReferencedAssets(text, asset.url).some((value) => /\.(?:js|mjs)(?:$|\?)/i.test(value))) signals.add("lazy_chunk_ref");
  return Array.from(signals);
}

function collectRouteCandidates(previews: PublicSpaAssetPreview[]): PublicSpaMetadataResult["route_candidates"] {
  const seen = new Set<string>();
  const candidates: PublicSpaMetadataResult["route_candidates"] = [];
  for (const preview of previews) {
    for (const value of preview.route_candidates) {
      const key = value;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        value,
        source_asset: preview.path,
        confidence: /(?:login|signup|pricing|model|vendor|setting|dashboard|account|products)/i.test(value) ? "medium" : "low",
      });
    }
  }
  return candidates
    .sort((left, right) => scoreRouteCandidate(right.value) - scoreRouteCandidate(left.value) || left.value.localeCompare(right.value))
    .slice(0, MAX_ROUTE_CANDIDATES);
}

function collectComponentCandidates(previews: PublicSpaAssetPreview[]): PublicSpaMetadataResult["component_candidates"] {
  const seen = new Set<string>();
  const candidates: PublicSpaMetadataResult["component_candidates"] = [];
  for (const preview of previews) {
    for (const value of preview.component_candidates) {
      if (seen.has(value)) continue;
      seen.add(value);
      candidates.push({
        value,
        source_asset: preview.path,
        confidence: /(?:Page|View|Layout|Dashboard|Panel|Router|Route|Terms|Privacy|Contact|Feedback)$/i.test(value) ? "medium" : "low",
      });
      if (candidates.length >= MAX_COMPONENT_CANDIDATES) return candidates;
    }
  }
  return candidates;
}

function extractRouteLikeStrings(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(/["'`]((?:\/[A-Za-z0-9][A-Za-z0-9/_:.-]{0,120})(?:\?[^"'`]{0,80})?)["'`]/g)) {
    const value = normalizeRouteCandidate(match[1]);
    if (!value) continue;
    values.push(value, ...deriveRouteCandidateAliases(value));
    if (values.length >= MAX_ROUTE_CANDIDATES * 3) break;
  }
  return uniqueStrings(values)
    .sort((left, right) => scoreRouteCandidate(right) - scoreRouteCandidate(left) || left.localeCompare(right))
    .slice(0, MAX_ROUTE_CANDIDATES);
}

function normalizeRouteCandidate(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/^\/(?:assets|static|_next|wp-|wp-content|favicon|robots\.txt|sitemap\.xml)\b/i.test(value)) return null;
  if (/\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|map|json|xml|txt|pdf|zip)(?:$|\?)/i.test(value)) return null;
  if (value.length < 2 || value.length > 140) return null;
  return value.replace(/\/+$/, "") || "/";
}

function deriveRouteCandidateAliases(value: string): string[] {
  const aliases: string[] = [];
  const settingsParent = value.match(/^\/setting\/(payment|profile|security|notification|data|system)\//i)?.[1];
  if (settingsParent) aliases.push(`/setting/${settingsParent.toLowerCase()}`);
  return aliases;
}

function scoreRouteCandidate(value: string): number {
  let score = 0;
  if (/^\/(?:login|signup|pricing|model|vendor|setting|products|dashboard|account|token|log|revenue|billing)/i.test(value)) score += 50;
  if (value.split("/").length <= 4) score += 20;
  if (/[{}*]/.test(value)) score -= 20;
  return score;
}

function extractComponentLikeSymbols(text: string): string[] {
  const symbolValues = Array.from(
    text.matchAll(/\b([A-Z][A-Za-z0-9]{2,48}(?:Page|View|Layout|Route|Router|Panel|Dashboard|Model|Vendor|Token|Recharge|Log|Setting|Terms|Privacy|Contact|Feedback|Profile|Account|Pricing|Product|Products))\b/g),
  ).map((match) => match[1]);
  const assetModuleValues = Array.from(
    text.matchAll(/(?:^|["'`])(?:\.?\/)?(?:assets|static)\/([A-Z][A-Za-z0-9]{2,48})-[A-Za-z0-9_-]+\.(?:js|mjs|css)/g),
  ).map((match) => match[1]);
  const namedPageValues = Array.from(
    text.matchAll(/\b(Terms|Privacy|Contact|Feedback|AuthLayout|VerifyPassword|MainContentFullWidth|DataTable|ModelCard|VendorApplication)\b/g),
  ).map((match) => match[1]);
  return uniqueStrings([...symbolValues, ...assetModuleValues, ...namedPageValues]).slice(0, MAX_COMPONENT_CANDIDATES);
}

function extractReferencedAssets(text: string, baseUrl: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(/["'`]([^"'`]*(?:\/|^)(?:assets|static|_next\/static)\/[^"'`]+\.(?:js|mjs|css))["'`]/gi)) {
    try {
      const url = new URL(match[1], baseUrl);
      values.push(url.pathname);
    } catch {
      continue;
    }
  }
  for (const match of text.matchAll(/["'`]([^"'`]+\.(?:js|mjs|css))["'`]/gi)) {
    const value = match[1];
    if (!/[A-Za-z0-9_-]{6,}\.(?:js|mjs|css)$/i.test(value)) continue;
    values.push(value);
  }
  return uniqueStrings(values).slice(0, MAX_REFERENCED_ASSET_CANDIDATES);
}

async function fetchText(url: string, maxBytes: number, accept: string): Promise<{
  finalUrl: string | null;
  status: number | null;
  contentType: string | null;
  text: string;
}> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept },
  });
  return {
    finalUrl: response.url || url,
    status: response.status,
    contentType: response.headers.get("content-type"),
    text: await readLimitedText(response, maxBytes),
  };
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

function acceptForAsset(asset: PublicSpaDeclaredAsset): string {
  if (asset.kind === "stylesheet") return "text/css,*/*;q=0.8";
  if (asset.kind === "manifest") return "application/manifest+json,application/json,*/*;q=0.8";
  return "application/javascript,text/javascript,text/css,*/*;q=0.8";
}

function countModuleScripts(html: string): number {
  return Array.from(html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*>/gi)).length;
}

function extractRootContainers(html: string): string[] {
  return uniqueStrings(
    Array.from(html.matchAll(/<(?:div|main|section)\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi))
      .map((match) => match[1])
      .filter((id) => /^(?:root|app|__next|svelte|mount|page)$/i.test(id)),
  ).slice(0, 8);
}

function extractTitle(html: string): string | null {
  return decodeHtmlText(html.match(/<title[^>]*>([\s\S]{0,240})<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "").slice(0, 160) || null;
}

function extractVisibleText(html: string): string {
  return decodeHtmlText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function readHtmlAttribute(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? null;
}

function addSignal(signals: PublicSpaSignal[], condition: boolean, signal: PublicSpaSignal): void {
  if (condition && signal.evidence.length > 0) signals.push(signal);
}

function previewEvidence(previews: PublicSpaAssetPreview[], pattern: RegExp): string[] {
  return previews
    .filter((preview) => pattern.test([preview.path, ...preview.signals, ...preview.referenced_assets].join(" ")))
    .slice(0, 5)
    .map((preview) => `${preview.path}: ${preview.signals.join(",") || "asset preview"}`);
}

function dedupeAssets(assets: PublicSpaDeclaredAsset[]): PublicSpaDeclaredAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.kind}:${asset.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

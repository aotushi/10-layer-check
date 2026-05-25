import type { LayerProbeContext } from "../core/probe-contract";
import type { SnapshotRecord } from "../core/types";
import type { PublicContentDetailPage, PublicContentDetailResult } from "../providers/public-content-detail/types";

export function createPublicContentDetailLayerRecords(
  context: LayerProbeContext,
  result: PublicContentDetailResult,
): SnapshotRecord[] {
  const usablePages = result.detail_pages.filter((page) => page.status_code !== null && !page.error);
  const productBusinessPages = usablePages.filter((page) =>
    ["business_overview", "product", "commercial", "technical_documentation", "news", "community"].includes(page.classification.controlled_hint)
    || page.evidence_snippets.length > 0,
  );
  const apiCompatibilityPages = usablePages.filter(hasApiCompatibilityEvidence);
  const detailKinds = uniqueStrings(usablePages.map((page) => page.detail_kind).filter((kind) => kind !== "unknown"));
  const labels = uniqueStrings(usablePages.map((page) => page.classification.label));
  const hints = uniqueStrings(usablePages.map((page) => page.classification.controlled_hint).filter((hint) => hint !== "unknown"));

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "public_content_detail_probe",
      layer: 4,
      item: "public_content_detail",
      probe_type: "active_request",
      source: result.source,
      status: usablePages.length > 0 ? "ok" : result.detail_pages.length > 0 ? "warning" : "skipped",
      value: {
        host: result.host,
        candidate_url_count: result.candidate_urls.length,
        collected_detail_page_count: usablePages.length,
        detail_kinds: detailKinds,
        classification_labels: labels,
        controlled_hints: hints,
        detail_pages: summarizeDetailPages(result.detail_pages),
        limits: result.limits,
        coverage: result.coverage,
      },
      risk: {
        level: "info",
        summary:
          usablePages.length > 0
            ? `Collected ${usablePages.length} bounded public content detail page(s): ${summarizePageTitles(usablePages)}.`
            : "No usable bounded public content detail pages were collected.",
      },
      evidence: [
        { type: "public_content_detail", name: "detail_pages", value: summarizeDetailPages(result.detail_pages) },
        { type: "limit", name: "public_content_detail_limits", value: result.limits },
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
      probe: "public_api_compatibility_detail_probe",
      layer: 6,
      item: "public_api_compatibility_detail",
      probe_type: "active_request",
      source: result.source,
      status: apiCompatibilityPages.length > 0 ? "ok" : "skipped",
      value: {
        host: result.host,
        snippet_count: apiCompatibilityPages.length,
        snippets: summarizeApiCompatibilitySnippets(apiCompatibilityPages),
        limits: result.limits,
        coverage: {
          collected: [
            "public_api_compatibility_docs",
            "public_base_url_docs",
            "public_model_protocol_docs",
            "public_api_reference_link_context",
          ],
          missing: [
            "authenticated_api_key_validation",
            "state_changing_api_calls",
            "complete_api_reference_corpus",
            "runtime_api_compatibility_execution",
          ],
          limitations: [
            ...result.coverage.limitations,
            "API compatibility details are public documentation evidence only; this provider does not execute API calls, use credentials, or validate live model behavior.",
          ],
        },
      },
      risk: {
        level: "info",
        summary:
          apiCompatibilityPages.length > 0
            ? `Collected public API compatibility detail snippets from ${apiCompatibilityPages.length} bounded page(s): ${summarizeApiCompatibilityHints(apiCompatibilityPages)}.`
            : "No public API compatibility detail snippets were collected.",
      },
      evidence: [
        { type: "public_api_compatibility_detail", name: "api_compatibility_snippets", value: summarizeApiCompatibilitySnippets(apiCompatibilityPages) },
        { type: "limit", name: "public_content_detail_limits", value: result.limits },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: [
          ...result.coverage.limitations,
          "Report synthesis may describe API compatibility only from collected public documentation snippets and must not treat it as live authenticated API validation.",
        ],
      },
      duration_ms: result.duration_ms,
    },
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "public_product_business_detail_probe",
      layer: 9,
      item: "public_product_business_detail",
      probe_type: "active_request",
      source: result.source,
      status: productBusinessPages.length > 0 ? "ok" : "skipped",
      value: {
        host: result.host,
        snippet_count: productBusinessPages.length,
        snippets: summarizeProductBusinessSnippets(productBusinessPages),
        detail_kinds: detailKinds,
        classification_labels: labels,
        controlled_hints: hints,
        limits: result.limits,
        coverage: {
          collected: ["public_docs_blog_product_business_detail_snippets", "public_link_context", "open_content_classification_hints"],
          missing: result.coverage.missing,
          limitations: result.coverage.limitations,
        },
      },
      risk: {
        level: "info",
        summary:
          productBusinessPages.length > 0
            ? `Collected public product/business detail snippets from ${productBusinessPages.length} bounded page(s): ${summarizeBusinessHints(productBusinessPages)}.`
            : "No public product/business detail snippets were collected.",
      },
      evidence: [
        { type: "public_product_business_detail", name: "product_business_detail_snippets", value: summarizeProductBusinessSnippets(productBusinessPages) },
        { type: "limit", name: "public_content_detail_limits", value: result.limits },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: [
          ...result.coverage.limitations,
          "AI may summarize product, business, or documentation signals only from these collected public snippets and must preserve uncertainty.",
        ],
      },
      duration_ms: result.duration_ms,
    },
  ];
}

function summarizeDetailPages(pages: PublicContentDetailPage[]) {
  return pages.map((page) => ({
    url: page.url,
    final_url: page.final_url,
    host: page.host,
    path: page.path,
    status_code: page.status_code,
    content_type: page.content_type,
    title: page.title,
    meta_description: page.meta_description,
    headings: page.headings.slice(0, 8),
    schema_types: page.schema_types,
    published_time: page.published_time,
    modified_time: page.modified_time,
    detail_kind: page.detail_kind,
    classification: page.classification,
    link_context: page.link_context,
    excerpt: page.excerpt,
    evidence_snippets: page.evidence_snippets,
    error: page.error,
  }));
}

function summarizeProductBusinessSnippets(pages: PublicContentDetailPage[]) {
  return pages.map((page) => ({
    url: page.final_url ?? page.url,
    host: page.host,
    path: page.path,
    title: page.title,
    detail_kind: page.detail_kind,
    label: page.classification.label,
    controlled_hint: page.classification.controlled_hint,
    confidence: page.classification.confidence,
    basis: page.classification.basis,
    headings: page.headings.slice(0, 5),
    meta_description: page.meta_description,
    snippets: page.evidence_snippets.slice(0, 6),
    excerpt: page.excerpt,
  }));
}

function summarizePageTitles(pages: PublicContentDetailPage[]): string {
  return pages
    .slice(0, 5)
    .map((page) => page.title || `${page.host}${page.path}`)
    .join("; ");
}

function summarizeBusinessHints(pages: PublicContentDetailPage[]): string {
  return uniqueStrings(
    pages.map((page) =>
      [page.detail_kind, page.classification.label, page.classification.controlled_hint, page.title].filter(Boolean).join(" / "),
    ),
  ).slice(0, 5).join("; ");
}

function summarizeApiCompatibilitySnippets(pages: PublicContentDetailPage[]) {
  return pages.map((page) => ({
    url: page.final_url ?? page.url,
    host: page.host,
    path: page.path,
    title: page.title,
    detail_kind: page.detail_kind,
    label: page.classification.label,
    controlled_hint: page.classification.controlled_hint,
    confidence: page.classification.confidence,
    basis: page.classification.basis,
    compatibility_signals: inferApiCompatibilitySignals(page),
    api_base_urls: extractApiBaseUrls(page),
    headings: page.headings.slice(0, 5),
    meta_description: page.meta_description,
    snippets: page.evidence_snippets.slice(0, 6),
    excerpt: page.excerpt,
  }));
}

function summarizeApiCompatibilityHints(pages: PublicContentDetailPage[]): string {
  return uniqueStrings(
    pages.map((page) =>
      [
        page.title || page.path,
        inferApiCompatibilitySignals(page).join(", "),
      ].filter(Boolean).join(" / "),
    ),
  ).slice(0, 5).join("; ");
}

function hasApiCompatibilityEvidence(page: PublicContentDetailPage): boolean {
  return inferApiCompatibilitySignals(page).length > 0;
}

function inferApiCompatibilitySignals(page: PublicContentDetailPage): string[] {
  const text = [
    page.url,
    page.final_url,
    page.path,
    page.title,
    page.meta_description,
    ...page.headings,
    ...(page.evidence_snippets ?? []),
    page.excerpt,
  ].filter(Boolean).join(" ").toLowerCase();
  const signals: string[] = [];
  if (/base[-_/ ]?url|接口地址/.test(text)) signals.push("base URL documentation");
  if (/\/v1\/chat\/completions|chat[-_/ ]?completions/.test(text)) {
    signals.push("OpenAI Chat Completions-compatible path (/v1/chat/completions)");
  }
  if (/\/v1\/responses|\bresponses\b/.test(text)) signals.push("OpenAI Responses-compatible path (/v1/responses)");
  if (/\/v1\/messages|\banthropic\b|\bmessages\b/.test(text)) {
    signals.push("Anthropic Messages-compatible surface (/v1/messages)");
  }
  if (/\bopenai\b|chatgpt|gpt-/.test(text)) signals.push("OpenAI-compatible model/API reference");
  if (/\bcompatib|兼容|差异说明/.test(text)) signals.push("compatibility/difference documentation");
  if (/model[-_/ ]?naming|模型命名|provider\/<base_model>|provider[-_/ ]?routing|模型厂商|路由/.test(text)) {
    signals.push("model naming/provider routing documentation");
  }
  if (/us-east|regional|api-eu|副接口|直连|无\s*cdn/.test(text)) signals.push("regional endpoint documentation");
  return uniqueStrings(signals).slice(0, 8);
}

function extractApiBaseUrls(page: PublicContentDetailPage): string[] {
  const text = [
    page.url,
    page.final_url,
    page.path,
    page.title,
    page.meta_description,
    ...page.headings,
    ...(page.evidence_snippets ?? []),
    page.excerpt,
  ].filter(Boolean).join(" ");
  const urls = Array.from(text.matchAll(/https?:\/\/[a-z0-9.-]*api[a-z0-9.-]*\.[a-z0-9.-]+(?::\d+)?\/?/gi))
    .map((match) => normalizeApiBaseUrl(match[0]))
    .filter((value): value is string => Boolean(value));
  return uniqueStrings(urls).slice(0, 6);
}

function normalizeApiBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/api/i.test(url.hostname)) return null;
    const path = url.pathname === "/" ? "/" : "";
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return null;
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

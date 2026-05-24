import type { ReportBrief } from "../../reporters/brief";

export type AiNarrativeReportSection = {
  id: string;
  title: string;
  content: string;
  evidence_refs: string[];
  missing_data_refs: string[];
  limitations: string[];
};

export type AiNarrativeReportContract = {
  schema_version: "site-10-layer-ai-narrative-report-contract/v0.1";
  invokes_provider: false;
  target: string;
  normalized_target: string;
  input: {
    brief: ReportBrief;
    instruction: string;
  };
  output_contract: {
    required_fields: ["sections", "markdown"];
    citation_rules: string[];
    section_ids: string[];
    markdown_rules: string[];
    style_rules: string[];
    section_guidance: Array<{
      id: string;
      title: string;
      focus: string;
      boundary: string;
      evidence_ref_hints: string[];
      missing_data_ref_hints: string[];
      fact_hints: string[];
    }>;
    required_section_ids: string[];
  };
};

export type AiNarrativeReportResult = {
  ok: true;
  schema_version: "site-10-layer-ai-narrative-report-result/v0.1";
  provider: "worker_ai_narrative_report";
  invokes_provider: true;
  target: string;
  normalized_target: string;
  sections: AiNarrativeReportSection[];
  markdown: string;
};

export type AiNarrativeReportValidation =
  | { ok: true; result: AiNarrativeReportResult }
  | { ok: false; error: string; validation_errors: string[] };

export const AI_NARRATIVE_REPORT_SECTION_IDS = [
  "summary",
  "public_information_architecture",
  "technology_stack",
  "deployment_network_surface",
  "request_rendering_chain",
  "api_protocol_surface",
  "subdomain_attack_surface",
  "organization_operations",
  "security_posture",
  "missing_data_next_steps",
] as const;

export const AI_NARRATIVE_REPORT_SECTION_GUIDANCE = [
  {
    id: "summary",
    title: "Executive Summary",
    focus: "State the strongest evidence-backed conclusion, coverage, and top risks.",
    boundary: "Do not infer business model or ownership from technical evidence alone.",
  },
  {
    id: "public_information_architecture",
    title: "Public Information Architecture",
    focus: "Summarize visible routes, robots/sitemap signals, page/resource shape, subdomain candidates, and high-level public host/endpoint map.",
    boundary: "Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths. Do not place CORS, cookie, API error-surface, or CMS metadata details here; use the API, Technology, Subdomain, or Security sections.",
  },
  {
    id: "technology_stack",
    title: "Technology Stack",
    focus: "Combine frontend, app fingerprint, resource, runtime, and public application metadata clues into technology candidates, including WordPress, Discourse, Mintlify, and wp-json when directly observed.",
    boundary: "Static and heuristic technology evidence is candidate evidence unless directly corroborated.",
  },
  {
    id: "deployment_network_surface",
    title: "Deployment and Network Surface",
    focus: "Combine DNS, CDN/header, TLS, HTTP, cache, and performance evidence.",
    boundary: "Do not claim full origin topology or CDN coverage from headers alone.",
  },
  {
    id: "request_rendering_chain",
    title: "Request and Rendering Chain",
    focus: "Explain the observed request path from DNS/HTTP response through browser runtime resources and API calls.",
    boundary: "Worker fetch and one browser run do not represent every user route or session state.",
  },
  {
    id: "api_protocol_surface",
    title: "API and Protocol Surface",
    focus: "Summarize API-like requests, protocol/header clues, bounded CORS observations, public API endpoint checks, error surfaces, and skipped reachability boundaries.",
    boundary: "Do not infer authenticated API behavior, billing, or backend business logic.",
  },
  {
    id: "subdomain_attack_surface",
    title: "Subdomains and Attack Surface",
    focus: "Summarize CT-discovered subdomains, bounded reachability, public host role hints, and service fingerprint hints. Keep CMS details brief unless they explain a host role.",
    boundary: "This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.",
  },
  {
    id: "organization_operations",
    title: "Organization and Operations Signals",
    focus: "Summarize RDAP, MX/TXT, homepage social/related-domain candidates, and Wayback evidence.",
    boundary: "Registration and historical evidence do not prove current operator or legal ownership.",
  },
  {
    id: "security_posture",
    title: "Security Posture",
    focus: "Summarize security headers, iframe policy, mixed content, leakage, runtime console/page errors, bounded CORS/cookie observations, and risk wording.",
    boundary: "Report missing controls as risk signals, not confirmed exploitability without authorized testing.",
  },
  {
    id: "missing_data_next_steps",
    title: "Missing Data and Next Steps",
    focus: "Group remaining gaps by add_provider, requires_permission, manual_review, requires_user_input, and out_of_scope.",
    boundary: "Do not present missing data as collected evidence.",
  },
] as const;

export function createAiNarrativeReportContract(brief: ReportBrief): AiNarrativeReportContract {
  const sectionGuidance = createSectionGuidance(brief);

  return {
    schema_version: "site-10-layer-ai-narrative-report-contract/v0.1",
    invokes_provider: false,
    target: brief.target,
    normalized_target: brief.normalized_target,
    input: {
      brief,
      instruction:
        "Write a poixe-style technical site analysis report from the supplied ReportBrief. Do not write one section per raw layer; merge evidence into topical sections from output_contract.section_guidance. Cite only evidence_refs and missing_data_refs present in the input. Keep unsupported ownership, business-model, related-domain, and vulnerability conclusions provisional or mark them as missing/manual review.",
    },
    output_contract: {
      required_fields: ["sections", "markdown"],
      citation_rules: [
        "Every non-summary section must include at least one evidence_ref or missing_data_ref.",
        "Use evidence_refs from input.brief.evidence_index[].id only.",
        "Use missing_data_refs from input.brief.missing_data[].id only.",
        "Do not create new evidence ids, URLs, dates, owners, technologies, or vulnerabilities not present in the brief.",
        "Markdown citations should use bracketed refs such as [E001] and [M001].",
      ],
      section_ids: [...AI_NARRATIVE_REPORT_SECTION_IDS],
      markdown_rules: [
        "Markdown must start with one H1 title.",
        "Markdown must use H2 sections that correspond to output_contract.section_ids.",
        "Markdown must cite bracketed evidence or missing-data refs for factual claims.",
        "Markdown must not include unsupported ownership, business-model, vulnerability, or related-domain conclusions.",
      ],
      style_rules: [
        "Do not output one section per raw layer.",
        "Synthesize multiple evidence records into topical conclusions.",
        "Prefer concise prose plus compact evidence references over long evidence tables.",
        "Mention limitations near the claim they constrain.",
        "Use each section_guidance item evidence_ref_hints as the primary refs for that section.",
        "Use each section_guidance item fact_hints as concrete facts before writing generic layer-count prose.",
        "Keep CORS, Access-Control, public API endpoint, and API error-surface facts in API and Security sections, not Public Information Architecture.",
        "Keep WordPress, Discourse, Mintlify, wp-json, and public application metadata facts in Technology Stack or Subdomains sections, not Public Information Architecture.",
      ],
      section_guidance: sectionGuidance,
      required_section_ids: sectionGuidance
        .filter((section) => section.id === "summary" || section.evidence_ref_hints.length > 0 || section.missing_data_ref_hints.length > 0)
        .map((section) => section.id),
    },
  };
}

export function validateAiNarrativeReportResult(
  contract: AiNarrativeReportContract,
  value: AiNarrativeReportResult,
): AiNarrativeReportValidation {
  const errors: string[] = [];
  const evidenceRefs = new Set(contract.input.brief.evidence_index.map((item) => item.id));
  const missingDataRefs = new Set(contract.input.brief.missing_data.map((item) => item.id));

  if (value.schema_version !== "site-10-layer-ai-narrative-report-result/v0.1") {
    errors.push("Result schema_version must be site-10-layer-ai-narrative-report-result/v0.1.");
  }
  if (value.provider !== "worker_ai_narrative_report") {
    errors.push("Result provider must be worker_ai_narrative_report.");
  }
  if (value.invokes_provider !== true) {
    errors.push("Result must mark invokes_provider=true.");
  }
  if (value.target !== contract.target || value.normalized_target !== contract.normalized_target) {
    errors.push("Result target fields must match the input contract.");
  }
  if (!value.markdown.trim()) {
    errors.push("Result markdown must be non-empty.");
  }
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    errors.push("Result sections must be a non-empty array.");
  }

  const allowedSectionIds = new Set(contract.output_contract.section_ids);
  const requiredSectionIds = new Set(contract.output_contract.required_section_ids ?? []);
  const seenSectionIds = new Set<string>();

  for (const [index, section] of value.sections.entries()) {
    if (!section.id) errors.push(`sections[${index}].id is required.`);
    if (!section.title) errors.push(`sections[${index}].title is required.`);
    if (!section.content) errors.push(`sections[${index}].content is required.`);
    if (section.id && !allowedSectionIds.has(section.id)) {
      errors.push(`sections[${index}].id ${section.id} is not in output_contract.section_ids.`);
    }
    if (section.id && seenSectionIds.has(section.id)) {
      errors.push(`sections[${index}].id ${section.id} is duplicated.`);
    }
    if (section.id) seenSectionIds.add(section.id);

    const refs = Array.isArray(section.evidence_refs) ? section.evidence_refs : [];
    const missingRefs = Array.isArray(section.missing_data_refs) ? section.missing_data_refs : [];
    if (section.id !== "summary" && refs.length === 0 && missingRefs.length === 0) {
      errors.push(`sections[${index}] must cite evidence_refs or missing_data_refs.`);
    }

    for (const ref of refs) {
      if (!evidenceRefs.has(ref)) errors.push(`sections[${index}] cites unknown evidence_ref ${ref}.`);
    }
    for (const ref of missingRefs) {
      if (!missingDataRefs.has(ref)) errors.push(`sections[${index}] cites unknown missing_data_ref ${ref}.`);
    }
  }

  for (const sectionId of requiredSectionIds) {
    if (!seenSectionIds.has(sectionId)) {
      errors.push(`Required section id ${sectionId} is missing.`);
    }
  }

  for (const ref of extractBracketRefs(value.markdown, "E")) {
    if (!evidenceRefs.has(ref)) errors.push(`markdown cites unknown evidence_ref ${ref}.`);
  }
  for (const ref of extractBracketRefs(value.markdown, "M")) {
    if (!missingDataRefs.has(ref)) errors.push(`markdown cites unknown missing_data_ref ${ref}.`);
  }
  if (!value.markdown.trim().startsWith("# ")) {
    errors.push("Result markdown must start with a single H1 title.");
  }

  if (errors.length > 0) return { ok: false, error: "AI narrative report output failed validation.", validation_errors: errors };
  return { ok: true, result: value };
}

function createSectionGuidance(brief: ReportBrief): AiNarrativeReportContract["output_contract"]["section_guidance"] {
  return AI_NARRATIVE_REPORT_SECTION_GUIDANCE.map((section) => {
    const evidenceRefs = selectEvidenceRefHints(brief, section.id);
    const missingDataRefs = selectMissingDataRefHints(brief, section.id);
    return {
      ...section,
      evidence_ref_hints: evidenceRefs,
      missing_data_ref_hints: missingDataRefs,
      fact_hints: selectFactHints(brief, section.id, evidenceRefs, missingDataRefs),
    };
  });
}

function selectFactHints(brief: ReportBrief, sectionId: string, evidenceRefs: string[], missingDataRefs: string[]): string[] {
  const evidenceFacts = evidenceRefs
    .map((ref) => brief.evidence_index.find((item) => item.id === ref))
    .filter((item): item is ReportBrief["evidence_index"][number] => Boolean(item))
    .map(createEvidenceFactHint);
  const missingFacts = missingDataRefs
    .map((ref) => brief.missing_data.find((item) => item.id === ref))
    .filter((item): item is ReportBrief["missing_data"][number] => Boolean(item))
    .map((item) => `Missing data: ${item.description} (${item.classification}).`);

  return prioritizeFactHints(sectionId, uniqueStrings([...evidenceFacts, ...missingFacts])).slice(0, 12);
}

function createEvidenceFactHint(item: ReportBrief["evidence_index"][number]): string {
  if (item.probe === "public_product_business_detail_probe") {
    return createPublicProductBusinessDetailFactHint(item);
  }

  const evidenceItems = item.evidence_items
    .slice(0, 4)
    .map(formatEvidenceItemFact)
    .filter(Boolean);
  const evidenceSuffix = evidenceItems.length > 0 ? ` Evidence: ${evidenceItems.join("; ")}.` : "";
  const prefix = createEvidenceFactPrefix(item);
  return truncateFactHint(`${prefix}${normalizeFactText(item.summary)}${evidenceSuffix}`);
}

function createPublicProductBusinessDetailFactHint(item: ReportBrief["evidence_index"][number]): string {
  const pages = uniqueStrings([
    ...extractStructuredEvidencePages(item.evidence_items)
      .map(formatPublicDetailPageEvidenceLabel)
      .filter(Boolean),
    ...extractDetailPageLabelsFromSummary(item.summary),
  ]);
  const operations = extractBusinessOperationLabels([...pages, item.summary]);
  const operationText = operations.length > 0
    ? ` Observed operation topics: ${operations.join(", ")}.`
    : "";
  const pageText = pages.length > 0
    ? ` Evidence pages: ${pages.slice(0, 6).join("; ")}${pages.length > 6 ? `; +${pages.length - 6} more` : ""}.`
    : "";
  return truncateFactHint(`Public product/business detail: ${normalizeFactText(item.summary)}${operationText}${pageText}`);
}

function extractDetailPageLabelsFromSummary(value: string): string[] {
  const match = value.match(/page\(s\):\s*([\s\S]+)$/i);
  if (!match?.[1]) return [];
  return match[1]
    .replace(/\.$/, "")
    .split(";")
    .map((item) => item.trim())
    .map((item) => item.split(/\s+\/\s+/).pop() ?? item)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function extractStructuredEvidencePages(
  evidenceItems: ReportBrief["evidence_index"][number]["evidence_items"],
): Record<string, unknown>[] {
  const pages: Record<string, unknown>[] = [];

  for (const evidence of evidenceItems) {
    const parsed = parseJsonValue(evidence.value.trim());
    if (!parsed.ok || !Array.isArray(parsed.value)) continue;
    for (const item of parsed.value) {
      if (!isRecord(item)) continue;
      if (!("detail_kind" in item) && !("evidence_snippets" in item) && !("snippets" in item)) continue;
      pages.push(item);
    }
  }

  return pages;
}

function formatPublicDetailPageEvidenceLabel(value: Record<string, unknown>): string {
  const title = stringField(value, "title") ?? stringField(value, "label") ?? stringField(value, "path");
  const path = stringField(value, "path");
  const hint = stringField(value, "controlled_hint");
  const detailKind = stringField(value, "detail_kind");
  const snippets = formatSnippetList(value.evidence_snippets ?? value.snippets)
    .replace(/^snippets=/, "")
    .replace(/\s+\+\d+ more$/, "");
  const prefix = [detailKind, hint].filter(Boolean).join("/");
  const location = path && title !== path ? `(${path})` : "";
  const snippetText = snippets ? ` - ${truncateFactValue(snippets)}` : "";
  return [prefix, title, location].filter(Boolean).join(" ").trim() + snippetText;
}

function extractBusinessOperationLabels(values: string[]): string[] {
  const text = values.join(" ").toLowerCase();
  const labels: string[] = [];
  if (/supplier|vendor|onboarding|入驻/.test(text)) labels.push("supplier/vendor onboarding");
  if (/payout|withdraw|withdrawal|提现|settlement/.test(text)) labels.push("payouts/withdrawals");
  if (/routing|provider|厂商|路由/.test(text)) labels.push("provider routing");
  if (/about|platform|关于|平台/.test(text)) labels.push("platform overview");
  if (/cost|成本|降/.test(text)) labels.push("cost reduction content");
  if (/product|products|商品|产品/.test(text)) labels.push("vendor/product pages");
  return uniqueStrings(labels).slice(0, 6);
}

function createEvidenceFactPrefix(item: ReportBrief["evidence_index"][number]): string {
  const prefixes: Record<string, string> = {
    subdomain_attack_surface_probe: "Subdomain/reachability matrix: ",
    bounded_cors_header_validation_probe: "Bounded public CORS check: ",
    bounded_public_api_error_surface_probe: "Bounded public API check: ",
    bounded_public_api_endpoint_inventory_probe: "Bounded public API endpoint inventory: ",
    bounded_public_metadata_probe: "Bounded public metadata check: ",
    bounded_public_app_header_metadata_probe: "Bounded public app header metadata: ",
    public_content_surface_probe: "Public content surface map: ",
    public_business_content_probe: "Public business/product content: ",
    public_content_detail_probe: "Public content detail map: ",
    public_product_business_detail_probe: "Public product/business detail: ",
    public_spa_asset_metadata_probe: "Public SPA asset metadata: ",
    public_spa_route_metadata_probe: "Public SPA route metadata: ",
    bounded_cookie_attribute_observation_probe: "Bounded public cookie check: ",
  };
  return prefixes[item.probe] ?? "";
}

function prioritizeFactHints(sectionId: string, values: string[]): string[] {
  return [...values].sort((left, right) => scoreFactHint(sectionId, right) - scoreFactHint(sectionId, left));
}

function scoreFactHint(sectionId: string, value: string): number {
  const normalized = value.toLowerCase();
  let score = 0;

  if (sectionId === "security_posture") {
    if (/cookie/.test(normalized)) score += 80;
    if (/cors|cross-origin|access-control/.test(normalized)) score += 80;
    if (/bounded public|public security|set-cookie|request[_ -]?id|wp-login/.test(normalized)) score += 70;
    if (/content-security-policy|strict-transport-security|x-frame-options|permissions-policy/.test(normalized)) score += 60;
    if (/mixed content|leakage|console error|failed request/.test(normalized)) score += 40;
  }

  if (sectionId === "organization_operations") {
    if (/public product\/business detail|public business\/product content|business\/product text|public content detail|public content|content surface|product|pricing|platform|solution|documentation|detail snippets/.test(normalized)) score += 85;
    if (/larksuite|onlarksuite|mx\d|spf|txt=/.test(normalized)) score += 80;
    if (/rdap|whois|namesilo|registrar/.test(normalized)) score += 60;
    if (/wayback|archive/.test(normalized)) score += 50;
  }

  if (sectionId === "public_information_architecture") {
    if (/subdomain\/reachability matrix|subdomains=|https_reachability=| host\(s\)/.test(normalized)) score += 80;
    if (/public host|docs|api|blog|community|status|role hint/.test(normalized)) score += 70;
    if (/public content detail|detail page|public content surface|content surface|homepage|heading|meta_description|classification/.test(normalized)) score += 75;
    if (/public spa route metadata|route-like string|route candidate|component\/page-like|client routing/.test(normalized)) score += 85;
    if (/robots|sitemap|rendered-page|browser runtime loaded|scripts|stylesheets|images/.test(normalized)) score += 55;
    if (/cors|cross-origin|access-control|set-cookie|cookie|wordpress|discourse|mintlify|wp-json/.test(normalized)) score -= 200;
  }

  if (sectionId === "subdomain_attack_surface") {
    if (/subdomain\/reachability matrix|subdomains=|https_reachability=| host\(s\)/.test(normalized)) score += 80;
    if (/service fingerprint|checked_hosts|fingerprint/.test(normalized)) score += 50;
    if (/public host|docs|api|blog|community|status|role hint/.test(normalized)) score += 70;
  }

  if (sectionId === "technology_stack") {
    if (/mintlify|wordpress|discourse|wp-json|public app marker|app header metadata|wordpress_public_metadata|discourse_header|mintlify_header|vercel|next_rsc|llms|timezone|namespace/.test(normalized)) score += 90;
    if (/public spa asset metadata|react|vite|csr|bundle|chunk|code splitting|frontend_framework|build_tool|rendering_mode/.test(normalized)) score += 95;
  }

  if (sectionId === "api_protocol_surface") {
    if (/bounded public api|api endpoint inventory|api_error|request[_ -]?id|\/health|\/v1\/models|cors|access-control/.test(normalized)) score += 90;
  }

  if (sectionId === "missing_data_next_steps") {
    if (/missing data:/.test(normalized)) score += 80;
  }

  return score;
}

function formatEvidenceItemFact(evidence: ReportBrief["evidence_index"][number]["evidence_items"][number]): string {
  const label = normalizeFactLabel(evidence.name ?? evidence.type);
  const value = formatEvidenceValue(evidence.value);
  return [label, value].filter(Boolean).join("=");
}

function formatEvidenceValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const parsed = parseJsonValue(trimmed);
  const formatted = parsed.ok ? formatStructuredEvidenceValue(parsed.value) : formatScalarEvidenceValue(trimmed);
  return truncateFactValue(formatted);
}

function formatStructuredEvidenceValue(value: unknown): string {
  if (Array.isArray(value)) return formatEvidenceArray(value);
  if (isRecord(value)) return formatEvidenceObject(value);
  return formatScalarEvidenceValue(String(value));
}

function formatEvidenceArray(value: unknown[]): string {
  if (value.length === 0) return "none";

  const detailLabels = value
    .slice(0, 5)
    .map(formatPublicDetailPageEvidenceLabelIfPresent)
    .filter(Boolean);
  if (detailLabels.length > 0) {
    const suffix = value.length > detailLabels.length ? ` (+${value.length - detailLabels.length} more)` : "";
    return `${value.length} detail page(s): ${detailLabels.join("; ")}${suffix}`;
  }

  const metadataLabels = value
    .slice(0, 3)
    .map(formatPublicMetadataArrayItemLabel)
    .filter(Boolean);
  if (metadataLabels.length > 0) {
    const suffix = value.length > metadataLabels.length ? ` (+${value.length - metadataLabels.length} more)` : "";
    return `${value.length} item(s): ${metadataLabels.join(", ")}${suffix}`;
  }

  const labels = value
    .slice(0, 3)
    .map(formatEvidenceArrayItemLabel)
    .filter(Boolean);
  const suffix = value.length > labels.length ? ` (+${value.length - labels.length} more)` : "";

  if (labels.length === 0) return `${value.length} item(s)`;
  return `${value.length} item(s): ${labels.join(", ")}${suffix}`;
}

function formatPublicDetailPageEvidenceLabelIfPresent(value: unknown): string {
  if (!isRecord(value)) return "";
  if (!("detail_kind" in value) && !("evidence_snippets" in value) && !("snippets" in value)) return "";
  return formatPublicDetailPageEvidenceLabel(value);
}

function formatPublicMetadataArrayItemLabel(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.parsed)) return "";

  const host = stringField(value, "host");
  const path = stringField(value, "path");
  const method = stringField(value, "method");
  const status = stringOrNumberField(value, "status_code") ?? stringOrNumberField(value, "https_status_code");
  const parsed = formatPrimaryParsedEvidencePair(value.parsed);

  if (!parsed) return "";
  return [host, path, method, status ? `status ${status}` : null, parsed].filter(Boolean).join(" ");
}

function formatPrimaryParsedEvidencePair(value: Record<string, unknown>): string {
  const keys = [
    "wordpress_name",
    "wordpress_timezone",
    "wordpress_namespaces",
    "wordpress_test_cookie",
    "x_discourse_route",
    "x_discourse_cached",
    "x_mintlify_client_version",
    "x_mint_proxy_version",
  ];

  for (const key of keys) {
    if (!(key in value)) continue;
    const formatted = formatNestedEvidenceScalar(value[key]);
    if (formatted) return `${normalizeFactLabel(key)}=${formatted}`;
  }

  return "";
}

function formatEvidenceArrayItemLabel(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return formatScalarEvidenceValue(String(value));
  }

  if (!isRecord(value)) return "";

  const host = stringField(value, "host");
  const method = stringField(value, "method");
  const path = stringField(value, "path");
  const kind = stringField(value, "kind");
  const data = stringField(value, "data");
  const title = stringField(value, "title");
  const label = stringField(value, "label") ?? stringField(value, "name") ?? stringField(value, "id");
  const category = stringField(value, "category");
  const controlledHint = stringField(value, "controlled_hint");
  const detailKind = stringField(value, "detail_kind");
  const confidence = stringField(value, "confidence");
  const routeCandidate = stringField(value, "route_candidate");
  const componentCandidate = stringField(value, "component_candidate");
  const sourceAsset = stringField(value, "source_asset");
  const marker = stringField(value, "marker");
  const status = stringOrNumberField(value, "status_code") ?? stringOrNumberField(value, "https_status_code");
  const server = stringField(value, "server");
  const issuer = stringField(value, "issuer_friendly_name") ?? stringField(value, "issuer_name");
  const date = stringField(value, "date") ?? stringField(value, "not_after") ?? stringField(value, "valid_to");
  const valueText = stringOrNumberField(value, "value");
  const rating = stringField(value, "rating");
  const excerpt = stringField(value, "excerpt") ?? stringField(value, "visible_text_excerpt") ?? stringField(value, "meta_description");
  const snippets = formatSnippetList(value.snippets ?? value.evidence_snippets);
  const signals = formatSignalList(value.signals);
  const parsed = isRecord(value.parsed) ? formatParsedEvidenceSummary(value.parsed) : formatParsedEvidenceSummary(value);

  if (routeCandidate) return [routeCandidate, sourceAsset ? `from ${sourceAsset}` : null, confidence].filter(Boolean).join(" ");
  if (componentCandidate) return [componentCandidate, sourceAsset ? `from ${sourceAsset}` : null, confidence].filter(Boolean).join(" ");
  if (data) return data;
  if (detailKind || snippets) return [detailKind, label, controlledHint, title, snippets || excerpt].filter(Boolean).join(" ");
  if (host && (path || kind || method || signals || parsed)) {
    return [
      host,
      path ?? null,
      method ?? kind ?? null,
      status ? `status ${status}` : null,
      signals,
      parsed,
    ].filter(Boolean).join(" ");
  }
  if (marker) return [marker, host ? `on ${host}` : null, status ? `status ${status}` : null].filter(Boolean).join(" ");
  if (label && (controlledHint || excerpt)) return [label, controlledHint, title, excerpt].filter(Boolean).join(" ");
  if (label && category) return [label, host ? `on ${host}` : null, category, confidence].filter(Boolean).join(" ");
  if (host) return [host, status ? `status ${status}` : null, title, server].filter(Boolean).join(" ");
  if (label && valueText) return [label, valueText, rating].filter(Boolean).join(" ");
  if (label) return [label, status ? `status ${status}` : null].filter(Boolean).join(" ");
  if (issuer) return [issuer, date ? `until ${date}` : null].filter(Boolean).join(" ");
  if (date) return date;
  return "";
}

function formatSignalList(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const signals = value
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .map((item) => item.replace(/_/g, " "))
    .slice(0, 3);
  if (signals.length === 0) return "";
  const suffix = value.length > signals.length ? ` +${value.length - signals.length} more` : "";
  return `signals=${signals.join("/")}${suffix}`;
}

function formatSnippetList(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const snippets = value
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .slice(0, 2);
  if (snippets.length === 0) return "";
  const suffix = value.length > snippets.length ? ` +${value.length - snippets.length} more` : "";
  return `snippets=${snippets.join(" | ")}${suffix}`;
}

function formatParsedEvidenceSummary(value: Record<string, unknown>): string {
  const parts: string[] = [];
  const keys = [
    "wordpress_name",
    "wordpress_description",
    "wordpress_timezone",
    "wordpress_gmt_offset",
    "wordpress_namespaces",
    "wordpress_test_cookie",
    "x_discourse_route",
    "x_discourse_cached",
    "x_mint_proxy_version",
    "x_mintlify_client_version",
    "discourse_route",
    "discourse_cached",
    "discourse_runtime",
    "mint_proxy_version",
    "mintlify_client_version",
    "vercel_cache",
    "vercel_id",
    "vercel_served_version",
    "vercel_project_id",
    "next_rsc_vary",
    "llms_txt_link",
    "wordpress_asset_versions",
    "controlled_hint",
    "detail_kind",
    "label",
    "excerpt",
    "snippets",
    "evidence_snippets",
    "route_candidate",
    "source_asset",
    "signals",
    "referenced_assets",
    "rendering_assessment",
    "detected_signals",
  ];

  for (const key of keys) {
    if (!(key in value)) continue;
    const formatted = formatNestedEvidenceScalar(value[key]);
    if (formatted) parts.push(`${normalizeFactLabel(key)}=${formatted}`);
    if (parts.length >= 4) break;
  }

  return parts.length > 0 ? parts.join(",") : "";
}

function formatEvidenceObject(value: Record<string, unknown>): string {
  const preferredKeys = [
    "url",
    "reachable",
    "status_code",
    "final_url",
    "content_type",
    "server",
    "title",
    "issuer_friendly_name",
    "issuer_name",
    "valid_to",
    "not_after",
    "days_until_expiry",
    "registrar",
    "provider",
    "status",
    "certificate_count",
    "error",
  ];
  const parts: string[] = [];

  for (const key of preferredKeys) {
    if (!(key in value)) continue;
    const formatted = formatNestedEvidenceScalar(value[key]);
    if (formatted) parts.push(`${normalizeFactLabel(key)}=${formatted}`);
    if (parts.length >= 5) break;
  }

  if (parts.length === 0) {
    for (const [key, child] of Object.entries(value)) {
      const formatted = formatNestedEvidenceScalar(child);
      if (!formatted) continue;
      parts.push(`${normalizeFactLabel(key)}=${formatted}`);
      if (parts.length >= 4) break;
    }
  }

  return parts.length > 0 ? parts.join(", ") : `${Object.keys(value).length} field(s)`;
}

function formatNestedEvidenceScalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return formatScalarEvidenceValue(String(value));
  }
  if (Array.isArray(value)) return formatEvidenceArray(value);
  if (isRecord(value)) {
    const label = formatEvidenceArrayItemLabel(value);
    return label || `${Object.keys(value).length} field(s)`;
  }
  return "";
}

function formatScalarEvidenceValue(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (/^[\[{]/.test(normalized)) return summarizeJsonLikeEvidenceText(normalized);
  if (/^https?:\/\//i.test(normalized)) return compactUrl(normalized);
  return normalized;
}

function summarizeJsonLikeEvidenceText(value: string): string {
  const objectCount = Math.max(0, value.match(/\{/g)?.length ?? 0);
  const hosts = extractJsonLikeStrings(value, "host");
  const labels = extractJsonLikeStrings(value, "label");
  const routeCandidates = extractJsonLikeStrings(value, "route_candidate");
  const componentCandidates = extractJsonLikeStrings(value, "component_candidate");
  const ids = extractJsonLikeStrings(value, "id");
  const names = extractJsonLikeStrings(value, "name");
  const ratings = extractJsonLikeStrings(value, "rating");
  const issuers = extractJsonLikeStrings(value, "issuer_friendly_name");
  const paths = extractJsonLikeStrings(value, "path");
  const wordpressNames = extractJsonLikeStrings(value, "wordpress_name");
  const wordpressTimezones = extractJsonLikeStrings(value, "wordpress_timezone");
  const discourseRoutes = extractJsonLikeStrings(value, "x_discourse_route");
  const mintlifyVersions = extractJsonLikeStrings(value, "x_mintlify_client_version");
  const wordpressCookies = extractJsonLikeStrings(value, "wordpress_test_cookie");
  const dnsNames = extractJsonLikeArrayStrings(value, "dns_names");
  const statusCodes = extractJsonLikeNumbers(value, "status_code");

  const publicMetadata = [
    ...wordpressNames.map((item) => `wordpress_name=${item}`),
    ...wordpressTimezones.map((item) => `wordpress_timezone=${item}`),
    ...discourseRoutes.map((item) => `x_discourse_route=${item}`),
    ...mintlifyVersions.map((item) => `x_mintlify_client_version=${item}`),
    ...wordpressCookies.map((item) => `wordpress_test_cookie=${item}`),
  ];
  if (publicMetadata.length > 0) return formatJsonLikeList("metadata", publicMetadata, objectCount || publicMetadata.length);

  if (routeCandidates.length > 0) {
    const sourceAssets = extractJsonLikeStrings(value, "source_asset");
    return formatJsonLikeList(
      "route candidate",
      routeCandidates.map((candidate, index) =>
        [candidate, sourceAssets[index] ? `from ${sourceAssets[index]}` : null].filter(Boolean).join(" "),
      ),
      objectCount || routeCandidates.length,
    );
  }

  if (componentCandidates.length > 0) {
    const sourceAssets = extractJsonLikeStrings(value, "source_asset");
    return formatJsonLikeList(
      "component candidate",
      componentCandidates.map((candidate, index) =>
        [candidate, sourceAssets[index] ? `from ${sourceAssets[index]}` : null].filter(Boolean).join(" "),
      ),
      objectCount || componentCandidates.length,
    );
  }

  if (paths.length > 0) {
    return formatJsonLikeList(
      "endpoint",
      paths.map((path, index) =>
        [hosts[index], path, statusCodes[index] ? `status ${statusCodes[index]}` : null].filter(Boolean).join(" "),
      ),
      objectCount || paths.length,
    );
  }

  if (hosts.length > 0) {
    return formatJsonLikeList(
      "host",
      hosts.map((host, index) =>
        [host, paths[index], statusCodes[index] ? `status ${statusCodes[index]}` : null].filter(Boolean).join(" "),
      ),
    );
  }
  if (issuers.length > 0) {
    const label = [issuers[0], dnsNames[0] ? `for ${dnsNames[0]}` : null].filter(Boolean).join(" ");
    return formatJsonLikeList("certificate", [label], objectCount);
  }
  if (labels.length > 0 || ids.length > 0) {
    const metricLabels = (labels.length > 0 ? labels : ids).map((label, index) =>
      [label, ratings[index]].filter(Boolean).join(" "),
    );
    return formatJsonLikeList("item", metricLabels, objectCount);
  }
  if (names.length > 0) return formatJsonLikeList("item", names, objectCount);
  if (statusCodes.length > 0) return formatJsonLikeList("status", statusCodes, objectCount);

  return objectCount > 0 ? `structured ${objectCount} item(s)` : "structured value";
}

function formatJsonLikeList(kind: string, values: string[], count = values.length): string {
  const unique = uniqueStrings(values.filter(Boolean)).slice(0, 3);
  const suffix = count > unique.length ? ` (+${count - unique.length} more)` : "";
  return `${count || unique.length} ${kind}(s): ${unique.join(", ")}${suffix}`;
}

function extractJsonLikeStrings(value: string, key: string): string[] {
  return Array.from(value.matchAll(new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"([^"]+)"`, "g"))).map((match) => match[1]);
}

function extractJsonLikeNumbers(value: string, key: string): string[] {
  return Array.from(value.matchAll(new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "g"))).map((match) => match[1]);
}

function extractJsonLikeArrayStrings(value: string, key: string): string[] {
  const arrayMatch = value.match(new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*\\[([^\\]]*)\\]`));
  if (!arrayMatch?.[1]) return [];
  return Array.from(arrayMatch[1].matchAll(/"([^"]+)"/g)).map((match) => match[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "/" : url.pathname;
    const query = url.search ? "?..." : "";
    return `${url.origin}${path}${query}`;
  } catch {
    return value;
  }
}

function normalizeFactText(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function normalizeFactLabel(value: string): string {
  return value.replace(/\s+/g, "_").trim();
}

function parseJsonValue(value: string): { ok: true; value: unknown } | { ok: false } {
  if (!/^[\[{"]/.test(value) && !/^(true|false|null|-?\d)/.test(value)) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function stringOrNumberField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  if (typeof field === "string" && field.length > 0) return field;
  if (typeof field === "number" && Number.isFinite(field)) return String(field);
  return null;
}

function truncateFactHint(value: string): string {
  return value.length > 600 ? `${value.slice(0, 597).trimEnd()}...` : value;
}

function truncateFactValue(value: string): string {
  return value.length > 180 ? `${value.slice(0, 177).trimEnd()}...` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function selectEvidenceRefHints(brief: ReportBrief, sectionId: string): string[] {
  if (sectionId === "summary") return selectSummaryEvidenceRefs(brief);

  const spec = SECTION_EVIDENCE_SELECTION[sectionId] ?? {};
  const scored = brief.evidence_index.map((item, index) => ({
    id: item.id,
    index,
    score: scoreEvidenceForSection(item, spec),
  }));

  return scored
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 12)
    .map((item) => item.id);
}

function selectSummaryEvidenceRefs(brief: ReportBrief): string[] {
  const riskRefs = brief.risks
    .flatMap((risk) => risk.evidence_refs)
    .filter((ref) => {
      const evidence = brief.evidence_index.find((item) => item.id === ref);
      return evidence ? !SUMMARY_DETAIL_PROBES.has(evidence.probe) : true;
    });
  const warningRefs = brief.evidence_index
    .filter((item) => item.status === "warning" || item.status === "error")
    .filter((item) => !SUMMARY_DETAIL_PROBES.has(item.probe))
    .map((item) => item.id);
  const firstLayerRefs = brief.layers.flatMap((layer) => layer.evidence_refs.slice(0, 1));
  return uniqueStrings([...riskRefs, ...warningRefs, ...firstLayerRefs]).slice(0, 10);
}

const SUMMARY_DETAIL_PROBES = new Set([
  "bounded_cors_header_validation_probe",
  "bounded_public_api_error_surface_probe",
  "bounded_public_api_endpoint_inventory_probe",
  "bounded_public_metadata_probe",
  "bounded_public_app_header_metadata_probe",
  "public_content_surface_probe",
  "public_business_content_probe",
  "public_content_detail_probe",
  "public_product_business_detail_probe",
  "public_spa_asset_metadata_probe",
  "public_spa_route_metadata_probe",
  "bounded_cookie_attribute_observation_probe",
]);

function selectMissingDataRefHints(brief: ReportBrief, sectionId: string): string[] {
  if (sectionId === "summary") return brief.missing_data.slice(0, 4).map((item) => item.id);
  if (sectionId === "missing_data_next_steps") return brief.missing_data.slice(0, 12).map((item) => item.id);

  const layers = SECTION_EVIDENCE_SELECTION[sectionId]?.layers ?? [];
  return brief.missing_data
    .filter((item) => layers.includes(item.layer))
    .slice(0, 8)
    .map((item) => item.id);
}

function scoreEvidenceForSection(
  item: ReportBrief["evidence_index"][number],
  spec: {
    layers?: number[];
    probes?: string[];
    items?: string[];
    sources?: string[];
  },
): number {
  let score = 0;
  if (spec.layers?.includes(item.layer)) score += 4;
  if (spec.probes?.includes(item.probe)) score += 8;
  if (spec.items?.some((value) => item.item.includes(value))) score += 3;
  if (spec.sources?.some((value) => item.source.includes(value))) score += 2;
  if (score > 0 && (item.status === "warning" || item.status === "error")) score += 2;
  return score;
}

const SECTION_EVIDENCE_SELECTION: Record<
  string,
  {
    layers?: number[];
    probes?: string[];
    items?: string[];
    sources?: string[];
  }
> = {
  public_information_architecture: {
    layers: [4, 7],
    probes: [
      "robots_sitemap_probe",
      "frontend_assets_probe",
      "browser_page_probe",
      "runtime_resource_summary_probe",
      "api_endpoint_probe",
      "subdomain_attack_surface_probe",
      "public_host_fingerprint_probe",
      "public_content_surface_probe",
      "public_content_detail_probe",
      "public_spa_route_metadata_probe",
    ],
    items: ["robots", "sitemap", "asset", "route", "endpoint", "subdomain", "public_host", "public_content", "public_spa"],
  },
  technology_stack: {
    layers: [4, 8],
    probes: [
      "frontend_technology_probe",
      "app_fingerprint_probe",
      "frontend_assets_probe",
      "third_party_scripts_probe",
      "runtime_third_party_resources_probe",
      "browser_page_probe",
      "public_app_marker_probe",
      "bounded_public_metadata_probe",
      "bounded_public_app_header_metadata_probe",
      "public_spa_asset_metadata_probe",
    ],
    items: ["technology", "fingerprint", "frontend", "asset", "script", "third_party", "public_app", "bounded_public_metadata", "bounded_public_app_header_metadata", "public_spa"],
  },
  deployment_network_surface: {
    layers: [1, 2, 3, 5],
    probes: [
      "network_infrastructure_probe",
      "cdn_header_evidence_probe",
      "tls_certificate_probe",
      "tls_live_certificate_probe",
      "http_headers_probe",
      "cache_policy_probe",
      "runtime_asset_cache_policy_probe",
      "performance_probe",
      "basic_performance_probe",
    ],
    items: ["dns", "cdn", "tls", "certificate", "headers", "cache", "performance"],
  },
  request_rendering_chain: {
    layers: [3, 4, 5, 6],
    probes: [
      "http_headers_probe",
      "browser_page_probe",
      "browser_runtime_page_probe",
      "runtime_resource_waterfall_probe",
      "runtime_resource_bytes_probe",
      "runtime_resource_summary_probe",
      "runtime_api_requests_probe",
    ],
    items: ["runtime", "waterfall", "resource", "bytes", "api"],
    sources: ["github-actions-browser"],
  },
  api_protocol_surface: {
    layers: [6],
    probes: [
      "api_reachability_probe",
      "api_endpoint_probe",
      "api_error_surface_probe",
      "api_protocol_probe",
      "runtime_api_requests_probe",
      "bounded_cors_header_validation_probe",
      "bounded_public_api_error_surface_probe",
      "bounded_public_api_endpoint_inventory_probe",
    ],
    items: ["api", "protocol", "endpoint", "error", "cors", "bounded_public_api"],
  },
  subdomain_attack_surface: {
    layers: [7],
    probes: ["subdomain_attack_surface_probe", "service_fingerprint_probe", "public_host_fingerprint_probe"],
    items: ["subdomain", "service", "fingerprint", "public_host"],
  },
  organization_operations: {
    layers: [9],
    probes: [
      "organization_intelligence_probe",
      "rdap_whois_lite_probe",
      "wayback_history_probe",
      "related_domain_confirmation_probe",
      "public_business_content_probe",
      "public_product_business_detail_probe",
    ],
    items: ["rdap", "whois", "mx", "txt", "wayback", "related", "organization", "business", "public_content", "product_business"],
  },
  security_posture: {
    layers: [10],
    probes: [
      "security_headers_probe",
      "iframe_embedding_probe",
      "mixed_content_probe",
      "leakage_signal_probe",
      "runtime_security_events_probe",
      "cookie_security_probe",
      "cors_policy_probe",
      "bounded_cors_header_validation_probe",
      "bounded_cookie_attribute_observation_probe",
    ],
    items: ["security", "headers", "iframe", "mixed_content", "leakage", "cookie", "cors"],
  },
};

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractBracketRefs(value: string, prefix: "E" | "M"): string[] {
  return Array.from(value.matchAll(new RegExp(`\\[(${prefix}\\d{3})\\]`, "g"))).map((match) => match[1]);
}

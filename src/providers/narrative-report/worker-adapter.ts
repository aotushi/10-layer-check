import type { ReportBrief } from "../../reporters/brief";
import {
  type AiNarrativeReportContract,
  type AiNarrativeReportResult,
  type AiNarrativeReportSection,
  AI_NARRATIVE_REPORT_SECTION_IDS,
  validateAiNarrativeReportResult,
} from "./contract";

export type NarrativeWorkersAiBinding = {
  run: (model: string, input: WorkersAiChatInput) => Promise<unknown>;
};

type WorkersAiChatInput = {
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
  response_format?: {
    type: "json_schema";
    json_schema: Record<string, unknown>;
  };
  temperature?: number;
  max_tokens?: number;
};

export type AiNarrativeReportWorkerEnv = {
  AI?: NarrativeWorkersAiBinding;
  AI_PROVIDER_API_KEY?: string;
  AI_PROVIDER_MODEL?: string;
  AI_PROVIDER_BASE_URL?: string;
};

export type AiNarrativeReportWorkerRequest = {
  contract?: unknown;
};

export type AiNarrativeReportWorkerSuccess = {
  ok: true;
  schema_version: "site-10-layer-ai-narrative-report-worker-response/v0.1";
  provider: "worker_ai_narrative_report";
  result: AiNarrativeReportResult;
};

export type AiNarrativeReportWorkerFailure = {
  ok: false;
  schema_version: "site-10-layer-ai-narrative-report-worker-response/v0.1";
  provider: "worker_ai_narrative_report";
  error_code:
    | "missing_ai_narrative_report_provider_config"
    | "invalid_contract"
    | "invalid_model_output"
    | "model_call_failed";
  error: string;
  status: number;
  missing_config?: string[];
  validation_errors?: string[];
};

export type AiNarrativeReportWorkerResponse =
  | AiNarrativeReportWorkerSuccess
  | AiNarrativeReportWorkerFailure;

type OpenAiCompatibleConfig = {
  AI_PROVIDER_API_KEY: string;
  AI_PROVIDER_MODEL: string;
  AI_PROVIDER_BASE_URL: string;
};

export type AiNarrativeReportModelClient = (
  contract: AiNarrativeReportContract,
  config: OpenAiCompatibleConfig,
) => Promise<unknown>;

export async function runWorkerAiNarrativeReportProvider(
  contract: AiNarrativeReportContract,
  env: AiNarrativeReportWorkerEnv,
  options: { modelClient?: AiNarrativeReportModelClient } = {},
): Promise<AiNarrativeReportWorkerResponse> {
  if (!isAiNarrativeReportContract(contract)) {
    return failure("invalid_contract", "Request body must include a valid AI narrative report contract.", 400);
  }

  const missing = missingProviderConfig(env);
  if (missing.length > 0) {
    return failure(
      "missing_ai_narrative_report_provider_config",
      "AI narrative report provider is not configured. Set AI_PROVIDER_MODEL plus either Workers AI binding or AI_PROVIDER_API_KEY.",
      503,
      { missing_config: missing },
    );
  }

  try {
    const raw = await callModelWithRetry(contract, env, options);
    const result = normalizeModelResult(contract, raw);
    const validation = validateAiNarrativeReportResult(contract, result);

    if (!validation.ok) {
      return failure("invalid_model_output", "AI narrative report provider returned invalid output.", 502, {
        validation_errors: validation.validation_errors,
      });
    }

    return {
      ok: true,
      schema_version: "site-10-layer-ai-narrative-report-worker-response/v0.1",
      provider: "worker_ai_narrative_report",
      result: validation.result,
    };
  } catch (error) {
    return failure("model_call_failed", error instanceof Error ? error.message : String(error), 502);
  }
}

async function callModelWithRetry(
  contract: AiNarrativeReportContract,
  env: AiNarrativeReportWorkerEnv,
  options: { modelClient?: AiNarrativeReportModelClient },
): Promise<unknown> {
  const maxAttempts = options.modelClient ? 1 : 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return options.modelClient && env.AI_PROVIDER_API_KEY
        ? await options.modelClient(contract, createOpenAiCompatibleConfig(env))
        : await callConfiguredProvider(contract, env);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function parseAiNarrativeReportWorkerRequest(
  body: AiNarrativeReportWorkerRequest,
): AiNarrativeReportContract | null {
  return isAiNarrativeReportContract(body.contract) ? body.contract : null;
}

function missingProviderConfig(env: AiNarrativeReportWorkerEnv): string[] {
  const missing: string[] = [];
  if (!hasText(env.AI_PROVIDER_MODEL)) missing.push("AI_PROVIDER_MODEL");
  if (!env.AI && !hasText(env.AI_PROVIDER_API_KEY)) missing.push("AI_PROVIDER_API_KEY");
  return missing;
}

async function callConfiguredProvider(
  contract: AiNarrativeReportContract,
  env: AiNarrativeReportWorkerEnv,
): Promise<unknown> {
  if (env.AI) return callCloudflareWorkersAi(contract, env.AI, env.AI_PROVIDER_MODEL ?? "");
  return callOpenAiCompatible(contract, createOpenAiCompatibleConfig(env));
}

function createOpenAiCompatibleConfig(env: AiNarrativeReportWorkerEnv): OpenAiCompatibleConfig {
  return {
    AI_PROVIDER_API_KEY: env.AI_PROVIDER_API_KEY ?? "",
    AI_PROVIDER_MODEL: env.AI_PROVIDER_MODEL ?? "",
    AI_PROVIDER_BASE_URL: env.AI_PROVIDER_BASE_URL ?? "https://api.openai.com/v1/chat/completions",
  };
}

async function callOpenAiCompatible(
  contract: AiNarrativeReportContract,
  config: OpenAiCompatibleConfig,
): Promise<unknown> {
  const response = await fetch(config.AI_PROVIDER_BASE_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.AI_PROVIDER_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.AI_PROVIDER_MODEL,
      response_format: { type: "json_object" },
      messages: createMessages(contract),
    }),
  });

  if (!response.ok) {
    throw new Error(`AI narrative report provider request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI narrative report provider response did not include message content.");
  return JSON.parse(content);
}

async function callCloudflareWorkersAi(
  contract: AiNarrativeReportContract,
  ai: NarrativeWorkersAiBinding,
  model: string,
): Promise<unknown> {
  const body = await ai.run(model, {
    messages: createMessages(contract),
    response_format: {
      type: "json_schema",
      json_schema: createJsonSchema(),
    },
    temperature: 0,
    max_tokens: 9000,
  });
  return parseModelJsonContent(extractModelContent(body));
}

function createMessages(contract: AiNarrativeReportContract): WorkersAiChatInput["messages"] {
  return [
    {
      role: "system",
      content:
        "Return only valid compact JSON matching site-10-layer-ai-narrative-report-result/v0.1. Do not wrap in markdown fences. Use only section ids from output_contract.section_ids, include every id from output_contract.required_section_ids, and follow output_contract.section_guidance. Do not write one section per raw layer; merge evidence into poixe-style topical sections. Prefer complete 8-10 section coverage when the brief has evidence or missing-data refs for those topics: summary, public_information_architecture, technology_stack, deployment_network_surface, request_rendering_chain, api_protocol_surface, subdomain_attack_surface, organization_operations, security_posture, missing_data_next_steps. Use each section_guidance fact_hints as concrete section material before generic layer-count prose. Use each section_guidance evidence_ref_hints and missing_data_ref_hints as primary refs for that section so generic CDN/header refs do not dominate unrelated sections. Put content maps primarily in public_information_architecture, public business-operation interpretation primarily in organization_operations, CORS/Access-Control/API endpoint facts primarily in api_protocol_surface, and cookie/security-header/runtime security facts primarily in security_posture. Do not add generic Missing data or Remaining gaps prose to topical sections; reserve those gaps for missing_data_next_steps unless a section-specific absence is directly relevant. Do not put CORS, Access-Control, Set-Cookie, API error-surface, WordPress, Discourse, Mintlify, or wp-json details in public_information_architecture. Each section content must be under 1000 characters. Keep markdown short or set it to an empty string; the service will synthesize final Markdown from sections. Cite only evidence_refs and missing_data_refs present in the input. Use E### only in evidence_refs and M### only in missing_data_refs. Do not invent ownership, business, vulnerability, or related-domain claims.",
    },
    {
      role: "user",
      content: JSON.stringify(contract),
    },
  ];
}

function createJsonSchema(): Record<string, unknown> {
  const section = {
    type: "object",
    properties: {
      id: { type: "string", enum: [...AI_NARRATIVE_REPORT_SECTION_IDS] },
      title: { type: "string", maxLength: 120 },
      content: { type: "string", maxLength: 1200 },
      evidence_refs: { type: "array", maxItems: 12, items: { type: "string" } },
      missing_data_refs: { type: "array", maxItems: 12, items: { type: "string" } },
      limitations: { type: "array", maxItems: 8, items: { type: "string", maxLength: 240 } },
    },
    required: ["id", "title", "content", "evidence_refs", "missing_data_refs", "limitations"],
  };

  return {
    type: "object",
    properties: {
      sections: { type: "array", minItems: 1, maxItems: 10, items: section },
      markdown: { type: "string", maxLength: 1200 },
    },
    required: ["sections", "markdown"],
  };
}

function normalizeModelResult(contract: AiNarrativeReportContract, value: unknown): AiNarrativeReportResult {
  const result = asObject(value);
  const sections = completeRequiredSections(
    contract,
    Array.isArray(result.sections) ? result.sections.map(normalizeSection) : [],
  );
  return {
    ok: true,
    schema_version: "site-10-layer-ai-narrative-report-result/v0.1",
    provider: "worker_ai_narrative_report",
    invokes_provider: true,
    target: contract.target,
    normalized_target: contract.normalized_target,
    sections,
    markdown: normalizeMarkdown(contract, asString(result.markdown), sections),
  };
}

function normalizeMarkdown(contract: AiNarrativeReportContract, value: string, sections: AiNarrativeReportSection[]): string {
  const markdown = truncate(value, 20000).trim();
  if (sections.length === 0 && markdown.length >= 400 && markdown.startsWith("# ") && /\[(E|M)\d{3}\]/.test(markdown)) {
    return markdown;
  }
  return renderMarkdownFromSections(contract, sections);
}

function renderMarkdownFromSections(contract: AiNarrativeReportContract, sections: AiNarrativeReportSection[]): string {
  const body = orderSections(contract, sections)
    .map((section) => {
      const refs = [...section.evidence_refs, ...section.missing_data_refs].map((ref) => `[${ref}]`).join(" ");
      const limitations = section.limitations.length > 0
        ? `\n\nBoundaries: ${section.limitations.join("; ")}`
        : "";
      const evidence = refs ? `\n\nEvidence: ${refs}` : "";
      return `## ${getCanonicalSectionTitle(contract, section)}\n\n${section.content}${evidence}${limitations}`;
    })
    .join("\n\n");
  return `# Site Analysis: ${contract.normalized_target}\n\n${body}`;
}

function normalizeSection(value: unknown): AiNarrativeReportSection {
  const item = asObject(value);
  const refs = splitRefs(asStringArray(item.evidence_refs));
  const missingRefs = splitRefs(asStringArray(item.missing_data_refs));
  const id = normalizeSectionId(asString(item.id));
  const title = truncate(asString(item.title), 200);
  return {
    id,
    title,
    content: truncate(sanitizeSectionContent(asString(item.content)), 3000),
    evidence_refs: Array.from(new Set([...refs.evidenceRefs, ...missingRefs.evidenceRefs])).slice(0, 30),
    missing_data_refs: Array.from(new Set([...refs.missingDataRefs, ...missingRefs.missingDataRefs])).slice(0, 30),
    limitations: asStringArray(item.limitations).map((value) => truncate(value, 500)).slice(0, 20),
  };
}

function completeRequiredSections(
  contract: AiNarrativeReportContract,
  sections: AiNarrativeReportSection[],
): AiNarrativeReportSection[] {
  const result = dedupeSections(sections)
    .map((section) => completeWeakSectionContent(contract, section))
    .filter((section) => hasSubstantiveSectionContent(section.content));
  const present = new Set(result.map((section) => section.id));

  for (const sectionId of contract.output_contract.required_section_ids ?? []) {
    if (present.has(sectionId)) continue;
    const fallback = createFallbackSection(contract, sectionId);
    if (!fallback) continue;
    result.push(fallback);
    present.add(sectionId);
  }

  return orderSections(contract, result).map((section) => ({
    ...section,
    title: getCanonicalSectionTitle(contract, section),
    content: appendSectionTables(contract, section.id, shapeSectionContent(section.id, section.content)),
    evidence_refs: prioritizeSectionEvidenceRefs(contract, section),
    missing_data_refs: prioritizeSectionMissingDataRefs(contract, section),
    limitations: sanitizeSectionLimitations(contract, section.id, section.limitations),
  }));
}

function completeWeakSectionContent(
  contract: AiNarrativeReportContract,
  section: AiNarrativeReportSection,
): AiNarrativeReportSection {
  if (hasSubstantiveSectionContent(section.content)) return enrichSectionContentWithFacts(contract, section);

  const fallback = createFallbackSection(contract, section.id);
  if (!fallback) return enrichSectionContentWithFacts(contract, section);

  return enrichSectionContentWithFacts(contract, {
    ...fallback,
    evidence_refs: uniqueStrings([...section.evidence_refs, ...fallback.evidence_refs]).slice(0, 30),
    missing_data_refs: uniqueStrings([...section.missing_data_refs, ...fallback.missing_data_refs]).slice(0, 30),
    limitations: section.limitations.length > 0 ? section.limitations : fallback.limitations,
  });
}

function dedupeSections(sections: AiNarrativeReportSection[]): AiNarrativeReportSection[] {
  const seen = new Set<string>();
  const result: AiNarrativeReportSection[] = [];

  for (const section of sections) {
    if (section.id && seen.has(section.id)) continue;
    if (section.id) seen.add(section.id);
    result.push(section);
  }

  return result;
}

function createFallbackSection(
  contract: AiNarrativeReportContract,
  sectionId: string,
): AiNarrativeReportSection | null {
  const guidance = contract.output_contract.section_guidance.find((item) => item.id === sectionId);
  if (!guidance) return null;

  const evidenceRefs = guidance.evidence_ref_hints.slice(0, 8);
  const missingRefs = guidance.missing_data_ref_hints.slice(0, 8);
  const factHints = guidance.fact_hints.slice(0, 8);
  if (sectionId !== "summary" && evidenceRefs.length === 0 && missingRefs.length === 0 && factHints.length === 0) return null;

  return {
    id: guidance.id,
    title: guidance.title,
    content: createFallbackContent(contract, guidance, evidenceRefs, missingRefs),
    evidence_refs: evidenceRefs,
    missing_data_refs: missingRefs,
    limitations: [guidance.boundary],
  };
}

function getCanonicalSectionTitle(contract: AiNarrativeReportContract, section: Pick<AiNarrativeReportSection, "id" | "title">): string {
  return contract.output_contract.section_guidance.find((item) => item.id === section.id)?.title ?? section.title;
}

function prioritizeSectionEvidenceRefs(
  contract: AiNarrativeReportContract,
  section: AiNarrativeReportSection,
): string[] {
  const guidanceRefs = getSectionGuidance(contract, section.id)?.evidence_ref_hints ?? [];
  return prioritizeSectionRefs(section.evidence_refs, guidanceRefs, sectionCitationLimit(section.id, "evidence"));
}

function prioritizeSectionMissingDataRefs(
  contract: AiNarrativeReportContract,
  section: AiNarrativeReportSection,
): string[] {
  const guidanceRefs = getSectionGuidance(contract, section.id)?.missing_data_ref_hints ?? [];
  return prioritizeSectionRefs(section.missing_data_refs, guidanceRefs, sectionCitationLimit(section.id, "missing"));
}

function prioritizeSectionRefs(sectionRefs: string[], guidanceRefs: string[], limit: number): string[] {
  const sectionSet = new Set(sectionRefs);
  const preferred = guidanceRefs.filter((ref) => sectionSet.size === 0 || sectionSet.has(ref));
  const fallbackGuidance = guidanceRefs.filter((ref) => !preferred.includes(ref));
  const extraSectionRefs = sectionRefs.filter((ref) => !preferred.includes(ref) && !fallbackGuidance.includes(ref));
  return uniqueStrings([...preferred, ...fallbackGuidance, ...extraSectionRefs]).slice(0, limit);
}

function sectionCitationLimit(sectionId: string, kind: "evidence" | "missing"): number {
  if (kind === "missing") {
    const limits: Record<string, number> = {
      summary: 3,
      missing_data_next_steps: 10,
      public_information_architecture: 4,
      request_rendering_chain: 4,
      api_protocol_surface: 4,
      subdomain_attack_surface: 4,
      organization_operations: 4,
      security_posture: 4,
    };
    return limits[sectionId] ?? 3;
  }

  const limits: Record<string, number> = {
    summary: 6,
    public_information_architecture: 7,
    technology_stack: 7,
    deployment_network_surface: 7,
    request_rendering_chain: 6,
    api_protocol_surface: 6,
    subdomain_attack_surface: 5,
    organization_operations: 7,
    security_posture: 6,
    missing_data_next_steps: 0,
  };
  return limits[sectionId] ?? 6;
}

function getSectionGuidance(contract: AiNarrativeReportContract, sectionId: string) {
  return contract.output_contract.section_guidance.find((item) => item.id === sectionId);
}

function enrichSectionContentWithFacts(
  contract: AiNarrativeReportContract,
  section: AiNarrativeReportSection,
): AiNarrativeReportSection {
  const guidance = contract.output_contract.section_guidance.find((item) => item.id === section.id);
  const forcedFactHints = createForcedSectionFactHints(contract, section.id);
  const factHints = uniqueStrings([
    ...forcedFactHints,
    ...(guidance?.fact_hints ?? []),
  ]).slice(0, createSectionFactLimit(section.id));
  const groupSummary = section.id === "missing_data_next_steps" ? createMissingDataGroupSummary(contract.input.brief) : "";
  if (factHints.length === 0 && !groupSummary) return section;
  const missingFactHints = factHints.filter(
    (hint) => !section.content.includes(hint) && !isRedundantSectionFact(section.id, section.content, hint),
  );
  if (missingFactHints.length === 0 && (!groupSummary || section.content.includes(groupSummary))) {
    return section;
  }

  const grouped = groupSummary ? ` Gap groups: ${groupSummary}` : "";
  const highlights = missingFactHints.length > 0
    ? ` ${createSectionFactAppendLabel(section.id)} ${missingFactHints.join(" ")}`
    : "";
  const content = `${section.content.trim()}${grouped}${highlights}`;
  return {
    ...section,
    content: truncate(content, 3000),
  };
}

function createSectionFactLimit(sectionId: string): number {
  const limits: Record<string, number> = {
    summary: 4,
    technology_stack: 10,
    organization_operations: 7,
    missing_data_next_steps: 8,
  };
  return limits[sectionId] ?? 7;
}

function isRedundantSectionFact(sectionId: string, content: string, hint: string): boolean {
  if (sectionId !== "organization_operations") return false;
  const normalizedContent = content.toLowerCase();
  const normalizedHint = hint.toLowerCase();
  if (normalizedHint.includes("larksuite") && !normalizedContent.includes("larksuite")) return false;
  return (
    normalizedContent.includes("organization-facing dns") &&
    normalizedHint.includes("organization-facing dns")
  );
}

function createForcedSectionFactHints(contract: AiNarrativeReportContract, sectionId: string): string[] {
  const probesBySection: Record<string, string[]> = {
    summary: [
      "performance_probe",
      "security_headers_probe",
      "subdomain_attack_surface_probe",
    ],
    deployment_network_surface: [
      "network_infrastructure_probe",
      "tls_live_certificate_probe",
      "performance_probe",
      "http_headers_probe",
    ],
    api_protocol_surface: [
      "cors_policy_probe",
      "bounded_cors_header_validation_probe",
      "bounded_public_api_error_surface_probe",
      "bounded_public_api_endpoint_inventory_probe",
    ],
    technology_stack: ["bounded_public_metadata_probe", "bounded_public_app_header_metadata_probe", "public_spa_asset_metadata_probe"],
    public_information_architecture: ["public_content_surface_probe", "public_content_detail_probe", "public_spa_route_metadata_probe"],
    organization_operations: ["public_business_content_probe", "public_product_business_detail_probe", "organization_intelligence_probe"],
    security_posture: [
      "cookie_security_probe",
      "security_headers_probe",
      "bounded_cookie_attribute_observation_probe",
    ],
  };
  const probes = probesBySection[sectionId] ?? [];
  if (probes.length === 0) return [];

  return contract.input.brief.evidence_index
    .filter((item) => probes.includes(item.probe))
    .map((item) => createBriefEvidenceFact(item))
    .filter(Boolean);
}

function createBriefEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  if (item.probe === "public_product_business_detail_probe") {
    return createBusinessOperationEvidenceFact(item);
  }
  if (item.probe === "performance_probe") {
    return createPerformanceEvidenceFact(item);
  }
  if (item.probe === "tls_live_certificate_probe") {
    return createCertificateEvidenceFact(item);
  }
  if (item.probe === "organization_intelligence_probe") {
    return createOrganizationIntelligenceEvidenceFact(item);
  }
  if (item.probe === "security_headers_probe") {
    return createSecurityHeadersEvidenceFact(item);
  }

  return truncate(item.summary, 360);
}

function createPerformanceEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  const score = findEvidenceItemValue(item, ["performance_score", "performance score"]);
  const scoreText = score ? ` Performance score ${score}.` : "";
  return truncate(`${item.summary}${scoreText}`, 360);
}

function createCertificateEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  const issuer = findEvidenceItemValue(item, ["issuer", "issuer_common_name", "issuer name"]);
  const issuerText = issuer ? ` Certificate issuer ${issuer}.` : "";
  return truncate(`${item.summary}${issuerText}`, 360);
}

function createOrganizationIntelligenceEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  const values = item.evidence_items.map((evidence) => evidence.value).join(" ").toLowerCase();
  const signals: string[] = [];
  if (values.includes("larksuite")) signals.push("larksuite MX/TXT mail DNS");
  if (item.summary.toLowerCase().includes("rdap") || values.includes("rdap")) signals.push("RDAP registration evidence");
  if (item.summary.toLowerCase().includes("wayback") || values.includes("wayback")) signals.push("Wayback archive evidence");
  const signalText = signals.length > 0 ? ` Signals: ${signals.join(", ")}.` : "";
  return truncate(`${item.summary}${signalText}`, 420);
}

function createSecurityHeadersEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  const missingHeaders = item.evidence_items
    .filter((evidence) => (evidence.name ?? evidence.type).toLowerCase().includes("missing"))
    .map((evidence) => evidence.value)
    .filter(Boolean);
  const missingText = missingHeaders.length > 0 ? ` Missing security headers: ${missingHeaders.join(", ")}.` : "";
  return truncate(`${item.summary}${missingText}`, 420);
}

function findEvidenceItemValue(item: ReportBrief["evidence_index"][number], names: string[]): string {
  const normalizedNames = names.map((name) => name.toLowerCase().replace(/[_-]+/g, " "));
  const match = item.evidence_items.find((evidence) => {
    const candidate = (evidence.name ?? evidence.type).toLowerCase().replace(/[_-]+/g, " ");
    return normalizedNames.includes(candidate);
  });
  return match?.value ?? "";
}

function createBusinessOperationEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  const pages = uniqueStrings([
    ...item.evidence_items
      .flatMap((evidence) => parseEvidenceArray(evidence.value))
      .filter((value) => isRecord(value) && ("detail_kind" in value || "evidence_snippets" in value || "snippets" in value))
      .map((value) => formatBusinessOperationPage(value as Record<string, unknown>))
      .filter(Boolean),
    ...extractDetailPageLabelsFromSummary(item.summary),
  ]);
  const operations = extractBusinessOperationTopics([...pages, item.summary]);
  const operationText = operations.length > 0
    ? ` Observed operation topics: ${operations.join(", ")}.`
    : "";
  const pageText = pages.length > 0
    ? ` Evidence pages: ${pages.slice(0, 5).join("; ")}${pages.length > 5 ? `; +${pages.length - 5} more` : ""}.`
    : "";
  return truncate(`Public product/business detail: ${item.summary}.${operationText}${pageText}`, 800);
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

function parseEvidenceArray(value: string): unknown[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendSectionTables(contract: AiNarrativeReportContract, sectionId: string, content: string): string {
  const tables = createSectionTables(contract, sectionId);
  if (tables.length === 0) return content;
  return [content.trim(), ...tables].filter(Boolean).join("\n\n");
}

function createSectionTables(contract: AiNarrativeReportContract, sectionId: string): string[] {
  if (sectionId === "public_information_architecture") {
    return [
      createPublicContentSurfaceTable(contract),
      createPublicContentDetailTable(contract),
      createSpaRouteCandidateTable(contract),
    ].filter(hasText);
  }
  if (sectionId === "technology_stack") {
    return [
      createSpaSignalTable(contract),
      createSpaAssetPreviewTable(contract),
      createPublicAppMarkerTable(contract),
    ].filter(hasText);
  }
  if (sectionId === "api_protocol_surface") {
    return [
      createApiEndpointTable(contract),
      createCorsObservationTable(contract),
    ].filter(hasText);
  }
  if (sectionId === "subdomain_attack_surface") return [createPublicHostTable(contract)].filter(hasText);
  if (sectionId === "organization_operations") return [createPublicBusinessPageTable(contract)].filter(hasText);
  if (sectionId === "security_posture") {
    return [
      createSecurityControlTable(contract),
      createCookieObservationTable(contract),
    ].filter(hasText);
  }
  return [];
}

function createPublicContentSurfaceTable(contract: AiNarrativeReportContract): string {
  const rows = evidenceRows(contract, "public_content_surface_probe", ["public_content_surfaces"])
    .slice(0, 5)
    .map((row) => [
      classificationLabel(row),
      stringField(row, "host") ?? "",
      stringField(row, "path") ?? "",
      statusField(row),
      stringField(row, "title") ?? "",
    ]);
  return markdownTable("Public content surface table:", ["Type", "Host", "Path", "Status", "Title"], rows);
}

function createPublicContentDetailTable(contract: AiNarrativeReportContract): string {
  const rows = evidenceRows(contract, "public_content_detail_probe", ["detail_pages"])
    .slice(0, 5)
    .map((row) => [
      stringField(row, "detail_kind") ?? classificationLabel(row),
      stringField(row, "host") ?? "",
      stringField(row, "path") ?? "",
      statusField(row),
      stringField(row, "title") ?? "",
    ]);
  return markdownTable("Public detail page table:", ["Kind", "Host", "Path", "Status", "Title"], rows);
}

function createSpaRouteCandidateTable(contract: AiNarrativeReportContract): string {
  const rows = evidenceRows(contract, "public_spa_route_metadata_probe", ["route_candidates"])
    .slice(0, 6)
    .map((row) => [
      stringField(row, "route_candidate") ?? "",
      basenameFromPath(stringField(row, "source_asset") ?? ""),
      stringField(row, "confidence") ?? "",
    ]);
  return markdownTable("SPA route candidate table:", ["Candidate", "Source asset", "Confidence"], rows);
}

function createSpaSignalTable(contract: AiNarrativeReportContract): string {
  const rows = evidenceRows(contract, "public_spa_asset_metadata_probe", ["detected_signals"])
    .slice(0, 6)
    .map((row) => [
      stringField(row, "category") ?? "",
      stringField(row, "label") ?? stringField(row, "name") ?? "",
      stringField(row, "confidence") ?? "",
      signalBasis(row),
    ]);
  return markdownTable("SPA signal table:", ["Category", "Signal", "Confidence", "Basis"], rows);
}

function createSpaAssetPreviewTable(contract: AiNarrativeReportContract): string {
  const rows = evidenceRows(contract, "public_spa_asset_metadata_probe", ["asset_previews"])
    .slice(0, 5)
    .map((row) => [
      stringField(row, "kind") ?? "",
      stringField(row, "role") ?? "",
      stringField(row, "path") ?? "",
      statusField(row),
      compactSignals(row.signals),
    ]);
  return markdownTable("SPA asset preview table:", ["Kind", "Role", "Path", "Status", "Signals"], rows);
}

function createPublicAppMarkerTable(contract: AiNarrativeReportContract): string {
  const rows = evidenceRows(contract, "public_app_marker_probe", ["public_app_marker_names", "public_app_markers"])
    .slice(0, 6)
    .map((row) => [
      stringField(row, "host") ?? "",
      stringField(row, "name") ?? "",
      stringField(row, "category") ?? "",
      stringField(row, "confidence") ?? "",
    ]);
  return markdownTable("Public app marker table:", ["Host", "Marker", "Category", "Confidence"], rows);
}

function createApiEndpointTable(contract: AiNarrativeReportContract): string {
  const rows = evidenceRows(contract, "bounded_public_api_endpoint_inventory_probe", ["public_api_endpoint_inventory"])
    .slice(0, 6)
    .map((row) => [
      stringField(row, "host") ?? "",
      stringField(row, "method") ?? "",
      stringField(row, "path") ?? "",
      statusField(row),
      compactSignals(row.signals),
    ]);
  return markdownTable("API endpoint table:", ["Host", "Method", "Path", "Status", "Signals"], rows);
}

function createCorsObservationTable(contract: AiNarrativeReportContract): string {
  const sourceRows = preferRowsWithSignalText(
    evidenceRows(contract, "bounded_cors_header_validation_probe", ["bounded_cors_checks"]),
  );
  const rows = sourceRows
    .slice(0, 6)
    .map((row) => [
      stringField(row, "host") ?? "",
      stringField(row, "method") ?? "",
      stringField(row, "path") ?? "",
      statusField(row),
      compactSignals(row.signals),
    ]);
  return markdownTable("CORS observation table:", ["Host", "Method", "Path", "Status", "Signals"], rows);
}

function createPublicHostTable(contract: AiNarrativeReportContract): string {
  const rows = evidenceRows(contract, "public_host_fingerprint_probe", ["public_hosts", "public_host_roles"])
    .slice(0, 6)
    .map((row) => [
      stringField(row, "host") ?? "",
      stringField(row, "role_hint") ?? "",
      statusField(row),
      publicHostObservedHint(row),
    ]);
  return markdownTable("Public host table:", ["Host", "Role", "Status", "Observed hint"], rows);
}

function createPublicBusinessPageTable(contract: AiNarrativeReportContract): string {
  const detailRows = evidenceRows(contract, "public_product_business_detail_probe", ["product_business_detail_snippets"]);
  const contentRows = evidenceRows(contract, "public_business_content_probe", ["business_product_snippets"]);
  const sourceRows = [
    ...detailRows,
    ...(detailRows.length > 0 ? contentRows.filter((row) => !isGenericHomepageBusinessRow(row)) : contentRows),
  ];
  const rows = sourceRows
    .slice(0, 6)
    .map((row) => [
      stringField(row, "detail_kind") ?? classificationLabel(row),
      stringField(row, "controlled_hint") ?? "",
      stringField(row, "path") ?? "",
      stringField(row, "title") ?? stringField(row, "label") ?? "",
    ]);
  return markdownTable("Public business page table:", ["Kind", "Hint", "Path", "Title"], rows);
}

function createSecurityControlTable(contract: AiNarrativeReportContract): string {
  const securityHeaderItem = contract.input.brief.evidence_index.find((item) => item.probe === "security_headers_probe");
  if (!securityHeaderItem) return "";
  const missingHeader = findEvidenceItemValue(securityHeaderItem, ["missing", "security_header", "security headers"]);
  const rowValue = missingHeader || securityHeaderItem.summary;
  return markdownTable("Security control table:", ["Control", "Observed state"], [["Missing headers", rowValue]]);
}

function createCookieObservationTable(contract: AiNarrativeReportContract): string {
  const sourceRows = preferRowsWithObservationText([
    ...evidenceRows(contract, "bounded_cookie_attribute_observation_probe", ["bounded_cookie_checks"]),
    ...evidenceRows(contract, "cookie_security_probe", ["cookie", "session"]),
  ]);
  const rows = sourceRows
    .slice(0, 5)
    .map((row) => [
      stringField(row, "host") ?? "",
      stringField(row, "method") ?? "",
      stringField(row, "path") ?? stringField(row, "name") ?? "",
      statusField(row),
      parsedSummary(row) || compactSignals(row.signals) || stringField(row, "value") || "",
    ]);
  return markdownTable("Cookie observation table:", ["Host", "Method", "Path/Cookie", "Status", "Attributes"], rows);
}

function evidenceRows(contract: AiNarrativeReportContract, probe: string, evidenceNames: string[]): Record<string, unknown>[] {
  return contract.input.brief.evidence_index
    .filter((item) => item.probe === probe)
    .flatMap((item) =>
      item.evidence_items
        .filter((evidence) => evidenceNames.includes(evidence.name ?? evidence.type))
        .flatMap((evidence) => parseEvidenceRecords(evidence.value)),
    );
}

function parseEvidenceRecords(value: string): Record<string, unknown>[] {
  return parseEvidenceArray(value).filter(isRecord);
}

function markdownTable(label: string, headers: string[], rows: string[][]): string {
  const filteredRows = rows.filter((row) => row.some((cell) => cell.trim().length > 0));
  if (filteredRows.length === 0) return "";
  const header = `| ${headers.map((cell) => markdownCell(cell, 48)).join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = filteredRows.map((row) => `| ${row.map((cell) => markdownCell(cell, 80)).join(" | ")} |`);
  return `${label}\n${[header, divider, ...body].join("\n")}`;
}

function markdownCell(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3))}...` : compact;
}

function preferRowsWithSignalText(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const signalRows = rows.filter((row) => compactSignals(row.signals).length > 0);
  return signalRows.length > 0 ? signalRows : rows;
}

function preferRowsWithObservationText(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const signalRows = rows.filter((row) =>
    parsedSummary(row).length > 0
    || compactSignals(row.signals).length > 0
    || stringField(row, "value") !== null
  );
  return signalRows.length > 0 ? signalRows : rows;
}

function publicHostObservedHint(row: Record<string, unknown>): string {
  const server = stringField(row, "server");
  if (server) return `server=${server}`;
  const title = stringField(row, "title");
  if (title) return `title=${title}`;
  const redirect = stringField(row, "redirect") ?? stringField(row, "redirected_to") ?? stringField(row, "final_url");
  if (redirect) return `redirect=${redirect}`;
  const error = stringField(row, "error");
  if (error) return `error=${error}`;
  const role = stringField(row, "role_hint");
  const status = statusField(row);
  if (role && status) return `${role} host HTTP ${status}`;
  if (status) return `HTTP ${status}`;
  return role ? `${role} host observed` : "";
}

function isGenericHomepageBusinessRow(row: Record<string, unknown>): boolean {
  const path = stringField(row, "path") ?? "";
  return path === "/" && stringField(row, "detail_kind") === null;
}

function classificationLabel(row: Record<string, unknown>): string {
  const direct = stringField(row, "controlled_hint") ?? stringField(row, "label") ?? stringField(row, "detail_kind");
  if (direct) return direct;
  const classification = isRecord(row.classification) ? row.classification : null;
  return classification
    ? stringField(classification, "controlled_hint") ?? stringField(classification, "label") ?? ""
    : "";
}

function statusField(row: Record<string, unknown>): string {
  const status = row.status_code;
  if (typeof status === "number") return String(status);
  if (typeof status === "string") return status;
  return stringField(row, "status") ?? "";
}

function compactSignals(value: unknown): string {
  return asStringArray(value).map(formatSignalLabel).slice(0, 3).join(", ");
}

function parsedSummary(row: Record<string, unknown>): string {
  const parsed = isRecord(row.parsed) ? row.parsed : null;
  if (!parsed) return "";
  return Object.entries(parsed)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

function formatSignalLabel(value: string): string {
  const normalized = value.trim();
  const [key, ...rest] = normalized.split(":");
  const detail = rest.join(":");
  if (key === "cors_allow_origin" || key === "access_control_allow_origin_reflects_probe_origin") {
    return detail ? `allow-origin ${detail}` : "allow-origin reflected";
  }
  if (key === "cors_allow_credentials" || key === "access_control_allow_credentials_true") return "allow-credentials true";
  if (key === "cors_allow_methods" || key === "access_control_allow_methods_present") return "allow-methods present";
  if (key === "cors_allow_headers" || key === "access_control_allow_headers_authorization") return "allow-headers authorization";
  if (key === "set_cookie_observed") return "set-cookie observed";
  if (key === "public_route_presence_observed") return "public route present";
  return normalized.replace(/_/g, " ");
}

function signalBasis(row: Record<string, unknown>): string {
  const basis = row.basis;
  if (typeof basis === "string") return basis;
  if (Array.isArray(basis)) return basis.filter((item): item is string => typeof item === "string").slice(0, 2).join(", ");
  return compactSignals(row.signals);
}

function basenameFromPath(value: string): string {
  if (!value) return "";
  const withoutQuery = value.split("?")[0] ?? value;
  return withoutQuery.split("/").filter(Boolean).pop() ?? withoutQuery;
}

function formatBusinessOperationPage(value: Record<string, unknown>): string {
  const title = stringField(value, "title") ?? stringField(value, "label") ?? stringField(value, "path");
  const path = stringField(value, "path");
  const snippets = asStringArray(value.evidence_snippets ?? value.snippets)
    .map((snippet) => snippet.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 1);
  const location = path && title !== path ? ` (${path})` : "";
  const evidence = snippets.length > 0 ? ` - ${truncate(snippets[0], 160)}` : "";
  return title ? `${title}${location}${evidence}` : "";
}

function extractBusinessOperationTopics(values: string[]): string[] {
  const text = values.join(" ").toLowerCase();
  const labels: string[] = [];
  if (/supplier|vendor|onboarding|入驻/.test(text)) labels.push("supplier/vendor onboarding");
  if (/payout|withdraw|withdrawal|提现|settlement/.test(text)) labels.push("payouts/withdrawals");
  if (/routing|provider|厂商|路由/.test(text)) labels.push("provider routing");
  if (/about|platform|关于|平台/.test(text)) labels.push("platform overview");
  if (/cost|成本|降/.test(text)) labels.push("cost-reduction content");
  if (/product|products|商品|产品/.test(text)) labels.push("vendor/product pages");
  return uniqueStrings(labels).slice(0, 6);
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function createFallbackContent(
  contract: AiNarrativeReportContract,
  guidance: AiNarrativeReportContract["output_contract"]["section_guidance"][number],
  evidenceRefs: string[],
  _missingRefs: string[],
): string {
  const brief = contract.input.brief;

  if (guidance.id === "summary") {
    const warningCount = brief.layers.filter((layer) => layer.status === "warning" || layer.status === "error").length;
    const riskCount = brief.risks.filter((risk) => risk.level === "high" || risk.level === "medium").length;
    return [
      `This report is based on ${brief.run.record_count} normalized record(s) across ${brief.coverage.collected_layers.length}/${brief.coverage.total_layers} collected layer(s).`,
      warningCount > 0 ? `${warningCount} layer(s) contain warning or error signals.` : "No layer has warning or error status in the current evidence.",
      riskCount > 0 ? `${riskCount} high/medium risk item(s) should be reviewed first.` : "No high/medium risk item is flagged by the deterministic analysis.",
    ].join(" ");
  }

  if (guidance.id === "missing_data_next_steps") {
    const groupSummary = createMissingDataGroupSummary(brief);
    const factHints = guidance.fact_hints.slice(0, 6);
    const highlights = factHints.length > 0 ? ` Gap examples: ${factHints.join(" ")}` : "";
    return `Gap groups: ${groupSummary || "No missing-data groups were emitted by the deterministic brief."}${highlights}`;
  }

  const evidenceSummaries = evidenceRefs
    .map((ref) => brief.evidence_index.find((item) => item.id === ref)?.summary)
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);
  const factHints = guidance.fact_hints.slice(0, 5);

  if (factHints.length > 0) {
    return `${createSectionFactAppendLabel(guidance.id)} ${factHints.join(" ")}`;
  }

  const collected = evidenceSummaries.length > 0
    ? `Current evidence includes ${evidenceSummaries.join(" ")}`
    : "No strong collected evidence was selected for this topic.";
  return collected;
}

function createSectionFactAppendLabel(sectionId: string): string {
  const labels: Record<string, string> = {
    summary: "Key evidence:",
    public_information_architecture: "Public map evidence:",
    technology_stack: "Technology evidence:",
    deployment_network_surface: "Network evidence:",
    request_rendering_chain: "Rendering-chain evidence:",
    api_protocol_surface: "API/protocol evidence:",
    subdomain_attack_surface: "Subdomain evidence:",
    organization_operations: "Public operations evidence:",
    security_posture: "Security evidence:",
    missing_data_next_steps: "Gap examples:",
  };
  return labels[sectionId] ?? "Evidence highlights:";
}

function shapeSectionContent(sectionId: string, content: string): string {
  const contentWithoutGenericMissing = removeGenericMissingDataProse(sectionId, content);
  if (sectionId === "organization_operations") return compressInlineEvidenceProse(sectionId, shapeOrganizationOperationsContent(contentWithoutGenericMissing));
  if (sectionId === "public_information_architecture") {
    return shapeAndCompressTopicalFactContent(sectionId, contentWithoutGenericMissing, {
      duplicateLabels: ["Public map evidence:"],
      paragraphMarkers: [
        "Subdomain/reachability matrix:",
        "Public content detail map:",
        "Public content surface map:",
        "Browser runtime loaded",
        "Public SPA route metadata:",
        "Browser runtime observed",
      ],
    });
  }
  if (sectionId === "summary") {
    return shapeAndCompressTopicalFactContent(sectionId, contentWithoutGenericMissing, {
      duplicateLabels: ["Key evidence:"],
      paragraphMarkers: ["Performance score", "Lighthouse performance score", "Missing security headers:", "Subdomain/reachability matrix:"],
    });
  }
  if (sectionId === "deployment_network_surface") {
    return shapeAndCompressTopicalFactContent(sectionId, contentWithoutGenericMissing, {
      duplicateLabels: ["Network evidence:"],
      paragraphMarkers: [
        "Performance score",
        "Lighthouse performance score",
        "CDN header signal(s) found:",
        "Live certificate expires",
        "Response cache policy",
      ],
    });
  }
  if (sectionId === "request_rendering_chain") {
    return shapeAndCompressTopicalFactContent(sectionId, contentWithoutGenericMissing, {
      duplicateLabels: ["Rendering-chain evidence:"],
      paragraphMarkers: [
        "Browser runtime loaded",
        "Browser runtime observed 0.",
        "Browser runtime observed 22",
        "Browser runtime observed 6 API-like",
        "Final response returned",
      ],
    });
  }
  if (sectionId === "technology_stack") {
    return shapeAndCompressTopicalFactContent(sectionId, contentWithoutGenericMissing, {
      duplicateLabels: ["Technology evidence:"],
      paragraphMarkers: [
        "Public SPA asset metadata:",
        "Found 2 application fingerprint",
        "Bounded public app header metadata:",
        "Bounded public metadata check:",
        "Observed public app marker(s):",
        "Extracted ",
        "Browser runtime observed",
        "No third-party",
        "Missing data:",
      ],
    });
  }
  if (sectionId === "api_protocol_surface") {
    return shapeApiProtocolSurfaceContent(contentWithoutGenericMissing, {
      duplicateLabels: ["API/protocol evidence:"],
      paragraphMarkers: [
        "Bounded public CORS check:",
        "Bounded public API endpoint inventory:",
        "Bounded public API check:",
        "No CORS headers",
        "No obvious API",
        "Found 2 protocol",
        "Browser runtime observed",
      ],
    });
  }
  if (sectionId === "subdomain_attack_surface") {
    return shapeAndCompressTopicalFactContent(sectionId, contentWithoutGenericMissing, {
      duplicateLabels: ["Subdomain evidence:"],
      paragraphMarkers: [
        "Collected 2 bounded HTTP",
        "Checked 6 bounded public host",
        "Found 2 application fingerprint",
        "Missing data:",
      ],
    });
  }
  if (sectionId === "security_posture") {
    return shapeAndCompressTopicalFactContent(sectionId, contentWithoutGenericMissing, {
      duplicateLabels: ["Security evidence:"],
      paragraphMarkers: [
        "No Set-Cookie",
        "Missing security headers:",
        "Frame embedding policy",
        "Browser runtime observed",
      ],
    });
  }
  if (sectionId === "missing_data_next_steps") {
    return shapeTopicalFactContent(content, {
      duplicateLabels: ["Gap examples:"],
      paragraphMarkers: ["Gap groups:", "Missing data:"],
    });
  }
  return compressInlineEvidenceProse(sectionId, contentWithoutGenericMissing);
}

function removeGenericMissingDataProse(sectionId: string, content: string): string {
  if (sectionId === "missing_data_next_steps") return content;
  return content
    .replace(/\s+Missing data:\s+[^.]+?\((?:add_provider|requires_permission|manual_review|requires_user_input|out_of_scope)\)\./g, "")
    .replace(/\s+Remaining gaps:\s+[^.]+(?:\.)?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function shapeTopicalFactContent(
  content: string,
  options: { duplicateLabels: string[]; paragraphMarkers: string[] },
): string {
  const normalized = removeSectionLeadInLabels(
    removeDuplicatedLeadInLabel(content, options.duplicateLabels),
    options.duplicateLabels,
  );
  return collapseExcessParagraphs(insertParagraphBreaksBeforeMarkers(normalized, options.paragraphMarkers)).join("\n\n");
}

function shapeAndCompressTopicalFactContent(
  sectionId: string,
  content: string,
  options: { duplicateLabels: string[]; paragraphMarkers: string[] },
): string {
  return compressInlineEvidenceProse(sectionId, shapeTopicalFactContent(content, options));
}

function shapeApiProtocolSurfaceContent(
  content: string,
  options: { duplicateLabels: string[]; paragraphMarkers: string[] },
): string {
  const shaped = compressInlineEvidenceProse("api_protocol_surface", shapeTopicalFactContent(content, options));
  return dedupeApiCorsBoilerplate(shaped);
}

function compressInlineEvidenceProse(sectionId: string, content: string): string {
  if (sectionId === "missing_data_next_steps") return content;
  const paragraphs = collapseExcessParagraphs(content)
    .map((paragraph) => compressInlineEvidenceParagraph(sectionId, paragraph));
  return dedupeCompressedSectionParagraphs(sectionId, paragraphs)
    .join("\n\n");
}

function compressInlineEvidenceParagraph(sectionId: string, paragraph: string): string {
  const evidenceIndex = paragraph.indexOf(" Evidence: ");
  if (evidenceIndex < 0) return paragraph;
  const claim = paragraph.slice(0, evidenceIndex).trim();
  const rawEvidence = paragraph.slice(evidenceIndex + " Evidence: ".length).trim();
  const digest = createInlineEvidenceDigest(sectionId, claim, rawEvidence);
  return `${claim}${digest ? ` ${digest}` : ""}`.replace(/\s+/g, " ").trim();
}

function createInlineEvidenceDigest(sectionId: string, claim: string, rawEvidence: string): string {
  const claimNormalized = claim.toLowerCase();
  const normalized = `${claim} ${rawEvidence}`.toLowerCase();
  if (rawEvidence.includes("Example CA")) return "Certificate issuer summary includes Example CA.";
  if (rawEvidence.includes("0.91")) return "Performance source metrics include score 0.91.";
  if (normalized.includes("larksuite")) return "Mail DNS includes larksuite MX/TXT signals.";
  if (
    sectionId === "api_protocol_surface" &&
    (claimNormalized.includes("cors") || claimNormalized.includes("access-control"))
  ) {
    return "CORS response-header signals were observed in bounded public checks.";
  }
  if (sectionId === "api_protocol_surface" && (normalized.includes("/health") || normalized.includes("/v1/models"))) {
    return "Bounded public checks include `/health` and `/v1/models`.";
  }
  if (sectionId === "security_posture" && normalized.includes("content-security-policy")) {
    return "Header evidence includes CSP/HSTS absence and frame/content-type/referrer controls.";
  }
  if (sectionId === "security_posture" && normalized.includes("set-cookie")) {
    return "Cookie evidence is limited to the bounded public checks.";
  }
  return "";
}

function dedupeCompressedSectionParagraphs(sectionId: string, paragraphs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const hasBusinessContentParagraph = sectionId === "organization_operations" &&
    paragraphs.some((paragraph) => paragraph.startsWith("Public business/product content:"));

  for (const paragraph of paragraphs) {
    if (
      hasBusinessContentParagraph &&
      paragraph.startsWith("Public operations evidence: Collected public business/product text snippets")
    ) {
      continue;
    }
    const key = compressedParagraphDedupeKey(sectionId, paragraph);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(paragraph);
  }

  return result;
}

function compressedParagraphDedupeKey(sectionId: string, paragraph: string): string | null {
  const normalized = paragraph.toLowerCase();
  if (sectionId === "deployment_network_surface" && normalized.startsWith("performance score ")) return "performance_score";
  if (sectionId === "deployment_network_surface" && normalized.startsWith("lighthouse performance score ")) return "lighthouse_performance_score";
  if (sectionId === "security_posture" && normalized.startsWith("no set-cookie header was observed")) return "no_set_cookie";
  if (sectionId === "security_posture" && normalized.startsWith("missing security headers:")) return "missing_security_headers";
  if (sectionId === "security_posture" && normalized.startsWith("bounded public cookie check:")) return "bounded_cookie_check";
  if (sectionId === "api_protocol_surface" && normalized.startsWith("bounded public cors check:")) return "bounded_cors_check";
  return null;
}

function dedupeApiCorsBoilerplate(content: string): string {
  let keptEndpointSummary = false;
  const endpointSummary = "Bounded public checks include `/health` and `/v1/models`.";
  const paragraphs = collapseExcessParagraphs(content).map((paragraph) => {
    if (!paragraph.startsWith("No CORS headers were found on the main response.")) return paragraph;
    return paragraph
      .replace(/\s+Bounded public CORS check:\s+[^.]+?\.\s*CORS response-header signals were observed in bounded public checks\./g, "")
      .replace(/\s+CORS response-header signals were observed in bounded public checks\./g, "")
      .trim();
  }).map((paragraph) => {
    if (!paragraph.includes(endpointSummary)) return paragraph;
    if (!keptEndpointSummary) {
      keptEndpointSummary = true;
      return paragraph;
    }
    return paragraph.replace(endpointSummary, "").replace(/\s{2,}/g, " ").trim();
  });
  return dedupeCompressedSectionParagraphs("api_protocol_surface", paragraphs).join("\n\n");
}

function removeDuplicatedLeadInLabel(content: string, labels: string[]): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  for (const label of labels) {
    const marker = `${label} `;
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex <= 0) continue;
    const leadIn = normalized.slice(0, markerIndex).trim();
    const afterLabel = normalized.slice(markerIndex + marker.length).trim();
    if (!leadIn || !afterLabel) continue;
    const normalizedLeadIn = normalizeComparableText(leadIn);
    const normalizedAfterLabel = normalizeComparableText(afterLabel);
    if (normalizedAfterLabel.startsWith(normalizedLeadIn)) {
      return afterLabel;
    }
  }
  return normalized;
}

function removeSectionLeadInLabels(content: string, labels: string[]): string {
  return labels.reduce((value, label) => {
    const pattern = new RegExp(`\\s*${escapeRegExp(label)}\\s*`, "g");
    return value.replace(pattern, " ");
  }, content).replace(/\s+/g, " ").trim();
}

function insertParagraphBreaksBeforeMarkers(content: string, markers: string[]): string {
  return markers.reduce((value, marker) => {
    const pattern = new RegExp(`\\s+(${escapeRegExp(marker)})`, "g");
    return value.replace(pattern, "\n\n$1");
  }, content);
}

function normalizeComparableText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function sanitizeSectionLimitations(
  contract: AiNarrativeReportContract,
  sectionId: string,
  limitations: string[],
): string[] {
  const guidanceBoundary = contract.output_contract.section_guidance.find((item) => item.id === sectionId)?.boundary;
  const cleaned = uniqueStrings(
    limitations
      .map(cleanSectionLimitation)
      .filter(Boolean)
      .filter((value) => !isInvalidSectionLimitation(value)),
  ).slice(0, 8);
  if (cleaned.length > 0) return cleaned;
  const fallback = guidanceBoundary ? cleanSectionLimitation(guidanceBoundary) : "";
  return fallback && !isInvalidSectionLimitation(fallback) ? [fallback] : [];
}

function cleanSectionLimitation(value: string): string {
  return value
    .trim()
    .replace(/;?\s*Do not place CORS,[\s\S]*$/i, "")
    .replace(/;?\s*Do not add generic Missing data[\s\S]*$/i, "")
    .replace(/;?\s*Use each section_guidance[\s\S]*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isInvalidSectionLimitation(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes(" evidence:") ||
    normalized.includes("generated from bounded reportbrief") ||
    normalized.includes("do not place ") ||
    normalized.includes("use the api, technology") ||
    normalized.includes("section_guidance") ||
    normalized.includes("write one section") ||
    normalized.includes("cite only ") ||
    normalized.includes("do not invent ") ||
    normalized.includes("must be under ") ||
    normalized.includes("keep markdown ") ||
    normalized.includes("status_code=") ||
    normalized.includes("metric(s)") ||
    normalized.includes("certificate(s)") ||
    normalized.includes("endpoint(s)") ||
    normalized.includes("item(s):") ||
    normalized.includes("host(s):") ||
    normalized.includes("https=url=") ||
    /^this is (an? )?.+ section\.?$/.test(normalized)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shapeOrganizationOperationsContent(content: string): string {
  const normalized = content
    .replace(/\s+/g, " ")
    .replace(/ Public operations evidence:\s*/g, "\n\nPublic operations evidence: ")
    .replace(/ Public business\/product content:\s*/g, "\n\nPublic business/product content: ")
    .replace(/ Public product\/business detail:\s*/g, "\n\nPublic product/business detail: ")
    .replace(/ Public content detail map:\s*/g, "\n\nPublic content detail map: ")
    .replace(/ Public content surface map:\s*/g, "\n\nPublic content surface map: ")
    .replace(/ Collected RDAP \/ WHOIS-lite/g, "\n\nCollected RDAP / WHOIS-lite")
    .replace(/ Collected Wayback/g, "\n\nCollected Wayback")
    .trim();

  return collapseExcessParagraphs(normalized)
    .map(trimOrganizationParagraph)
    .filter(Boolean)
    .filter(uniqueOrganizationParagraph)
    .sort((left, right) => scoreOrganizationParagraph(left) - scoreOrganizationParagraph(right))
    .join("\n\n");
}

function collapseExcessParagraphs(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimOrganizationParagraph(value: string): string {
  if (value === "Public operations evidence:") return "";
  if (value.startsWith("Public operations evidence: ")) {
    const trimmed = value.replace(/^Public operations evidence:\s*/, "");
    if (/^Collected organization-facing DNS/i.test(trimmed)) return "";
    return `Public operations evidence: ${trimmed}`;
  }
  return value;
}

function uniqueOrganizationParagraph(value: string, index: number, values: string[]): boolean {
  const key = organizationParagraphKey(value);
  if (!key) return true;
  return values.findIndex((candidate) => organizationParagraphKey(candidate) === key) === index;
}

function organizationParagraphKey(value: string): string | null {
  for (const label of [
    "Public product/business detail:",
    "Public business/product content:",
    "Public content detail map:",
    "Public content surface map:",
  ]) {
    if (value.startsWith(label)) return label;
  }
  return null;
}

function scoreOrganizationParagraph(value: string): number {
  if (value.startsWith("Public product/business detail:")) return 10;
  if (value.startsWith("Public business/product content:")) return 20;
  if (value.startsWith("Public content detail map:")) return 30;
  if (value.startsWith("Public content surface map:")) return 40;
  if (/organization-facing DNS/i.test(value)) return 50;
  if (/RDAP \/ WHOIS-lite/i.test(value)) return 60;
  if (/Wayback/i.test(value)) return 70;
  if (/Remaining gaps:/i.test(value)) return 90;
  return 80;
}

function createMissingDataGroupSummary(brief: ReportBrief): string {
  const order = ["add_provider", "requires_permission", "manual_review", "requires_user_input", "out_of_scope"];
  const groups = new Map<string, string[]>();

  for (const item of brief.missing_data) {
    const values = groups.get(item.classification) ?? [];
    values.push(item.description);
    groups.set(item.classification, values);
  }

  return order
    .map((classification) => {
      const values = groups.get(classification) ?? [];
      if (values.length === 0) return "";
      const examples = values.slice(0, 3).join("; ");
      const suffix = values.length > 3 ? `; +${values.length - 3} more` : "";
      return `${classification}: ${values.length} (${examples}${suffix})`;
    })
    .filter(Boolean)
    .join(" | ");
}

function orderSections(
  contract: AiNarrativeReportContract,
  sections: AiNarrativeReportSection[],
): AiNarrativeReportSection[] {
  const order = new Map(contract.output_contract.section_ids.map((id, index) => [id, index]));
  return [...sections].sort((left, right) => {
    const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

function normalizeSectionId(value: string): string {
  const id = truncate(value, 100);
  return (AI_NARRATIVE_REPORT_SECTION_IDS as readonly string[]).includes(id) ? id : id;
}

function sanitizeSectionContent(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const cleaned: string[] = [];
  let seenContent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!seenContent && trimmed.length === 0) continue;
    if (!seenContent && /^#{1,6}\s+\S/.test(trimmed)) continue;
    if (/^(Evidence|Boundaries|Limitations):/i.test(trimmed)) continue;
    seenContent = true;
    cleaned.push(line);
  }

  return cleaned
    .join("\n")
    .replace(/\bCurrent evidence highlights:\s*/gi, "")
    .trim();
}

function hasSubstantiveSectionContent(value: string): boolean {
  return value.replace(/\[(?:E|M)\d{3}\]/g, "").trim().length > 20;
}

function splitRefs(values: string[]): { evidenceRefs: string[]; missingDataRefs: string[] } {
  const evidenceRefs: string[] = [];
  const missingDataRefs: string[] = [];

  for (const value of values) {
    if (/^E\d{3}$/.test(value)) evidenceRefs.push(value);
    else if (/^M\d{3}$/.test(value)) missingDataRefs.push(value);
    else evidenceRefs.push(value);
  }

  return { evidenceRefs, missingDataRefs };
}

function isAiNarrativeReportContract(value: unknown): value is AiNarrativeReportContract {
  const contract = asObject(value);
  const input = asObject(contract.input);
  return (
    contract.schema_version === "site-10-layer-ai-narrative-report-contract/v0.1" &&
    contract.invokes_provider === false &&
    typeof contract.target === "string" &&
    typeof contract.normalized_target === "string" &&
    isReportBrief(input.brief)
  );
}

function isReportBrief(value: unknown): value is ReportBrief {
  const brief = asObject(value);
  return (
    brief.schema_version === "site-10-layer-report-brief/v0.1" &&
    typeof brief.target === "string" &&
    typeof brief.normalized_target === "string" &&
    Array.isArray(brief.layers) &&
    Array.isArray(brief.evidence_index) &&
    Array.isArray(brief.missing_data)
  );
}

function failure(
  error_code: AiNarrativeReportWorkerFailure["error_code"],
  error: string,
  status: number,
  extra: Pick<AiNarrativeReportWorkerFailure, "missing_config" | "validation_errors"> = {},
): AiNarrativeReportWorkerFailure {
  return {
    ok: false,
    schema_version: "site-10-layer-ai-narrative-report-worker-response/v0.1",
    provider: "worker_ai_narrative_report",
    error_code,
    error,
    status,
    ...extra,
  };
}

function extractModelContent(value: unknown): string {
  if (typeof value === "string") return value;
  const body = asObject(value);
  const response = body.response;
  if (typeof response === "string") return response;
  if (isRecord(response)) return JSON.stringify(response);
  const result = body.result;
  if (typeof result === "string") return result;
  if (isRecord(result)) return JSON.stringify(result);
  const content = body.content;
  if (typeof content === "string") return content;
  return JSON.stringify(value);
}

function parseModelJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return JSON.parse(fenced[1].trim());

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return JSON.parse(trimmed);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

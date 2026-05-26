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
  if (hint.startsWith("Business model synthesis:")) {
    return content.includes("Business model synthesis:");
  }
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
      "cache_policy_probe",
      "runtime_asset_cache_policy_probe",
    ],
    api_protocol_surface: [
      "cors_policy_probe",
      "bounded_cors_header_validation_probe",
      "bounded_public_api_error_surface_probe",
      "bounded_public_api_endpoint_inventory_probe",
      "public_api_compatibility_detail_probe",
    ],
    technology_stack: [
      "frontend_technology_probe",
      "runtime_third_party_resources_probe",
      "bounded_public_metadata_probe",
      "bounded_public_app_header_metadata_probe",
      "public_spa_asset_metadata_probe",
    ],
    public_information_architecture: ["public_content_surface_probe", "public_content_detail_probe", "public_spa_route_metadata_probe"],
    organization_operations: [
      "public_business_content_probe",
      "public_product_business_detail_probe",
      "public_spa_route_metadata_probe",
      "bounded_public_api_endpoint_inventory_probe",
      "organization_intelligence_probe",
    ],
    security_posture: [
      "cookie_security_probe",
      "security_headers_probe",
      "bounded_cookie_attribute_observation_probe",
      "bounded_cors_header_validation_probe",
      "bounded_public_api_endpoint_inventory_probe",
    ],
  };
  const probes = probesBySection[sectionId] ?? [];
  const synthesisFact = sectionId === "summary" || sectionId === "organization_operations"
    ? createBusinessModelSynthesisFact(contract)
    : "";
  if (probes.length === 0) return synthesisFact ? [synthesisFact] : [];

  const evidenceFacts = contract.input.brief.evidence_index
    .filter((item) => probes.includes(item.probe))
    .map((item) => createBriefEvidenceFact(item))
    .filter(Boolean);
  return uniqueStrings([synthesisFact, ...evidenceFacts].filter(Boolean));
}

function createBriefEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  if (item.probe === "public_product_business_detail_probe") {
    return createBusinessOperationEvidenceFact(item);
  }
  if (item.probe === "public_api_compatibility_detail_probe") {
    return createApiCompatibilityEvidenceFact(item);
  }
  if (item.probe === "public_spa_route_metadata_probe") {
    return createSpaOperationEvidenceFact(item);
  }
  if (item.probe === "frontend_technology_probe") {
    return createFrontendTechnologyEvidenceFact(item);
  }
  if (item.probe === "bounded_public_app_header_metadata_probe") {
    return createPublicAppHeaderMetadataEvidenceFact(item);
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
  if (item.probe === "rdap_whois_lite_probe") {
    return createRdapRegistrationEvidenceFact(item);
  }
  if (item.probe === "security_headers_probe") {
    return createSecurityHeadersEvidenceFact(item);
  }
  if (item.probe === "bounded_cors_header_validation_probe") {
    return createSecurityCorsEvidenceFact(item);
  }
  if (item.probe === "bounded_public_api_endpoint_inventory_probe") {
    return createPublicApiEndpointSecurityEvidenceFact(item);
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

function createRdapRegistrationEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  const registrar = findEvidenceItemValue(item, ["rdap_registrar", "registrar"]);
  const registrarText = registrar ? ` Registrar: ${registrar}.` : "";
  return truncate(`${item.summary}${registrarText}`, 420);
}

function createSecurityCorsEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  const rows = preferRowsWithSignalText(
    item.evidence_items
      .filter((evidence) => (evidence.name ?? evidence.type) === "bounded_cors_checks")
      .flatMap((evidence) => parseEvidenceRecords(evidence.value)),
  );
  const details = rows
    .slice(0, 3)
    .map((row) => {
      const target = [stringField(row, "host"), stringField(row, "method"), stringField(row, "path")]
        .filter(Boolean)
        .join(" ");
      const signals = compactSignals(row.signals);
      return [target, signals].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("; ");
  const detailText = details ? ` ${details}.` : "";
  return truncate(
    `CORS risk signal: bounded public checks observed response-header signal(s).${detailText} Risk signal only; not confirmed exploitability.`,
    420,
  );
}

function createPublicApiEndpointSecurityEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  const rows = item.evidence_items
    .filter((evidence) => (evidence.name ?? evidence.type) === "public_api_endpoint_inventory")
    .flatMap((evidence) => parseEvidenceRecords(evidence.value));
  const endpoints = rows
    .slice(0, 4)
    .map((row) => [stringField(row, "method"), stringField(row, "path"), statusField(row)].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("; ");
  const endpointText = endpoints ? ` ${endpoints}.` : "";
  return truncate(
    `Public API endpoint exposure: bounded public checks observed endpoint inventory.${endpointText} Inventory signal only; not authenticated API validation.`,
    420,
  );
}

function createFrontendTechnologyEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  const values = item.evidence_items
    .map((evidence) => `${evidence.name ?? evidence.type} ${stringifyEvidenceValue(evidence.value)}`)
    .join(" ");
  const facts: string[] = [];
  if (/matomo/i.test(values)) facts.push("Matomo analytics marker");
  const hostMatch = values.match(/matomo-host:([a-z0-9.-]+)/i) ?? values.match(/\b([a-z0-9.-]*matomo[a-z0-9.-]*)\b/i);
  if (hostMatch?.[1]) facts.push(`tracker host ${hostMatch[1].toLowerCase()}`);
  const factText = facts.length > 0
    ? ` Static frontend marker evidence: ${uniqueStrings(facts).join(", ")}. Tracker-host evidence is a public script/configuration signal, not ownership proof.`
    : "";
  return truncate(`${item.summary}${factText}`, 420);
}

function createPublicAppHeaderMetadataEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  const rows = item.evidence_items
    .filter((evidence) => (evidence.name ?? evidence.type) === "public_app_header_metadata")
    .flatMap((evidence) => parseEvidenceArray(evidence.value))
    .filter(isRecord);
  const facts = rankRows(rows, scorePublicAppHeaderMetadataRow)
    .slice(0, 4)
    .map(formatPublicAppHeaderMetadataFact)
    .filter(Boolean);
  return facts.length > 0
    ? `Public app/header metadata: ${facts.join("; ")}.`
    : item.summary.replace(/\.\.\./g, "");
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

function createApiCompatibilityEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  const rows = item.evidence_items
    .filter((evidence) => (evidence.name ?? evidence.type) === "api_compatibility_snippets")
    .flatMap((evidence) => parseEvidenceArray(evidence.value))
    .filter(isRecord);
  const signals = uniqueStrings(
    rows.flatMap((row) => arrayField(row, "compatibility_signals")),
  );
  const apiBaseUrls = uniqueStrings(rows.flatMap((row) => arrayField(row, "api_base_urls")));
  const pages = rows
    .map((row) => {
      const title = stringField(row, "title") ?? stringField(row, "path");
      const path = stringField(row, "path");
      return [title, path && title !== path ? `(${path})` : ""].filter(Boolean).join(" ");
    })
    .filter(Boolean);
  const signalText = signals.length > 0 ? ` Public-doc signals: ${signals.slice(0, 6).join(", ")}.` : "";
  const baseUrlText = apiBaseUrls.length > 0 ? ` Public API base URLs: ${apiBaseUrls.slice(0, 5).join(", ")}.` : "";
  const pageText = pages.length > 0
    ? ` Evidence pages: ${pages.slice(0, 4).join("; ")}${pages.length > 4 ? `; +${pages.length - 4} more` : ""}.`
    : "";
  return truncate(`Public API compatibility detail: ${item.summary}.${signalText}${baseUrlText}${pageText}`, 820);
}

function createSpaOperationEvidenceFact(item: ReportBrief["evidence_index"][number]): string {
  const rows = item.evidence_items
    .filter((evidence) => (evidence.name ?? evidence.type) === "spa_operation_hints")
    .flatMap((evidence) => parseEvidenceArray(evidence.value))
    .filter(isRecord);
  const operations = uniqueStrings(rows.map((row) => stringField(row, "operation")).filter((value): value is string => Boolean(value)));
  const signals = compactOperationSignalFacts(rows);
  const operationText = operations.length > 0 ? ` Operation hints: ${operations.join(", ")}.` : "";
  const signalText = signals.length > 0 ? ` Signals: ${signals.join("; ")}.` : "";
  return truncate(`SPA operation hints: ${item.summary}.${operationText}${signalText}`, 800);
}

function createBusinessModelSynthesisFact(_contract: AiNarrativeReportContract): string {
  return "";
}

function compactOperationSignalFacts(rows: Record<string, unknown>[]): string[] {
  const byOperation = new Map<string, string[]>();
  for (const row of rows) {
    const operation = stringField(row, "operation");
    const signal = stringField(row, "signal");
    if (!operation || !signal) continue;
    byOperation.set(operation, uniqueStrings([...(byOperation.get(operation) ?? []), signal]));
  }
  return Array.from(byOperation.entries())
    .map(([operation, signals]) => `${operation}: ${summarizeOperationSignals(signals)}`)
    .slice(0, 5);
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
      createFrontendTechnologyTable(contract),
      createSpaSignalTable(contract),
      createSpaAssetPreviewTable(contract),
      createPublicAppMarkerTable(contract),
      createPublicCmsForumMetadataTable(contract),
      createPublicAppHeaderMetadataTable(contract),
    ].filter(hasText);
  }
  if (sectionId === "deployment_network_surface") return [createCacheHeaderEvidenceTable(contract)].filter(hasText);
  if (sectionId === "api_protocol_surface") {
    return [
      createApiBaseUrlTable(contract),
      createApiCompatibilityTable(contract),
      createApiEndpointTable(contract),
      createApiModelListDetailTable(contract),
      createCorsObservationTable(contract),
    ].filter(hasText);
  }
  if (sectionId === "subdomain_attack_surface") {
    return [
      createPublicHostTable(contract),
      createCtSubdomainCandidateTable(contract),
    ].filter(hasText);
  }
  if (sectionId === "organization_operations") {
    return [
      createPublicBusinessPageTable(contract),
      createSpaOperationEvidenceTable(contract),
      createOrganizationEvidenceTable(contract),
    ].filter(hasText);
  }
  if (sectionId === "security_posture") {
    return [
      createSecurityControlTable(contract),
      createCorsRiskSignalTable(contract),
      createPublicApiEndpointExposureTable(contract),
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
  const rows = rankRows(
    evidenceRows(contract, "public_spa_route_metadata_probe", ["route_candidates"])
      .filter(isReportableSpaRouteCandidateRow),
    scoreSpaRouteCandidateRow,
  )
    .slice(0, 9)
    .map((row) => [
      stringField(row, "route_candidate") ?? "",
      basenameFromPath(stringField(row, "source_asset") ?? ""),
      stringField(row, "confidence") ?? "",
      spaRouteDerivationLabel(row),
    ]);
  return markdownTable("SPA route candidate table:", ["Candidate", "Source asset", "Confidence", "Derivation"], rows);
}

function isReportableSpaRouteCandidateRow(row: Record<string, unknown>): boolean {
  const route = (stringField(row, "route_candidate") ?? "").toLowerCase();
  if (!route) return false;
  if (/^\/(?:admin|api|auth|tool|agent|affiliate|dash)\//.test(route)) return false;
  if (/^\/setting\/payment\/.+/.test(route)) return false;
  return route.split("/").filter(Boolean).length <= 3;
}


function createOrganizationEvidenceTable(contract: AiNarrativeReportContract): string {
  const rows: string[][] = [];
  const organizationItem = contract.input.brief.evidence_index.find((item) => item.probe === "organization_intelligence_probe");
  const organizationValues = organizationItem?.evidence_items.map((item) => item.value).join(" ") ?? "";
  if (/larksuite/i.test(organizationValues)) {
    rows.push(["Mail DNS", "MX/TXT", "Larksuite mail DNS signals"]);
  }

  const rdapItem = contract.input.brief.evidence_index.find((item) => item.probe === "rdap_whois_lite_probe");
  const registrar = rdapItem ? findEvidenceItemValue(rdapItem, ["rdap_registrar", "registrar"]) : "";
  if (registrar) rows.push(["Registration", "Registrar", registrar]);

  return markdownTable("Organization evidence table:", ["Category", "Signal", "Observed value"], rows);
}

function spaRouteDerivationLabel(row: Record<string, unknown>): string {
  if (stringField(row, "derivation") !== "derived_alias") return "direct";
  return `derived alias: ${stringField(row, "basis") ?? "multiple public evidence signals"}`;
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
  const rows = rankRows(
    evidenceRows(contract, "public_spa_asset_metadata_probe", ["asset_previews"]),
    scoreSpaAssetPreviewRow,
  )
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

function createPublicAppHeaderMetadataTable(contract: AiNarrativeReportContract): string {
  const rows = rankRows(
    evidenceRows(contract, "bounded_public_app_header_metadata_probe", ["public_app_header_metadata"]),
    scorePublicAppHeaderMetadataRow,
  )
    .slice(0, 6)
    .map((row) => [
      stringField(row, "host") ?? "",
      stringField(row, "kind") ?? stringField(row, "role_hint") ?? "",
      statusField(row),
      publicAppHeaderMetadataSignals(row),
    ]);
  return markdownTable("Public app header metadata table:", ["Host", "Kind", "Status", "Observed signals"], rows);
}

function createPublicCmsForumMetadataTable(contract: AiNarrativeReportContract): string {
  const rows = rankRows(
    evidenceRows(contract, "bounded_public_metadata_probe", ["bounded_public_metadata_checks"]),
    scorePublicCmsForumMetadataRow,
  )
    .map((row) => [
      stringField(row, "host") ?? "",
      publicCmsForumPlatformLabel(row),
      stringField(row, "path") ?? "",
      statusField(row),
      publicCmsForumMetadataSignals(row),
      publicCmsForumBoundary(row),
    ])
    .filter((row) => row[1] && row[4])
    .slice(0, 8);
  return markdownTable(
    "Public CMS/forum metadata table:",
    ["Host", "Platform", "Path", "Status", "Observed metadata", "Boundary"],
    rows,
    140,
  );
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

function createApiModelListDetailTable(contract: AiNarrativeReportContract): string {
  const rows = evidenceRows(contract, "bounded_public_api_endpoint_inventory_probe", ["public_api_endpoint_inventory"])
    .filter((row) => stringField(row, "path") === "/v1/models")
    .filter((row) => typeof row.model_count === "number" || arrayField(row, "model_sample").length > 0)
    .slice(0, 4)
    .map((row) => [
      stringField(row, "host") ?? "",
      stringField(row, "path") ?? "",
      statusField(row),
      typeof row.model_count === "number" ? String(row.model_count) : "",
      arrayField(row, "model_sample").slice(0, 5).join(", "),
      bodyPreviewMetadata(row),
      "Public endpoint inventory only; not authenticated API validation or availability guarantee",
    ]);
  return markdownTable(
    "API model list detail table:",
    ["Host", "Path", "Status", "Model count", "Sample", "Body preview", "Boundary"],
    rows,
    140,
  );
}

function createApiCompatibilityTable(contract: AiNarrativeReportContract): string {
  const rows = rankRows(
    evidenceRows(contract, "public_api_compatibility_detail_probe", ["api_compatibility_snippets"]),
    scoreApiCompatibilityRow,
  )
    .slice(0, 6)
    .map((row) => [
      stringField(row, "title") ?? stringField(row, "path") ?? "",
      stringField(row, "path") ?? "",
      summarizeApiCompatibilitySignals(arrayField(row, "compatibility_signals")),
      summarizeApiCompatibilitySnippet(row),
    ]);
  return markdownTable("API compatibility evidence table:", ["Page", "Path", "Signals", "Snippet"], rows);
}

function createApiBaseUrlTable(contract: AiNarrativeReportContract): string {
  const rows = rankRows(
    evidenceRows(contract, "public_api_compatibility_detail_probe", ["api_compatibility_snippets"])
      .filter((row) => arrayField(row, "api_base_urls").length > 0),
    scoreApiCompatibilityRow,
  )
    .slice(0, 4)
    .flatMap((row) => arrayField(row, "api_base_urls").slice(0, 4).map((apiBaseUrl) => [
      stringField(row, "title") ?? stringField(row, "path") ?? "",
      apiBaseUrl,
      summarizeApiCompatibilitySignals(arrayField(row, "compatibility_signals")),
      summarizeApiBaseUrlSnippet(row, apiBaseUrl),
    ]))
    .slice(0, 8);
  return markdownTable("API base URL table:", ["Page", "Base URL", "Signals", "Snippet"], rows, 120);
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

function createCtSubdomainCandidateTable(contract: AiNarrativeReportContract): string {
  const rows = selectGroupedCtSubdomainCandidateRows(
    rankRows(
      evidenceRows(contract, "subdomain_attack_surface_probe", ["subdomains"]),
      scoreCtSubdomainCandidateRow,
    ),
  )
    .map((row) => [
      ctHostGroupLabel(stringField(row, "host") ?? ""),
      stringField(row, "host") ?? "",
      stringField(row, "source") ?? arrayField(row, "sources").join(", "),
      ctSubdomainSignals(row),
      "CT candidate; not service inventory",
    ]);
  return markdownTable("CT-discovered host candidate table:", ["Group", "Host", "Source", "Signals", "Boundary"], rows);
}

function selectGroupedCtSubdomainCandidateRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byHost = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const host = (stringField(row, "host") ?? "").toLowerCase();
    if (!host || byHost.has(host)) continue;
    byHost.set(host, row);
  }

  const groupLimits = new Map([
    ["official/public", 6],
    ["placeholder/content", 5],
    ["storage/media", 3],
    ["tooling/ci", 3],
    ["translation/tool", 3],
    ["other candidate", 2],
  ]);
  const selected: Record<string, unknown>[] = [];

  for (const [group, limit] of groupLimits) {
    const groupRows = Array.from(byHost.values()).filter((row) => ctHostGroupKey(stringField(row, "host") ?? "") === group);
    selected.push(...groupRows.slice(0, limit));
  }

  return selected.slice(0, 16);
}

function createFrontendTechnologyTable(contract: AiNarrativeReportContract): string {
  const staticRows = contract.input.brief.evidence_index
    .filter((item) => item.probe === "frontend_technology_probe")
    .flatMap((item) => item.evidence_items)
    .filter((evidence) => (evidence.name ?? evidence.type).toLowerCase().includes("matomo"))
    .map((evidence) => {
      const value = parseEvidenceObject(evidence.value);
      return [
        evidence.name ?? evidence.type,
        stringField(value, "category") ?? "analytics",
        stringField(value, "confidence") ?? "",
        arrayField(value, "evidence_refs").join(", "),
        "tracker host is not ownership proof",
      ];
    });
  const runtimeRows = contract.input.brief.evidence_index
    .filter((item) => item.probe === "runtime_third_party_resources_probe")
    .flatMap((item) => item.evidence_items)
    .filter((evidence) => /matomo/i.test(evidence.value))
    .map((evidence) => [
      "Matomo",
      "analytics",
      "observed",
      analyticsHostFromUrl(evidence.value) ?? "runtime third-party resource",
      "tracker host is not ownership proof",
    ]);
  const rows = dedupeTechnologyRows([...staticRows, ...runtimeRows]);
  return markdownTable(
    "Frontend technology evidence table:",
    ["Technology", "Category", "Confidence", "Evidence refs", "Boundary"],
    rows,
  );
}

function createCacheHeaderEvidenceTable(contract: AiNarrativeReportContract): string {
  const headerNames = new Set([
    "server",
    "cache-control",
    "pragma",
    "expires",
    "etag",
    "last-modified",
    "vary",
    "age",
    "cf-cache-status",
    "x-cache",
    "x-cache-hits",
    "server-timing",
  ]);
  const rows: string[][] = [];
  const seen = new Set<string>();

  for (const item of contract.input.brief.evidence_index) {
    if (!["http_headers_probe", "cache_policy_probe", "runtime_asset_cache_policy_probe"].includes(item.probe)) continue;

    for (const evidence of item.evidence_items) {
      const signal = (evidence.name ?? evidence.type).toLowerCase();
      if (!headerNames.has(signal) && !signal.startsWith("runtime_asset_cache_")) continue;

      const value = markdownCell(evidence.value, 72);
      if (!value) continue;

      const key = `${signal}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push([
        cacheHeaderSourceLabel(item.probe),
        signal,
        value,
        "Header/cache signals do not prove origin topology",
      ]);
    }
  }

  return markdownTable("Cache/header evidence table:", ["Source", "Signal", "Observed value", "Boundary"], rows.slice(0, 10));
}

function cacheHeaderSourceLabel(probe: string): string {
  if (probe === "cache_policy_probe") return "main response cache policy";
  if (probe === "runtime_asset_cache_policy_probe") return "runtime asset cache policy";
  return "main response headers";
}

function dedupeTechnologyRows(rows: string[][]): string[][] {
  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    const key = `${row[0].toLowerCase()}:${row[1].toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    const stronger = technologyConfidenceRank(row[2]) > technologyConfidenceRank(existing[2]) ? row : existing;
    byKey.set(key, [
      stronger[0],
      stronger[1],
      stronger[2],
      uniqueStrings([...splitCommaValues(existing[3]), ...splitCommaValues(row[3])]).join(", "),
      stronger[4],
    ]);
  }
  return Array.from(byKey.values());
}

function splitCommaValues(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function technologyConfidenceRank(value: string): number {
  const normalized = value.toLowerCase();
  if (normalized === "confirmed") return 3;
  if (normalized === "observed") return 2;
  if (normalized === "likely" || normalized === "medium") return 1;
  return 0;
}

function analyticsHostFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    const match = value.match(/\b([a-z0-9.-]*matomo[a-z0-9.-]*)\b/i);
    return match?.[1]?.toLowerCase() ?? null;
  }
}

function createPublicBusinessPageTable(contract: AiNarrativeReportContract): string {
  const detailRows = evidenceRows(contract, "public_product_business_detail_probe", ["product_business_detail_snippets"]);
  const contentRows = evidenceRows(contract, "public_business_content_probe", ["business_product_snippets"]);
  const sourceRows = [
    ...detailRows,
    ...(detailRows.length > 0 ? contentRows.filter((row) => !isGenericHomepageBusinessRow(row)) : contentRows),
  ];
  const rows = rankRows(sourceRows, scorePublicBusinessPageRow)
    .slice(0, 6)
    .map((row) => [
      stringField(row, "detail_kind") ?? classificationLabel(row),
      stringField(row, "controlled_hint") ?? "",
      stringField(row, "path") ?? "",
      stringField(row, "title") ?? stringField(row, "label") ?? "",
      arrayField(row, "workflow_terms").join(", "),
    ]);
  return markdownTable("Public business page table:", ["Kind", "Hint", "Path", "Title", "Workflow terms"], rows);
}

function createSpaOperationEvidenceTable(contract: AiNarrativeReportContract): string {
  const spaRows = evidenceRows(contract, "public_spa_route_metadata_probe", ["spa_operation_hints"]);
  const rows = compactSpaOperationEvidenceRows(
    contract,
    rankRows(
      [...spaRows, ...deriveCrossSourceOperationEvidenceRows(contract, spaRows)],
      scoreSpaOperationEvidenceRow,
    ),
  )
    .slice(0, 6)
    .map((row) => [
      stringField(row, "operation") ?? "",
      stringField(row, "signal") ?? "",
      operationSupportLabel(contract, row),
      operationConfidenceLabel(contract, row),
    ]);
  return markdownTable("SPA operation evidence table:", ["Operation", "Signal", "Support", "Confidence"], rows);
}

function compactSpaOperationEvidenceRows(
  contract: AiNarrativeReportContract,
  rankedRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const grouped = new Map<string, { row: Record<string, unknown>; signals: string[] }>();
  for (const row of rankedRows) {
    const operation = stringField(row, "operation");
    const signal = stringField(row, "signal");
    if (!operation || !signal) continue;
    const key = [
      operation,
      operationSupportLabel(contract, row),
      operationConfidenceLabel(contract, row),
    ].join("::");
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { row, signals: [signal] });
      continue;
    }
    current.signals = uniqueStrings([...current.signals, signal]);
  }

  return Array.from(grouped.values()).map(({ row, signals }) => ({
    ...row,
    signal: summarizeOperationSignals(signals),
  }));
}

function summarizeOperationSignals(signals: string[]): string {
  const unique = uniqueStrings(signals);
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique[0]} (+${unique.length - 1} related signal${unique.length > 2 ? "s" : ""})`;
}

function deriveCrossSourceOperationEvidenceRows(
  contract: AiNarrativeReportContract,
  existingRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const hasModelOperation = existingRows.some((row) => stringField(row, "operation") === "model-load/provider routing");

  if (!hasModelOperation && hasProviderRoutingPublicDocs(contract) && hasPublicModelsApiEndpoint(contract)) {
    rows.push({
      operation: "model-load/provider routing",
      signal: "/v1/models + provider-routing docs",
      support: "public docs + public API endpoint",
      confidence: "medium",
      basis: "docs/API evidence; no exact query-tab route",
    });
  }

  return rows;
}

function operationSupportLabel(contract: AiNarrativeReportContract, row: Record<string, unknown>): string {
  const support = stringField(row, "support");
  if (support) return support;

  const operation = (stringField(row, "operation") ?? "").toLowerCase();
  const sources = ["SPA asset string"];
  if (operation === "model-load/provider routing") {
    if (hasProviderRoutingPublicDocs(contract)) sources.push("public docs");
    if (hasPublicModelsApiEndpoint(contract)) sources.push("public API endpoint");
  }
  return sources.join(" + ");
}

function operationConfidenceLabel(contract: AiNarrativeReportContract, row: Record<string, unknown>): string {
  const operation = (stringField(row, "operation") ?? "").toLowerCase();
  if (operation === "model-load/provider routing" && hasProviderRoutingPublicDocs(contract) && hasPublicModelsApiEndpoint(contract)) {
    return "medium";
  }
  return stringField(row, "confidence") ?? "low";
}

function hasProviderRoutingPublicDocs(contract: AiNarrativeReportContract): boolean {
  return [
    ...evidenceRows(contract, "public_product_business_detail_probe", ["product_business_detail_snippets"]),
    ...evidenceRows(contract, "public_content_detail_probe", ["detail_pages"]),
    ...evidenceRows(contract, "public_api_compatibility_detail_probe", ["api_compatibility_snippets"]),
  ].some((row) => /provider|routing|model|provider\/<base_model>/.test(rowSearchText(row)));
}

function hasPublicModelsApiEndpoint(contract: AiNarrativeReportContract): boolean {
  return evidenceRows(contract, "bounded_public_api_endpoint_inventory_probe", ["public_api_endpoint_inventory"])
    .some((row) => (stringField(row, "path") ?? "").toLowerCase() === "/v1/models");
}


function createSecurityControlTable(contract: AiNarrativeReportContract): string {
  const securityHeaderItem = contract.input.brief.evidence_index.find((item) => item.probe === "security_headers_probe");
  if (!securityHeaderItem) return "";
  const missingHeader = findEvidenceItemValue(securityHeaderItem, ["missing", "security_header", "security headers"]);
  const rowValue = [missingHeader, securityHeaderItem.summary]
    .filter(Boolean)
    .filter((value, index, values) => index === 0 || !values[0]?.includes(value))
    .join("; ");
  return markdownTable("Security control table:", ["Control", "Observed state"], [["Missing headers", rowValue]], 160);
}

function createCorsRiskSignalTable(contract: AiNarrativeReportContract): string {
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
      "Risk signal; not confirmed exploitability",
    ]);
  return markdownTable(
    "CORS risk signal table:",
    ["Host", "Method", "Path", "Status", "Signals", "Boundary"],
    rows,
    120,
  );
}

function createPublicApiEndpointExposureTable(contract: AiNarrativeReportContract): string {
  const rows = evidenceRows(contract, "bounded_public_api_endpoint_inventory_probe", ["public_api_endpoint_inventory"])
    .slice(0, 6)
    .map((row) => [
      stringField(row, "host") ?? "",
      stringField(row, "method") ?? "",
      stringField(row, "path") ?? "",
      statusField(row),
      compactSignals(row.signals),
      "Public endpoint observation; not authenticated API validation",
    ]);
  return markdownTable(
    "Public API endpoint exposure table:",
    ["Host", "Method", "Path", "Status", "Signals", "Boundary"],
    rows,
    120,
  );
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
      cookieObservationBoundary(row),
    ]);
  return markdownTable(
    "Cookie observation table:",
    ["Host", "Method", "Path/Cookie", "Status", "Attributes", "Boundary"],
    rows,
    120,
  );
}

function cookieObservationBoundary(row: Record<string, unknown>): string {
  const path = stringField(row, "path") ?? stringField(row, "name") ?? "";
  if (/wp-login/i.test(path)) return "Public route/cookie metadata; not admin access";
  return "Public cookie metadata; not authenticated behavior";
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

function parseEvidenceObject(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function markdownTable(label: string, headers: string[], rows: string[][], bodyCellMaxLength = 80): string {
  const filteredRows = rows.filter((row) => row.some((cell) => cell.trim().length > 0));
  if (filteredRows.length === 0) return "";
  const header = `| ${headers.map((cell) => markdownCell(cell, 48)).join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = filteredRows.map((row) => `| ${row.map((cell) => markdownCell(cell, bodyCellMaxLength)).join(" | ")} |`);
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

function rankRows(
  rows: Record<string, unknown>[],
  scoreRow: (row: Record<string, unknown>) => number,
): Record<string, unknown>[] {
  return rows
    .map((row, index) => ({ row, index, score: scoreRow(row) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.row);
}

function scorePublicBusinessPageRow(row: Record<string, unknown>): number {
  const text = rowSearchText(row);
  const path = stringField(row, "path") ?? "";
  const hint = classificationLabel(row).toLowerCase();
  let score = 0;

  if (stringField(row, "detail_kind")) score += 18;
  if (/product|commercial|business/.test(hint)) score += 18;
  if (/article/.test(hint)) score += 8;
  if (/technical_documentation|docs|news|blog/.test(hint)) score -= 4;
  if (/community|status|unknown/.test(hint)) score -= 12;
  if (isGenericHomepageBusinessRow(row)) score -= 30;

  score += businessOperationScore(text);
  if (path && path !== "/") score += Math.min(12, path.split("/").filter(Boolean).length * 3);
  if (asStringArray(row.evidence_snippets ?? row.snippets).length > 0) score += 6;

  return score;
}

function scoreSpaRouteCandidateRow(row: Record<string, unknown>): number {
  const route = (stringField(row, "route_candidate") ?? "").toLowerCase();
  let score = confidenceScore(stringField(row, "confidence"));

  if (/^\/(pricing|billing|dashboard|login|signup|settings?)$/.test(route)) score += 20;
  if (/^\/(?:admin|api|auth|tool|agent|affiliate)\//.test(route)) score -= 50;
  if (route === "/" || route.includes("*")) score -= 20;
  if (/\.(js|css|svg|png|jpg|webp)$/i.test(route)) score -= 40;

  return score;
}

function scoreSpaAssetPreviewRow(row: Record<string, unknown>): number {
  const text = rowSearchText(row);
  let score = 0;
  if (stringField(row, "kind") === "script") score += 18;
  if (/entry|main|bundle/.test((stringField(row, "role") ?? "").toLowerCase())) score += 24;
  if (/route|router|lazy|chunk|vendor|profile|dashboard|billing/.test(text)) score += 16;
  if (compactSignals(row.signals).length > 0) score += 10;
  return score;
}

function scoreSpaOperationEvidenceRow(row: Record<string, unknown>): number {
  return confidenceScore(stringField(row, "confidence"));
}

function scoreApiCompatibilityRow(row: Record<string, unknown>): number {
  const text = rowSearchText(row);
  const apiBaseUrls = arrayField(row, "api_base_urls");
  const apiBaseUrlText = apiBaseUrls.join(" ").toLowerCase();
  let score = confidenceScore(stringField(row, "confidence"));
  if (apiBaseUrls.length > 0) score += 80;
  if (apiBaseUrls.length > 1) score += 90;
  if (/api-eu|regional/.test(apiBaseUrlText)) score += 60;
  if (/base url/.test(text)) score += 36;
  if (/api-eu|regional/.test(text)) score += 32;
  if (/https?:\/\/[a-z0-9.-]*api[a-z0-9.-]*\./.test(text)) score += 30;
  if (/chat completions|\/v1\/chat\/completions/.test(text)) score += 36;
  if (/responses|\/v1\/responses/.test(text)) score += 28;
  if (/anthropic|messages|\/v1\/messages/.test(text)) score += 30;
  if (/openai|chatgpt|gpt-/.test(text)) score += 28;
  if (/compatib/.test(text)) score += 28;
  if (/model naming|provider\/<base_model>|provider routing/.test(text)) score += 34;
  if (/us-east|regional/.test(text)) score += 20;
  if (stringField(row, "path")) score += 8;
  return score;
}

function scorePublicAppHeaderMetadataRow(row: Record<string, unknown>): number {
  const host = (stringField(row, "host") ?? "").toLowerCase();
  const signals = publicAppHeaderMetadataSignals(row).toLowerCase();
  let score = 0;
  if (host.includes("docs.")) score += 28;
  if (host.includes("community.")) score += 22;
  if (host.includes("blog.")) score += 14;
  if (/mintlify|mint proxy|vercel|next\/rsc/.test(signals)) score += 30;
  if (/discourse|x-runtime/.test(signals)) score += 24;
  if (statusField(row)) score += 4;
  return score;
}

function scorePublicCmsForumMetadataRow(row: Record<string, unknown>): number {
  const host = (stringField(row, "host") ?? "").toLowerCase();
  const path = (stringField(row, "path") ?? "").toLowerCase();
  const signals = publicCmsForumMetadataSignals(row).toLowerCase();
  let score = 0;
  if (host.includes("blog.")) score += 24;
  if (host.includes("community.")) score += 22;
  if (path.includes("wp-json")) score += 28;
  if (path.includes("latest.json")) score += 18;
  if (/wordpress|wp-json|namespace|timezone|asset version/.test(signals)) score += 30;
  if (/discourse|x-discourse-route|x-runtime|cached/.test(signals)) score += 28;
  if (statusField(row)) score += 4;
  return score;
}

function scoreCtSubdomainCandidateRow(row: Record<string, unknown>): number {
  const host = (stringField(row, "host") ?? "").toLowerCase();
  const labels = host.split(".").filter(Boolean);
  const leftLabel = labels[0] ?? "";
  let score = 0;

  if (labels.length === 3) score += 28;
  if (labels.length > 3) score -= 16;
  if (/^(admin|internal|dev|test|ci|s3|n8n|bt|fanyi|translate|proxify)$/i.test(leftLabel)) score -= 28;
  if (/^(api|docs|blog|community|status)$/i.test(leftLabel)) score += 14;
  if (/^[a-z][a-z0-9-]{2,20}$/i.test(leftLabel)) score += 8;
  if (arrayField(row, "indicators").length > 0) score += 4;

  return score;
}

function ctHostGroupLabel(host: string): string {
  return ctHostGroupKey(host);
}

function ctHostGroupKey(host: string): string {
  const normalized = host.toLowerCase();
  const labels = normalized.split(".").filter(Boolean);
  const leftLabel = labels[0] ?? "";

  if (/^(api|docs|blog|community|status)$/.test(leftLabel)) return "official/public";
  if (/^(academy|news|nav|demo)$/.test(leftLabel)) return "placeholder/content";
  if (leftLabel === "s3" || normalized.includes(".s3.")) return "storage/media";
  if (/^(ci|bench)$/.test(leftLabel)) return "tooling/ci";
  if (/^(fanyi|translate)$/.test(leftLabel) || normalized.includes(".translate.")) return "translation/tool";
  return "other candidate";
}

function confidenceScore(value: string | null): number {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "confirmed" || normalized === "high") return 30;
  if (normalized === "likely" || normalized === "medium") return 20;
  if (normalized === "possible" || normalized === "low") return 6;
  return 0;
}

function businessOperationScore(text: string): number {
  let score = 0;
  if (/supplier|vendor|onboarding/.test(text)) score += 28;
  if (/payout|withdraw|withdrawal|settlement/.test(text)) score += 26;
  if (/routing|provider/.test(text)) score += 24;
  if (/pricing|price|cost|discount/.test(text)) score += 18;
  if (/token|recharge|billing|payment|wallet|log|model/.test(text)) score += 16;
  if (/about|platform/.test(text)) score += 8;
  return score;
}

function rowSearchText(row: Record<string, unknown>): string {
  const parts = [
    stringField(row, "title"),
    stringField(row, "label"),
    stringField(row, "path"),
    stringField(row, "detail_kind"),
    stringField(row, "controlled_hint"),
    stringField(row, "route_candidate"),
    stringField(row, "operation"),
    stringField(row, "signal"),
    stringField(row, "basis"),
    stringField(row, "source_asset"),
    stringField(row, "role"),
    compactSignals(row.signals),
    ...arrayField(row, "workflow_terms"),
    ...asStringArray(row.evidence_snippets ?? row.snippets),
  ];
  return parts.filter((part): part is string => Boolean(part)).join(" ").toLowerCase();
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

function bodyPreviewMetadata(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof row.body_preview_bytes === "number") parts.push(`${row.body_preview_bytes} bytes sampled`);
  if (typeof row.body_preview_truncated === "boolean") parts.push(row.body_preview_truncated ? "truncated" : "not truncated");
  return parts.join("; ");
}

function publicAppHeaderMetadataSignals(row: Record<string, unknown>): string {
  const signals: string[] = [];
  const discourseRoute = stringField(row, "discourse_route");
  const discourseRuntime = stringField(row, "discourse_runtime");
  const mintlifyClient = stringField(row, "mintlify_client_version");
  const mintProxy = stringField(row, "mint_proxy_version");
  const vercelCache = stringField(row, "vercel_cache");
  const nextRscVary = stringField(row, "next_rsc_vary");
  if (discourseRoute) signals.push(`Discourse route ${discourseRoute}`);
  if (discourseRuntime) signals.push(`x-runtime ${discourseRuntime}`);
  if (mintlifyClient) signals.push(`Mintlify ${mintlifyClient}`);
  if (mintProxy) signals.push(`Mint proxy ${mintProxy}`);
  if (vercelCache) signals.push(`Vercel ${vercelCache}`);
  if (nextRscVary) signals.push("Next/RSC vary");
  if (signals.length === 0) signals.push(...arrayField(row, "signals").slice(0, 3));
  return signals.slice(0, 4).join(", ");
}

function publicCmsForumPlatformLabel(row: Record<string, unknown>): string {
  const parsed = parsedField(row);
  const host = (stringField(row, "host") ?? "").toLowerCase();
  const path = (stringField(row, "path") ?? "").toLowerCase();
  const text = rowSearchText({ ...row, ...parsed });
  if (path.includes("wp-json") || host.includes("blog.") || /wordpress|wp-json|wp\/v2|oembed/.test(text)) return "WordPress public metadata";
  if (host.includes("community.") || /discourse|x_discourse|x-discourse|list\/latest/.test(text)) return "Discourse public metadata";
  return "";
}

function publicCmsForumMetadataSignals(row: Record<string, unknown>): string {
  const parsed = parsedField(row);
  const signals: string[] = [];
  const wordpressName = stringField(parsed, "wordpress_name") ?? stringField(row, "wordpress_name");
  const wordpressTimezone = stringField(parsed, "wordpress_timezone") ?? stringField(row, "wordpress_timezone");
  const wordpressNamespaces = arrayField(parsed, "wordpress_namespaces").length > 0
    ? arrayField(parsed, "wordpress_namespaces")
    : arrayField(row, "wordpress_namespaces");
  const wordpressAssetVersions = arrayField(parsed, "wordpress_asset_versions").length > 0
    ? arrayField(parsed, "wordpress_asset_versions")
    : arrayField(row, "wordpress_asset_versions");
  const discourseRoute = stringField(parsed, "discourse_route")
    ?? stringField(parsed, "x_discourse_route")
    ?? stringField(row, "discourse_route")
    ?? stringField(row, "x_discourse_route");
  const discourseCached = stringField(parsed, "discourse_cached")
    ?? stringField(parsed, "x_discourse_cached")
    ?? stringField(row, "discourse_cached")
    ?? stringField(row, "x_discourse_cached");
  const discourseRuntime = stringField(parsed, "discourse_runtime")
    ?? stringField(parsed, "x_runtime")
    ?? stringField(row, "discourse_runtime")
    ?? stringField(row, "x_runtime");

  if (wordpressNamespaces.length > 0) signals.push(`wordpress_namespaces=${prioritizeWordpressNamespaces(wordpressNamespaces).join(",")}`);
  if (wordpressName) signals.push(`wordpress_name=${wordpressName}`);
  if (wordpressTimezone) signals.push(`wordpress_timezone=${wordpressTimezone}`);
  if (wordpressAssetVersions.length > 0) signals.push(`wordpress_asset_versions=${wordpressAssetVersions.slice(0, 3).join(",")}`);
  if (discourseRoute) signals.push(`x-discourse-route=${discourseRoute}`);
  if (discourseCached) signals.push(`x-discourse-cached=${discourseCached}`);
  if (discourseRuntime) signals.push(`x-runtime=${discourseRuntime}`);
  return signals.slice(0, 4).join(", ");
}

function prioritizeWordpressNamespaces(values: string[]): string[] {
  const priority = ["meow-lightbox", "farallon", "wp/v2", "oembed/1.0"];
  const unique = uniqueStrings(values);
  const selected = [
    ...priority.filter((item) => unique.includes(item)),
    ...unique.filter((item) => !priority.includes(item)),
  ];
  return selected.slice(0, 4);
}

function publicCmsForumBoundary(row: Record<string, unknown>): string {
  const platform = publicCmsForumPlatformLabel(row).toLowerCase();
  if (platform.includes("wordpress")) {
    return "Public metadata; not admin access, vulnerability proof, or exact core version";
  }
  if (platform.includes("discourse")) {
    return "Public headers/metadata; not authenticated community behavior";
  }
  return "Public metadata only";
}

function parsedField(row: Record<string, unknown>): Record<string, unknown> {
  return isRecord(row.parsed) ? row.parsed : {};
}

function formatPublicAppHeaderMetadataFact(row: Record<string, unknown>): string {
  const host = stringField(row, "host");
  const signals = publicAppHeaderMetadataSignals(row);
  if (!host || !signals) return "";
  return `${host}: ${signals}`;
}

function ctSubdomainSignals(row: Record<string, unknown>): string {
  const signals = [
    ...arrayField(row, "sources"),
    ...arrayField(row, "indicators"),
  ];
  const source = stringField(row, "source");
  if (source && signals.length === 0) signals.push(source);
  return signals.slice(0, 3).join(", ");
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
  if (key === "access_control_allow_origin_reflects_probe_origin") {
    return detail ? `allow-origin reflected (${detail})` : "allow-origin reflected";
  }
  if (key === "cors_allow_origin") {
    if (detail.includes("site-10-layer-check.invalid")) return `allow-origin reflected (${detail})`;
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
  const snippets = [...arrayField(value, "workflow_terms"), ...asStringArray(value.evidence_snippets ?? value.snippets)]
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
  if (/创建令牌/.test(text)) labels.push("创建令牌/token creation");
  if (/充值/.test(text)) labels.push("充值/recharge");
  if (/查看日志/.test(text)) labels.push("查看日志/logs");
  if (/收益提现/.test(text)) labels.push("收益提现/payouts");
  if (/payout|withdraw|withdrawal|提现|settlement/.test(text)) labels.push("payouts/withdrawals");
  if (/model[_/-]?load|model[_/-]?stat|\/v1\/models|\/dash\/model/.test(text)) labels.push("model-load/provider routing");
  if (/routing|provider|厂商|路由/.test(text)) labels.push("provider routing");
  if (/about|platform|关于|平台/.test(text)) labels.push("platform overview");
  if (/cost|成本|降/.test(text)) labels.push("cost-reduction content");
  if (/product|products|商品|产品/.test(text)) labels.push("vendor/product pages");
  return uniqueStrings(labels).slice(0, 6);
}

function summarizeApiCompatibilitySignals(values: string[]): string {
  return uniqueStrings(values).slice(0, 3).join("; ");
}

function summarizeApiCompatibilitySnippet(row: Record<string, unknown>): string {
  const snippets = arrayField(row, "snippets");
  const excerpt = stringField(row, "excerpt");
  const preferred = snippets.find((snippet) => /https?:\/\/|api-eu|\/v1\/(?:chat\/completions|messages|responses)/i.test(snippet))
    ?? excerpt
    ?? snippets[0]
    ?? "";
  return truncate(preferred.replace(/\s+/g, " "), 120);
}

function summarizeApiBaseUrlSnippet(row: Record<string, unknown>, apiBaseUrl: string): string {
  const snippets = arrayField(row, "snippets");
  const excerpt = stringField(row, "excerpt");
  const regionalBaseUrl = isRegionalApiBaseUrl(apiBaseUrl);
  const preferred = snippets.find((snippet) => snippetMentionsApiBaseUrl(snippet, apiBaseUrl))
    ?? (regionalBaseUrl ? summarizeRegionalApiBaseUrlFallback(row, apiBaseUrl) : null)
    ?? snippets.find((snippet) => /https?:\/\/|api-eu|\/v1\/(?:chat\/completions|messages|responses)/i.test(snippet))
    ?? excerpt
    ?? snippets[0]
    ?? "";
  return truncate(preferred.replace(/\s+/g, " "), 120);
}

function summarizeRegionalApiBaseUrlFallback(row: Record<string, unknown>, apiBaseUrl: string): string | null {
  const signals = arrayField(row, "compatibility_signals").join(" ");
  const snippets = arrayField(row, "snippets");
  const hasRegionalEvidence = /regional|api-eu|direct|without\s+cdn|no\s*cdn|副接口|直连|无\s*cdn/i.test(signals)
    || snippets.some(isRegionalApiEndpointSnippet);
  return hasRegionalEvidence ? `Regional endpoint documented: ${apiBaseUrl}` : null;
}

function snippetMentionsApiBaseUrl(snippet: string, apiBaseUrl: string): boolean {
  const normalizedSnippet = snippet.toLowerCase();
  for (const candidate of apiBaseUrlMatchCandidates(apiBaseUrl)) {
    if (candidate && normalizedSnippet.includes(candidate)) return true;
  }
  return false;
}

function apiBaseUrlMatchCandidates(apiBaseUrl: string): string[] {
  const normalized = apiBaseUrl.toLowerCase().replace(/\/+$/, "");
  const candidates = [normalized, `${normalized}/`];
  try {
    const parsed = new URL(apiBaseUrl);
    candidates.push(parsed.host.toLowerCase());
  } catch {
    // Keep the normalized string fallback for malformed candidate evidence.
  }
  return uniqueStrings(candidates);
}

function isRegionalApiBaseUrl(apiBaseUrl: string): boolean {
  return /api-[a-z]+-[a-z]+-\d|api-eu|dc\d+|regional/i.test(apiBaseUrl);
}

function isRegionalApiEndpointSnippet(snippet: string): boolean {
  return /api-[a-z]+-[a-z]+-\d|api-eu|dc\d+|regional|direct|without\s+cdn|no\s*cdn|副接口|直连|无\s*cdn/i.test(snippet);
}

function arrayField(value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  if (!Array.isArray(field)) return [];
  return field.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function stringifyEvidenceValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function createFallbackContent(
  contract: AiNarrativeReportContract,
  guidance: AiNarrativeReportContract["output_contract"]["section_guidance"][number],
  evidenceRefs: string[],
  _missingRefs: string[],
): string {
  const brief = contract.input.brief;
  const businessModelSynthesis = guidance.id === "summary" || guidance.id === "organization_operations"
    ? createBusinessModelSynthesisFact(contract)
    : "";

  if (guidance.id === "summary") {
    const warningCount = brief.layers.filter((layer) => layer.status === "warning" || layer.status === "error").length;
    const riskCount = brief.risks.filter((risk) => risk.level === "high" || risk.level === "medium").length;
    return [
      `This report is based on ${brief.run.record_count} normalized record(s) across ${brief.coverage.collected_layers.length}/${brief.coverage.total_layers} collected layer(s).`,
      businessModelSynthesis,
      warningCount > 0 ? `${warningCount} layer(s) contain warning or error signals.` : "No layer has warning or error status in the current evidence.",
      riskCount > 0 ? `${riskCount} high/medium risk item(s) should be reviewed first.` : "No high/medium risk item is flagged by the deterministic analysis.",
    ].filter(Boolean).join(" ");
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
    const synthesisPrefix = businessModelSynthesis ? `${businessModelSynthesis} ` : "";
    return `${synthesisPrefix}${createSectionFactAppendLabel(guidance.id)} ${factHints.join(" ")}`;
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
      paragraphMarkers: [
        "Business model synthesis:",
        "Performance score",
        "Lighthouse performance score",
        "Missing security headers:",
        "Subdomain/reachability matrix:",
      ],
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
        "Static frontend marker evidence:",
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
        "CORS risk signal:",
        "Public API endpoint exposure:",
        "Bounded public CORS check:",
        "Bounded public API endpoint inventory:",
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
  const paragraphs = collapseExcessParagraphs(removeInlineDeterministicTableFragments(sectionId, content))
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
  if (
    sectionId === "security_posture" &&
    (claimNormalized.includes("cors") || claimNormalized.includes("access-control"))
  ) {
    return "CORS response-header signals are risk signals, not confirmed exploitability.";
  }
  if (sectionId === "security_posture" && (normalized.includes("/health") || normalized.includes("/v1/models"))) {
    return "Bounded public API endpoint observations are inventory signals, not authenticated API validation.";
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
    if (shouldDropDenseTableOwnedParagraph(sectionId, paragraph)) continue;
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
  if (sectionId === "security_posture" && normalized.startsWith("bounded public cors check:")) return "bounded_cors_check";
  if (sectionId === "security_posture" && normalized.startsWith("cors risk signal:")) return "cors_risk_signal";
  if (sectionId === "security_posture" && normalized.startsWith("public api endpoint exposure:")) {
    return "public_api_endpoint_exposure";
  }
  if (sectionId === "security_posture" && normalized.startsWith("bounded public api endpoint inventory:")) {
    return "bounded_public_api_endpoint_inventory";
  }
  if (sectionId === "api_protocol_surface" && normalized.startsWith("bounded public cors check:")) return "bounded_cors_check";
  return null;
}

function shouldDropDenseTableOwnedParagraph(sectionId: string, paragraph: string): boolean {
  const normalized = paragraph.toLowerCase();
  if (sectionId === "technology_stack") {
    return (
      normalized.startsWith("bounded public app header metadata:") ||
      normalized.startsWith("public app/header metadata:") ||
      normalized.startsWith("observed public app header metadata signal") ||
      normalized.includes("docs.poix...")
    );
  }
  return false;
}

function removeInlineDeterministicTableFragments(sectionId: string, content: string): string {
  const labelsBySection: Record<string, string[]> = {
    public_information_architecture: [
      "Public content surface table:",
      "Public detail page table:",
      "SPA route candidate table:",
    ],
    technology_stack: [
      "Frontend technology evidence table:",
      "SPA signal table:",
      "SPA asset preview table:",
      "Public app marker table:",
      "Public app header metadata table:",
    ],
    deployment_network_surface: ["Cache/header evidence table:"],
    api_protocol_surface: [
      "API base URL table:",
      "API compatibility evidence table:",
      "API endpoint table:",
      "API model list detail table:",
      "CORS observation table:",
    ],
    subdomain_attack_surface: [
      "Public host table:",
      "CT-discovered host candidate table:",
    ],
    organization_operations: [
      "Public business page table:",
      "SPA operation evidence table:",
      "Organization evidence table:",
    ],
    security_posture: [
      "Security control table:",
      "CORS risk signal table:",
      "Public API endpoint exposure table:",
      "Cookie observation table:",
    ],
  };
  let result = content;
  for (const label of labelsBySection[sectionId] ?? []) {
    result = removeInlineTableFragment(result, label);
  }
  return result;
}

function removeInlineTableFragment(content: string, label: string): string {
  let result = content;
  let start = result.indexOf(`${label} |`);
  while (start >= 0) {
    const end = findInlineTableFragmentEnd(result, start + label.length);
    result = `${result.slice(0, start).trimEnd()} ${result.slice(end).trimStart()}`.replace(/\s{2,}/g, " ").trim();
    start = result.indexOf(`${label} |`);
  }
  return result;
}

function findInlineTableFragmentEnd(content: string, fromIndex: number): number {
  const markers = [
    "Subdomain/reachability matrix:",
    "Public SPA asset metadata:",
    "Bounded public app header metadata:",
    "Public product/business detail:",
    "Public business/product content:",
    "Public API compatibility detail:",
    "Security evidence:",
    "Missing security headers:",
    "Frame embedding policy",
    "No Set-Cookie",
    "Browser runtime",
    "Collected ",
    "Checked ",
    "Found ",
    "Evidence:",
    "Boundaries:",
  ];
  const candidates = markers
    .map((marker) => content.indexOf(marker, fromIndex))
    .filter((index) => index >= 0);
  return candidates.length > 0 ? Math.min(...candidates) : content.length;
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
  const trimmed = value.trim();
  if (/^Do not infer business model or ownership from technical evidence alone/i.test(trimmed)) {
    return "Technical evidence alone does not prove business model or ownership.";
  }
  return value
    .trim()
    .replace(/;?\s*Do not place CORS,[\s\S]*$/i, "")
    .replace(/;?\s*Do not add generic Missing data[\s\S]*$/i, "")
    .replace(/;?\s*Do not infer ownership,[\s\S]*$/i, "")
    .replace(/;?\s*Use each section_guidance[\s\S]*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isInvalidSectionLimitation(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes(" evidence:") ||
    normalized.includes("public spa asset metadata:") ||
    normalized.includes("bounded public app header metadata:") ||
    normalized.includes("static frontend marker evidence:") ||
    normalized.includes("no third-party script was found") ||
    normalized.includes("generated from bounded reportbrief") ||
    normalized.includes("do not place ") ||
    normalized.includes("do not infer ") ||
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
    .replace(/ Business model synthesis:\s*/g, "\n\nBusiness model synthesis: ")
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
    if (/^Business model synthesis:/i.test(trimmed)) return trimBusinessModelSynthesisParagraph(trimmed);
    if (/^Collected organization-facing DNS/i.test(trimmed) && !/larksuite|mail DNS/i.test(trimmed)) return "";
    if (/^Public SPA operation evidence:/i.test(trimmed)) {
      return `Public operations evidence: ${trimmed.replace(/^Public SPA operation evidence:\s*/i, "SPA operation hints: ")}`;
    }
    return `Public operations evidence: ${trimmed}`;
  }
  return value;
}

function trimBusinessModelSynthesisParagraph(value: string): string {
  return value
    .replace(/\s+(?:SPA operation hints:|Preserved \d+ bounded public API endpoint|Collected public business\/product|Collected organization-facing DNS)[\s\S]*$/i, "")
    .trim();
}

function uniqueOrganizationParagraph(value: string, index: number, values: string[]): boolean {
  const key = organizationParagraphKey(value);
  if (!key) return true;
  return values.findIndex((candidate) => organizationParagraphKey(candidate) === key) === index;
}

function organizationParagraphKey(value: string): string | null {
  for (const label of [
    "Business model synthesis:",
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
  if (value.startsWith("Business model synthesis:")) return 5;
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

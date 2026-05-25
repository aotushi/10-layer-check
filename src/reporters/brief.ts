import { LAYERS } from "../core/layers";
import type { Evidence, EvidenceMetadata, Run, SnapshotRecord } from "../core/types";
import { type AnalysisReport, createAnalysisReport } from "./analysis";

export type MissingDataClassification =
  | "add_provider"
  | "requires_user_input"
  | "requires_permission"
  | "manual_review"
  | "out_of_scope";

export type ReportBriefEvidence = {
  id: string;
  layer: number;
  probe: string;
  item: string;
  status: string;
  source: string;
  summary: string;
  metadata: EvidenceMetadata | null;
  evidence_items: ReportBriefEvidenceItem[];
  limitations: string[];
};

export type ReportBriefEvidenceItem = {
  type: string;
  name?: string;
  value: string;
};

export type ReportBriefMissingData = {
  id: string;
  layer: number;
  description: string;
  classification: MissingDataClassification;
  evidence_refs: string[];
};

export type ReportBriefLayer = {
  layer: number;
  name: string;
  status: string;
  summary: string;
  key_findings: string[];
  evidence_refs: string[];
  limitations: string[];
  missing_data_ids: string[];
};

export type ReportBrief = {
  schema_version: "site-10-layer-report-brief/v0.1";
  target: string;
  normalized_target: string;
  generated_at: string;
  run: AnalysisReport["run"];
  coverage: AnalysisReport["coverage"];
  ai_boundary: {
    invokes_ai_provider: false;
    instruction: string;
    claim_policy: string[];
  };
  executive_summary: string[];
  layers: ReportBriefLayer[];
  evidence_index: ReportBriefEvidence[];
  missing_data: ReportBriefMissingData[];
  risks: AnalysisReport["risks"];
  next_steps: string[];
};

export function createReportBrief(run: Run, analysis: AnalysisReport = createAnalysisReport(run)): ReportBrief {
  const evidenceIndex = createBriefEvidenceIndex(run, analysis);
  const missingData = createMissingData(run, analysis);
  const missingByLayer = groupMissingByLayer(missingData);

  return {
    schema_version: "site-10-layer-report-brief/v0.1",
    target: analysis.target,
    normalized_target: analysis.normalized_target,
    generated_at: analysis.generated_at,
    run: analysis.run,
    coverage: analysis.coverage,
    ai_boundary: {
      invokes_ai_provider: false,
      instruction:
        "Use this brief as evidence input only. Final narrative claims must cite evidence_refs and account for limitations and missing_data.",
      claim_policy: [
        "Do not turn registration, archive, DNS, header, or heuristic signals into ownership claims without explicit evidence.",
        "Do not treat provider-ready contracts as collected target evidence.",
        "If a layer has missing_data, describe the gap or keep the conclusion provisional.",
      ],
    },
    executive_summary: analysis.executive_summary,
    layers: analysis.layer_summaries.map((layer) => ({
      layer: layer.layer,
      name: layer.name,
      status: layer.status,
      summary: layer.summary,
      key_findings: layer.key_findings,
      evidence_refs: layer.evidence_refs,
      limitations: layer.limitations,
      missing_data_ids: (missingByLayer.get(layer.layer) ?? []).map((item) => item.id),
    })),
    evidence_index: evidenceIndex,
    missing_data: missingData,
    risks: analysis.risks,
    next_steps: analysis.next_steps,
  };
}

function createBriefEvidenceIndex(run: Run, analysis: AnalysisReport): ReportBriefEvidence[] {
  return analysis.evidence_index.map((ref) => {
    const record = run.records.find(
      (item) =>
        item.layer === ref.layer &&
        item.probe === ref.probe &&
        item.item === ref.item &&
        item.status === ref.status &&
        item.source === ref.source,
    );

    return {
      id: ref.id,
      layer: ref.layer,
      probe: ref.probe,
      item: ref.item,
      status: ref.status,
      source: ref.source,
      summary: record?.risk.summary ?? "",
      metadata: record?.evidence_metadata ?? null,
      evidence_items: compactEvidenceItems(record?.evidence ?? []),
      limitations: record?.evidence_metadata?.limitations ?? [],
    };
  });
}

function createMissingData(run: Run, analysis: AnalysisReport): ReportBriefMissingData[] {
  const items: Array<Omit<ReportBriefMissingData, "id">> = [];

  items.push(...createProviderStatusMissingData(run, analysis));
  items.push(...createExplicitMissingData(run, analysis));

  for (const layer of analysis.layer_summaries) {
    if (layer.status === "missing") {
      items.push({
        layer: layer.layer,
        description: `Layer ${layer.layer} ${layer.name} has no collected target evidence.`,
        classification: "add_provider",
        evidence_refs: [],
      });
    }
  }

  const deduped = dedupeMissingData(items);
  return deduped.map((item, index) => ({
    id: `M${String(index + 1).padStart(3, "0")}`,
    ...item,
  }));
}

function createProviderStatusMissingData(
  run: Run,
  analysis: AnalysisReport,
): Array<Omit<ReportBriefMissingData, "id">> {
  const items: Array<Omit<ReportBriefMissingData, "id">> = [];

  for (const record of run.records) {
    if (!isProviderResultStatusRecord(record) || record.layer < 1 || record.layer > 10) continue;

    const value = record.value;
    const provider = typeof value.provider === "string" ? value.provider : record.source;
    const errorCode = typeof value.error_code === "string" ? value.error_code : null;
    const error = typeof value.error === "string" ? value.error : null;
    const status = typeof value.status === "string" || typeof value.status === "number" ? String(value.status) : record.status;
    const missingConfig = Array.isArray(value.missing_config)
      ? value.missing_config.filter((item): item is string => typeof item === "string")
      : [];
    const evidenceRef = analysis.evidence_index.find(
      (item) =>
        item.layer === record.layer &&
        item.probe === record.probe &&
        item.item === record.item &&
        item.status === record.status &&
        item.source === record.source,
    )?.id;

    items.push({
      layer: record.layer,
      description:
        record.status === "error"
          ? `${provider} provider did not return usable target evidence: ${errorCode ?? error ?? "provider_error"}.`
          : `${provider} provider has no completed target evidence yet; current provider status is ${status}.`,
      classification: missingConfig.length > 0 ? "requires_user_input" : "add_provider",
      evidence_refs: evidenceRef ? [evidenceRef] : [],
    });
  }

  return items;
}

function createExplicitMissingData(run: Run, analysis: AnalysisReport): Array<Omit<ReportBriefMissingData, "id">> {
  const items: Array<Omit<ReportBriefMissingData, "id">> = [];
  const collectedSignalsByLayer = createCollectedSignalsByLayer(run);

  for (const record of run.records) {
    if (record.status === "skipped" || isProviderContractRecord(record)) continue;

    const evidenceRef = analysis.evidence_index.find(
      (item) =>
        item.layer === record.layer &&
        item.probe === record.probe &&
        item.item === record.item &&
        item.status === record.status &&
        item.source === record.source,
    )?.id;
    const evidenceRefs = evidenceRef ? [evidenceRef] : [];

    for (const description of extractExplicitGaps(record.value)) {
      if (isGapSatisfiedByLayerEvidence(description, collectedSignalsByLayer.get(record.layer))) continue;
      items.push({
        layer: record.layer,
        description,
        classification: classifyMissingData(description),
        evidence_refs: evidenceRefs,
      });
    }
  }

  return items;
}

function createCollectedSignalsByLayer(run: Run): Map<number, Set<string>> {
  const result = new Map<number, Set<string>>();

  for (const record of run.records) {
    if (record.status === "skipped" || isProviderContractRecord(record)) continue;

    const signals = result.get(record.layer) ?? new Set<string>();
    addCollectedSignals(signals, record.value);
    addDerivedCollectedSignals(signals, record);
    result.set(record.layer, signals);
  }

  addCrossLayerCollectedSignals(result, run.records);

  return result;
}

function addCrossLayerCollectedSignals(signalsByLayer: Map<number, Set<string>>, records: SnapshotRecord[]): void {
  const layerFiveSignals = signalsByLayer.get(5) ?? new Set<string>();

  for (const record of records) {
    if (record.status === "skipped" || isProviderContractRecord(record)) continue;

    if (record.probe === "runtime_resource_waterfall_probe") {
      layerFiveSignals.add(normalizeSignal("runtime_resource_waterfall"));
      layerFiveSignals.add(normalizeSignal("browser_resource_waterfall"));
      layerFiveSignals.add(normalizeSignal("javascript_runtime_resource_injection"));
    }
  }

  signalsByLayer.set(5, layerFiveSignals);
}

function addCollectedSignals(signals: Set<string>, value: unknown): void {
  if (!isRecord(value)) return;

  const coverage = isRecord(value.coverage) ? value.coverage : null;
  if (Array.isArray(coverage?.collected)) {
    for (const item of coverage.collected) {
      if (typeof item === "string") signals.add(normalizeSignal(item));
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "html" || key === "certificates" || key === "records") continue;
    addCollectedSignals(signals, child);
  }
}

function addDerivedCollectedSignals(signals: Set<string>, record: SnapshotRecord): void {
  if (record.layer === 2 && record.probe === "tls_live_certificate_probe" && record.status !== "error" && isRecord(record.value)) {
    signals.add(normalizeSignal("current_certificate"));
    signals.add(normalizeSignal("live_certificate"));

    const chain = Array.isArray(record.value.chain) ? record.value.chain : [];
    if (chain.length > 0) signals.add(normalizeSignal("live_certificate_chain"));

    const certificate = isRecord(record.value.certificate) ? record.value.certificate : null;
    if (certificate) {
      signals.add(normalizeSignal("current_certificate"));
      if (isRecord(certificate.issuer)) signals.add(normalizeSignal("live_certificate_issuer"));
      if (typeof certificate.valid_to === "string" || typeof record.value.days_until_expiry === "number") {
        signals.add(normalizeSignal("live_certificate_expiry"));
      }
      if (
        (Array.isArray(certificate.subject_alt_names) && certificate.subject_alt_names.length > 0) ||
        typeof certificate.raw_subject_alt_name === "string"
      ) {
        signals.add(normalizeSignal("live_certificate_san"));
      }
    }
  }

  if (record.layer !== 5 || record.probe !== "performance_probe" || !isRecord(record.value)) return;

  const metrics = Array.isArray(record.value.metrics) ? record.value.metrics : [];
  if (metrics.length > 0) signals.add(normalizeSignal("lighthouse_lab_metrics"));

  const performanceScore = record.value.performance_score;
  if (typeof performanceScore === "number") {
    signals.add(normalizeSignal("performance_score"));
    signals.add(normalizeSignal("lighthouse_score"));
  }

  const rawSummary = isRecord(record.value.raw_summary) ? record.value.raw_summary : null;
  const fieldData = isRecord(rawSummary?.field_data) ? rawSummary.field_data : null;
  if (fieldData?.available === true) {
    signals.add(normalizeSignal("crux_field_data"));
    signals.add(normalizeSignal("core_web_vitals_field_data"));
  }
}

function isGapSatisfiedByLayerEvidence(description: string, signals: Set<string> | undefined): boolean {
  if (!signals) return false;

  for (const candidate of getGapSignalCandidates(description)) {
    if (signals.has(normalizeSignal(candidate))) return true;
  }

  return false;
}

function getGapSignalCandidates(description: string): string[] {
  const normalized = normalizeSignal(description);
  const aliases: Record<string, string[]> = {
    lighthouse_score: ["performance_score", "lighthouse_lab_metrics"],
    core_web_vitals_field_data: ["crux_field_data"],
    current_certificate_is_not_collected: ["current_certificate", "live_certificate"],
    live_certificate_chain: ["live_certificate_chain", "live_certificate"],
    live_certificate_san: ["live_certificate_san", "live_certificate"],
    live_certificate_issuer: ["live_certificate_issuer", "live_certificate"],
    live_certificate_expiry: ["live_certificate_expiry", "live_certificate"],
    browser_resource_waterfall: ["runtime_resource_waterfall"],
    javascript_runtime_resource_injection: ["runtime_resource_waterfall"],
  };

  return [normalized, ...(aliases[normalized] ?? [])];
}

function normalizeSignal(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function classifyMissingData(description: string): MissingDataClassification {
  const value = description.toLowerCase();

  if (/\bout[- ]of[- ]scope\b|out of scope|icp|jurisdiction/.test(value)) return "out_of_scope";
  if (/permission|authorization|authorisation|intrusive|scan boundary|rate limit|authenticated|user-enumeration/.test(value)) {
    return "requires_permission";
  }
  if (/user input|user-provided|user supplied|credential|api key|login|account/.test(value)) return "requires_user_input";
  if (/manual review|manual confirmation|related[-_ ]domain|ownership|operating entity|report layer|ai\/report|final entity/.test(value)) {
    return "manual_review";
  }

  return "add_provider";
}

function extractExplicitGaps(value: unknown, path = ""): string[] {
  if (!isRecord(value)) return [];

  const gaps: string[] = [];

  if (value.status === "not_collected" && path) {
    gaps.push(`${path} is not collected`);
  }

  if (path.endsWith("coverage") && Array.isArray(value.missing)) {
    for (const item of value.missing) {
      if (typeof item === "string") gaps.push(item);
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "html" || key === "certificates" || key === "records") continue;
    gaps.push(...extractExplicitGaps(child, path ? `${path}.${key}` : key));
  }

  return gaps;
}

function compactEvidenceItems(items: Evidence[]): ReportBriefEvidenceItem[] {
  const result: ReportBriefEvidenceItem[] = [];
  for (const item of items.slice(0, 20)) {
    result.push({
      type: item.type,
      ...(item.name ? { name: item.name } : {}),
      value: compactEvidenceValue(item),
    });
    result.push(...createDerivedBriefEvidenceItems(item));
  }
  return result.slice(0, 20);
}

function compactEvidenceValue(item: Evidence): string {
  const tableRows = compactTableRowsForEvidenceItem(item);
  const isSubdomains = item.name === "subdomains";
  if (tableRows) {
    const maxLength = isSubdomains ? 1800 : 900;
    const maxRows = isSubdomains ? 16 : 8;
    for (let size = Math.min(tableRows.length, maxRows); size >= 1; size -= 1) {
      const text = JSON.stringify(tableRows.slice(0, size));
      if (text.length <= maxLength) return text;
    }
    return JSON.stringify([]);
  }
  return compactValue(item.value);
}

function createDerivedBriefEvidenceItems(_item: Evidence): ReportBriefEvidenceItem[] {
  return [];
}

function compactValue(value: unknown): string {
  if (Array.isArray(value)) return compactArrayValue(value);
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 900 ? `${text.slice(0, 900)}...` : text;
}

function compactArrayValue(value: unknown[], maxLength = 900, maxRows = 8): string {
  const compacted = value.map(compactBriefJsonValue);
  for (let size = Math.min(compacted.length, maxRows); size >= 1; size -= 1) {
    const text = JSON.stringify(compacted.slice(0, size));
    if (text.length <= maxLength) return text;
  }
  return JSON.stringify([]);
}

function compactTableRowsForEvidenceItem(item: Evidence): unknown[] | null {
  if (!Array.isArray(item.value)) return null;
  const name = item.name ?? item.type;
  const rows = item.value.filter(isRecord);

  if (name === "product_business_detail_snippets") {
    return rankBriefRows(rows.map(compactPublicBusinessDetailRow), scoreGenericRow);
  }

  if (name === "business_product_snippets") {
    return rankBriefRows(rows.map(compactPublicBusinessContentRow), scoreGenericRow);
  }

  if (name === "api_compatibility_snippets") {
    return rankBriefRows(rows.map(compactApiCompatibilityDetailRow), scoreApiCompatibilityDetailRow);
  }

  if (name === "public_api_endpoint_inventory") {
    return rankBriefRows(rows.map(compactPublicApiEndpointInventoryRow), scorePublicApiEndpointInventoryRow);
  }

  if (name === "public_app_header_metadata") {
    return rankBriefRows(rows.map(compactPublicAppHeaderMetadataRow), scoreGenericRow);
  }

  if (name === "bounded_public_metadata_checks") {
    return rankBriefRows(rows.map(compactPublicCmsForumMetadataRow), scoreGenericRow);
  }

  if (name === "subdomains") {
    return rankBriefRows(rows.map(compactCtSubdomainRow), scoreCtSubdomainRow);
  }

  if (name === "route_candidates") {
    const compactRows = rows.map(compactRouteCandidateRow);
    return rankBriefRows(compactRows.filter(isReportableRouteCandidateRow), scoreRouteCandidateRow);
  }

  return null;
}

function compactPublicBusinessDetailRow(row: Record<string, unknown>): Record<string, unknown> {
  return removeEmptyFields({
    path: stringField(row, "path"),
    title: stringField(row, "title") ?? stringField(row, "label"),
    detail_kind: stringField(row, "detail_kind"),
    controlled_hint: stringField(row, "controlled_hint"),
  });
}

function compactPublicBusinessContentRow(row: Record<string, unknown>): Record<string, unknown> {
  return removeEmptyFields({
    host: stringField(row, "host"),
    path: stringField(row, "path"),
    title: stringField(row, "title") ?? stringField(row, "label"),
    controlled_hint: stringField(row, "controlled_hint"),
    confidence: stringField(row, "confidence"),
  });
}

function compactApiCompatibilityDetailRow(row: Record<string, unknown>): Record<string, unknown> {
  return removeEmptyFields({
    path: stringField(row, "path"),
    title: stringField(row, "title") ?? stringField(row, "label"),
    confidence: stringField(row, "confidence"),
    compatibility_signals: arrayField(row, "compatibility_signals").slice(0, 3)
      .map((value) => truncateBriefField(value, 54)).filter((value): value is string => Boolean(value)),
    api_base_urls: arrayField(row, "api_base_urls").slice(0, 4)
      .map((value) => truncateBriefField(value, 80)).filter((value): value is string => Boolean(value)),
    snippets: compactApiCompatibilitySnippets(row),
  });
}

function compactPublicApiEndpointInventoryRow(row: Record<string, unknown>): Record<string, unknown> {
  return removeEmptyFields({
    host: stringField(row, "host"),
    role_hint: stringField(row, "role_hint"),
    method: stringField(row, "method"),
    path: stringField(row, "path"),
    endpoint: stringField(row, "endpoint"),
    status_code: typeof row.status_code === "number" ? row.status_code : stringField(row, "status_code"),
    content_type: stringField(row, "content_type"),
    signals: arrayField(row, "signals").slice(0, 4),
    api_error: stringField(row, "api_error"),
    api_message: stringField(row, "api_message"),
    api_request_id: stringField(row, "api_request_id"),
    api_type: stringField(row, "api_type"),
    model_count: typeof row.model_count === "number" ? row.model_count : undefined,
    model_sample: arrayField(row, "model_sample").slice(0, 6),
    model_object: stringField(row, "model_object"),
    body_preview_bytes: typeof row.body_preview_bytes === "number" ? row.body_preview_bytes : undefined,
    body_preview_truncated: typeof row.body_preview_truncated === "boolean" ? row.body_preview_truncated : undefined,
    error: stringField(row, "error"),
  });
}

function compactPublicAppHeaderMetadataRow(row: Record<string, unknown>): Record<string, unknown> {
  return removeEmptyFields({
    host: stringField(row, "host"),
    role_hint: stringField(row, "role_hint"),
    method: stringField(row, "method"),
    path: stringField(row, "path"),
    status_code: typeof row.status_code === "number" ? row.status_code : stringField(row, "status_code"),
    kind: stringField(row, "kind"),
    signals: arrayField(row, "signals").slice(0, 3),
    discourse_route: stringField(row, "discourse_route"),
    discourse_runtime: stringField(row, "discourse_runtime"),
    mint_proxy_version: stringField(row, "mint_proxy_version"),
    mintlify_client_version: stringField(row, "mintlify_client_version"),
    vercel_cache: stringField(row, "vercel_cache"),
    next_rsc_vary: stringField(row, "next_rsc_vary"),
    error: stringField(row, "error"),
  });
}

function compactPublicCmsForumMetadataRow(row: Record<string, unknown>): Record<string, unknown> {
  const parsed = isRecord(row.parsed) ? row.parsed : {};
  return removeEmptyFields({
    host: stringField(row, "host"),
    role_hint: stringField(row, "role_hint"),
    method: stringField(row, "method"),
    path: stringField(row, "path"),
    status_code: typeof row.status_code === "number" ? row.status_code : stringField(row, "status_code"),
    kind: stringField(row, "kind"),
    signals: arrayField(row, "signals").slice(0, 4),
    wordpress_name: stringField(parsed, "wordpress_name") ?? stringField(row, "wordpress_name"),
    wordpress_timezone: stringField(parsed, "wordpress_timezone") ?? stringField(row, "wordpress_timezone"),
    wordpress_namespaces: arrayField(parsed, "wordpress_namespaces").length > 0
      ? arrayField(parsed, "wordpress_namespaces").slice(0, 6)
      : arrayField(row, "wordpress_namespaces").slice(0, 6),
    wordpress_asset_versions: arrayField(parsed, "wordpress_asset_versions").length > 0
      ? arrayField(parsed, "wordpress_asset_versions").slice(0, 3)
      : arrayField(row, "wordpress_asset_versions").slice(0, 3),
    discourse_route: stringField(parsed, "discourse_route")
      ?? stringField(parsed, "x_discourse_route")
      ?? stringField(row, "discourse_route")
      ?? stringField(row, "x_discourse_route"),
    x_discourse_route: stringField(parsed, "x_discourse_route") ?? stringField(row, "x_discourse_route"),
    discourse_cached: stringField(parsed, "discourse_cached")
      ?? stringField(parsed, "x_discourse_cached")
      ?? stringField(row, "discourse_cached")
      ?? stringField(row, "x_discourse_cached"),
    x_discourse_cached: stringField(parsed, "x_discourse_cached") ?? stringField(row, "x_discourse_cached"),
    discourse_runtime: stringField(parsed, "discourse_runtime")
      ?? stringField(parsed, "x_runtime")
      ?? stringField(row, "discourse_runtime")
      ?? stringField(row, "x_runtime"),
    x_runtime: stringField(parsed, "x_runtime") ?? stringField(row, "x_runtime"),
    error: stringField(row, "error"),
  });
}

function compactCtSubdomainRow(row: Record<string, unknown>): Record<string, unknown> {
  return removeEmptyFields({
    host: stringField(row, "host"),
    source: stringField(row, "source"),
    sources: arrayField(row, "sources").slice(0, 2),
    indicators: arrayField(row, "indicators").slice(0, 2),
  });
}

function compactApiCompatibilitySnippets(row: Record<string, unknown>): string[] {
  const snippets = arrayField(row, "snippets");
  const excerpt = stringField(row, "excerpt");
  const apiBaseUrls = arrayField(row, "api_base_urls");
  const urlSpecificSnippets = apiBaseUrls.flatMap((apiBaseUrl) =>
    snippets.filter((value) => snippetMentionsApiBaseUrl(value, apiBaseUrl)),
  );
  const regionalSnippets = snippets.filter((value) => /api-[a-z]+-[a-z]+-\d|api-eu|dc\d+|regional|direct|without\s+cdn|no\s*cdn/i.test(value));
  const candidates = [
    ...urlSpecificSnippets,
    ...regionalSnippets,
    ...snippets.filter((value) => /https?:\/\/|api-eu|\/v1\/(?:chat\/completions|messages|responses)/i.test(value)),
    ...(excerpt ? [excerpt] : []),
    ...snippets,
  ];
  return uniqueStrings(candidates)
    .slice(0, 4)
    .map((value) => truncateBriefField(value, 180))
    .filter((value): value is string => Boolean(value));
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

function compactRouteCandidateRow(row: Record<string, unknown>): Record<string, unknown> {
  return removeEmptyFields({
    route_candidate: stringField(row, "route_candidate") ?? stringField(row, "value"),
    source_asset: stringField(row, "source_asset"),
    confidence: stringField(row, "confidence"),
    derivation: stringField(row, "derivation"),
    basis: stringField(row, "basis"),
  });
}


function rankBriefRows(
  rows: Record<string, unknown>[],
  scoreRow: (row: Record<string, unknown>) => number,
): Record<string, unknown>[] {
  return rows
    .map((row, index) => ({ row, index, score: scoreRow(row) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.row);
}

function scoreGenericRow(row: Record<string, unknown>): number {
  const hint = (stringField(row, "controlled_hint") ?? "").toLowerCase();
  const kind = (stringField(row, "detail_kind") ?? "").toLowerCase();
  let score = 0;
  if (kind === "product") score += 24;
  if (kind === "article") score += 10;
  if (/product|commercial|business/.test(hint)) score += 18;
  if (/docs|technical_documentation|news|blog/.test(hint)) score -= 4;
  return score;
}

function scoreApiCompatibilityDetailRow(row: Record<string, unknown>): number {
  const apiBaseUrls = arrayField(row, "api_base_urls");
  let score = confidenceScore(stringField(row, "confidence"));
  if (apiBaseUrls.length > 0) score += 80;
  if (apiBaseUrls.length > 1) score += 40;
  return score;
}

function scorePublicApiEndpointInventoryRow(row: Record<string, unknown>): number {
  let score = 0;
  if (typeof row.status_code === "number" && row.status_code >= 200 && row.status_code < 300) score += 20;
  if (stringField(row, "content_type")) score += 8;
  if (arrayField(row, "signals").length > 0) score += 6;
  return score;
}



function scoreCtSubdomainRow(row: Record<string, unknown>): number {
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

function scoreRouteCandidateRow(row: Record<string, unknown>): number {
  const route = (stringField(row, "route_candidate") ?? "").toLowerCase();
  let score = confidenceScore(stringField(row, "confidence"));
  const depth = route.split("/").filter(Boolean).length;
  score += Math.max(0, 10 - depth * 2);
  if (/^\/(?:admin|api|auth|tool|agent|affiliate)\//.test(route)) score -= 50;
  if (route === "/" || route.includes("*")) score -= 20;
  return score;
}

function isReportableRouteCandidateRow(row: Record<string, unknown>): boolean {
  const route = (stringField(row, "route_candidate") ?? "").toLowerCase();
  if (!route) return false;
  if (/^\/(?:admin|api|auth|tool|agent|affiliate|dash)\//.test(route)) return false;
  if (/^\/setting\/payment\/.+/.test(route)) return false;
  return route.split("/").filter(Boolean).length <= 3;
}


function confidenceScore(value: string | null): number {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "confirmed" || normalized === "high") return 30;
  if (normalized === "likely" || normalized === "medium") return 20;
  if (normalized === "possible" || normalized === "low") return 6;
  return 0;
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const child = value[key];
  return typeof child === "string" && child.trim() ? child : null;
}

function arrayField(value: Record<string, unknown>, key: string): string[] {
  const child = value[key];
  return Array.isArray(child) ? child.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function truncateBriefField(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function removeEmptyFields(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && child.length > 0) result[key] = child;
    else if (Array.isArray(child) && child.length > 0) result[key] = child;
    else if (typeof child === "number" || typeof child === "boolean") result[key] = child;
  }
  return result;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function compactBriefJsonValue(value: unknown): unknown {
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 80)}...` : value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 3).map(compactBriefJsonValue);
  if (!isRecord(value)) return value;

  const preferredKeys = [
    "host",
    "role_hint",
    "method",
    "path",
    "endpoint",
    "status_code",
    "content_type",
    "headers",
    "raw_headers",
    "cacheability",
    "browser_max_age_seconds",
    "shared_max_age_seconds",
    "has_validator",
    "validator",
    "cdn_cache_status",
    "age_seconds",
    "kind",
    "role",
    "name",
    "data",
    "source",
    "sources",
    "indicators",
    "category",
    "label",
    "controlled_hint",
    "confidence",
    "title",
    "detail_kind",
    "api_base_urls",
    "source_asset",
    "route_candidate",
    "operation",
    "signal",
    "derivation",
    "basis",
    "compatibility_signals",
    "snippets",
    "excerpt",
    "component_candidate",
    "signals",
    "parsed",
    "classification",
    "error",
  ];
  const entries = preferredKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
    .map((key) => [key, key === "parsed" ? compactParsedSubObject(value[key]) : compactBriefJsonValue(value[key])] as const);
  return Object.fromEntries(entries);
}

function compactParsedSubObject(value: unknown): unknown {
  if (!isRecord(value)) return compactBriefJsonValue(value);
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 12)
      .map(([k, v]) => [k, typeof v === "string" ? (v.length > 60 ? `${v.slice(0, 60)}...` : v) : v]),
  );
}

function isProviderContractRecord(record: SnapshotRecord): boolean {
  if (!isRecord(record.value)) return false;
  const coverageState = record.value.coverage_state;
  return coverageState === "provider_configured" || coverageState === "provider_required" || coverageState === "planned";
}

function isProviderResultStatusRecord(record: SnapshotRecord): record is SnapshotRecord<Record<string, unknown>> {
  if (record.probe !== "provider_result_status" || !isRecord(record.value)) return false;
  return record.value.schema_version === "site-10-layer-provider-result-status/v0.1";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function dedupeMissingData(items: Array<Omit<ReportBriefMissingData, "id">>): Array<Omit<ReportBriefMissingData, "id">> {
  const byKey = new Map<string, Omit<ReportBriefMissingData, "id">>();

  for (const item of items) {
    const normalizedItem = {
      ...item,
      description: canonicalMissingDataDescription(item.description),
    };
    const key = `${normalizedItem.layer}:${normalizedItem.classification}:${normalizedItem.description}`;
    if (!byKey.has(key)) byKey.set(key, normalizedItem);
  }

  return Array.from(byKey.values()).sort((left, right) => {
    if (left.layer !== right.layer) return left.layer - right.layer;
    return left.description.localeCompare(right.description);
  });
}

function canonicalMissingDataDescription(value: string): string {
  const normalized = normalizeSignal(value);

  if (normalized === "external_intelligence_icp_is_not_collected") return "icp";

  return value;
}

function groupMissingByLayer(items: ReportBriefMissingData[]): Map<number, ReportBriefMissingData[]> {
  const result = new Map<number, ReportBriefMissingData[]>();

  for (const layer of LAYERS) {
    result.set(layer.layer, []);
  }

  for (const item of items) {
    result.set(item.layer, [...(result.get(item.layer) ?? []), item]);
  }

  return result;
}

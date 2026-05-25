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
  return tableRows ? compactArrayValue(tableRows) : compactValue(item.value);
}

function createDerivedBriefEvidenceItems(item: Evidence): ReportBriefEvidenceItem[] {
  const name = item.name ?? item.type;
  if (name !== "route_candidates" || !Array.isArray(item.value)) return [];

  const rows = item.value.filter(isRecord).map(compactRouteCandidateRow);
  const operationHints = createSpaOperationHintRows(rows);
  if (operationHints.length === 0) return [];

  return [
    {
      type: "spa_operation_hint",
      name: "spa_operation_hints",
      value: compactArrayValue(operationHints),
    },
  ];
}

function compactValue(value: unknown): string {
  if (Array.isArray(value)) return compactArrayValue(value);
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 900 ? `${text.slice(0, 900)}...` : text;
}

function compactArrayValue(value: unknown[]): string {
  const compacted = value.map(compactBriefJsonValue);
  for (let size = Math.min(compacted.length, 8); size >= 1; size -= 1) {
    const text = JSON.stringify(compacted.slice(0, size));
    if (text.length <= 900) return text;
  }
  return JSON.stringify([]);
}

function compactTableRowsForEvidenceItem(item: Evidence): unknown[] | null {
  if (!Array.isArray(item.value)) return null;
  const name = item.name ?? item.type;
  const rows = item.value.filter(isRecord);

  if (name === "product_business_detail_snippets") {
    return rankBriefRows(rows.map(compactPublicBusinessDetailRow), scorePublicBusinessDetailRow);
  }

  if (name === "api_compatibility_snippets") {
    return rankBriefRows(rows.map(compactApiCompatibilityDetailRow), scoreApiCompatibilityDetailRow);
  }

  if (name === "route_candidates") {
    const compactRows = rows.map(compactRouteCandidateRow);
    return rankBriefRows(
      [...compactRows.filter(isReportableRouteCandidateRow), ...deriveRouteAliasRows(compactRows)],
      scoreRouteCandidateRow,
    );
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

function compactApiCompatibilitySnippets(row: Record<string, unknown>): string[] {
  const snippets = arrayField(row, "snippets");
  const excerpt = stringField(row, "excerpt");
  const candidates = [
    ...snippets.filter((value) => /https?:\/\/|api-eu|\/v1\/(?:chat\/completions|messages|responses)/i.test(value)),
    ...(excerpt ? [excerpt] : []),
    ...snippets,
  ];
  return uniqueStrings(candidates)
    .slice(0, 1)
    .map((value) => truncateBriefField(value, 150))
    .filter((value): value is string => Boolean(value));
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

function deriveRouteAliasRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (rows.some((row) => (stringField(row, "route_candidate") ?? "").toLowerCase() === "/vendor/revenue")) {
    return [];
  }

  const hasVendorRoute = rows.some((row) => (stringField(row, "route_candidate") ?? "").toLowerCase() === "/vendor");
  const revenueRows = rows.filter((row) => {
    const route = (stringField(row, "route_candidate") ?? "").toLowerCase();
    const sourceAsset = (stringField(row, "source_asset") ?? "").toLowerCase();
    return /^\/(?:agent\/revenue|affiliate\/earning)\//.test(route) || sourceAsset.includes("revenue");
  });
  const hasRevenueApiPath = revenueRows.some((row) =>
    /^\/(?:agent\/revenue|affiliate\/earning)\//.test((stringField(row, "route_candidate") ?? "").toLowerCase()),
  );
  const revenueSourceAsset = revenueRows.map((row) => stringField(row, "source_asset")).find((value): value is string =>
    Boolean(value),
  );

  if (!hasVendorRoute || !hasRevenueApiPath || !revenueSourceAsset) return [];

  return [
    {
      route_candidate: "/vendor/revenue",
      source_asset: revenueSourceAsset,
      confidence: "low",
      derivation: "derived_alias",
      basis: "vendor route + revenue API path",
    },
  ];
}

function createSpaOperationHintRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const hints: Record<string, unknown>[] = [];

  for (const row of rows) {
    const text = rowSearchText(row);
    const route = stringField(row, "route_candidate");
    const sourceAsset = stringField(row, "source_asset");
    const signal = route ?? sourceAsset;
    if (!signal) continue;

    for (const operation of classifySpaOperationHints(text)) {
      hints.push(removeEmptyFields({
        operation,
        signal,
        source_asset: sourceAsset,
        confidence: spaOperationConfidence(operation, row),
        basis: "SPA string; not route proof",
      }));
    }
  }

  return rankBriefRows(dedupeOperationHints(hints), scoreSpaOperationHintRow);
}

function classifySpaOperationHints(text: string): string[] {
  const operations: string[] = [];
  if (/model[_/-]?load|model[_/-]?stat|\/dash\/model|\/v1\/models|provider[_/-]?routing|provider|routing|厂商|路由/.test(text)) {
    operations.push("model-load/provider routing");
  }
  if (/channel[_/-]?manage[_/-]?log|\/log\b|[_/-]log\b|log[_/-]|日志/.test(text)) {
    operations.push("log-management");
  }
  if (/revenue|earning|payout|withdraw|withdrawal|settlement|收益|提现/.test(text)) {
    operations.push("vendor revenue/payout");
  }
  if (/vendor|supplier|onboarding|入驻/.test(text)) {
    operations.push("supplier/vendor onboarding");
  }
  if (/payment|billing|wallet|recharge|token|账单|钱包|充值|令牌/.test(text)) {
    operations.push("payment/billing");
  }
  return uniqueStrings(operations).slice(0, 3);
}

function spaOperationConfidence(operation: string, row: Record<string, unknown>): string {
  const confidence = (stringField(row, "confidence") ?? "").toLowerCase();
  if (operation === "log-management") return "low";
  if (operation === "model-load/provider routing" && confidence === "medium") return "medium";
  if (confidence === "medium") return "medium";
  return "low";
}

function dedupeOperationHints(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = [
      stringField(row, "operation"),
      stringField(row, "signal"),
      stringField(row, "source_asset"),
    ].join(":");
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

function scoreSpaOperationHintRow(row: Record<string, unknown>): number {
  const operation = (stringField(row, "operation") ?? "").toLowerCase();
  const text = rowSearchText(row);
  let score = confidenceScore(stringField(row, "confidence"));
  if (operation === "model-load/provider routing") score += 50;
  if (operation === "vendor revenue/payout") score += 40;
  if (operation === "supplier/vendor onboarding") score += 34;
  if (operation === "payment/billing") score += 28;
  if (operation === "log-management") score += 44;
  if (/model_load|provider[_/-]?routing|\/v1\/models|channel[_/-]?manage[_/-]?log/.test(text)) score += 12;
  return score;
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

function scorePublicBusinessDetailRow(row: Record<string, unknown>): number {
  const text = rowSearchText(row);
  const path = stringField(row, "path") ?? "";
  const hint = (stringField(row, "controlled_hint") ?? "").toLowerCase();
  const kind = (stringField(row, "detail_kind") ?? "").toLowerCase();
  let score = 0;

  if (kind === "product") score += 24;
  if (kind === "article") score += 10;
  if (/product|commercial|business/.test(hint)) score += 18;
  if (/docs|technical_documentation|news|blog/.test(hint)) score -= 4;
  score += businessRowSignalScore(text);
  if (/\/products\/vendor\/application/i.test(path)) score += 34;
  else if (/\/products\/vendor/i.test(path)) score += 28;
  if (/\/cn\/docs\/get-started\/overview/i.test(path)) score -= 18;

  return score;
}

function scoreApiCompatibilityDetailRow(row: Record<string, unknown>): number {
  const text = rowSearchText(row);
  const path = (stringField(row, "path") ?? "").toLowerCase();
  const apiBaseUrls = arrayField(row, "api_base_urls");
  const apiBaseUrlText = apiBaseUrls.join(" ").toLowerCase();
  let score = confidenceScore(stringField(row, "confidence"));
  if (/\/base-url(?:\.md)?$/.test(path)) score += 90;
  if (/\/openai-completions\//.test(path)) score += 78;
  if (/\/anthropic-messages\//.test(path)) score += 72;
  if (/\/model-naming(?:\.md)?$|provider-routing/.test(path)) score += 66;
  if (/prompt-caching/.test(path)) score -= 24;
  if (apiBaseUrls.length > 0) score += 80;
  if (apiBaseUrls.length > 1) score += 90;
  if (/api-eu|regional|副接口|直连|无\s*cdn/.test(apiBaseUrlText)) score += 60;
  if (/base url|接口地址|api[-./\w]*poixe/.test(text)) score += 50;
  if (/chat completions|\/v1\/chat\/completions/.test(text)) score += 42;
  if (/anthropic|messages|\/v1\/messages/.test(text)) score += 34;
  if (/responses|\/v1\/responses/.test(text)) score += 30;
  if (/openai|chatgpt|gpt-/.test(text)) score += 30;
  if (/compatib|兼容|差异说明/.test(text)) score += 28;
  if (/model naming|模型命名|provider\/<base_model>|provider routing|模型厂商|路由/.test(text)) score += 34;
  if (/regional|us-east|api-eu|直连|副接口/.test(text)) score += 22;
  return score;
}

function scoreRouteCandidateRow(row: Record<string, unknown>): number {
  const route = (stringField(row, "route_candidate") ?? "").toLowerCase();
  let score = confidenceScore(stringField(row, "confidence")) + businessRowSignalScore(route);

  if (/^\/products\/vendor\/application$/.test(route)) score += 40;
  else if (/^\/products\/vendor$/.test(route)) score += 36;
  else if (/^\/vendor\/(revenue|log)$/.test(route)) score += 32;
  else if (/^\/vendor$/.test(route)) score += 28;
  if (stringField(row, "derivation") === "derived_alias") score += 8;
  if (/^\/setting\/payment$/.test(route)) score += 30;
  if (/^\/(pricing|model)$/.test(route)) score += 24;
  if (/^\/(login|signup)$/.test(route)) score += 24;
  if (/^\/(dashboard|billing|wallet)$/.test(route)) score += 14;
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

function businessRowSignalScore(text: string): number {
  let score = 0;
  if (/supplier|vendor|onboarding/.test(text)) score += 28;
  if (/payout|withdraw|withdrawal|settlement/.test(text)) score += 26;
  if (/routing|provider/.test(text)) score += 24;
  if (/pricing|price|cost|discount/.test(text)) score += 18;
  if (/token|recharge|billing|payment|wallet|log|model/.test(text)) score += 16;
  if (/about|platform/.test(text)) score += 8;
  return score;
}

function confidenceScore(value: string | null): number {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "confirmed" || normalized === "high") return 30;
  if (normalized === "likely" || normalized === "medium") return 20;
  if (normalized === "possible" || normalized === "low") return 6;
  return 0;
}

function rowSearchText(row: Record<string, unknown>): string {
  return flattenSearchValues(Object.values(row))
    .toLowerCase();
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

function flattenSearchValues(values: unknown[]): string {
  const parts: string[] = [];
  for (const value of values) {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) parts.push(flattenSearchValues(value));
    else if (isRecord(value)) parts.push(flattenSearchValues(Object.values(value)));
  }
  return parts.join(" ");
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
    "kind",
    "role",
    "name",
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
    "wordpress_name",
    "wordpress_timezone",
    "wordpress_namespaces",
    "wordpress_test_cookie",
    "discourse_route",
    "discourse_cached",
    "discourse_runtime",
    "mint_proxy_version",
    "mintlify_client_version",
    "vercel_cache",
    "next_rsc_vary",
    "api_error",
    "api_message",
    "api_request_id",
    "api_type",
    "error",
  ];
  const entries = preferredKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
    .map((key) => [key, compactBriefJsonValue(value[key])] as const);
  return Object.fromEntries(entries);
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

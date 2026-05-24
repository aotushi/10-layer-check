import { LAYERS, getLayerDefinition } from "../core/layers";
import type { RiskLevel, Run, SnapshotRecord, SnapshotStatus } from "../core/types";

export type AnalysisLayerStatus = "ok" | "warning" | "error" | "partial" | "missing";

export type AnalysisEvidenceRef = {
  id: string;
  layer: number;
  probe: string;
  item: string;
  status: SnapshotStatus;
  source: string;
};

export type AnalysisRisk = {
  level: RiskLevel;
  title: string;
  layer: number;
  evidence_refs: string[];
};

export type AnalysisLayerSummary = {
  layer: number;
  name: string;
  focus: string;
  status: AnalysisLayerStatus;
  summary: string;
  key_findings: string[];
  limitations: string[];
  evidence_refs: string[];
  record_count: number;
};

export type AnalysisReport = {
  schema_version: "site-10-layer-analysis/v0.1";
  target: string;
  normalized_target: string;
  generated_at: string;
  run: {
    id: string;
    created_at: string;
    source: Run["source"];
    record_count: number;
  };
  coverage: {
    total_layers: number;
    collected_layers: number[];
    provider_ready_layers: number[];
    missing_layers: number[];
    recommended_mvp_layers: number[];
    recommended_partial_layers: number[];
  };
  executive_summary: string[];
  layer_summaries: AnalysisLayerSummary[];
  risks: AnalysisRisk[];
  next_steps: string[];
  evidence_index: AnalysisEvidenceRef[];
};

const RECOMMENDED_MVP_LAYERS = [2, 3, 5];
const RECOMMENDED_PARTIAL_LAYERS = [1, 4, 6, 7, 8, 9, 10];

export function createAnalysisReport(run: Run): AnalysisReport {
  const evidenceIndex = createEvidenceIndex(run.records);
  const layerSummaries = LAYERS.map((layer) => createLayerSummary(run.records, layer.layer, evidenceIndex));
  const collectedLayers = layerSummaries
    .filter((layer) => layer.status !== "missing")
    .map((layer) => layer.layer);
  const providerReadyLayers = uniqueSorted(
    run.records.filter((record) => getCoverageState(record) === "provider_configured").map((record) => record.layer),
  );
  const missingLayers = layerSummaries
    .filter((layer) => layer.status === "missing")
    .map((layer) => layer.layer);
  const risks = createRisks(run.records, evidenceIndex);

  return {
    schema_version: "site-10-layer-analysis/v0.1",
    target: run.target,
    normalized_target: run.normalizedTarget,
    generated_at: new Date().toISOString(),
    run: {
      id: run.id,
      created_at: run.createdAt,
      source: run.source,
      record_count: run.records.length,
    },
    coverage: {
      total_layers: LAYERS.length,
      collected_layers: collectedLayers,
      provider_ready_layers: providerReadyLayers,
      missing_layers: missingLayers,
      recommended_mvp_layers: RECOMMENDED_MVP_LAYERS,
      recommended_partial_layers: RECOMMENDED_PARTIAL_LAYERS,
    },
    executive_summary: createExecutiveSummary(layerSummaries, risks),
    layer_summaries: layerSummaries,
    risks,
    next_steps: createNextSteps(layerSummaries, risks),
    evidence_index: evidenceIndex,
  };
}

function createLayerSummary(
  records: SnapshotRecord[],
  layer: number,
  evidenceIndex: AnalysisEvidenceRef[],
): AnalysisLayerSummary {
  const definition = getLayerDefinition(layer);
  const layerRecords = records.filter((record) => record.layer === layer);
  const collectedRecords = layerRecords.filter((record) => !isProviderContractRecord(record) && record.status !== "skipped");
  const contractRecords = layerRecords.filter(isProviderContractRecord);
  const limitations = uniqueStrings(collectedRecords.flatMap((record) => record.evidence_metadata?.limitations ?? []));
  const explicitGaps = collectedRecords.flatMap(extractExplicitGaps);
  const status = classifyLayerStatus(collectedRecords, contractRecords, explicitGaps);
  const evidenceRefs = evidenceIndex.filter((ref) => ref.layer === layer).map((ref) => ref.id);
  const keyFindings = createKeyFindings(collectedRecords, contractRecords);

  return {
    layer,
    name: definition.name,
    focus: definition.focus,
    status,
    summary: createLayerSummaryText(definition.name, status, collectedRecords, contractRecords),
    key_findings: keyFindings,
    limitations: uniqueStrings([...limitations, ...explicitGaps]),
    evidence_refs: evidenceRefs,
    record_count: collectedRecords.length,
  };
}

function classifyLayerStatus(
  collectedRecords: SnapshotRecord[],
  contractRecords: SnapshotRecord[],
  explicitGaps: string[],
): AnalysisLayerStatus {
  if (collectedRecords.length === 0) return contractRecords.length > 0 ? "missing" : "missing";
  if (collectedRecords.some((record) => record.status === "error")) return "error";
  if (collectedRecords.some((record) => record.status === "warning")) return "warning";
  if (explicitGaps.length > 0) return "partial";
  return "ok";
}

function createLayerSummaryText(
  name: string,
  status: AnalysisLayerStatus,
  collectedRecords: SnapshotRecord[],
  contractRecords: SnapshotRecord[],
): string {
  if (collectedRecords.length === 0 && contractRecords.length > 0) {
    return `${name} has provider contract records only; no target evidence has been collected yet.`;
  }

  if (collectedRecords.length === 0) return `${name} has no collected records.`;

  const warningCount = collectedRecords.filter((record) => record.status === "warning").length;
  const errorCount = collectedRecords.filter((record) => record.status === "error").length;
  if (status === "error") return `${name} has ${errorCount} error record(s) and needs review.`;
  if (status === "warning") return `${name} has ${warningCount} warning record(s) across ${collectedRecords.length} collected record(s).`;
  if (status === "partial") return `${name} has ${collectedRecords.length} collected record(s), with explicit limitations or missing sub-signals.`;
  return `${name} has ${collectedRecords.length} collected record(s) and no warning/error status.`;
}

function createKeyFindings(collectedRecords: SnapshotRecord[], contractRecords: SnapshotRecord[]): string[] {
  if (collectedRecords.length === 0) {
    return contractRecords.map((record) => record.risk.summary).filter(Boolean).slice(0, 4);
  }

  return uniqueStrings(collectedRecords.map((record) => record.risk.summary).filter(Boolean)).slice(0, 6);
}

function createRisks(records: SnapshotRecord[], evidenceIndex: AnalysisEvidenceRef[]): AnalysisRisk[] {
  return records
    .filter((record) => !isProviderContractRecord(record))
    .filter((record) => record.risk.level !== "info" || record.status === "warning" || record.status === "error")
    .map((record) => ({
      level: record.risk.level,
      title: record.risk.summary,
      layer: record.layer,
      evidence_refs: evidenceIndex
        .filter((ref) => ref.layer === record.layer && ref.probe === record.probe && ref.item === record.item)
        .map((ref) => ref.id),
    }))
    .sort((left, right) => riskOrder(right.level) - riskOrder(left.level));
}

function createExecutiveSummary(layerSummaries: AnalysisLayerSummary[], risks: AnalysisRisk[]): string[] {
  const collectedCount = layerSummaries.filter((layer) => layer.status !== "missing").length;
  const warningLayers = layerSummaries.filter((layer) => layer.status === "warning" || layer.status === "error");
  const highOrMediumRisks = risks.filter((risk) => risk.level === "high" || risk.level === "medium");

  return [
    `${collectedCount}/${layerSummaries.length} layers have collected evidence.`,
    warningLayers.length > 0
      ? `${warningLayers.length} layer(s) contain warning or error records.`
      : "No layer contains warning or error records in the current run.",
    highOrMediumRisks.length > 0
      ? `${highOrMediumRisks.length} high/medium risk item(s) should be reviewed first.`
      : "No high or medium risk item is currently flagged.",
  ];
}

function createNextSteps(layerSummaries: AnalysisLayerSummary[], risks: AnalysisRisk[]): string[] {
  const missing = layerSummaries.filter((layer) => layer.status === "missing").map((layer) => `Collect target evidence for Layer ${layer.layer} ${layer.name}.`);
  const warnings = risks
    .filter((risk) => risk.level === "high" || risk.level === "medium")
    .slice(0, 5)
    .map((risk) => `Review Layer ${risk.layer}: ${risk.title}`);
  const partial = layerSummaries
    .filter((layer) => layer.status === "partial")
    .slice(0, 5)
    .map((layer) => `Resolve or document limitations for Layer ${layer.layer} ${layer.name}.`);

  return uniqueStrings([...warnings, ...missing, ...partial]).slice(0, 10);
}

function createEvidenceIndex(records: SnapshotRecord[]): AnalysisEvidenceRef[] {
  return records
    .filter((record) => !isProviderContractRecord(record))
    .filter((record) => record.status !== "skipped")
    .map((record, index) => ({
      id: `E${String(index + 1).padStart(3, "0")}`,
      layer: record.layer,
      probe: record.probe,
      item: record.item,
      status: record.status,
      source: record.source,
    }));
}

function extractExplicitGaps(record: SnapshotRecord): string[] {
  const gaps: string[] = [];
  collectGaps(record.value, gaps);
  return uniqueStrings(gaps);
}

function collectGaps(value: unknown, gaps: string[], path = ""): void {
  if (Array.isArray(value)) {
    for (const item of value) collectGaps(item, gaps, path);
    return;
  }

  if (!isRecord(value)) return;

  const status = value.status;
  if (status === "not_collected" && path) gaps.push(`${path} is not collected`);

  const missing = value.missing;
  if (Array.isArray(missing) && path.endsWith("coverage")) {
    for (const item of missing) {
      if (typeof item === "string") gaps.push(item);
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "html" || key === "certificates" || key === "records") continue;
    collectGaps(child, gaps, path ? `${path}.${key}` : key);
  }
}

function isProviderContractRecord(record: SnapshotRecord): boolean {
  const coverageState = getCoverageState(record);
  return coverageState === "provider_configured" || coverageState === "provider_required" || coverageState === "planned";
}

function getCoverageState(record: SnapshotRecord): string | null {
  if (!isRecord(record.value)) return null;
  return typeof record.value.coverage_state === "string" ? record.value.coverage_state : null;
}

function riskOrder(level: RiskLevel): number {
  return { info: 0, low: 1, medium: 2, high: 3 }[level];
}

function uniqueSorted(values: number[]): number[] {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

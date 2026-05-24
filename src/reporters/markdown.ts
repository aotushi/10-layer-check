import type { AnalysisLayerSummary, AnalysisReport } from "./analysis";
import type { ReportBrief, ReportBriefEvidence, ReportBriefMissingData } from "./brief";

export function renderAnalysisMarkdown(report: AnalysisReport): string {
  return [
    `# Site 10-Layer Analysis: ${report.normalized_target}`,
    "",
    `- Target: ${report.target}`,
    `- Generated: ${report.generated_at}`,
    `- Source run: ${report.run.id}`,
    `- Records: ${report.run.record_count}`,
    "",
    "## Executive Summary",
    "",
    ...report.executive_summary.map((item) => `- ${item}`),
    "",
    "## Coverage",
    "",
    "| Scope | Layers |",
    "| --- | --- |",
    `| Collected | ${formatLayers(report.coverage.collected_layers)} |`,
    `| Missing | ${formatLayers(report.coverage.missing_layers)} |`,
    `| Recommended MVP | ${formatLayers(report.coverage.recommended_mvp_layers)} |`,
    `| Recommended partial | ${formatLayers(report.coverage.recommended_partial_layers)} |`,
    "",
    "## Layer Summary",
    "",
    "| Layer | Status | Summary | Evidence |",
    "| ---: | --- | --- | --- |",
    ...report.layer_summaries.map(renderLayerRow),
    "",
    "## Risks",
    "",
    ...renderRisks(report),
    "",
    "## Next Steps",
    "",
    ...(report.next_steps.length > 0 ? report.next_steps.map((step) => `- ${step}`) : ["- No next step was generated."]),
    "",
    "## Evidence Index",
    "",
    "| Ref | Layer | Probe | Item | Status | Source |",
    "| --- | ---: | --- | --- | --- | --- |",
    ...report.evidence_index.map(
      (ref) =>
        `| ${ref.id} | ${ref.layer} | ${escapeTable(ref.probe)} | ${escapeTable(ref.item)} | ${ref.status} | ${escapeTable(ref.source)} |`,
    ),
    "",
  ].join("\n");
}

export function renderNarrativeMarkdown(brief: ReportBrief): string {
  const allEvidenceRefs = uniqueStrings(brief.layers.flatMap((layer) => layer.evidence_refs));

  return [
    `# Site Narrative Report: ${brief.normalized_target}`,
    "",
    "## Summary",
    "",
    `- Target: ${brief.target}`,
    `- Generated: ${brief.generated_at}`,
    `- Source run: ${brief.run.id}`,
    `- Records: ${brief.run.record_count}`,
    `- Coverage: ${brief.coverage.collected_layers.length}/${brief.coverage.total_layers} layers have collected evidence. Evidence refs: ${formatRefs(allEvidenceRefs)}`,
    `- AI provider invoked: ${brief.ai_boundary.invokes_ai_provider ? "yes" : "no"}`,
    "",
    ...brief.executive_summary.map((item) => `- ${item} Evidence refs: ${formatRefs(allEvidenceRefs)}`),
    "",
    "## Layer Findings",
    "",
    ...brief.layers.flatMap((layer) => [
      `### Layer ${layer.layer}: ${layer.name}`,
      "",
      `- Status: ${layer.status}`,
      `- Summary: ${layer.summary} Evidence refs: ${formatRefs(layer.evidence_refs)} Missing data: ${formatRefs(layer.missing_data_ids)}`,
      ...(layer.key_findings.length > 0
        ? layer.key_findings.map((finding) => `- Finding: ${finding} Evidence refs: ${formatRefs(layer.evidence_refs)}`)
        : [`- Finding: No deterministic finding generated. Evidence refs: ${formatRefs(layer.evidence_refs)}`]),
      ...(layer.limitations.length > 0 ? layer.limitations.map((item) => `- Limitation: ${item}`) : []),
      "",
    ]),
    "## Technical Surface",
    "",
    ...renderTechnicalSurface(brief),
    "",
    "## Risks",
    "",
    ...renderNarrativeRisks(brief),
    "",
    "## Missing Data",
    "",
    ...renderMissingData(brief.missing_data),
    "",
    "## Evidence Appendix",
    "",
    "| Ref | Layer | Probe | Status | Source | Metadata | Evidence Items | Limitations |",
    "| --- | ---: | --- | --- | --- | --- | --- | --- |",
    ...brief.evidence_index.map(renderBriefEvidenceRow),
    "",
  ].join("\n");
}

function renderLayerRow(layer: AnalysisLayerSummary): string {
  const evidence = layer.evidence_refs.length > 0 ? layer.evidence_refs.join(", ") : "";
  return `| ${layer.layer} ${escapeTable(layer.name)} | ${layer.status} | ${escapeTable(layer.summary)} | ${escapeTable(evidence)} |`;
}

function renderRisks(report: AnalysisReport): string[] {
  if (report.risks.length === 0) return ["No non-info risk items were generated."];

  return [
    "| Level | Layer | Finding | Evidence |",
    "| --- | ---: | --- | --- |",
    ...report.risks.map(
      (risk) =>
        `| ${risk.level} | ${risk.layer} | ${escapeTable(risk.title)} | ${escapeTable(risk.evidence_refs.join(", "))} |`,
    ),
  ];
}

function renderTechnicalSurface(brief: ReportBrief): string[] {
  const groups = [
    { name: "Network and HTTP", layers: [1, 2, 3] },
    { name: "Frontend and Application", layers: [4, 8] },
    { name: "Performance and API", layers: [5, 6] },
    { name: "Subdomains and Organization", layers: [7, 9] },
    { name: "Security Posture", layers: [10] },
  ];

  return groups.flatMap((group) => {
    const layers = brief.layers.filter((layer) => group.layers.includes(layer.layer));
    const evidenceRefs = uniqueStrings(layers.flatMap((layer) => layer.evidence_refs));
    const missingIds = uniqueStrings(layers.flatMap((layer) => layer.missing_data_ids));
    const findings = layers.flatMap((layer) =>
      layer.key_findings.slice(0, 2).map((finding) => `Layer ${layer.layer}: ${finding}`),
    );

    return [
      `### ${group.name}`,
      "",
      `- Layers: ${group.layers.join(", ")}`,
      `- Evidence refs: ${formatRefs(evidenceRefs)}`,
      `- Missing data: ${formatRefs(missingIds)}`,
      ...(findings.length > 0 ? findings.map((finding) => `- Finding: ${finding} Evidence refs: ${formatRefs(evidenceRefs)}`) : []),
      "",
    ];
  });
}

function renderNarrativeRisks(brief: ReportBrief): string[] {
  if (brief.risks.length === 0) return ["- No non-info risk items were generated from the current evidence."];

  return [
    "| Level | Layer | Finding | Evidence |",
    "| --- | ---: | --- | --- |",
    ...brief.risks.map(
      (risk) =>
        `| ${risk.level} | ${risk.layer} | ${escapeTable(risk.title)} | ${escapeTable(formatRefs(risk.evidence_refs))} |`,
    ),
  ];
}

function renderMissingData(items: ReportBriefMissingData[]): string[] {
  if (items.length === 0) return ["- No explicit missing data was generated."];

  return [
    "| ID | Layer | Classification | Description | Evidence |",
    "| --- | ---: | --- | --- | --- |",
    ...items.map(
      (item) =>
        `| ${item.id} | ${item.layer} | ${item.classification} | ${escapeTable(item.description)} | ${escapeTable(formatRefs(item.evidence_refs))} |`,
    ),
  ];
}

function renderBriefEvidenceRow(item: ReportBriefEvidence): string {
  const metadata = item.metadata
    ? `${item.metadata.origin}/${item.metadata.role}/${item.metadata.method}`
    : "none";
  const evidenceItems = item.evidence_items
    .slice(0, 5)
    .map((evidence) => `${evidence.type}${evidence.name ? `:${evidence.name}` : ""}=${evidence.value}`)
    .join("; ");

  return `| ${item.id} | ${item.layer} | ${escapeTable(item.probe)} | ${item.status} | ${escapeTable(item.source)} | ${escapeTable(metadata)} | ${escapeTable(evidenceItems || "-")} | ${escapeTable(item.limitations.join("; ") || "-")} |`;
}

function formatLayers(layers: number[]): string {
  return layers.length > 0 ? layers.join(", ") : "-";
}

function formatRefs(refs: string[]): string {
  return refs.length > 0 ? refs.join(", ") : "-";
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

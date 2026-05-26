import type { Evidence, EvidenceMetadata, Run, SnapshotRecord } from "../../core/types";

export type AiClassifierOutputConfidence = "confirmed" | "likely" | "possible" | "unknown";

export type AiClassifierInputCandidate = {
  name: string;
  category: string;
  confidence: string;
  source: string;
  evidence_refs: string[];
  local_evidence_refs: string[];
};

export type AiClassifierEvidenceInput = {
  evidence_ref: string;
  layer: 4 | 8;
  probe: string;
  item: string;
  source: string;
  status: string;
  summary: string;
  metadata: EvidenceMetadata | null;
  candidates: AiClassifierInputCandidate[];
  evidence_items: AiClassifierEvidenceItem[];
  raw_evidence_types: string[];
  limitations: string[];
};

export type AiClassifierEvidenceItem = {
  type: string;
  name?: string;
  value: string;
};

export type AiClassifierContract = {
  schema_version: "site-10-layer-ai-classifier-contract/v0.1";
  invokes_ai_provider: false;
  target: string;
  normalized_target: string;
  input: {
    layers: [4, 8];
    evidence: AiClassifierEvidenceInput[];
    instruction: string;
  };
  output_contract: {
    required_fields: ["technology", "category", "confidence", "reasoning", "evidence_refs", "limitations"];
    confidence_values: AiClassifierOutputConfidence[];
    rules: string[];
    example: {
      technology: string;
      category: string;
      confidence: AiClassifierOutputConfidence;
      reasoning: string;
      evidence_refs: string[];
      limitations: string[];
    };
  };
};

export function createAiClassifierContract(
  run: Run,
  probeStrategy?: import("../../scan/probe-strategy").ProbeStrategy,
): AiClassifierContract {
  const evidence = run.records
    .filter(isAiClassifierInputRecord)
    .map((record, index) => createEvidenceInput(record, `AIC${String(index + 1).padStart(3, "0")}`));

  return {
    schema_version: "site-10-layer-ai-classifier-contract/v0.1",
    invokes_ai_provider: false,
    target: run.target,
    normalized_target: run.normalizedTarget,
    input: {
      layers: [4, 8],
      evidence,
      instruction: buildClassifierInstruction(probeStrategy),
    },
    output_contract: {
      required_fields: ["technology", "category", "confidence", "reasoning", "evidence_refs", "limitations"],
      confidence_values: ["confirmed", "likely", "possible", "unknown"],
      rules: [
        "Every classifier output item must cite one or more evidence_refs from input.evidence.",
        "Output limitations must include the relevant input limitations when evidence is static, heuristic, or runtime-incomplete.",
        "Absence of a candidate in the input is not proof that a technology is absent.",
        "The contract defines shape only; this function must not call an AI provider.",
      ],
      example: {
        technology: "Next.js",
        category: "frontend_framework",
        confidence: "likely",
        reasoning: "The referenced evidence includes Next.js static chunk paths or __NEXT_DATA__ markers.",
        evidence_refs: ["AIC001"],
        limitations: ["Static and runtime evidence can miss server-side or hidden technologies."],
      },
    },
  };
}

function buildClassifierInstruction(
  probeStrategy?: import("../../scan/probe-strategy").ProbeStrategy,
): string {
  const base =
    "Classify frontend/application technologies only from the supplied evidence refs. Do not infer ownership, deployment platform, or full stack inventory from weak or missing evidence.";
  if (!probeStrategy) return base;

  const runProbes = probeStrategy.probe_manifest
    .filter((e) => e.status === "run")
    .map((e) => `${e.probe}: ${e.intent}`)
    .join("; ");
  const skippedProbes = probeStrategy.probe_manifest.filter((e) => e.status === "skipped");
  const skippedNote =
    skippedProbes.length > 0
      ? ` Note: ${skippedProbes.map((e) => e.probe).join(", ")} were not run (${probeStrategy.site_type_hints.is_static ? "static site detected" : "site type mismatch"}).`
      : "";

  return `${base} Probes run and their intents: ${runProbes}.${skippedNote}`;
}

function isAiClassifierInputRecord(record: SnapshotRecord): boolean {
  return (
    (record.layer === 4 || record.layer === 8) &&
    record.status !== "skipped" &&
    record.probe !== "provider_contract" &&
    ["ai_frontend_evidence_pack", "frontend_technology_probe", "app_fingerprint_probe"].includes(record.probe)
  );
}

function createEvidenceInput(record: SnapshotRecord, evidenceRef: string): AiClassifierEvidenceInput {
  return {
    evidence_ref: evidenceRef,
    layer: record.layer as 4 | 8,
    probe: record.probe,
    item: record.item,
    source: record.source,
    status: record.status,
    summary: record.risk.summary,
    metadata: record.evidence_metadata ?? null,
    candidates: extractCandidates(record, evidenceRef),
    evidence_items: compactEvidenceItems(record.evidence),
    raw_evidence_types: Array.from(new Set(record.evidence.map((item) => [item.type, item.name].filter(Boolean).join(":")))),
    limitations: record.evidence_metadata?.limitations?.length
      ? record.evidence_metadata.limitations
      : ["No explicit collection limitation was attached to this evidence record."],
  };
}

function extractCandidates(record: SnapshotRecord, evidenceRef: string): AiClassifierInputCandidate[] {
  const value = asObject(record.value);
  const candidates = [
    ...extractTechnologyCandidates(value, "deterministic_signals", evidenceRef),
    ...extractTechnologyCandidates(value, "technology_candidates", evidenceRef),
    ...extractFingerprintCandidates(value, "fingerprint_candidates", evidenceRef),
    ...extractFingerprintCandidates(value, "matches", evidenceRef),
  ];

  return dedupeCandidates(candidates);
}

function extractTechnologyCandidates(
  value: Record<string, unknown>,
  field: string,
  evidenceRef: string,
): AiClassifierInputCandidate[] {
  const items = Array.isArray(value[field]) ? value[field] : [];

  return items.flatMap((item) => {
    const candidate = asObject(item);
    const technology = asString(candidate.technology);
    if (!technology) return [];

    const localRefs = asStringArray(candidate.evidence_refs);
    return [
      {
        name: technology,
        category: asString(candidate.category) ?? "unknown",
        confidence: asString(candidate.confidence) ?? "unknown",
        source: asString(candidate.source) ?? field,
        evidence_refs: [evidenceRef],
        local_evidence_refs: localRefs,
      },
    ];
  });
}

function extractFingerprintCandidates(
  value: Record<string, unknown>,
  field: string,
  evidenceRef: string,
): AiClassifierInputCandidate[] {
  const items = Array.isArray(value[field]) ? value[field] : [];

  return items.flatMap((item) => {
    const candidate = asObject(item);
    const name = asString(candidate.name);
    if (!name) return [];

    return [
      {
        name,
        category: asString(candidate.category) ?? "unknown",
        confidence: asString(candidate.confidence) ?? "unknown",
        source: field,
        evidence_refs: [evidenceRef],
        local_evidence_refs: asStringArray(candidate.evidence),
      },
    ];
  });
}

function dedupeCandidates(candidates: AiClassifierInputCandidate[]): AiClassifierInputCandidate[] {
  const byKey = new Map<string, AiClassifierInputCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.name}:${candidate.category}:${candidate.source}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }

    existing.evidence_refs = Array.from(new Set([...existing.evidence_refs, ...candidate.evidence_refs]));
    existing.local_evidence_refs = Array.from(new Set([...existing.local_evidence_refs, ...candidate.local_evidence_refs]));
  }

  return Array.from(byKey.values());
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function compactEvidenceItems(items: Evidence[]): AiClassifierEvidenceItem[] {
  return items.slice(0, 30).map((item) => ({
    type: item.type,
    ...(item.name ? { name: item.name } : {}),
    value: compactValue(item.value),
  }));
}

function compactValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

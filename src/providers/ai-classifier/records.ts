import type { LayerProbeContext } from "../../core/probe-contract";
import type { Evidence, EvidenceAssessment, SnapshotRecord } from "../../core/types";
import type { AiClassifierResultItem } from "./fake";
import type { WorkerAiClassifierFailure, WorkerAiClassifierResponse } from "./worker-adapter";

type AiClassifierRecordContext = Pick<LayerProbeContext, "target" | "normalizedTarget" | "snapshotAt">;

type AiClassifierRecordValue = {
  schema_version: "site-10-layer-ai-classifier-record/v0.1";
  provider: string;
  invokes_ai_provider: boolean;
  layer_scope: 4 | 8;
  classifications: AiClassifierResultItem[];
  source_evidence_refs: string[];
  ai_classifier_assessment: EvidenceAssessment;
};

type AiClassifierFailureValue = {
  schema_version: "site-10-layer-ai-classifier-record/v0.1";
  provider: string;
  invokes_ai_provider: false;
  error_code: WorkerAiClassifierFailure["error_code"];
  error: string;
  missing_config?: string[];
  validation_errors?: string[];
};

export function createAiClassifierRecords(
  context: AiClassifierRecordContext,
  response: WorkerAiClassifierResponse,
): SnapshotRecord<AiClassifierRecordValue | AiClassifierFailureValue>[] {
  if (!response.ok) {
    return [createFailureRecord(context, response)];
  }

  const grouped = groupByLayer(response.result.results);

  return ([4, 8] as const).flatMap((layer) => {
    const classifications = grouped.get(layer) ?? [];
    if (classifications.length === 0) return [];
    return [createSuccessRecord(context, layer, response.result.provider, response.result.invokes_ai_provider, classifications)];
  });
}

function createSuccessRecord(
  context: AiClassifierRecordContext,
  layer: 4 | 8,
  provider: string,
  invokesAiProvider: boolean,
  classifications: AiClassifierResultItem[],
): SnapshotRecord<AiClassifierRecordValue> {
  const sourceEvidenceRefs = uniqueStrings(classifications.flatMap((item) => item.evidence_refs));
  const limitations = uniqueStrings(classifications.flatMap((item) => item.limitations));
  const label = layer === 4 ? "AI-assisted frontend technology classification" : "AI-assisted application fingerprint classification";

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "ai_classifier_probe",
    layer,
    item: layer === 4 ? "ai_frontend_technology_classification" : "ai_app_fingerprint_classification",
    probe_type: "external_provider",
    source: provider,
    status: "ok",
    value: {
      schema_version: "site-10-layer-ai-classifier-record/v0.1",
      provider,
      invokes_ai_provider: invokesAiProvider,
      layer_scope: layer,
      classifications,
      source_evidence_refs: sourceEvidenceRefs,
      ai_classifier_assessment: {
        label,
        conclusion: classifications.length > 0 ? "possible" : "not_detected",
        confidence: highestConfidence(classifications),
        signals: classifications.map((item) => ({
          type: "ai_classifier_candidate",
          name: item.technology,
          value: {
            category: item.category,
            confidence: item.confidence,
            reasoning: item.reasoning,
          },
          source: provider,
          evidence_refs: item.evidence_refs,
        })),
        limitations,
      },
    },
    risk: {
      level: "info",
      summary: `${label} returned ${classifications.length} evidence-cited candidate(s).`,
    },
    evidence: buildClassificationEvidence(classifications),
    evidence_metadata: {
      origin: "external_provider",
      role: "derived",
      method: "external_api",
      limitations: [
        "AI classifier output is model-assisted interpretation of collected evidence, not direct observation.",
        "Each classification must be grounded in the cited contract-level evidence_refs.",
        ...limitations,
      ],
    },
  };
}

function createFailureRecord(
  context: AiClassifierRecordContext,
  response: WorkerAiClassifierFailure,
): SnapshotRecord<AiClassifierFailureValue> {
  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "ai_classifier_provider_error",
    layer: 4,
    item: "ai_classifier_provider_status",
    probe_type: "external_provider",
    source: response.provider,
    status: "error",
    value: {
      schema_version: "site-10-layer-ai-classifier-record/v0.1",
      provider: response.provider,
      invokes_ai_provider: false,
      error_code: response.error_code,
      error: response.error,
      ...(response.missing_config ? { missing_config: response.missing_config } : {}),
      ...(response.validation_errors ? { validation_errors: response.validation_errors } : {}),
    },
    risk: {
      level: "info",
      summary: `AI classifier provider did not return usable classification evidence: ${response.error_code}.`,
    },
    evidence: [
      {
        type: "provider_error",
        name: response.error_code,
        value: {
          error: response.error,
          missing_config: response.missing_config ?? [],
          validation_errors: response.validation_errors ?? [],
        },
      },
    ],
    evidence_metadata: {
      origin: "external_provider",
      role: "derived",
      method: "external_api",
      limitations: [
        "Provider failures are status evidence only and must not be interpreted as technology classification evidence.",
      ],
    },
  };
}

function groupByLayer(items: AiClassifierResultItem[]): Map<4 | 8, AiClassifierResultItem[]> {
  const grouped = new Map<4 | 8, AiClassifierResultItem[]>();

  for (const item of items) {
    const layer = classifyResultLayer(item.category);
    grouped.set(layer, [...(grouped.get(layer) ?? []), item]);
  }

  return grouped;
}

function classifyResultLayer(category: string): 4 | 8 {
  const normalized = category.toLowerCase().replace(/[\s-]+/g, "_");
  const layer8Categories = new Set([
    "analytics",
    "cms",
    "commerce",
    "docs",
    "documentation",
    "forum",
    "hosting",
    "runtime",
    "security",
    "support",
    "support_chat",
    "tag_manager",
  ]);

  return layer8Categories.has(normalized) ? 8 : 4;
}

function buildClassificationEvidence(classifications: AiClassifierResultItem[]): Evidence[] {
  return classifications.map((item) => ({
    type: "ai_classifier_result",
    name: item.technology,
    value: {
      category: item.category,
      confidence: item.confidence,
      reasoning: item.reasoning,
      evidence_refs: item.evidence_refs,
      limitations: item.limitations,
    },
  }));
}

function highestConfidence(classifications: AiClassifierResultItem[]): EvidenceAssessment["confidence"] {
  const rank: Record<AiClassifierResultItem["confidence"], number> = {
    unknown: 0,
    possible: 1,
    likely: 2,
    confirmed: 3,
  };
  const highest = classifications.reduce<AiClassifierResultItem["confidence"]>(
    (current, item) => (rank[item.confidence] > rank[current] ? item.confidence : current),
    "unknown",
  );
  if (highest === "confirmed") return "confirmed";
  if (highest === "likely") return "likely";
  if (highest === "possible") return "possible";
  return "unknown";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

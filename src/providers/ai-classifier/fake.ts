import type { AiClassifierContract, AiClassifierOutputConfidence } from "./contract";

export type AiClassifierResultItem = {
  technology: string;
  category: string;
  confidence: AiClassifierOutputConfidence;
  reasoning: string;
  evidence_refs: string[];
  limitations: string[];
};

export type AiClassifierResult = {
  schema_version: "site-10-layer-ai-classifier-result/v0.1";
  provider: string;
  invokes_ai_provider: boolean;
  target: string;
  normalized_target: string;
  results: AiClassifierResultItem[];
};

export type AiClassifierValidation = {
  ok: boolean;
  errors: string[];
};

export function runFakeAiClassifier(contract: AiClassifierContract): AiClassifierResult {
  const byTechnology = new Map<string, AiClassifierResultItem>();

  for (const evidence of contract.input.evidence) {
    for (const candidate of evidence.candidates) {
      const key = `${candidate.name}:${candidate.category}`;
      const existing = byTechnology.get(key);
      const next: AiClassifierResultItem = {
        technology: candidate.name,
        category: candidate.category,
        confidence: normalizeConfidence(candidate.confidence),
        reasoning: createReasoning(candidate.name, evidence.evidence_items.map((item) => item.type)),
        evidence_refs: candidate.evidence_refs,
        limitations: evidence.limitations,
      };

      if (!existing) {
        byTechnology.set(key, next);
        continue;
      }

      existing.confidence = maxConfidence(existing.confidence, next.confidence);
      existing.evidence_refs = uniqueStrings([...existing.evidence_refs, ...next.evidence_refs]);
      existing.limitations = uniqueStrings([...existing.limitations, ...next.limitations]);
      existing.reasoning = createReasoning(existing.technology, evidence.evidence_items.map((item) => item.type));
    }
  }

  const result: AiClassifierResult = {
    schema_version: "site-10-layer-ai-classifier-result/v0.1",
    provider: "fake_ai_classifier",
    invokes_ai_provider: false,
    target: contract.target,
    normalized_target: contract.normalized_target,
    results: Array.from(byTechnology.values()),
  };

  const validation = validateAiClassifierResult(contract, result);
  if (!validation.ok) {
    throw new Error(`Fake AI classifier produced invalid result: ${validation.errors.join("; ")}`);
  }

  return result;
}

export function validateAiClassifierResult(
  contract: AiClassifierContract,
  result: AiClassifierResult,
  options: { allowAiProviderInvocation?: boolean } = {},
): AiClassifierValidation {
  const errors: string[] = [];
  const allowedRefs = new Set(contract.input.evidence.map((item) => item.evidence_ref));
  const allowedConfidence = new Set(contract.output_contract.confidence_values);

  if (!options.allowAiProviderInvocation && result.invokes_ai_provider !== false) {
    errors.push("Result must not mark invokes_ai_provider as true.");
  }

  for (const [index, item] of result.results.entries()) {
    const prefix = `results[${index}]`;

    if (!item.technology) errors.push(`${prefix}.technology is required.`);
    if (!item.category) errors.push(`${prefix}.category is required.`);
    if (!allowedConfidence.has(item.confidence)) errors.push(`${prefix}.confidence is invalid.`);
    if (!item.reasoning) errors.push(`${prefix}.reasoning is required.`);
    if (!Array.isArray(item.limitations) || item.limitations.length === 0) errors.push(`${prefix}.limitations is required.`);
    if (!Array.isArray(item.evidence_refs) || item.evidence_refs.length === 0) {
      errors.push(`${prefix}.evidence_refs is required.`);
      continue;
    }

    for (const ref of item.evidence_refs) {
      if (!allowedRefs.has(ref)) errors.push(`${prefix}.evidence_refs contains unknown ref ${ref}.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function createReasoning(technology: string, evidenceTypes: string[]): string {
  const evidence = uniqueStrings(evidenceTypes).slice(0, 4).join(", ") || "candidate evidence";
  return `Fake classifier copied ${technology} from deterministic candidates and cited evidence types: ${evidence}.`;
}

function normalizeConfidence(value: string): AiClassifierOutputConfidence {
  if (value === "confirmed" || value === "likely" || value === "possible") return value;
  if (value === "high") return "likely";
  if (value === "medium" || value === "low") return "possible";
  return "unknown";
}

function maxConfidence(left: AiClassifierOutputConfidence, right: AiClassifierOutputConfidence): AiClassifierOutputConfidence {
  const rank: Record<AiClassifierOutputConfidence, number> = {
    unknown: 0,
    possible: 1,
    likely: 2,
    confirmed: 3,
  };

  return rank[right] > rank[left] ? right : left;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

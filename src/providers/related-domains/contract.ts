import type { Evidence, EvidenceMetadata, Run, SnapshotRecord } from "../../core/types";

export type RelatedDomainRelationship = "confirmed" | "likely" | "possible" | "unconfirmed" | "not_related";

export type RelatedDomainCandidateInput = {
  host: string;
  url: string;
  signal: string;
  role: string | null;
  source: string;
  evidence_refs: string[];
  evidence_items: RelatedDomainEvidenceItem[];
};

export type RelatedDomainEvidenceInput = {
  evidence_ref: string;
  layer: 9;
  probe: string;
  item: string;
  source: string;
  status: string;
  summary: string;
  metadata: EvidenceMetadata | null;
  candidates: RelatedDomainCandidateInput[];
  evidence_items: RelatedDomainEvidenceItem[];
  limitations: string[];
};

export type RelatedDomainEvidenceItem = {
  type: string;
  name?: string;
  value: string;
};

export type RelatedDomainConfirmationContract = {
  schema_version: "site-10-layer-related-domain-confirmation-contract/v0.1";
  invokes_provider: false;
  target: string;
  normalized_target: string;
  input: {
    layer: 9;
    evidence: RelatedDomainEvidenceInput[];
    instruction: string;
  };
  output_contract: {
    required_fields: ["candidate_host", "relationship", "reasoning", "evidence_refs", "limitations"];
    relationship_values: RelatedDomainRelationship[];
    rules: string[];
    example: {
      candidate_host: string;
      relationship: RelatedDomainRelationship;
      reasoning: string;
      evidence_refs: string[];
      limitations: string[];
    };
  };
};

export function createRelatedDomainConfirmationContract(run: Run): RelatedDomainConfirmationContract {
  const evidence = run.records
    .filter(isRelatedDomainInputRecord)
    .map((record, index) => createEvidenceInput(record, `RDC${String(index + 1).padStart(3, "0")}`))
    .filter((item) => item.candidates.length > 0);

  return {
    schema_version: "site-10-layer-related-domain-confirmation-contract/v0.1",
    invokes_provider: false,
    target: run.target,
    normalized_target: run.normalizedTarget,
    input: {
      layer: 9,
      evidence,
      instruction:
        "Evaluate whether homepage-visible related-domain candidates have additional relationship evidence. Do not infer legal ownership, operating entity identity, or business relationship from candidates alone.",
    },
    output_contract: {
      required_fields: ["candidate_host", "relationship", "reasoning", "evidence_refs", "limitations"],
      relationship_values: ["confirmed", "likely", "possible", "unconfirmed", "not_related"],
      rules: [
        "Every output item must cite one or more evidence_refs from input.evidence.",
        "Homepage-visible candidates alone should remain possible or unconfirmed unless additional evidence is supplied.",
        "Relationship output is not an ownership, legal-entity, or operating-entity claim.",
        "Absence of a candidate is not proof that no related domain exists.",
        "The contract defines shape only; this function must not call an external provider or AI model.",
      ],
      example: {
        candidate_host: "docs.example.net",
        relationship: "possible",
        reasoning: "The candidate appears in homepage links, but no shared identifier or external confirmation is present.",
        evidence_refs: ["RDC001"],
        limitations: ["Homepage-visible links can point to vendors, partners, docs, CDN, or unrelated third-party services."],
      },
    },
  };
}

function isRelatedDomainInputRecord(record: SnapshotRecord): boolean {
  return record.layer === 9 && record.status !== "skipped" && record.probe === "organization_intelligence_probe";
}

function createEvidenceInput(record: SnapshotRecord, evidenceRef: string): RelatedDomainEvidenceInput {
  return {
    evidence_ref: evidenceRef,
    layer: 9,
    probe: record.probe,
    item: record.item,
    source: record.source,
    status: record.status,
    summary: record.risk.summary,
    metadata: record.evidence_metadata ?? null,
    candidates: extractCandidates(record, evidenceRef),
    evidence_items: compactEvidenceItems(record.evidence),
    limitations: record.evidence_metadata?.limitations?.length
      ? record.evidence_metadata.limitations
      : ["No explicit collection limitation was attached to this evidence record."],
  };
}

function extractCandidates(record: SnapshotRecord, evidenceRef: string): RelatedDomainCandidateInput[] {
  const value = asObject(record.value);
  const candidates = Array.isArray(value.related_domain_candidates) ? value.related_domain_candidates : [];

  return candidates.flatMap((item) => {
    const candidate = asObject(item);
    const host = asString(candidate.host);
    const url = asString(candidate.url);
    const signal = asString(candidate.signal);
    const source = asString(candidate.source);
    if (!host || !url || !signal || !source) return [];

    return [
      {
        host,
        url,
        signal,
        role: asString(candidate.role),
        source,
        evidence_refs: [evidenceRef],
        evidence_items: compactCandidateEvidenceItems(candidate.evidence),
      },
    ];
  });
}

function compactCandidateEvidenceItems(value: unknown): RelatedDomainEvidenceItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 12)
    .flatMap((item) => {
      const evidence = asObject(item);
      const type = asString(evidence.type);
      const name = asString(evidence.name);
      const rawValue = asString(evidence.value);
      if (!type || !rawValue) return [];

      return [
        {
          type,
          ...(name ? { name } : {}),
          value: compactValue(rawValue),
        },
      ];
    });
}

function compactEvidenceItems(items: Evidence[]): RelatedDomainEvidenceItem[] {
  return items.slice(0, 20).map((item) => ({
    type: item.type,
    ...(item.name ? { name: item.name } : {}),
    value: compactValue(item.value),
  }));
}

function compactValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

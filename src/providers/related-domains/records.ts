import type { Evidence, EvidenceAssessment, SnapshotRecord } from "../../core/types";
import type { RelatedDomainRelationship } from "./contract";

type RelatedDomainRecordContext = {
  target: string;
  normalizedTarget: string;
  snapshotAt: string;
};

export type RelatedDomainConfirmationItem = {
  candidate_host: string;
  relationship: RelatedDomainRelationship;
  reasoning: string;
  evidence_refs: string[];
  limitations: string[];
};

export type RelatedDomainConfirmationSuccess = {
  ok: true;
  schema_version: "site-10-layer-related-domain-confirmation-result/v0.1";
  provider: string;
  invokes_provider: boolean;
  target: string;
  normalized_target: string;
  results: RelatedDomainConfirmationItem[];
};

export type RelatedDomainConfirmationFailure = {
  ok: false;
  schema_version: "site-10-layer-related-domain-confirmation-result/v0.1";
  provider: string;
  error_code: string;
  error: string;
  missing_config?: string[];
  validation_errors?: string[];
};

export type RelatedDomainConfirmationResponse =
  | RelatedDomainConfirmationSuccess
  | RelatedDomainConfirmationFailure;

type RelatedDomainConfirmationRecordValue = {
  schema_version: "site-10-layer-related-domain-confirmation-record/v0.1";
  provider: string;
  invokes_provider: boolean;
  confirmations: RelatedDomainConfirmationItem[];
  source_evidence_refs: string[];
  related_domain_confirmation_assessment: EvidenceAssessment;
};

type RelatedDomainConfirmationFailureValue = {
  schema_version: "site-10-layer-related-domain-confirmation-record/v0.1";
  provider: string;
  invokes_provider: false;
  error_code: string;
  error: string;
  missing_config?: string[];
  validation_errors?: string[];
};

export function createRelatedDomainConfirmationRecords(
  context: RelatedDomainRecordContext,
  response: RelatedDomainConfirmationResponse,
): SnapshotRecord<RelatedDomainConfirmationRecordValue | RelatedDomainConfirmationFailureValue>[] {
  if (!response.ok) {
    return [createFailureRecord(context, response)];
  }

  if (response.results.length === 0) return [];

  return [createSuccessRecord(context, response.provider, response.invokes_provider, response.results)];
}

export function validateRelatedDomainConfirmationResponse(
  response: RelatedDomainConfirmationResponse,
  allowedEvidenceRefs: string[],
): RelatedDomainConfirmationResponse {
  if (!response.ok) return response;

  const allowed = new Set(allowedEvidenceRefs);
  const validationErrors: string[] = [];

  for (const [index, item] of response.results.entries()) {
    if (!item.candidate_host) validationErrors.push(`results[${index}].candidate_host is required.`);
    if (!item.reasoning) validationErrors.push(`results[${index}].reasoning is required.`);
    if (!Array.isArray(item.evidence_refs) || item.evidence_refs.length === 0) {
      validationErrors.push(`results[${index}].evidence_refs must contain at least one evidence ref.`);
    }
    for (const ref of item.evidence_refs) {
      if (!allowed.has(ref)) validationErrors.push(`results[${index}].evidence_refs contains unknown ref ${ref}.`);
    }
    if (!Array.isArray(item.limitations) || item.limitations.length === 0) {
      validationErrors.push(`results[${index}].limitations must contain at least one limitation.`);
    }
  }

  if (validationErrors.length === 0) return response;

  return {
    ok: false,
    schema_version: "site-10-layer-related-domain-confirmation-result/v0.1",
    provider: response.provider,
    error_code: "invalid_related_domain_confirmation_output",
    error: "Related-domain confirmation provider returned invalid output.",
    validation_errors: validationErrors,
  };
}

function createSuccessRecord(
  context: RelatedDomainRecordContext,
  provider: string,
  invokesProvider: boolean,
  confirmations: RelatedDomainConfirmationItem[],
): SnapshotRecord<RelatedDomainConfirmationRecordValue> {
  const sourceEvidenceRefs = uniqueStrings(confirmations.flatMap((item) => item.evidence_refs));
  const limitations = uniqueStrings(confirmations.flatMap((item) => item.limitations));

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "related_domain_confirmation_probe",
    layer: 9,
    item: "related_domain_confirmation",
    probe_type: "external_provider",
    source: provider,
    status: "ok",
    value: {
      schema_version: "site-10-layer-related-domain-confirmation-record/v0.1",
      provider,
      invokes_provider: invokesProvider,
      confirmations,
      source_evidence_refs: sourceEvidenceRefs,
      related_domain_confirmation_assessment: {
        label: "Related-domain relationship evidence",
        conclusion: highestConclusion(confirmations),
        confidence: highestConfidence(confirmations),
        signals: confirmations.map((item) => ({
          type: "related_domain_relationship_evidence",
          name: item.candidate_host,
          value: {
            relationship: item.relationship,
            reasoning: item.reasoning,
          },
          source: provider,
          evidence_refs: item.evidence_refs,
        })),
        limitations: [
          "Related-domain confirmation is relationship evidence, not legal ownership or operating-entity proof.",
          "Each relationship status must be grounded in cited candidate or external evidence refs.",
          ...limitations,
        ],
      },
    },
    risk: {
      level: "info",
      summary: `Related-domain confirmation returned ${confirmations.length} evidence-cited relationship item(s).`,
    },
    evidence: buildConfirmationEvidence(confirmations),
    evidence_metadata: {
      origin: "external_provider",
      role: "derived",
      method: "external_api",
      limitations: [
        "Related-domain confirmation records must not be interpreted as ownership, legal-entity, or operating-entity claims.",
        "Homepage-visible candidates can be vendors, partners, CDNs, docs, redirects, or unrelated third-party services.",
        ...limitations,
      ],
    },
  };
}

function createFailureRecord(
  context: RelatedDomainRecordContext,
  response: RelatedDomainConfirmationFailure,
): SnapshotRecord<RelatedDomainConfirmationFailureValue> {
  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "related_domain_confirmation_provider_error",
    layer: 9,
    item: "related_domain_confirmation_provider_status",
    probe_type: "external_provider",
    source: response.provider,
    status: "error",
    value: {
      schema_version: "site-10-layer-related-domain-confirmation-record/v0.1",
      provider: response.provider,
      invokes_provider: false,
      error_code: response.error_code,
      error: response.error,
      ...(response.missing_config ? { missing_config: response.missing_config } : {}),
      ...(response.validation_errors ? { validation_errors: response.validation_errors } : {}),
    },
    risk: {
      level: "info",
      summary: `Related-domain confirmation provider did not return usable relationship evidence: ${response.error_code}.`,
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
        "Provider failures are status evidence only and must not be interpreted as related-domain relationship evidence.",
      ],
    },
  };
}

function buildConfirmationEvidence(confirmations: RelatedDomainConfirmationItem[]): Evidence[] {
  return confirmations.map((item) => ({
    type: "related_domain_confirmation_result",
    name: item.candidate_host,
    value: {
      relationship: item.relationship,
      reasoning: item.reasoning,
      evidence_refs: item.evidence_refs,
      limitations: item.limitations,
    },
  }));
}

function highestConclusion(confirmations: RelatedDomainConfirmationItem[]): EvidenceAssessment["conclusion"] {
  const relationship = highestRelationship(confirmations);
  if (relationship === "confirmed") return "confirmed";
  if (relationship === "likely") return "likely";
  if (relationship === "possible") return "possible";
  if (relationship === "not_related") return "not_detected";
  return "unknown";
}

function highestConfidence(confirmations: RelatedDomainConfirmationItem[]): EvidenceAssessment["confidence"] {
  const relationship = highestRelationship(confirmations);
  if (relationship === "confirmed") return "confirmed";
  if (relationship === "likely") return "likely";
  if (relationship === "possible") return "possible";
  if (relationship === "not_related") return "low";
  return "unknown";
}

function highestRelationship(confirmations: RelatedDomainConfirmationItem[]): RelatedDomainRelationship {
  const rank: Record<RelatedDomainRelationship, number> = {
    not_related: 0,
    unconfirmed: 1,
    possible: 2,
    likely: 3,
    confirmed: 4,
  };
  return confirmations.reduce<RelatedDomainRelationship>(
    (current, item) => (rank[item.relationship] > rank[current] ? item.relationship : current),
    "unconfirmed",
  );
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

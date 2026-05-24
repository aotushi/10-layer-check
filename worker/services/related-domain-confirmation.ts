import {
  parseRelatedDomainConfirmationWorkerRequest,
  runWorkerRelatedDomainConfirmationProvider,
  type RelatedDomainConfirmationWorkerRequest,
  type RelatedDomainConfirmationWorkerResponse,
  type RelatedDomainConfirmationWorkerEnv,
} from "../../src/providers/related-domains/worker-adapter";

export type RelatedDomainConfirmationEnv = RelatedDomainConfirmationWorkerEnv;

export async function runRelatedDomainConfirmationProvider(
  body: RelatedDomainConfirmationWorkerRequest,
  env: RelatedDomainConfirmationEnv,
): Promise<RelatedDomainConfirmationWorkerResponse> {
  const contract = parseRelatedDomainConfirmationWorkerRequest(body);
  if (!contract) {
    return {
      ok: false,
      schema_version: "site-10-layer-related-domain-confirmation-worker-response/v0.1",
      provider: "worker_related_domain_confirmation",
      error_code: "invalid_contract",
      error: "Request body must include a valid related-domain confirmation contract.",
      status: 400,
    };
  }

  return runWorkerRelatedDomainConfirmationProvider(contract, env);
}

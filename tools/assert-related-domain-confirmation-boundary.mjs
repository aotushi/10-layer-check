#!/usr/bin/env node
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createOrganizationLayerRecords } = await server.ssrLoadModule("/src/probes/layer-09-organization.ts");
  const { createRelatedDomainConfirmationContract } = await server.ssrLoadModule(
    "/src/providers/related-domains/contract.ts",
  );
  const { createRelatedDomainConfirmationRecords, validateRelatedDomainConfirmationResponse } = await server.ssrLoadModule(
    "/src/providers/related-domains/records.ts",
  );

  const context = {
    target: "https://example.com/",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-21T00:00:00.000Z",
    providers: [],
  };
  const organizationRecords = createOrganizationLayerRecords(context, createOrganizationFixtureResult());
  const run = {
    id: "related_domain_confirmation_boundary_fixture",
    target: context.target,
    normalizedTarget: context.normalizedTarget,
    createdAt: context.snapshotAt,
    source: "provider",
    records: organizationRecords,
  };

  const contract = createRelatedDomainConfirmationContract(run);
  if (contract.schema_version !== "site-10-layer-related-domain-confirmation-contract/v0.1") {
    throw new Error("Related-domain confirmation contract schema version is not stable.");
  }
  if (contract.invokes_provider !== false) {
    throw new Error("Related-domain confirmation contract creator must not invoke a provider.");
  }
  if (contract.input.evidence.length !== 1 || contract.input.evidence[0].evidence_ref !== "RDC001") {
    throw new Error("Contract must create stable evidence refs for organization candidate evidence.");
  }
  if (!contract.input.evidence[0].candidates.some((candidate) => candidate.host === "docs.example.net")) {
    throw new Error("Contract must preserve related-domain candidate hosts.");
  }
  if (!contract.input.evidence[0].evidence_items.some((item) => item.name === "related_domain_candidates")) {
    throw new Error("Contract must include compact candidate evidence items.");
  }
  if (!contract.output_contract.rules.some((rule) => /not an ownership/i.test(rule) || /ownership/i.test(rule))) {
    throw new Error("Contract must explicitly forbid ownership or operating-entity inference.");
  }

  const allowedRefs = contract.input.evidence.map((item) => item.evidence_ref);
  const validResponse = validateRelatedDomainConfirmationResponse(
    {
      ok: true,
      schema_version: "site-10-layer-related-domain-confirmation-result/v0.1",
      provider: "fixture_related_domain_reviewer",
      invokes_provider: false,
      target: context.target,
      normalized_target: context.normalizedTarget,
      results: [
        {
          candidate_host: "docs.example.net",
          relationship: "possible",
          reasoning: "The host appears as a homepage documentation link, but no shared identifier or external confirmation is present.",
          evidence_refs: ["RDC001"],
          limitations: ["Homepage-visible links can point to docs, vendors, partners, or unrelated third-party services."],
        },
      ],
    },
    allowedRefs,
  );

  const records = createRelatedDomainConfirmationRecords(context, validResponse);
  if (records.length !== 1) {
    throw new Error("Valid related-domain confirmation output should create one record.");
  }
  const record = records[0];
  if (record.layer !== 9 || record.probe !== "related_domain_confirmation_probe" || record.status !== "ok") {
    throw new Error("Valid related-domain confirmation output should create an ok L9 confirmation record.");
  }
  if (record.value.confirmations[0].relationship !== "possible") {
    throw new Error("Confirmation record must preserve relationship status.");
  }
  if (!record.value.related_domain_confirmation_assessment.signals[0].evidence_refs.includes("RDC001")) {
    throw new Error("Confirmation assessment must preserve cited evidence refs.");
  }
  assertNoOwnershipClaims(record);

  const invalidResponse = validateRelatedDomainConfirmationResponse(
    {
      ok: true,
      schema_version: "site-10-layer-related-domain-confirmation-result/v0.1",
      provider: "fixture_related_domain_reviewer",
      invokes_provider: false,
      target: context.target,
      normalized_target: context.normalizedTarget,
      results: [
        {
          candidate_host: "docs.example.net",
          relationship: "confirmed",
          reasoning: "This output cites a missing evidence ref and must be rejected before storage.",
          evidence_refs: ["RDC999"],
          limitations: ["Fixture invalid output."],
        },
      ],
    },
    allowedRefs,
  );

  const invalidRecords = createRelatedDomainConfirmationRecords(context, invalidResponse);
  if (invalidRecords.length !== 1 || invalidRecords[0].probe !== "related_domain_confirmation_provider_error") {
    throw new Error("Invalid related-domain confirmation output must become provider error status only.");
  }
  if (invalidRecords[0].evidence.some((item) => item.type === "related_domain_confirmation_result")) {
    throw new Error("Invalid provider output must not create positive relationship evidence.");
  }

  console.log("Related-domain confirmation boundary check passed.");
} finally {
  await server.close();
}

function assertNoOwnershipClaims(record) {
  const serialized = JSON.stringify(record).toLowerCase();
  for (const forbidden of ["is owned by", "are owned by", "owner of", "operated by", "legal owner is"]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`Related-domain confirmation record must not contain ownership claim phrase: ${forbidden}`);
    }
  }
}

function createOrganizationFixtureResult() {
  return {
    requested_url: "https://example.com/",
    host: "www.example.com",
    dns: {
      mx: { type: "MX", status: 0, answers: [] },
      ns: { type: "NS", status: 0, answers: [] },
      txt: { type: "TXT", status: 0, answers: [] },
      caa: { type: "CAA", status: 0, answers: [] },
    },
    mail_providers: [],
    social_links: [],
    related_domain_candidates: [
      {
        host: "docs.example.net",
        url: "https://docs.example.net/start",
        signal: "homepage_anchor_host",
        source: "homepage_html",
      },
      {
        host: "assets.example-cdn.net",
        url: "https://assets.example-cdn.net/app.js",
        signal: "homepage_resource_host",
        source: "homepage_html",
      },
    ],
    external_intelligence: {
      whois: { status: "not_collected", reason: "RDAP lookup is out of scope for this fixture." },
      icp: { status: "not_collected", reason: "ICP lookup is out of scope." },
      wayback: { status: "not_collected", reason: "Wayback lookup is out of scope for this fixture." },
    },
    duration_ms: 120,
    provider_id: "worker-organization-intelligence",
    source: "cloudflare_worker_org_intel",
  };
}

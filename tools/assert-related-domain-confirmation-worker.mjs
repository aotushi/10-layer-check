#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const dispatchSource = await readFile(new URL("../worker/routes/dispatch.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../worker/routes/related-domains.ts", import.meta.url), "utf8");
const serviceSource = await readFile(new URL("../worker/services/related-domain-confirmation.ts", import.meta.url), "utf8");
const adapterSource = await readFile(new URL("../src/providers/related-domains/worker-adapter.ts", import.meta.url), "utf8");

for (const token of [
  "/provider/related-domains/confirm",
  "handleRelatedDomainsRoute",
  "runRelatedDomainConfirmationProvider",
  "runWorkerRelatedDomainConfirmationProvider",
  "validateRelatedDomainConfirmationResponse",
]) {
  if (![dispatchSource, routeSource, serviceSource, adapterSource].some((source) => source.includes(token))) {
    throw new Error(`Related-domain confirmation Worker path should include ${token}.`);
  }
}

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");
  const { createRelatedDomainConfirmationRecords } = await server.ssrLoadModule("/src/providers/related-domains/records.ts");
  const contract = createContract();

  const missingConfig = await post(worker, { contract }, { ALLOW_LOCAL_DEV_NO_AUTH: "true" });
  assert.equal(missingConfig.status, 503);
  assert.equal(missingConfig.body.ok, false);
  assert.equal(missingConfig.body.error_code, "missing_related_domain_confirmation_provider_config");
  assert.deepEqual(missingConfig.body.missing_config, ["AI_PROVIDER_MODEL", "AI_PROVIDER_API_KEY"]);

  const valid = await post(worker, { contract }, {
    ALLOW_LOCAL_DEV_NO_AUTH: "true",
    AI_PROVIDER_MODEL: "@cf/meta/llama-3.1-8b-instruct",
    AI: {
      async run(_model, input) {
        assert.ok(JSON.stringify(input).includes("site-10-layer-related-domain-confirmation-contract/v0.1"));
        return {
          response: JSON.stringify({
            results: [
              {
                candidate_host: "docs.example.net",
                relationship: "possible",
                reasoning: "Candidate appears in homepage evidence but no external shared identifier is present.",
                evidence_refs: ["RDC001"],
                limitations: ["Homepage-visible candidates are not ownership proof."],
              },
            ],
          }),
        };
      },
    },
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.result.schema_version, "site-10-layer-related-domain-confirmation-result/v0.1");
  assert.equal(valid.body.result.invokes_provider, true);
  assert.equal(valid.body.result.results[0].evidence_refs[0], "RDC001");

  const records = createRelatedDomainConfirmationRecords(
    {
      target: "https://example.com/",
      normalizedTarget: "example.com",
      snapshotAt: "2026-05-21T00:00:00.000Z",
    },
    valid.body.result,
  );
  assert.equal(records[0].probe, "related_domain_confirmation_probe");
  assert.equal(records[0].value.invokes_provider, true);

  const invalid = await post(worker, { contract }, {
    ALLOW_LOCAL_DEV_NO_AUTH: "true",
    AI_PROVIDER_MODEL: "@cf/meta/llama-3.1-8b-instruct",
    AI: {
      async run() {
        return {
          response: JSON.stringify({
            results: [
              {
                candidate_host: "docs.example.net",
                relationship: "confirmed",
                reasoning: "Invalid fixture cites an unknown evidence ref.",
                evidence_refs: ["RDC999"],
                limitations: ["Invalid fixture."],
              },
            ],
          }),
        };
      },
    },
  });
  assert.equal(invalid.status, 502);
  assert.equal(invalid.body.ok, false);
  assert.equal(invalid.body.error_code, "invalid_model_output");
  assert.ok(invalid.body.validation_errors.some((item) => item.includes("unknown ref RDC999")));

  console.log("related-domain confirmation Worker check passed.");
} finally {
  await server.close();
}

async function post(worker, body, env) {
  const response = await worker.default.fetch(
    new Request("http://worker.local/provider/related-domains/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
  return {
    status: response.status,
    body: await response.json(),
  };
}

function createContract() {
  return {
    schema_version: "site-10-layer-related-domain-confirmation-contract/v0.1",
    invokes_provider: false,
    target: "https://example.com/",
    normalized_target: "example.com",
    input: {
      layer: 9,
      evidence: [
        {
          evidence_ref: "RDC001",
          layer: 9,
          probe: "organization_intelligence_probe",
          item: "organization_intelligence",
          source: "cloudflare_worker_org_intel",
          status: "ok",
          summary: "Homepage-visible related-domain candidates were found.",
          metadata: null,
          candidates: [
            {
              host: "docs.example.net",
              url: "https://docs.example.net/start",
              signal: "homepage_anchor_host",
              source: "homepage_html",
              evidence_refs: ["RDC001"],
            },
          ],
          evidence_items: [
            {
              type: "homepage_html",
              name: "related_domain_candidates",
              value: JSON.stringify([{ host: "docs.example.net", url: "https://docs.example.net/start" }]),
            },
          ],
          limitations: ["Homepage-visible links can point to vendors, docs, or unrelated third-party services."],
        },
      ],
      instruction:
        "Evaluate whether homepage-visible related-domain candidates have additional relationship evidence. Do not infer legal ownership.",
    },
    output_contract: {
      required_fields: ["candidate_host", "relationship", "reasoning", "evidence_refs", "limitations"],
      relationship_values: ["confirmed", "likely", "possible", "unconfirmed", "not_related"],
      rules: [
        "Every output item must cite one or more evidence_refs from input.evidence.",
        "Relationship output is not an ownership, legal-entity, or operating-entity claim.",
      ],
      example: {
        candidate_host: "docs.example.net",
        relationship: "possible",
        reasoning: "Candidate appears in homepage links, but no external confirmation is present.",
        evidence_refs: ["RDC001"],
        limitations: ["Homepage-visible links are weak evidence."],
      },
    },
  };
}

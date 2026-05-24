#!/usr/bin/env node
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createAiClassifierContract } = await server.ssrLoadModule("/src/providers/ai-classifier/contract.ts");
  const contract = createAiClassifierContract(createFixtureRun());

  if (contract.schema_version !== "site-10-layer-ai-classifier-contract/v0.1") {
    throw new Error("AI classifier contract schema version is not stable.");
  }

  if (contract.invokes_ai_provider !== false) {
    throw new Error("AI classifier contract must not invoke an AI provider.");
  }

  const requiredFields = new Set(contract.output_contract.required_fields);
  for (const expected of ["technology", "category", "confidence", "reasoning", "evidence_refs", "limitations"]) {
    if (!requiredFields.has(expected)) {
      throw new Error(`AI classifier output contract must require ${expected}.`);
    }
  }

  if (!contract.input.layers.includes(4) || !contract.input.layers.includes(8)) {
    throw new Error("AI classifier input must be scoped to L4 and L8.");
  }

  if (!contract.input.evidence.some((item) => item.evidence_ref === "AIC001" && item.layer === 4)) {
    throw new Error("AI classifier input must preserve L4 evidence refs.");
  }

  if (!contract.input.evidence.some((item) => item.layer === 8 && item.candidates.some((candidate) => candidate.name === "Next.js"))) {
    throw new Error("AI classifier input must include L8 fingerprint candidates.");
  }

  if (!contract.input.evidence.every((item) => item.limitations.length > 0)) {
    throw new Error("AI classifier input evidence must preserve limitations.");
  }

  const firstEvidence = contract.input.evidence.find((item) => item.evidence_ref === "AIC001");
  if (!firstEvidence?.evidence_items.some((item) => item.type === "script_url" && item.name === "script:1" && /_next\/static/.test(item.value))) {
    throw new Error("AI classifier input must include compact evidence snippets for model judgment.");
  }

  if (!firstEvidence.metadata || firstEvidence.metadata.origin !== "direct_observation" || firstEvidence.metadata.method !== "static_parse") {
    throw new Error("AI classifier input must preserve evidence metadata.");
  }

  console.log("AI classifier contract check passed.");
} finally {
  await server.close();
}

function createFixtureRun() {
  return {
    id: "run_ai_classifier_contract_fixture",
    target: "https://example.com/",
    normalizedTarget: "example.com",
    createdAt: "2026-05-21T00:00:00.000Z",
    source: "provider",
    records: [
      {
        target: "https://example.com/",
        normalized_target: "example.com",
        snapshot_at: "2026-05-21T00:00:00.000Z",
        probe: "ai_frontend_evidence_pack",
        layer: 4,
        item: "ai_frontend_evidence",
        probe_type: "active_request",
        source: "fixture",
        status: "ok",
        value: {
          deterministic_signals: [
            {
              technology: "Next.js",
              category: "frontend_framework",
              confidence: "likely",
              evidence_refs: ["script:1", "marker:__NEXT_DATA__"],
              source: "deterministic_rule",
            },
          ],
        },
        risk: {
          level: "info",
          summary: "Prepared an AI-ready Layer 4 evidence pack without invoking an AI provider.",
        },
        evidence: [
          { type: "script_url", name: "script:1", value: "https://example.com/_next/static/chunk.js" },
          { type: "html_marker", value: "__NEXT_DATA__" },
        ],
        evidence_metadata: {
          origin: "direct_observation",
          role: "raw",
          method: "static_parse",
          limitations: ["This record prepares evidence for a future AI classifier but does not invoke one."],
        },
      },
      {
        target: "https://example.com/",
        normalized_target: "example.com",
        snapshot_at: "2026-05-21T00:00:00.000Z",
        probe: "app_fingerprint_probe",
        layer: 8,
        item: "app_fingerprint",
        probe_type: "active_request",
        source: "fixture",
        status: "ok",
        value: {
          fingerprint_candidates: [
            {
              category: "framework",
              name: "Next.js",
              confidence: "high",
              evidence: ["html matched /__NEXT_DATA__/i"],
            },
          ],
        },
        risk: {
          level: "info",
          summary: "Found one application fingerprint candidate.",
        },
        evidence: [{ type: "fingerprint", name: "Next.js", value: "html matched /__NEXT_DATA__/i" }],
        evidence_metadata: {
          origin: "static_heuristic",
          role: "derived",
          method: "static_parse",
          limitations: ["Application fingerprints are based on visible response headers and static HTML patterns."],
        },
      },
    ],
  };
}

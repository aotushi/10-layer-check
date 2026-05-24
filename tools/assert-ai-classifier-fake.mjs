#!/usr/bin/env node
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createAiClassifierContract } = await server.ssrLoadModule("/src/providers/ai-classifier/contract.ts");
  const { runFakeAiClassifier, validateAiClassifierResult } = await server.ssrLoadModule("/src/providers/ai-classifier/fake.ts");
  const contract = createAiClassifierContract(createFixtureRun());
  const result = runFakeAiClassifier(contract);

  if (result.schema_version !== "site-10-layer-ai-classifier-result/v0.1") {
    throw new Error("Fake AI classifier result schema version is not stable.");
  }

  if (result.invokes_ai_provider !== false || result.provider !== "fake_ai_classifier") {
    throw new Error("Fake AI classifier must not invoke a real AI provider.");
  }

  const validation = validateAiClassifierResult(contract, result);
  if (!validation.ok) {
    throw new Error(`Fake AI classifier result must validate: ${validation.errors.join("; ")}`);
  }

  const next = result.results.find((item) => item.technology === "Next.js");
  if (!next) {
    throw new Error("Fake AI classifier must emit a Next.js candidate from fixture evidence.");
  }

  for (const field of ["technology", "category", "confidence", "reasoning", "evidence_refs", "limitations"]) {
    if (!(field in next)) {
      throw new Error(`Fake AI classifier result item must include ${field}.`);
    }
  }

  if (!next.evidence_refs.includes("AIC001")) {
    throw new Error("Fake AI classifier result must cite contract-level evidence_refs.");
  }

  const bad = {
    ...result,
    results: [
      {
        ...next,
        evidence_refs: ["UNKNOWN_REF"],
      },
    ],
  };
  const badValidation = validateAiClassifierResult(contract, bad);
  if (badValidation.ok || !badValidation.errors.some((error) => /UNKNOWN_REF/.test(error))) {
    throw new Error("AI classifier result validation must reject unknown evidence_refs.");
  }

  console.log("Fake AI classifier check passed.");
} finally {
  await server.close();
}

function createFixtureRun() {
  return {
    id: "run_fake_ai_classifier_fixture",
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
    ],
  };
}

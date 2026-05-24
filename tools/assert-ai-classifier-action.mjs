#!/usr/bin/env node
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createAiClassifierContract } = await server.ssrLoadModule("/src/providers/ai-classifier/contract.ts");
  const { callWorkerAiClassifierProvider } = await server.ssrLoadModule("/src/providers/ai-classifier/client.ts");
  const { createAiClassifierRun, createDemoRemoteFetchRun, mergeProviderRun } = await server.ssrLoadModule("/src/core/model.ts");

  const provider = {
    id: "worker-ai",
    type: "ai_classifier",
    displayName: "Worker AI Classifier",
    endpoint: "http://worker.local/probe/remote-fetch",
    authMode: "api_key",
    secretRef: "probe-key",
    enabled: true,
    capabilityTags: ["technology_classification", "evidence_reasoning"],
  };
  const providers = [provider];
  const baseRun = createDemoRemoteFetchRun("https://example.com/", providers);
  const contract = createAiClassifierContract(baseRun);

  if (contract.input.evidence.length === 0) {
    throw new Error("Fixture run must provide L4/L8 classifier input evidence.");
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        schema_version: "site-10-layer-ai-classifier-worker-response/v0.1",
        provider: "worker_ai_classifier",
        result: {
          schema_version: "site-10-layer-ai-classifier-result/v0.1",
          provider: "worker_ai_classifier",
          invokes_ai_provider: true,
          target: baseRun.target,
          normalized_target: baseRun.normalizedTarget,
          results: [
            {
              technology: "React",
              category: "frontend_framework",
              confidence: "possible",
              reasoning: "The cited evidence includes frontend app markers.",
              evidence_refs: [contract.input.evidence[0].evidence_ref],
              limitations: ["Static evidence can miss runtime-only frameworks."],
            },
            {
              technology: "Google Analytics",
              category: "analytics",
              confidence: "possible",
              reasoning: "The cited evidence includes third-party analytics hints.",
              evidence_refs: [contract.input.evidence[0].evidence_ref],
              limitations: ["Third-party scripts can be proxied or loaded after interaction."],
            },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const response = await callWorkerAiClassifierProvider({ provider, contract });
    const providerRun = createAiClassifierRun(baseRun.target, providers, response);
    const mergedRun = mergeProviderRun(baseRun, providerRun);

    if (!mergedRun.records.some((record) => record.layer === 4 && record.probe === "ai_classifier_probe")) {
      throw new Error("AI classifier action path should merge a Layer 4 ai_classifier_probe record.");
    }
    if (!mergedRun.records.some((record) => record.layer === 8 && record.probe === "ai_classifier_probe")) {
      throw new Error("AI classifier action path should merge a Layer 8 ai_classifier_probe record.");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const failureRun = createAiClassifierRun(baseRun.target, providers, {
    ok: false,
    schema_version: "site-10-layer-ai-classifier-worker-response/v0.1",
    provider: "worker_ai_classifier",
    error_code: "missing_ai_provider_config",
    error: "AI provider is not configured.",
    status: 503,
    missing_config: ["AI_PROVIDER_API_KEY", "AI_PROVIDER_MODEL"],
  });
  const failureMergedRun = mergeProviderRun(baseRun, failureRun);

  if (!failureMergedRun.records.some((record) => record.probe === "ai_classifier_provider_error")) {
    throw new Error("AI classifier failure path should merge a provider error status record.");
  }
  if (failureMergedRun.records.some((record) => record.probe === "ai_classifier_provider_error" && record.evidence.some((item) => item.type === "ai_classifier_result"))) {
    throw new Error("AI classifier failure path must not create positive classification evidence.");
  }

  console.log("AI classifier action merge check passed.");
} finally {
  await server.close();
}

#!/usr/bin/env node
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createAiClassifierRecords } = await server.ssrLoadModule("/src/providers/ai-classifier/records.ts");

  const context = {
    target: "https://example.com/",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-21T00:00:00.000Z",
  };

  const records = createAiClassifierRecords(context, {
    ok: true,
    schema_version: "site-10-layer-ai-classifier-worker-response/v0.1",
    provider: "worker_ai_classifier",
    result: {
      schema_version: "site-10-layer-ai-classifier-result/v0.1",
      provider: "worker_ai_classifier",
      invokes_ai_provider: true,
      target: context.target,
      normalized_target: context.normalizedTarget,
      results: [
        {
          technology: "Next.js",
          category: "frontend_framework",
          confidence: "likely",
          reasoning: "The cited evidence includes Next.js static chunk paths.",
          evidence_refs: ["AIC001"],
          limitations: ["Static and runtime evidence can miss server-side technologies."],
        },
        {
          technology: "Google Analytics",
          category: "analytics",
          confidence: "possible",
          reasoning: "The cited evidence includes analytics script hints.",
          evidence_refs: ["AIC002"],
          limitations: ["Third-party tools can be proxied or loaded after interaction."],
        },
      ],
    },
  });

  if (records.length !== 2) {
    throw new Error(`Expected one Layer 4 and one Layer 8 AI classifier record, got ${records.length}.`);
  }

  const layer4 = records.find((record) => record.layer === 4);
  if (!layer4 || layer4.probe !== "ai_classifier_probe" || layer4.status !== "ok") {
    throw new Error("Valid classifier output should create an ok Layer 4 ai_classifier_probe record.");
  }
  if (layer4.value.invokes_ai_provider !== true || layer4.value.provider !== "worker_ai_classifier") {
    throw new Error("AI classifier records must preserve provider and invokes_ai_provider metadata.");
  }
  if (layer4.value.classifications[0]?.evidence_refs?.[0] !== "AIC001") {
    throw new Error("AI classifier records must preserve cited contract evidence refs.");
  }
  if (!layer4.evidence.some((item) => item.type === "ai_classifier_result" && item.name === "Next.js")) {
    throw new Error("AI classifier records must expose compact classification evidence.");
  }
  if (layer4.evidence_metadata?.origin !== "external_provider" || layer4.evidence_metadata?.method !== "external_api") {
    throw new Error("AI classifier records must mark the evidence as external-provider AI output.");
  }

  const layer8 = records.find((record) => record.layer === 8);
  if (!layer8 || layer8.value.classifications[0]?.technology !== "Google Analytics") {
    throw new Error("Application/tool categories should map to Layer 8 classifier evidence.");
  }

  const failureRecords = createAiClassifierRecords(context, {
    ok: false,
    schema_version: "site-10-layer-ai-classifier-worker-response/v0.1",
    provider: "worker_ai_classifier",
    error_code: "missing_ai_provider_config",
    error: "AI provider is not configured.",
    status: 503,
    missing_config: ["AI_PROVIDER_API_KEY", "AI_PROVIDER_MODEL"],
  });

  if (failureRecords.length !== 1) {
    throw new Error("Provider failures should create one status record, not positive technology evidence.");
  }
  if (failureRecords[0].status !== "error" || failureRecords[0].probe !== "ai_classifier_provider_error") {
    throw new Error("Provider failures should be represented as an ai_classifier_provider_error record.");
  }
  if (failureRecords[0].value.classifications || failureRecords[0].evidence.some((item) => item.type === "ai_classifier_result")) {
    throw new Error("Provider failure records must not contain positive technology classification evidence.");
  }

  console.log("AI classifier record mapping check passed.");
} finally {
  await server.close();
}

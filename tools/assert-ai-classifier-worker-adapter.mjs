#!/usr/bin/env node
import { createServer } from "vite";
import { readFile } from "node:fs/promises";

const remoteFetchSource = await readFile(new URL("../worker/remote-fetch.ts", import.meta.url), "utf8");
const aiRouteSource = await readFile(new URL("../worker/routes/ai.ts", import.meta.url), "utf8").catch(() => "");
const aiServiceSource = await readFile(new URL("../worker/services/ai-classifier.ts", import.meta.url), "utf8").catch(() => "");

if (!remoteFetchSource.includes('from "./routes/dispatch"') || !aiRouteSource.includes('from "../services/ai-classifier"')) {
  throw new Error("Worker AI classifier route should delegate through worker/services/ai-classifier.ts.");
}

if (remoteFetchSource.includes("parseWorkerAiClassifierRequest") || remoteFetchSource.includes("runWorkerAiClassifierProvider")) {
  throw new Error("worker/remote-fetch.ts should not own AI classifier request parsing or provider invocation.");
}

for (const token of [
  "runAiClassifierProvider",
  "parseWorkerAiClassifierRequest",
  "runWorkerAiClassifierProvider",
  "invalid_contract",
  "site-10-layer-ai-classifier-worker-response/v0.1",
]) {
  if (!aiServiceSource.includes(token)) {
    throw new Error(`worker/services/ai-classifier.ts should contain ${token}.`);
  }
}

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createAiClassifierContract } = await server.ssrLoadModule("/src/providers/ai-classifier/contract.ts");
  const { callWorkerAiClassifierProvider } = await server.ssrLoadModule("/src/providers/ai-classifier/client.ts");
  const { runWorkerAiClassifierProvider } = await server.ssrLoadModule("/src/providers/ai-classifier/worker-adapter.ts");
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");

  const contract = createAiClassifierContract(createFixtureRun());

  const missingConfigResponse = await worker.default.fetch(
    new Request("http://worker.local/provider/ai/classifier", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contract }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );
  const missingConfigBody = await missingConfigResponse.json();
  if (missingConfigResponse.status !== 503) {
    throw new Error(`Missing AI provider config should return 503, got ${missingConfigResponse.status}.`);
  }
  if (missingConfigBody.error_code !== "missing_ai_provider_config") {
    throw new Error("Missing AI provider config should return a structured missing_ai_provider_config error.");
  }
  if (!missingConfigBody.missing_config?.includes("AI_PROVIDER_API_KEY")) {
    throw new Error("Missing AI provider config should report AI_PROVIDER_API_KEY.");
  }

  const workersAiCalls = [];
  const workersAi = await runWorkerAiClassifierProvider(contract, {
    AI_PROVIDER_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    AI: {
      run: async (model, input) => {
        workersAiCalls.push({ model, input });
        return {
          response: `Here is the JSON:
\`\`\`json
${JSON.stringify({
            results: [
              {
                technology: "Next.js",
                category: "frontend_framework",
                confidence: "likely",
                reasoning: "The supplied evidence cites Next.js script paths and markers.",
                evidence_refs: ["AIC001"],
                limitations: ["Static and runtime evidence can miss server-side technologies."],
              },
            ],
          })}
\`\`\`
`,
        };
      },
    },
  });
  if (!workersAi.ok || workersAi.result.results[0]?.technology !== "Next.js") {
    throw new Error("Worker AI classifier adapter should use Cloudflare Workers AI binding when env.AI is available.");
  }
  if (workersAiCalls[0]?.model !== "@cf/meta/llama-3.1-8b-instruct-fast") {
    throw new Error("Worker AI classifier adapter should pass AI_PROVIDER_MODEL to env.AI.run.");
  }
  if (workersAiCalls[0]?.input?.messages?.[0]?.role !== "system") {
    throw new Error("Worker AI classifier adapter should send chat messages to env.AI.run.");
  }
  if (workersAiCalls[0]?.input?.response_format?.type !== "json_schema") {
    throw new Error("Worker AI classifier adapter should request Cloudflare Workers AI JSON Mode.");
  }

  const originalFetch = globalThis.fetch;
  let clientRequest = null;
  globalThis.fetch = async (request, init) => {
    clientRequest = { request, init };
    return new Response(
      JSON.stringify({
        ok: false,
        schema_version: "site-10-layer-ai-classifier-worker-response/v0.1",
        provider: "worker_ai_classifier",
        error_code: "missing_ai_provider_config",
        error: "AI provider is not configured.",
        status: 503,
        missing_config: ["AI_PROVIDER_API_KEY", "AI_PROVIDER_MODEL"],
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const clientResponse = await callWorkerAiClassifierProvider({
      provider: {
        id: "worker-ai",
        type: "ai_classifier",
        displayName: "Worker AI Classifier",
        endpoint: "http://worker.local/probe/remote-fetch",
        authMode: "api_key",
        secretRef: "probe-key",
        enabled: true,
        capabilityTags: ["ai_classifier"],
      },
      contract,
    });
    if (clientResponse.ok || clientResponse.error_code !== "missing_ai_provider_config") {
      throw new Error("Frontend Worker AI classifier client should preserve structured provider failures.");
    }
    if (String(clientRequest?.request) !== "http://worker.local/provider/ai/classifier") {
      throw new Error("Frontend Worker AI classifier client should target /provider/ai/classifier on the configured Worker.");
    }
    if (clientRequest?.init?.headers?.["x-api-key"] !== "probe-key") {
      throw new Error("Frontend Worker AI classifier client should send provider api_key as x-api-key.");
    }
    const requestBody = JSON.parse(clientRequest?.init?.body ?? "{}");
    if (requestBody.contract?.schema_version !== "site-10-layer-ai-classifier-contract/v0.1") {
      throw new Error("Frontend Worker AI classifier client should send the classifier contract in the request body.");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const valid = await runWorkerAiClassifierProvider(
    contract,
    {
      AI_PROVIDER_API_KEY: "test-key",
      AI_PROVIDER_MODEL: "test-model",
      AI_PROVIDER_BASE_URL: "https://example.invalid/v1/chat/completions",
    },
    {
      modelClient: async () => ({
        schema_version: "site-10-layer-ai-classifier-result/v0.1",
        provider: "worker_ai_classifier",
        invokes_ai_provider: true,
        target: contract.target,
        normalized_target: contract.normalized_target,
        results: [
          {
            technology: "Next.js",
            category: "frontend_framework",
            confidence: "likely",
            reasoning: "The supplied evidence cites Next.js script paths and markers.",
            evidence_refs: ["AIC001"],
            limitations: ["Static and runtime evidence can miss server-side technologies."],
          },
        ],
      }),
    },
  );
  if (!valid.ok || valid.result.results[0]?.technology !== "Next.js") {
    throw new Error("Worker AI classifier adapter should accept a valid structured model result.");
  }
  if (valid.result.invokes_ai_provider !== true) {
    throw new Error("Worker AI classifier adapter should mark successful real-adapter responses as invoking an AI provider.");
  }

  const invalid = await runWorkerAiClassifierProvider(
    contract,
    { AI_PROVIDER_API_KEY: "test-key", AI_PROVIDER_MODEL: "test-model" },
    {
      modelClient: async () => ({
        schema_version: "site-10-layer-ai-classifier-result/v0.1",
        provider: "worker_ai_classifier",
        invokes_ai_provider: true,
        target: contract.target,
        normalized_target: contract.normalized_target,
        results: [
          {
            technology: "UnknownStack",
            category: "frontend_framework",
            confidence: "likely",
            reasoning: "Bad fixture cites a missing evidence ref.",
            evidence_refs: ["UNKNOWN_REF"],
            limitations: ["Fixture limitation."],
          },
        ],
      }),
    },
  );
  if (invalid.ok || invalid.error_code !== "invalid_model_output") {
    throw new Error("Worker AI classifier adapter should reject model output with unknown evidence_refs.");
  }
  if (!invalid.validation_errors?.some((error) => error.includes("UNKNOWN_REF"))) {
    throw new Error("Worker AI classifier adapter should expose validation errors for unknown evidence_refs.");
  }

  console.log("Worker AI classifier adapter check passed.");
} finally {
  await server.close();
}

function createFixtureRun() {
  return {
    id: "run_worker_ai_classifier_fixture",
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

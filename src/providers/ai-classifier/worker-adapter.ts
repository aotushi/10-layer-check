import type { AiClassifierContract } from "./contract";
import type { AiClassifierResult } from "./fake";
import { validateAiClassifierResult } from "./fake";

export type WorkerAiClassifierEnv = {
  AI?: WorkersAiBinding;
  AI_PROVIDER_API_KEY?: string;
  AI_PROVIDER_MODEL?: string;
  AI_PROVIDER_BASE_URL?: string;
};

export type WorkersAiBinding = {
  run: (model: string, input: WorkersAiChatInput) => Promise<unknown>;
};

type WorkersAiChatInput = {
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
  response_format?: {
    type: "json_schema";
    json_schema: Record<string, unknown>;
  };
  temperature?: number;
  max_tokens?: number;
};

export type WorkerAiClassifierRequest = {
  contract?: unknown;
};

export type WorkerAiClassifierSuccess = {
  ok: true;
  schema_version: "site-10-layer-ai-classifier-worker-response/v0.1";
  provider: "worker_ai_classifier";
  result: AiClassifierResult;
};

export type WorkerAiClassifierFailure = {
  ok: false;
  schema_version: "site-10-layer-ai-classifier-worker-response/v0.1";
  provider: "worker_ai_classifier";
  error_code:
    | "missing_ai_provider_config"
    | "invalid_contract"
    | "invalid_model_output"
    | "model_call_failed";
  error: string;
  status: number;
  missing_config?: string[];
  validation_errors?: string[];
};

export type WorkerAiClassifierResponse = WorkerAiClassifierSuccess | WorkerAiClassifierFailure;

export type WorkerAiClassifierModelClient = (
  contract: AiClassifierContract,
  config: OpenAiCompatibleConfig,
) => Promise<unknown>;

type OpenAiCompatibleConfig = {
  AI_PROVIDER_API_KEY: string;
  AI_PROVIDER_MODEL: string;
  AI_PROVIDER_BASE_URL: string;
};

export async function runWorkerAiClassifierProvider(
  contract: AiClassifierContract,
  env: WorkerAiClassifierEnv,
  options: { modelClient?: WorkerAiClassifierModelClient } = {},
): Promise<WorkerAiClassifierResponse> {
  if (!isAiClassifierContract(contract)) {
    return failure("invalid_contract", "Request body must include a valid AI classifier contract.", 400);
  }

  const missing = missingAiProviderConfig(env);
  if (missing.length > 0) {
    return failure(
      "missing_ai_provider_config",
      "AI provider is not configured. Set AI_PROVIDER_MODEL plus either Workers AI binding or AI_PROVIDER_API_KEY before calling a real model.",
      503,
      { missing_config: missing },
    );
  }

  try {
    const raw =
      options.modelClient && env.AI_PROVIDER_API_KEY
        ? await options.modelClient(contract, createOpenAiCompatibleConfig(env))
        : await callConfiguredAiClassifier(contract, env);
    const result = normalizeModelResult(contract, raw);
    const validation = validateAiClassifierResult(contract, result, { allowAiProviderInvocation: true });

    if (!validation.ok) {
      return failure("invalid_model_output", "AI provider returned invalid classifier output.", 502, {
        validation_errors: validation.errors,
      });
    }

    return {
      ok: true,
      schema_version: "site-10-layer-ai-classifier-worker-response/v0.1",
      provider: "worker_ai_classifier",
      result,
    };
  } catch (error) {
    return failure("model_call_failed", error instanceof Error ? error.message : String(error), 502);
  }
}

export function parseWorkerAiClassifierRequest(body: WorkerAiClassifierRequest): AiClassifierContract | null {
  return isAiClassifierContract(body.contract) ? body.contract : null;
}

function missingAiProviderConfig(env: WorkerAiClassifierEnv): string[] {
  const missing: string[] = [];
  if (!hasText(env.AI_PROVIDER_MODEL)) missing.push("AI_PROVIDER_MODEL");
  if (!env.AI && !hasText(env.AI_PROVIDER_API_KEY)) missing.push("AI_PROVIDER_API_KEY");
  return missing;
}

async function callConfiguredAiClassifier(contract: AiClassifierContract, env: WorkerAiClassifierEnv): Promise<unknown> {
  if (env.AI) return callCloudflareWorkersAiClassifier(contract, env.AI, env.AI_PROVIDER_MODEL ?? "");
  return callOpenAiCompatibleClassifier(contract, createOpenAiCompatibleConfig(env));
}

function createOpenAiCompatibleConfig(env: WorkerAiClassifierEnv): OpenAiCompatibleConfig {
  return {
    AI_PROVIDER_API_KEY: env.AI_PROVIDER_API_KEY ?? "",
    AI_PROVIDER_MODEL: env.AI_PROVIDER_MODEL ?? "",
    AI_PROVIDER_BASE_URL: env.AI_PROVIDER_BASE_URL ?? "https://api.openai.com/v1/chat/completions",
  };
}

async function callOpenAiCompatibleClassifier(
  contract: AiClassifierContract,
  config: OpenAiCompatibleConfig,
): Promise<unknown> {
  const response = await fetch(config.AI_PROVIDER_BASE_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.AI_PROVIDER_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.AI_PROVIDER_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Return only JSON matching site-10-layer-ai-classifier-result/v0.1. Cite only evidence_refs present in the input contract.",
        },
        {
          role: "user",
          content: JSON.stringify(contract),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`AI provider request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI provider response did not include message content.");
  return JSON.parse(content);
}

async function callCloudflareWorkersAiClassifier(
  contract: AiClassifierContract,
  ai: WorkersAiBinding,
  model: string,
): Promise<unknown> {
  const body = await ai.run(model, {
    messages: createClassifierMessages(contract),
    temperature: 0,
    max_tokens: 1200,
  });
  return parseModelJsonContent(extractModelContent(body));
}

function createClassifierMessages(contract: AiClassifierContract): WorkersAiChatInput["messages"] {
  return [
    {
      role: "system",
      content:
        "Return only JSON matching site-10-layer-ai-classifier-result/v0.1. Cite only evidence_refs present in the input contract.",
    },
    {
      role: "user",
      content: JSON.stringify(contract),
    },
  ];
}

function extractModelContent(value: unknown): string {
  if (typeof value === "string") return value;
  const body = asObject(value);
  const response = body.response;
  if (typeof response === "string") return response;
  if (isRecord(response)) return JSON.stringify(response);
  const result = body.result;
  if (typeof result === "string") return result;
  if (isRecord(result)) return JSON.stringify(result);
  const content = body.content;
  if (typeof content === "string") return content;
  return JSON.stringify(value);
}

function parseModelJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return JSON.parse(fenced[1].trim());

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return JSON.parse(trimmed);
}

function normalizeModelResult(contract: AiClassifierContract, value: unknown): AiClassifierResult {
  const result = asObject(value);
  return {
    schema_version: "site-10-layer-ai-classifier-result/v0.1",
    provider: "worker_ai_classifier",
    invokes_ai_provider: true,
    target: contract.target,
    normalized_target: contract.normalized_target,
    results: Array.isArray(result.results)
      ? result.results.map((item) => normalizeModelResultItem(item))
      : [],
  };
}

function normalizeModelResultItem(value: unknown): AiClassifierResult["results"][number] {
  const item = asObject(value);
  return {
    technology: asString(item.technology),
    category: asString(item.category),
    confidence: asString(item.confidence) as AiClassifierResult["results"][number]["confidence"],
    reasoning: truncate(asString(item.reasoning), 1000),
    evidence_refs: asStringArray(item.evidence_refs).slice(0, 20),
    limitations: asStringArray(item.limitations).map((value) => truncate(value, 500)).slice(0, 20),
  };
}

function isAiClassifierContract(value: unknown): value is AiClassifierContract {
  const contract = asObject(value);
  return (
    contract.schema_version === "site-10-layer-ai-classifier-contract/v0.1" &&
    contract.invokes_ai_provider === false &&
    typeof contract.target === "string" &&
    typeof contract.normalized_target === "string" &&
    Array.isArray(asObject(contract.input).evidence)
  );
}

function failure(
  error_code: WorkerAiClassifierFailure["error_code"],
  error: string,
  status: number,
  extra: Pick<WorkerAiClassifierFailure, "missing_config" | "validation_errors"> = {},
): WorkerAiClassifierFailure {
  return {
    ok: false,
    schema_version: "site-10-layer-ai-classifier-worker-response/v0.1",
    provider: "worker_ai_classifier",
    error_code,
    error,
    status,
    ...extra,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

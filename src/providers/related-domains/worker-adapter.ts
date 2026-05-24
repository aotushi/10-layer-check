import type { RelatedDomainConfirmationContract, RelatedDomainRelationship } from "./contract";
import {
  validateRelatedDomainConfirmationResponse,
  type RelatedDomainConfirmationSuccess,
} from "./records";

export type RelatedDomainConfirmationWorkerEnv = {
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

export type RelatedDomainConfirmationWorkerRequest = {
  contract?: unknown;
};

export type RelatedDomainConfirmationWorkerFailure = {
  ok: false;
  schema_version: "site-10-layer-related-domain-confirmation-worker-response/v0.1";
  provider: "worker_related_domain_confirmation";
  error_code:
    | "missing_related_domain_confirmation_provider_config"
    | "invalid_contract"
    | "invalid_model_output"
    | "model_call_failed";
  error: string;
  status: number;
  missing_config?: string[];
  validation_errors?: string[];
};

export type RelatedDomainConfirmationWorkerSuccess = {
  ok: true;
  schema_version: "site-10-layer-related-domain-confirmation-worker-response/v0.1";
  provider: "worker_related_domain_confirmation";
  result: RelatedDomainConfirmationSuccess;
};

export type RelatedDomainConfirmationWorkerResponse =
  | RelatedDomainConfirmationWorkerSuccess
  | RelatedDomainConfirmationWorkerFailure;

type OpenAiCompatibleConfig = {
  AI_PROVIDER_API_KEY: string;
  AI_PROVIDER_MODEL: string;
  AI_PROVIDER_BASE_URL: string;
};

export type RelatedDomainConfirmationModelClient = (
  contract: RelatedDomainConfirmationContract,
  config: OpenAiCompatibleConfig,
) => Promise<unknown>;

export async function runWorkerRelatedDomainConfirmationProvider(
  contract: RelatedDomainConfirmationContract,
  env: RelatedDomainConfirmationWorkerEnv,
  options: { modelClient?: RelatedDomainConfirmationModelClient } = {},
): Promise<RelatedDomainConfirmationWorkerResponse> {
  if (!isRelatedDomainConfirmationContract(contract)) {
    return failure("invalid_contract", "Request body must include a valid related-domain confirmation contract.", 400);
  }

  const missing = missingProviderConfig(env);
  if (missing.length > 0) {
    return failure(
      "missing_related_domain_confirmation_provider_config",
      "Related-domain confirmation provider is not configured. Set AI_PROVIDER_MODEL plus either Workers AI binding or AI_PROVIDER_API_KEY.",
      503,
      { missing_config: missing },
    );
  }

  try {
    const raw =
      options.modelClient && env.AI_PROVIDER_API_KEY
        ? await options.modelClient(contract, createOpenAiCompatibleConfig(env))
        : await callConfiguredProvider(contract, env);
    const result = normalizeModelResult(contract, raw);
    const allowedRefs = contract.input.evidence.map((item) => item.evidence_ref);
    const validation = validateRelatedDomainConfirmationResponse(result, allowedRefs);

    if (!validation.ok) {
      return failure("invalid_model_output", "Related-domain confirmation provider returned invalid output.", 502, {
        validation_errors: validation.validation_errors ?? [validation.error],
      });
    }

    return {
      ok: true,
      schema_version: "site-10-layer-related-domain-confirmation-worker-response/v0.1",
      provider: "worker_related_domain_confirmation",
      result: validation,
    };
  } catch (error) {
    return failure("model_call_failed", error instanceof Error ? error.message : String(error), 502);
  }
}

export function parseRelatedDomainConfirmationWorkerRequest(
  body: RelatedDomainConfirmationWorkerRequest,
): RelatedDomainConfirmationContract | null {
  return isRelatedDomainConfirmationContract(body.contract) ? body.contract : null;
}

function missingProviderConfig(env: RelatedDomainConfirmationWorkerEnv): string[] {
  const missing: string[] = [];
  if (!hasText(env.AI_PROVIDER_MODEL)) missing.push("AI_PROVIDER_MODEL");
  if (!env.AI && !hasText(env.AI_PROVIDER_API_KEY)) missing.push("AI_PROVIDER_API_KEY");
  return missing;
}

async function callConfiguredProvider(
  contract: RelatedDomainConfirmationContract,
  env: RelatedDomainConfirmationWorkerEnv,
): Promise<unknown> {
  if (env.AI) return callCloudflareWorkersAi(contract, env.AI, env.AI_PROVIDER_MODEL ?? "");
  return callOpenAiCompatible(contract, createOpenAiCompatibleConfig(env));
}

function createOpenAiCompatibleConfig(env: RelatedDomainConfirmationWorkerEnv): OpenAiCompatibleConfig {
  return {
    AI_PROVIDER_API_KEY: env.AI_PROVIDER_API_KEY ?? "",
    AI_PROVIDER_MODEL: env.AI_PROVIDER_MODEL ?? "",
    AI_PROVIDER_BASE_URL: env.AI_PROVIDER_BASE_URL ?? "https://api.openai.com/v1/chat/completions",
  };
}

async function callOpenAiCompatible(
  contract: RelatedDomainConfirmationContract,
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
      messages: createMessages(contract),
    }),
  });

  if (!response.ok) {
    throw new Error(`Related-domain confirmation provider request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Related-domain confirmation provider response did not include message content.");
  return JSON.parse(content);
}

async function callCloudflareWorkersAi(
  contract: RelatedDomainConfirmationContract,
  ai: WorkersAiBinding,
  model: string,
): Promise<unknown> {
  const body = await ai.run(model, {
    messages: createMessages(contract),
    response_format: {
      type: "json_schema",
      json_schema: createJsonSchema(),
    },
    temperature: 0,
    max_tokens: 1200,
  });
  return parseModelJsonContent(extractModelContent(body));
}

function createMessages(contract: RelatedDomainConfirmationContract): WorkersAiChatInput["messages"] {
  return [
    {
      role: "system",
      content:
        "Return only JSON with a results array matching site-10-layer-related-domain-confirmation-result/v0.1. Cite only evidence_refs present in the input. Do not make ownership, legal-entity, or operating-entity claims.",
    },
    {
      role: "user",
      content: JSON.stringify(contract),
    },
  ];
}

function createJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            candidate_host: { type: "string" },
            relationship: {
              type: "string",
              enum: ["confirmed", "likely", "possible", "unconfirmed", "not_related"],
            },
            reasoning: { type: "string" },
            evidence_refs: { type: "array", items: { type: "string" } },
            limitations: { type: "array", items: { type: "string" } },
          },
          required: ["candidate_host", "relationship", "reasoning", "evidence_refs", "limitations"],
        },
      },
    },
    required: ["results"],
  };
}

function normalizeModelResult(
  contract: RelatedDomainConfirmationContract,
  value: unknown,
): RelatedDomainConfirmationSuccess {
  const result = asObject(value);
  return {
    ok: true,
    schema_version: "site-10-layer-related-domain-confirmation-result/v0.1",
    provider: "worker_related_domain_confirmation",
    invokes_provider: true,
    target: contract.target,
    normalized_target: contract.normalized_target,
    results: Array.isArray(result.results) ? result.results.map(normalizeResultItem) : [],
  };
}

function normalizeResultItem(value: unknown): RelatedDomainConfirmationSuccess["results"][number] {
  const item = asObject(value);
  return {
    candidate_host: asString(item.candidate_host),
    relationship: normalizeRelationship(item.relationship),
    reasoning: truncate(asString(item.reasoning), 1000),
    evidence_refs: asStringArray(item.evidence_refs).slice(0, 20),
    limitations: asStringArray(item.limitations).map((value) => truncate(value, 500)).slice(0, 20),
  };
}

function normalizeRelationship(value: unknown): RelatedDomainRelationship {
  if (
    value === "confirmed" ||
    value === "likely" ||
    value === "possible" ||
    value === "unconfirmed" ||
    value === "not_related"
  ) {
    return value;
  }
  return "unconfirmed";
}

function isRelatedDomainConfirmationContract(value: unknown): value is RelatedDomainConfirmationContract {
  const contract = asObject(value);
  return (
    contract.schema_version === "site-10-layer-related-domain-confirmation-contract/v0.1" &&
    contract.invokes_provider === false &&
    typeof contract.target === "string" &&
    typeof contract.normalized_target === "string" &&
    Array.isArray(asObject(contract.input).evidence)
  );
}

function failure(
  error_code: RelatedDomainConfirmationWorkerFailure["error_code"],
  error: string,
  status: number,
  extra: Pick<RelatedDomainConfirmationWorkerFailure, "missing_config" | "validation_errors"> = {},
): RelatedDomainConfirmationWorkerFailure {
  return {
    ok: false,
    schema_version: "site-10-layer-related-domain-confirmation-worker-response/v0.1",
    provider: "worker_related_domain_confirmation",
    error_code,
    error,
    status,
    ...extra,
  };
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

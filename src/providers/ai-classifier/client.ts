import type { ProviderConfig } from "../../core/types";
import type { AiClassifierContract } from "./contract";
import type { WorkerAiClassifierResponse } from "./worker-adapter";

export async function callWorkerAiClassifierProvider(input: {
  provider: ProviderConfig;
  contract: AiClassifierContract;
}): Promise<WorkerAiClassifierResponse> {
  const response = await fetch(resolveProviderEndpoint(input.provider, "/provider/ai/classifier"), {
    method: "POST",
    headers: buildHeaders(input.provider),
    body: JSON.stringify({
      contract: input.contract,
    }),
  });

  const body = (await response.json()) as unknown;
  if (!isWorkerAiClassifierResponse(body)) {
    throw new Error(`AI classifier provider returned an invalid response: ${response.status}`);
  }

  return body;
}

function buildHeaders(provider: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (provider.authMode === "bearer" && provider.secretRef) {
    headers.authorization = `Bearer ${provider.secretRef}`;
  }

  if (provider.authMode === "api_key" && provider.secretRef) {
    headers["x-api-key"] = provider.secretRef;
  }

  return headers;
}

function resolveProviderEndpoint(provider: ProviderConfig, path: string): string {
  const endpoint = new URL(provider.endpoint);
  endpoint.pathname = path;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString();
}

function isWorkerAiClassifierResponse(value: unknown): value is WorkerAiClassifierResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return (
    response.schema_version === "site-10-layer-ai-classifier-worker-response/v0.1" &&
    response.provider === "worker_ai_classifier" &&
    typeof response.ok === "boolean"
  );
}

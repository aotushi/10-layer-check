import type { ProviderConfig } from "../../core/types";
import type { BasicPerformanceResult } from "./types";

export async function callBasicPerformanceProvider(input: {
  provider: ProviderConfig;
  target: string;
}): Promise<BasicPerformanceResult> {
  const response = await fetch(resolveProviderEndpoint(input.provider, "/probe/performance-basic"), {
    method: "POST",
    headers: buildHeaders(input.provider),
    body: JSON.stringify({
      target: input.target,
    }),
  });

  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string" ? body.error : `Basic performance provider failed: ${response.status}`;
    throw new Error(message);
  }

  return body as BasicPerformanceResult;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { ProviderConfig } from "../../core/types";
import type { RemoteFetchResult } from "./types";

export async function callRemoteFetchProvider(input: {
  provider: ProviderConfig;
  target: string;
  maxRedirects?: number;
}): Promise<RemoteFetchResult> {
  const response = await fetch(input.provider.endpoint, {
    method: "POST",
    headers: buildHeaders(input.provider),
    body: JSON.stringify({
      target: input.target,
      max_redirects: input.maxRedirects ?? 10,
    }),
  });

  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : `Remote fetch failed: ${response.status}`;
    throw new Error(message);
  }

  return body as RemoteFetchResult;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

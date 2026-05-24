import type { ProviderConfig } from "../../core/types";
import type {
  DnsInfrastructureResult,
  OrganizationIntelligenceResult,
  SubdomainAttackSurfaceResult,
  TlsCertificateResult,
} from "./types";

export async function callDnsInfrastructureProvider(input: {
  provider: ProviderConfig;
  target: string;
}): Promise<DnsInfrastructureResult> {
  const response = await fetch(input.provider.endpoint, {
    method: "POST",
    headers: buildHeaders(input.provider),
    body: JSON.stringify({
      target: input.target,
    }),
  });

  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : `DNS provider failed: ${response.status}`;
    throw new Error(message);
  }

  return body as DnsInfrastructureResult;
}

export async function callTlsCertificateProvider(input: {
  provider: ProviderConfig;
  target: string;
}): Promise<TlsCertificateResult> {
  const response = await fetch(resolveProviderEndpoint(input.provider, "/probe/tls-certificate"), {
    method: "POST",
    headers: buildHeaders(input.provider),
    body: JSON.stringify({
      target: input.target,
    }),
  });

  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : `TLS provider failed: ${response.status}`;
    throw new Error(message);
  }

  return body as TlsCertificateResult;
}

export async function callSubdomainAttackSurfaceProvider(input: {
  provider: ProviderConfig;
  target: string;
}): Promise<SubdomainAttackSurfaceResult> {
  const response = await fetch(resolveProviderEndpoint(input.provider, "/probe/subdomain-attack-surface"), {
    method: "POST",
    headers: buildHeaders(input.provider),
    body: JSON.stringify({
      target: input.target,
    }),
  });

  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string" ? body.error : `Subdomain provider failed: ${response.status}`;
    throw new Error(message);
  }

  return body as SubdomainAttackSurfaceResult;
}

export async function callOrganizationIntelligenceProvider(input: {
  provider: ProviderConfig;
  target: string;
}): Promise<OrganizationIntelligenceResult> {
  const response = await fetch(resolveProviderEndpoint(input.provider, "/probe/organization-intelligence"), {
    method: "POST",
    headers: buildHeaders(input.provider),
    body: JSON.stringify({
      target: input.target,
    }),
  });

  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string" ? body.error : `Organization provider failed: ${response.status}`;
    throw new Error(message);
  }

  return body as OrganizationIntelligenceResult;
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

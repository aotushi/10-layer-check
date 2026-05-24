import type { ProviderConfig, SnapshotRecord } from "../../core/types";

export type GitHubLiveTlsStartResult = {
  provider: "github_actions_live_tls";
  request_id: string;
  run_id: number | null;
  status: string;
  conclusion: string | null;
  html_url: string | null;
  next_step?: string;
};

export type GitHubLiveTlsStatusResult = {
  provider: "github_actions_live_tls";
  request_id: string | null;
  run_id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
};

export type GitHubLiveTlsResult = {
  provider: "github_actions_live_tls";
  request_id: string | null;
  run_id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  artifact?: {
    id: number;
    name: string;
    expired: boolean;
  };
  records?: SnapshotRecord[];
  error?: string;
  next_step?: string;
};

export type GitHubLighthouseStartResult = {
  provider: "github_actions_lighthouse";
  request_id: string;
  run_id: number | null;
  status: string;
  conclusion: string | null;
  html_url: string | null;
  strategy: "mobile" | "desktop";
  next_step?: string;
};

export type GitHubLighthouseStatusResult = {
  provider: "github_actions_lighthouse";
  request_id: string | null;
  run_id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
};

export type GitHubLighthouseResult = {
  provider: "github_actions_lighthouse";
  request_id: string | null;
  run_id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  artifact?: {
    id: number;
    name: string;
    expired: boolean;
  };
  records?: SnapshotRecord[];
  error?: string;
  next_step?: string;
};

export type GitHubBrowserRuntimeStartResult = {
  provider: "github_actions_browser_runtime";
  request_id: string;
  run_id: number | null;
  status: string;
  conclusion: string | null;
  html_url: string | null;
  runtime_provider: "github-actions-browser";
  next_step?: string;
};

export type GitHubBrowserRuntimeStatusResult = {
  provider: "github_actions_browser_runtime";
  request_id: string | null;
  run_id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
};

export type GitHubBrowserRuntimeResult = {
  provider: "github_actions_browser_runtime";
  request_id: string | null;
  run_id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  artifact?: {
    id: number;
    name: string;
    expired: boolean;
  };
  records?: SnapshotRecord[];
  error?: string;
  next_step?: string;
};

export async function startGitHubLiveTlsProvider(input: {
  provider: ProviderConfig;
  target: string;
}): Promise<GitHubLiveTlsStartResult> {
  const response = await fetch(resolveProviderEndpoint(input.provider, "/provider/github/live-tls/start"), {
    method: "POST",
    headers: buildHeaders(input.provider),
    body: JSON.stringify({
      target: input.target,
    }),
  });
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : `GitHub live TLS start failed: ${response.status}`;
    throw new Error(message);
  }

  return body as GitHubLiveTlsStartResult;
}

export async function getGitHubLiveTlsStatus(input: {
  provider: ProviderConfig;
  requestId: string;
}): Promise<GitHubLiveTlsStatusResult> {
  const endpoint = resolveProviderEndpoint(input.provider, "/provider/github/live-tls/status");
  endpoint.searchParams.set("id", input.requestId);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: buildHeaders(input.provider),
  });
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : `GitHub live TLS status failed: ${response.status}`;
    throw new Error(message);
  }

  return body as GitHubLiveTlsStatusResult;
}

export async function getGitHubLiveTlsResult(input: {
  provider: ProviderConfig;
  requestId: string;
}): Promise<GitHubLiveTlsResult> {
  const endpoint = resolveProviderEndpoint(input.provider, "/provider/github/live-tls/result");
  endpoint.searchParams.set("id", input.requestId);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: buildHeaders(input.provider),
  });
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : `GitHub live TLS result failed: ${response.status}`;
    throw new Error(message);
  }

  return body as GitHubLiveTlsResult;
}

export async function startGitHubLighthouseProvider(input: {
  provider: ProviderConfig;
  target: string;
  strategy?: "mobile" | "desktop";
}): Promise<GitHubLighthouseStartResult> {
  const response = await fetch(resolveProviderEndpoint(input.provider, "/provider/github/lighthouse/start"), {
    method: "POST",
    headers: buildHeaders(input.provider),
    body: JSON.stringify({
      target: input.target,
      strategy: input.strategy ?? "mobile",
    }),
  });
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string" ? body.error : `GitHub Lighthouse start failed: ${response.status}`;
    throw new Error(message);
  }

  return body as GitHubLighthouseStartResult;
}

export async function getGitHubLighthouseStatus(input: {
  provider: ProviderConfig;
  requestId: string;
}): Promise<GitHubLighthouseStatusResult> {
  const endpoint = resolveProviderEndpoint(input.provider, "/provider/github/lighthouse/status");
  endpoint.searchParams.set("id", input.requestId);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: buildHeaders(input.provider),
  });
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string" ? body.error : `GitHub Lighthouse status failed: ${response.status}`;
    throw new Error(message);
  }

  return body as GitHubLighthouseStatusResult;
}

export async function getGitHubLighthouseResult(input: {
  provider: ProviderConfig;
  requestId: string;
}): Promise<GitHubLighthouseResult> {
  const endpoint = resolveProviderEndpoint(input.provider, "/provider/github/lighthouse/result");
  endpoint.searchParams.set("id", input.requestId);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: buildHeaders(input.provider),
  });
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string" ? body.error : `GitHub Lighthouse result failed: ${response.status}`;
    throw new Error(message);
  }

  return body as GitHubLighthouseResult;
}

export async function startGitHubBrowserRuntimeProvider(input: {
  provider: ProviderConfig;
  target: string;
}): Promise<GitHubBrowserRuntimeStartResult> {
  const response = await fetch(resolveProviderEndpoint(input.provider, "/provider/github/browser-runtime/start"), {
    method: "POST",
    headers: buildHeaders(input.provider),
    body: JSON.stringify({
      target: input.target,
    }),
  });
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string" ? body.error : `GitHub browser runtime start failed: ${response.status}`;
    throw new Error(message);
  }

  return body as GitHubBrowserRuntimeStartResult;
}

export async function getGitHubBrowserRuntimeStatus(input: {
  provider: ProviderConfig;
  requestId: string;
}): Promise<GitHubBrowserRuntimeStatusResult> {
  const endpoint = resolveProviderEndpoint(input.provider, "/provider/github/browser-runtime/status");
  endpoint.searchParams.set("id", input.requestId);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: buildHeaders(input.provider),
  });
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string" ? body.error : `GitHub browser runtime status failed: ${response.status}`;
    throw new Error(message);
  }

  return body as GitHubBrowserRuntimeStatusResult;
}

export async function getGitHubBrowserRuntimeResult(input: {
  provider: ProviderConfig;
  requestId: string;
}): Promise<GitHubBrowserRuntimeResult> {
  const endpoint = resolveProviderEndpoint(input.provider, "/provider/github/browser-runtime/result");
  endpoint.searchParams.set("id", input.requestId);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: buildHeaders(input.provider),
  });
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string" ? body.error : `GitHub browser runtime result failed: ${response.status}`;
    throw new Error(message);
  }

  return body as GitHubBrowserRuntimeResult;
}

function resolveProviderEndpoint(provider: ProviderConfig, path: string): URL {
  const endpoint = new URL(provider.endpoint);
  endpoint.pathname = path;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
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

export type GitHubActionsEnv = {
  GITHUB_TOKEN?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  GITHUB_LIVE_TLS_WORKFLOW?: string;
  GITHUB_LIGHTHOUSE_WORKFLOW?: string;
  GITHUB_BROWSER_RUNTIME_WORKFLOW?: string;
  GITHUB_REF?: string;
};

type GitHubWorkflowKey = "GITHUB_LIVE_TLS_WORKFLOW" | "GITHUB_LIGHTHOUSE_WORKFLOW" | "GITHUB_BROWSER_RUNTIME_WORKFLOW";

type GitHubConfig = {
  owner: string;
  repo: string;
  workflow: string;
  ref: string;
  token: string;
};

type GitHubWorkflowRun = {
  id: number;
  name?: string;
  display_title?: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
};

type GitHubArtifact = {
  id: number;
  name: string;
  archive_download_url: string;
  expired: boolean;
};

const GITHUB_API_VERSION = "2022-11-28";

export async function githubLiveTlsStart(env: GitHubActionsEnv, target: string) {
  const config = getGitHubConfig(env, "GITHUB_LIVE_TLS_WORKFLOW");
  const requestId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await dispatchWorkflow(config, {
    target,
    request_id: requestId,
  });

  const run = await findGitHubRunByRequestId(config, requestId, startedAt);

  return {
    provider: "github_actions_live_tls",
    request_id: requestId,
    run_id: run?.id ?? null,
    status: run?.status ?? "queued",
    conclusion: run?.conclusion ?? null,
    html_url: run?.html_url ?? null,
    next_step:
      "Poll /provider/github/live-tls/status?id=<request_id>, then /provider/github/live-tls/result?id=<request_id> when completed.",
  };
}

export async function githubLiveTlsStatus(env: GitHubActionsEnv, url: URL) {
  const config = getGitHubConfig(env, "GITHUB_LIVE_TLS_WORKFLOW");
  const run = await resolveGitHubRun(config, url);

  return githubStatusEnvelope("github_actions_live_tls", url, run);
}

export async function githubLiveTlsResult(env: GitHubActionsEnv, url: URL) {
  const config = getGitHubConfig(env, "GITHUB_LIVE_TLS_WORKFLOW");
  const run = await resolveGitHubRun(config, url);

  return githubArtifactResultEnvelope("github_actions_live_tls", config, run, url);
}

export async function githubLighthouseStart(env: GitHubActionsEnv, target: string, strategy: "mobile" | "desktop") {
  const config = getGitHubConfig(env, "GITHUB_LIGHTHOUSE_WORKFLOW");
  const requestId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await dispatchWorkflow(config, {
    target,
    strategy,
    request_id: requestId,
  });

  const run = await findGitHubRunByRequestId(config, requestId, startedAt);

  return {
    provider: "github_actions_lighthouse",
    request_id: requestId,
    run_id: run?.id ?? null,
    status: run?.status ?? "queued",
    conclusion: run?.conclusion ?? null,
    html_url: run?.html_url ?? null,
    strategy,
    next_step:
      "Poll /provider/github/lighthouse/status?id=<request_id>, then /provider/github/lighthouse/result?id=<request_id> when completed.",
  };
}

export async function githubLighthouseStatus(env: GitHubActionsEnv, url: URL) {
  const config = getGitHubConfig(env, "GITHUB_LIGHTHOUSE_WORKFLOW");
  const run = await resolveGitHubRun(config, url);

  return githubStatusEnvelope("github_actions_lighthouse", url, run);
}

export async function githubLighthouseResult(env: GitHubActionsEnv, url: URL) {
  const config = getGitHubConfig(env, "GITHUB_LIGHTHOUSE_WORKFLOW");
  const run = await resolveGitHubRun(config, url);

  return githubArtifactResultEnvelope("github_actions_lighthouse", config, run, url);
}

export async function githubBrowserRuntimeStart(env: GitHubActionsEnv, target: string) {
  const config = getGitHubConfig(env, "GITHUB_BROWSER_RUNTIME_WORKFLOW");
  const requestId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await dispatchWorkflow(config, {
    target,
    target_file: "",
    provider: "github-actions-browser",
    request_id: requestId,
  });

  const run = await findGitHubRunByRequestId(config, requestId, startedAt);

  return {
    provider: "github_actions_browser_runtime",
    request_id: requestId,
    run_id: run?.id ?? null,
    status: run?.status ?? "queued",
    conclusion: run?.conclusion ?? null,
    html_url: run?.html_url ?? null,
    runtime_provider: "github-actions-browser",
    next_step:
      "Poll /provider/github/browser-runtime/status?id=<request_id>, then /provider/github/browser-runtime/result?id=<request_id> when completed.",
  };
}

export async function githubBrowserRuntimeStatus(env: GitHubActionsEnv, url: URL) {
  const config = getGitHubConfig(env, "GITHUB_BROWSER_RUNTIME_WORKFLOW");
  const run = await resolveGitHubRun(config, url);

  return githubStatusEnvelope("github_actions_browser_runtime", url, run);
}

export async function githubBrowserRuntimeResult(env: GitHubActionsEnv, url: URL) {
  const config = getGitHubConfig(env, "GITHUB_BROWSER_RUNTIME_WORKFLOW");
  const run = await resolveGitHubRun(config, url);

  return githubArtifactResultEnvelope("github_actions_browser_runtime", config, run, url, (artifacts, requestedId) =>
    artifacts.find((item) => requestedId && item.name.includes(requestedId)) ??
    artifacts.find((item) => item.name.includes("site-10-layer-check-browser")) ??
    artifacts[0],
  );
}

async function dispatchWorkflow(config: GitHubConfig, inputs: Record<string, string>) {
  const dispatchResponse = await githubFetch(
    config,
    `/repos/${config.owner}/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({
        ref: config.ref,
        inputs,
      }),
    },
  );

  if (!dispatchResponse.ok) {
    throw new Error(`GitHub workflow dispatch failed: ${dispatchResponse.status} ${await dispatchResponse.text()}`);
  }
}

function githubStatusEnvelope(provider: string, url: URL, run: GitHubWorkflowRun) {
  return {
    provider,
    request_id: url.searchParams.get("id") ?? null,
    run_id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    html_url: run.html_url,
    created_at: run.created_at,
    updated_at: run.updated_at,
  };
}

async function githubArtifactResultEnvelope(
  provider: string,
  config: GitHubConfig,
  run: GitHubWorkflowRun,
  url: URL,
  selectArtifact: (artifacts: GitHubArtifact[], requestedId: string | null) => GitHubArtifact | undefined = (artifacts, requestedId) =>
    artifacts.find((item) => requestedId && item.name.includes(requestedId)) ?? artifacts[0],
) {
  if (run.status !== "completed") {
    return {
      provider,
      run_id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      html_url: run.html_url,
      records: [],
      next_step: "Workflow is not completed yet. Poll status again later.",
    };
  }

  if (run.conclusion !== "success") {
    return {
      provider,
      run_id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      html_url: run.html_url,
      records: [],
      error: `Workflow completed with conclusion ${run.conclusion}.`,
    };
  }

  const artifacts = await listGitHubRunArtifacts(config, run.id);
  const requestedId = url.searchParams.get("id");
  const artifact = selectArtifact(artifacts, requestedId);

  if (!artifact) {
    throw new Error(`No artifacts found for GitHub run ${run.id}.`);
  }

  const artifactJson = await downloadArtifactSnapshotJson(config, artifact);
  const artifactPayload = Array.isArray(artifactJson)
    ? { records: artifactJson }
    : isPlainRecord(artifactJson)
      ? artifactJson
      : { artifact_json: artifactJson };

  return {
    provider,
    request_id: requestedId,
    run_id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    html_url: run.html_url,
    artifact: {
      id: artifact.id,
      name: artifact.name,
      expired: artifact.expired,
    },
    ...artifactPayload,
  };
}

function getGitHubConfig(env: GitHubActionsEnv, workflowKey: GitHubWorkflowKey): GitHubConfig {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const workflow = env[workflowKey];
  const ref = env.GITHUB_REF ?? "main";
  const token = env.GITHUB_TOKEN;

  if (!owner || !repo || !workflow || !token) {
    throw new Error(`GitHub provider is not configured. Required: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, ${workflowKey}.`);
  }

  return { owner, repo, workflow, ref, token };
}

async function resolveGitHubRun(config: GitHubConfig, url: URL): Promise<GitHubWorkflowRun> {
  const runId = url.searchParams.get("run_id");
  if (runId) return getGitHubRun(config, Number(runId));

  const requestId = url.searchParams.get("id");
  if (!requestId) throw new Error("Query requires id=<request_id> or run_id=<github_run_id>.");

  const run = await findGitHubRunByRequestId(config, requestId);
  if (!run) throw new Error(`No GitHub workflow run found for request id ${requestId}.`);
  return run;
}

async function getGitHubRun(config: GitHubConfig, runId: number): Promise<GitHubWorkflowRun> {
  if (!Number.isFinite(runId)) throw new Error("run_id must be a number.");
  const response = await githubFetch(config, `/repos/${config.owner}/${config.repo}/actions/runs/${runId}`);
  if (!response.ok) throw new Error(`GitHub run lookup failed: ${response.status} ${await response.text()}`);
  return normalizeGitHubRun(await response.json());
}

async function findGitHubRunByRequestId(
  config: GitHubConfig,
  requestId: string,
  createdAfter?: string,
): Promise<GitHubWorkflowRun | null> {
  const params = new URLSearchParams({
    event: "workflow_dispatch",
    branch: config.ref,
    per_page: "20",
  });
  const response = await githubFetch(
    config,
    `/repos/${config.owner}/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}/runs?${params.toString()}`,
  );

  if (!response.ok) throw new Error(`GitHub workflow run list failed: ${response.status} ${await response.text()}`);

  const body = (await response.json()) as { workflow_runs?: unknown };
  const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs.map(normalizeGitHubRun) : [];
  const minimumTime = createdAfter ? Date.parse(createdAfter) - 60_000 : 0;

  return (
    runs.find((run) => {
      const title = `${run.name ?? ""} ${run.display_title ?? ""}`;
      return title.includes(requestId) && Date.parse(run.created_at) >= minimumTime;
    }) ?? null
  );
}

async function listGitHubRunArtifacts(config: GitHubConfig, runId: number): Promise<GitHubArtifact[]> {
  const response = await githubFetch(config, `/repos/${config.owner}/${config.repo}/actions/runs/${runId}/artifacts`);
  if (!response.ok) throw new Error(`GitHub artifacts lookup failed: ${response.status} ${await response.text()}`);

  const body = (await response.json()) as { artifacts?: unknown };
  return Array.isArray(body.artifacts) ? body.artifacts.map(normalizeGitHubArtifact).filter(isGitHubArtifact) : [];
}

async function downloadArtifactSnapshotJson(config: GitHubConfig, artifact: GitHubArtifact): Promise<unknown> {
  const response = await githubFetch(
    config,
    `/repos/${config.owner}/${config.repo}/actions/artifacts/${artifact.id}/zip`,
    { redirect: "follow" },
  );

  if (!response.ok) throw new Error(`GitHub artifact download failed: ${response.status} ${await response.text()}`);

  const buffer = await response.arrayBuffer();
  const files = await unzipFiles(buffer);
  const snapshot =
    files.find((file) => /(^|\/)snapshots\/[^/]+\.json$/i.test(file.name)) ?? files.find((file) => /\.json$/i.test(file.name));

  if (!snapshot) throw new Error(`Artifact ${artifact.name} did not contain a JSON snapshot.`);

  return JSON.parse(snapshot.text);
}

async function githubFetch(config: GitHubConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/vnd.github+json");
  headers.set("authorization", `Bearer ${config.token}`);
  headers.set("user-agent", "site-10-layer-check-worker/0.1");
  headers.set("x-github-api-version", GITHUB_API_VERSION);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers,
  });
}

function normalizeGitHubRun(value: unknown): GitHubWorkflowRun {
  const record = isPlainRecord(value) ? value : {};
  return {
    id: Number(record.id),
    name: typeof record.name === "string" ? record.name : undefined,
    display_title: typeof record.display_title === "string" ? record.display_title : undefined,
    status: typeof record.status === "string" ? record.status : "unknown",
    conclusion: typeof record.conclusion === "string" ? record.conclusion : null,
    html_url: typeof record.html_url === "string" ? record.html_url : "",
    created_at: typeof record.created_at === "string" ? record.created_at : "",
    updated_at: typeof record.updated_at === "string" ? record.updated_at : "",
  };
}

function normalizeGitHubArtifact(value: unknown): GitHubArtifact | null {
  const record = isPlainRecord(value) ? value : null;
  if (!record || typeof record.name !== "string" || typeof record.archive_download_url !== "string") return null;

  return {
    id: Number(record.id),
    name: record.name,
    archive_download_url: record.archive_download_url,
    expired: record.expired === true,
  };
}

function isGitHubArtifact(value: GitHubArtifact | null): value is GitHubArtifact {
  return value !== null && Number.isFinite(value.id);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ZipFile = {
  name: string;
  text: string;
};

async function unzipFiles(buffer: ArrayBuffer): Promise<ZipFile[]> {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) throw new Error("Invalid ZIP archive: end of central directory not found.");

  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const files: ZipFile[] = [];
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileName = decoder.decode(new Uint8Array(buffer, offset + 46, fileNameLength));

    if (!fileName.endsWith("/")) {
      const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressed = buffer.slice(dataOffset, dataOffset + compressedSize);
      const bytes = await decompressZipEntry(compressed, compressionMethod);
      files.push({
        name: fileName,
        text: decoder.decode(bytes),
      });
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return files;
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimumOffset = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

async function decompressZipEntry(buffer: ArrayBuffer, compressionMethod: number): Promise<Uint8Array> {
  if (compressionMethod === 0) return new Uint8Array(buffer);
  if (compressionMethod !== 8) throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);

  const DecompressionStreamCtor = (globalThis as unknown as {
    DecompressionStream?: new (format: string) => DecompressionStream;
  }).DecompressionStream;

  if (!DecompressionStreamCtor) throw new Error("ZIP deflate decompression is not available in this Worker runtime.");

  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStreamCtor("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

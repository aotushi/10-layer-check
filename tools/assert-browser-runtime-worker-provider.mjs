#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const root = process.cwd();
const workerSource = readFileSync(resolve(root, "worker/remote-fetch.ts"), "utf8");
const githubRouteSource = readFileSync(resolve(root, "worker/routes/github.ts"), "utf8");
const githubActionsSource = readFileSync(resolve(root, "worker/services/github-actions.ts"), "utf8");
const wranglerToml = readFileSync(resolve(root, "wrangler.toml"), "utf8");
const browserWorkflow = readFileSync(resolve(root, "../02-browser-runtime-remote-github/.github/workflows/site-10-layer-check-browser.yml"), "utf8");

const requiredRouteTokens = [
  "GITHUB_BROWSER_RUNTIME_WORKFLOW",
  "/provider/github/browser-runtime/start",
  "/provider/github/browser-runtime/status",
  "/provider/github/browser-runtime/result",
  "githubBrowserRuntimeStart",
  "githubBrowserRuntimeStatus",
  "githubBrowserRuntimeResult",
  'from "../services/github-actions"',
];

for (const token of requiredRouteTokens) {
  if (!workerSource.includes(token) && !githubRouteSource.includes(token) && !githubActionsSource.includes(token)) {
    throw new Error(`Worker browser runtime route is missing required token: ${token}`);
  }
}

const requiredProviderTokens = [
  "GITHUB_BROWSER_RUNTIME_WORKFLOW",
  "githubBrowserRuntimeStart",
  "githubBrowserRuntimeStatus",
  "githubBrowserRuntimeResult",
  'provider: "github_actions_browser_runtime"',
  'provider: "github-actions-browser"',
  "downloadArtifactSnapshotJson(config, artifact)",
];

for (const token of requiredProviderTokens) {
  if (!githubActionsSource.includes(token)) {
    throw new Error(`Worker browser runtime provider service is missing required token: ${token}`);
  }
}

if (!wranglerToml.includes('GITHUB_BROWSER_RUNTIME_WORKFLOW = "site-10-layer-check-browser.yml"')) {
  throw new Error("wrangler.toml must configure GITHUB_BROWSER_RUNTIME_WORKFLOW.");
}

const requiredWorkflowTokens = [
  "run-name:",
  "request_id:",
  "${{ inputs.request_id }}",
  "site-10-layer-check-browser",
  '--provider "${{ inputs.provider }}"',
];

for (const token of requiredWorkflowTokens) {
  if (!browserWorkflow.includes(token)) {
    throw new Error(`Browser runtime GitHub workflow is missing required token: ${token}`);
  }
}

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

const originalFetch = globalThis.fetch;
let dispatchPayload = null;
let runListCalls = 0;

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");
  const env = {
    ALLOW_LOCAL_DEV_NO_AUTH: "true",
    GITHUB_TOKEN: "test-token",
    GITHUB_OWNER: "aotushi",
    GITHUB_REPO: "02-browser-runtime-remote-git",
    GITHUB_BROWSER_RUNTIME_WORKFLOW: "site-10-layer-check-browser.yml",
    GITHUB_REF: "main",
  };

  globalThis.fetch = async (request, init = {}) => {
    const requestUrl = String(request);

    if (requestUrl.endsWith("/actions/workflows/site-10-layer-check-browser.yml/dispatches")) {
      dispatchPayload = JSON.parse(String(init.body));
      return new Response(null, { status: 204 });
    }

    if (requestUrl.includes("/actions/workflows/site-10-layer-check-browser.yml/runs?")) {
      runListCalls += 1;
      const requestId = dispatchPayload?.inputs?.request_id ?? "missing-request-id";
      return jsonResponse({
        workflow_runs: [
          {
            id: 123456,
            name: "Browser runtime check",
            display_title: `Browser runtime ${dispatchPayload?.inputs?.target ?? ""} ${requestId}`,
            status: "in_progress",
            conclusion: null,
            html_url: "https://github.com/aotushi/02-browser-runtime-remote-git/actions/runs/123456",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });
    }

    throw new Error(`Unexpected mocked GitHub request: ${requestUrl}`);
  };

  const startResponse = await worker.default.fetch(
    new Request("http://worker.local/provider/github/browser-runtime/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://example.com" }),
    }),
    env,
  );
  const startBody = await startResponse.json();

  if (startResponse.status !== 200) {
    throw new Error(`Browser runtime start should return HTTP 200, got ${startResponse.status}.`);
  }
  if (startBody.provider !== "github_actions_browser_runtime") {
    throw new Error("Browser runtime start should identify github_actions_browser_runtime provider.");
  }
  if (startBody.run_id !== 123456 || startBody.status !== "in_progress") {
    throw new Error("Browser runtime start should resolve the GitHub run by request_id.");
  }
  if (dispatchPayload?.inputs?.target !== "https://example.com") {
    throw new Error("Browser runtime start should dispatch the requested target.");
  }
  if (dispatchPayload?.inputs?.provider !== "github-actions-browser") {
    throw new Error("Browser runtime start should dispatch provider=github-actions-browser.");
  }
  if (!dispatchPayload?.inputs?.request_id || dispatchPayload.inputs.request_id !== startBody.request_id) {
    throw new Error("Browser runtime start should dispatch and return the same request_id.");
  }

  const statusResponse = await worker.default.fetch(
    new Request(`http://worker.local/provider/github/browser-runtime/status?id=${startBody.request_id}`, {
      method: "GET",
    }),
    env,
  );
  const statusBody = await statusResponse.json();
  if (statusBody.provider !== "github_actions_browser_runtime" || statusBody.run_id !== 123456) {
    throw new Error("Browser runtime status should return the resolved GitHub run.");
  }

  const pendingResultResponse = await worker.default.fetch(
    new Request(`http://worker.local/provider/github/browser-runtime/result?id=${startBody.request_id}`, {
      method: "GET",
    }),
    env,
  );
  const pendingResultBody = await pendingResultResponse.json();
  if (!Array.isArray(pendingResultBody.records) || !pendingResultBody.next_step) {
    throw new Error("Browser runtime result should return an empty records array and next_step while the run is pending.");
  }
  if (runListCalls < 3) {
    throw new Error("Browser runtime start/status/result should all resolve runs through GitHub workflow runs.");
  }
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

console.log("Browser runtime Worker provider check passed.");

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

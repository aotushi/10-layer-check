#!/usr/bin/env node
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

const originalFetch = globalThis.fetch;
let browserRuntimeDispatchPayload = null;

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");

  globalThis.fetch = async (request, init = {}) => {
    const url = String(request);

    if (url === "https://example.com/") {
      return new Response("<!doctype html><title>Example</title><script src=\"/app.js\"></script>", {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "max-age=60",
          server: "test-server",
        },
      });
    }

    if (url === "https://example.com/robots.txt") {
      return new Response("User-agent: *\nSitemap: https://example.com/sitemap.xml\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    if (url === "https://example.com/sitemap.xml") {
      return new Response("<urlset></urlset>", {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }

    if (url.endsWith("/actions/workflows/site-10-layer-check-browser.yml/dispatches")) {
      browserRuntimeDispatchPayload = JSON.parse(String(init.body));
      return new Response(null, { status: 204 });
    }

    if (url.includes("/actions/workflows/site-10-layer-check-browser.yml/runs?")) {
      const requestId = browserRuntimeDispatchPayload?.inputs?.request_id ?? "missing-request-id";
      return jsonResponse({
        workflow_runs: [
          {
            id: 987654,
            name: "Browser runtime check",
            display_title: `Browser runtime https://example.com ${requestId}`,
            status: "queued",
            conclusion: null,
            html_url: "https://github.com/aotushi/02-browser-runtime-remote-git/actions/runs/987654",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch in backend scan contract check: ${url}`);
  };

  const response = await worker.default.fetch(
    new Request("http://worker.local/scan/site/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: "https://example.com",
        sync_probes: ["remote_fetch"],
        async_providers: ["browser_runtime"],
      }),
    }),
    {
      ALLOW_LOCAL_DEV_NO_AUTH: "true",
      GITHUB_TOKEN: "test-token",
      GITHUB_OWNER: "aotushi",
      GITHUB_REPO: "02-browser-runtime-remote-git",
      GITHUB_BROWSER_RUNTIME_WORKFLOW: "site-10-layer-check-browser.yml",
      GITHUB_REF: "main",
    },
  );
  const body = await response.json();

  if (response.status !== 200) {
    throw new Error(`Backend scan contract should return HTTP 200, got ${response.status}: ${JSON.stringify(body)}`);
  }

  if (body.schema_version !== "site-10-layer-scan-start/v0.1") {
    throw new Error("Backend scan contract must expose schema_version site-10-layer-scan-start/v0.1.");
  }

  if (body.normalized_target !== "example.com") {
    throw new Error("Backend scan contract must return normalized_target.");
  }

  if (body.sync_results?.remote_fetch?.status !== "fulfilled") {
    throw new Error("Backend scan contract must include fulfilled remote_fetch result.");
  }

  if (body.sync_results.remote_fetch.result.status_code !== 200) {
    throw new Error("remote_fetch result should preserve the fetched HTTP status code.");
  }

  const browserJob = body.async_jobs?.find((job) => job.capability === "browser_runtime");
  if (!browserJob) {
    throw new Error("Backend scan contract must include a browser_runtime async job descriptor.");
  }

  if (browserJob.provider !== "github_actions_browser_runtime" || browserJob.request_id !== browserRuntimeDispatchPayload?.inputs?.request_id) {
    throw new Error("browser_runtime async job must preserve provider and request_id.");
  }

  if (!browserJob.endpoints?.status?.includes("/provider/github/browser-runtime/status?id=")) {
    throw new Error("browser_runtime async job must expose a status polling endpoint.");
  }

  if (!browserJob.endpoints?.result?.includes("/provider/github/browser-runtime/result?id=")) {
    throw new Error("browser_runtime async job must expose a result polling endpoint.");
  }

  if (!body.coverage?.collected?.includes("remote_fetch")) {
    throw new Error("Backend scan contract must summarize collected sync probes.");
  }

  if (!body.coverage?.pending?.includes("browser_runtime")) {
    throw new Error("Backend scan contract must summarize pending async providers.");
  }

  console.log("backend scan contract check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

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

    throw new Error(`Unexpected fetch in backend scan job v2 endpoint check: ${url}`);
  };

  const response = await worker.default.fetch(
    new Request("http://worker.local/scan/jobs", {
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
    throw new Error(`Backend scan job v2 endpoint should return HTTP 200, got ${response.status}: ${JSON.stringify(body)}`);
  }

  if (body.schema_version !== "site-10-layer-scan-job/v0.1") {
    throw new Error("Backend scan job v2 endpoint must expose schema_version site-10-layer-scan-job/v0.1.");
  }

  if (body.boundaries?.storage_persisted !== false || body.boundaries?.frontend_state_mutated !== false) {
    throw new Error("Backend scan job v2 endpoint must preserve no-storage and no-frontend-mutation boundaries.");
  }

  if (typeof body.job?.id !== "string" || !body.job.id.startsWith("scan-example.com-")) {
    throw new Error(`Backend scan job v2 endpoint should use the scan run id prefix. Got: ${body.job?.id}`);
  }

  if (body.job?.status !== "async_pending") {
    throw new Error(`Backend scan job v2 endpoint should return async_pending while browser runtime is queued. Got: ${body.job?.status}`);
  }

  if (!body.job?.records?.some((record) => record.probe === "http_headers_probe")) {
    throw new Error("Backend scan job v2 endpoint should include normalized sync probe records.");
  }

  const browserJob = body.job?.provider_jobs?.find((job) => job.capability === "browser_runtime");
  if (!browserJob) {
    throw new Error("Backend scan job v2 endpoint must include browser_runtime ProviderJob.");
  }

  if (browserJob.status !== "queued" || browserJob.provider !== "github_actions_browser_runtime") {
    throw new Error("browser_runtime ProviderJob must preserve queued provider state.");
  }

  if (!browserJob.policy?.requires_secret?.includes("GITHUB_TOKEN")) {
    throw new Error("browser_runtime ProviderJob must expose provider policy secrets.");
  }

  if (body.raw_scan_start?.schema_version !== "site-10-layer-scan-start/v0.1") {
    throw new Error("Backend scan job v2 endpoint must preserve the raw scan-start envelope for V1 compatibility.");
  }

  console.log("backend scan job v2 endpoint check passed.");
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

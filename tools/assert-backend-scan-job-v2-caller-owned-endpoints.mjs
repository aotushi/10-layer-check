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

    throw new Error(`Unexpected fetch in caller-owned endpoint check: ${url}`);
  };

  const env = {
    ALLOW_LOCAL_DEV_NO_AUTH: "true",
    GITHUB_TOKEN: "test-token",
    GITHUB_OWNER: "aotushi",
    GITHUB_REPO: "02-browser-runtime-remote-git",
    GITHUB_BROWSER_RUNTIME_WORKFLOW: "site-10-layer-check-browser.yml",
    GITHUB_REF: "main",
    SCAN_JOB_HANDLE_SECRET: "fixture-scan-job-handle-secret",
    SCAN_JOB_HANDLE_KID: "fixture-kid",
    SCAN_JOB_HANDLE_TTL_SECONDS: "3600",
  };

  const startResponse = await worker.default.fetch(
    jsonRequest("http://worker.local/scan/jobs", {
      target: "https://example.com",
      sync_probes: ["remote_fetch"],
      async_providers: ["browser_runtime"],
    }),
    env,
  );
  const startBody = await startResponse.json();
  if (startBody.schema_version !== "site-10-layer-scan-job/v0.1") {
    throw new Error("Expected initial /scan/jobs response.");
  }
  if (startBody.job_handle?.schema_version !== "site-10-layer-signed-job-handle/v0.1") {
    throw new Error("Expected /scan/jobs to include a signed job_handle when signed-handle config is present.");
  }

  const collectResponse = await worker.default.fetch(
    jsonRequest("http://worker.local/scan/jobs/collect", {
      job_handle: startBody.job_handle,
      async_result_envelopes: {
        browser_runtime: createBrowserRuntimeProviderResult(startBody.job),
      },
    }),
    env,
  );
  const collectBody = await collectResponse.json();

  if (collectResponse.status !== 200) {
    throw new Error(`collect endpoint should return HTTP 200, got ${collectResponse.status}: ${JSON.stringify(collectBody)}`);
  }

  if (collectBody.schema_version !== "site-10-layer-scan-job/v0.1") {
    throw new Error("collect endpoint must return site-10-layer-scan-job/v0.1.");
  }

  if (collectBody.boundaries?.storage_persisted !== false || collectBody.boundaries?.caller_owned_state !== true) {
    throw new Error("collect endpoint must expose caller-owned no-storage boundaries.");
  }
  if (collectBody.boundaries?.signed_handle !== true || collectBody.job_handle?.schema_version !== "site-10-layer-signed-job-handle/v0.1") {
    throw new Error("collect endpoint must return the next signed job_handle when signed-handle config is present.");
  }

  if (collectBody.job?.status !== "completed") {
    throw new Error(`collect endpoint should complete the only async provider. Got: ${collectBody.job?.status}`);
  }

  if (!collectBody.job?.records?.some((record) => record.probe === "browser_page_probe")) {
    throw new Error("collect endpoint should merge completed async provider records into the job.");
  }

  const artifactResponse = await worker.default.fetch(
    jsonRequest("http://worker.local/scan/jobs/artifact", {
      job_handle: collectBody.job_handle,
    }),
    env,
  );
  const artifact = await artifactResponse.json();

  if (artifactResponse.status !== 200) {
    throw new Error(`artifact endpoint should return HTTP 200, got ${artifactResponse.status}: ${JSON.stringify(artifact)}`);
  }

  if (artifact.schema_version !== "site-10-layer-scan-export-artifact/v0.1") {
    throw new Error("artifact endpoint must return scan export artifact schema.");
  }

  if (artifact.boundaries?.storage_persisted !== false || artifact.boundaries?.frontend_state_mutated !== false) {
    throw new Error("artifact endpoint must preserve no-storage/no-frontend boundaries.");
  }

  if (!artifact.records?.some((record) => record.probe === "browser_page_probe")) {
    throw new Error("artifact endpoint should include records from the caller-owned job.");
  }

  if (!String(artifact.markdown?.narrative ?? "").includes("Site Narrative Report")) {
    throw new Error("artifact endpoint should include narrative markdown.");
  }

  const tamperedHandle = {
    ...collectBody.job_handle,
    token: `${collectBody.job_handle.token.slice(0, -1)}x`,
  };
  const tamperedResponse = await worker.default.fetch(
    jsonRequest("http://worker.local/scan/jobs/artifact", {
      job_handle: tamperedHandle,
    }),
    env,
  );
  const tamperedBody = await tamperedResponse.json();
  if (tamperedResponse.status !== 400 || !/signature/i.test(tamperedBody.error ?? "")) {
    throw new Error("artifact endpoint should reject tampered signed job handles.");
  }

  console.log("backend scan job v2 caller-owned endpoint check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

function jsonRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createBrowserRuntimeProviderResult(job) {
  return {
    provider: "github_actions_browser_runtime",
    request_id: "browser-request",
    run_id: 123,
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/example/actions/runs/123",
    records: [
      {
        target: job.target,
        normalized_target: job.normalized_target,
        snapshot_at: job.created_at,
        probe: "browser_page_probe",
        layer: 4,
        item: "browser_runtime",
        probe_type: "browser_runtime",
        source: "github-actions-browser",
        status: "ok",
        value: {
          final_url: job.target,
          status_code: 200,
          title: "Example",
          html_bytes: 2048,
          visible_text_bytes: 256,
          resource_counts: { document: 1, script: 1 },
          resources: [],
          console_messages: [],
          page_errors: [],
          runtime_security: {
            mixed_content_candidates: [],
            failed_request_count: 0,
            console_error_count: 0,
            page_error_count: 0,
          },
          screenshot_path: null,
          access_barrier: {
            detected: false,
            types: [],
            title: "Example",
            visible_text_sample: "Example",
          },
        },
        risk: { level: "info", summary: "Fixture browser runtime record." },
        evidence: [{ type: "fixture", name: "browser_runtime", value: "record" }],
        browser: {
          provider: "github-actions-browser",
          headed: false,
          wait_ms: 0,
          timeout_ms: 30000,
        },
      },
    ],
  };
}

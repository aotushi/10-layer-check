#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const {
    applyProviderResultEnvelopes,
    createScanJobArtifact,
    createScanJobFromStartEnvelope,
  } = await server.ssrLoadModule("/src/scan/job.ts");

  const baseInput = {
    id: "scan-job-v2-fixture",
    target: "https://example.com/",
    normalizedTarget: "example.com",
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:01.000Z",
    providers: [],
    scanStartEnvelope: createScanStartEnvelope(),
  };

  const initialJob = createScanJobFromStartEnvelope(baseInput);
  assert.equal(initialJob.id, "scan-job-v2-fixture");
  assert.equal(initialJob.status, "async_pending");
  assert.equal(initialJob.requested_sync_probes.includes("remote_fetch"), true);
  assert.equal(initialJob.requested_async_providers.includes("browser_runtime"), true);
  assert.equal(initialJob.provider_jobs.length, 2);
  assert.ok(initialJob.records.some((record) => record.probe === "http_headers_probe"));
  assert.equal(initialJob.artifact_ref, null);
  assert.equal(initialJob.error, null);

  const browserJob = initialJob.provider_jobs.find((job) => job.capability === "browser_runtime");
  assert.equal(browserJob?.status, "queued");
  assert.equal(browserJob?.policy.requires_secret.includes("GITHUB_TOKEN"), true);
  assert.equal(browserJob?.policy.requires_permission, false);

  const tlsJob = initialJob.provider_jobs.find((job) => job.capability === "live_tls");
  assert.equal(tlsJob?.policy.requires_secret.includes("GITHUB_TOKEN"), true);

  const partialJob = applyProviderResultEnvelopes(initialJob, {
    asyncResultEnvelopes: {
      browser_runtime: createBrowserRuntimeProviderResult(baseInput),
    },
    updatedAt: "2026-05-21T00:00:02.000Z",
  });
  assert.equal(partialJob.status, "partial");
  assert.equal(partialJob.updated_at, "2026-05-21T00:00:02.000Z");
  assert.equal(partialJob.completed_at, "2026-05-21T00:00:02.000Z");
  assert.ok(partialJob.records.some((record) => record.probe === "browser_page_probe"));
  assert.ok(partialJob.records.some((record) => record.source === "github_actions_live_tls" && record.probe === "provider_result_status"));

  const completedBrowserJob = partialJob.provider_jobs.find((job) => job.capability === "browser_runtime");
  assert.equal(completedBrowserJob?.status, "completed");
  assert.equal(completedBrowserJob?.normalized_record_count > 0, true);
  assert.equal(completedBrowserJob?.completed_at, "2026-05-21T00:00:02.000Z");

  const pendingTlsJob = partialJob.provider_jobs.find((job) => job.capability === "live_tls");
  assert.equal(pendingTlsJob?.status, "queued");
  assert.equal(pendingTlsJob?.normalized_record_count, 0);

  const completedJob = applyProviderResultEnvelopes(partialJob, {
    asyncResultEnvelopes: {
      browser_runtime: createBrowserRuntimeProviderResult(baseInput),
      live_tls: createLiveTlsProviderResult(baseInput),
    },
    updatedAt: "2026-05-21T00:00:03.000Z",
  });
  assert.equal(completedJob.status, "completed");
  assert.ok(completedJob.records.some((record) => record.probe === "tls_live_certificate_probe"));
  assert.equal(completedJob.provider_jobs.every((job) => job.status === "completed"), true);

  const artifact = createScanJobArtifact(completedJob, {
    generatedAt: "2026-05-21T00:00:04.000Z",
  });
  assert.equal(artifact.schema_version, "site-10-layer-scan-export-artifact/v0.1");
  assert.equal(artifact.generated_at, "2026-05-21T00:00:04.000Z");
  assert.equal(artifact.run.id, completedJob.id);
  assert.equal(artifact.boundaries.storage_persisted, false);
  assert.equal(artifact.boundaries.frontend_state_mutated, false);
  assert.ok(artifact.records.some((record) => record.probe === "tls_live_certificate_probe"));
  assert.ok(artifact.markdown.narrative.includes("Site Narrative Report"));

  console.log("backend scan job v2 model check passed.");
} finally {
  await server.close();
}

function createScanStartEnvelope() {
  return {
    schema_version: "site-10-layer-scan-start/v0.1",
    provider: "cloudflare_worker_site_scan",
    requested_url: "https://example.com/",
    normalized_url: "https://example.com/",
    normalized_target: "example.com",
    status: "ok",
    sync_probes: ["remote_fetch"],
    async_providers: ["browser_runtime", "live_tls"],
    sync_results: {
      remote_fetch: {
        status: "fulfilled",
        result: createRemoteFetchFixture(),
      },
    },
    async_jobs: [
      {
        capability: "browser_runtime",
        provider: "github_actions_browser_runtime",
        provider_schema_version: "site-10-layer-browser-runtime-result/v0.1",
        request_id: "browser-request",
        run_id: 123,
        status: "queued",
        conclusion: null,
        html_url: "https://github.com/example/actions/runs/123",
        endpoints: {
          status: "/provider/github/browser-runtime/status?id=browser-request",
          result: "/provider/github/browser-runtime/result?id=browser-request",
        },
      },
      {
        capability: "live_tls",
        provider: "github_actions_live_tls",
        provider_schema_version: "site-10-layer-live-tls-result/v0.1",
        request_id: "tls-request",
        run_id: 456,
        status: "queued",
        conclusion: null,
        html_url: "https://github.com/example/actions/runs/456",
        endpoints: {
          status: "/provider/github/live-tls/status?id=tls-request",
          result: "/provider/github/live-tls/result?id=tls-request",
        },
      },
    ],
    coverage: {
      collected: ["remote_fetch"],
      pending: ["browser_runtime", "live_tls"],
      failed: [],
    },
  };
}

function createBrowserRuntimeProviderResult(baseInput) {
  return {
    provider: "github_actions_browser_runtime",
    request_id: "browser-request",
    run_id: 123,
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/example/actions/runs/123",
    records: [createBrowserRuntimeRecord(baseInput)],
  };
}

function createLiveTlsProviderResult(baseInput) {
  return {
    provider: "github_actions_live_tls",
    request_id: "tls-request",
    run_id: 456,
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/example/actions/runs/456",
    records: [
      {
        target: baseInput.target,
        normalized_target: baseInput.normalizedTarget,
        snapshot_at: baseInput.createdAt,
        probe: "tls_live_certificate_probe",
        layer: 2,
        item: "live_certificate",
        probe_type: "external_provider",
        source: "github_actions_live_tls",
        status: "ok",
        value: {
          subject: "example.com",
          issuer: "Example CA",
          san: ["example.com"],
          valid_to: "2026-12-31T00:00:00.000Z",
          protocol: "TLSv1.3",
          cipher: "TLS_AES_128_GCM_SHA256",
        },
        risk: { level: "info", summary: "Fixture live TLS record." },
        evidence: [{ type: "fixture", name: "tls", value: "record" }],
        evidence_metadata: {
          origin: "external_provider",
          role: "raw",
          method: "tls_socket",
        },
      },
    ],
  };
}

function createBrowserRuntimeRecord(baseInput) {
  return {
    target: baseInput.target,
    normalized_target: baseInput.normalizedTarget,
    snapshot_at: baseInput.createdAt,
    probe: "browser_page_probe",
    layer: 4,
    item: "browser_runtime",
    probe_type: "browser_runtime",
    source: "github-actions-browser",
    status: "ok",
    value: {
      final_url: "https://example.com/",
      status_code: 200,
      title: "Example",
      html_bytes: 2048,
      visible_text_bytes: 256,
      resource_counts: { document: 1, fetch: 0, script: 1 },
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
  };
}

function createRemoteFetchFixture() {
  return {
    requested_url: "https://example.com/",
    final_url: "https://example.com/",
    status_code: 200,
    ok: true,
    redirected: false,
    redirect_chain: [],
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "max-age=60",
      server: "cloudflare",
      "cf-ray": "fixture-ray",
    },
    html: '<!doctype html><title>Example</title><script src="/app.js"></script><a href="/api/status">API</a>',
    crawl_metadata: {
      robots_txt: {
        url: "https://example.com/robots.txt",
        status_code: 200,
        found: true,
        body_excerpt: "User-agent: *",
        sitemap_urls: ["https://example.com/sitemap.xml"],
        disallow_count: 0,
      },
      sitemap_xml: {
        url: "https://example.com/sitemap.xml",
        status_code: 200,
        found: true,
        content_type: "application/xml",
        body_excerpt: "<urlset></urlset>",
      },
    },
    duration_ms: 42,
    provider_id: "cloudflare_worker_fetch",
    source: "cloudflare_worker_fetch",
  };
}

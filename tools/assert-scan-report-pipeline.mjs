#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { normalizeSiteScanProviderResults } = await server.ssrLoadModule("/src/providers/results/normalize.ts");
  const { createAnalysisReport } = await server.ssrLoadModule("/src/reporters/analysis.ts");
  const { createReportBrief } = await server.ssrLoadModule("/src/reporters/brief.ts");
  const { renderNarrativeMarkdown } = await server.ssrLoadModule("/src/reporters/markdown.ts");

  const baseInput = {
    target: "https://example.com/",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-21T00:00:00.000Z",
    providers: [],
  };

  const records = normalizeSiteScanProviderResults({
    ...baseInput,
    scanStartEnvelope: createScanStartEnvelope(),
    asyncResultEnvelopes: {
      browser_runtime: createBrowserRuntimeProviderResult(baseInput),
    },
  });

  assert.ok(records.some((record) => record.probe === "http_headers_probe"), "remote_fetch records should be normalized");
  assert.ok(records.some((record) => record.probe === "basic_performance_probe"), "performance_basic records should be normalized");
  assert.ok(records.some((record) => record.probe === "browser_page_probe"), "browser runtime records should be imported");
  assert.ok(records.some((record) => record.probe === "runtime_api_requests_probe"), "browser runtime derived API records should be created");

  const pendingTlsRecord = records.find(
    (record) => record.probe === "provider_result_status" && record.source === "github_actions_live_tls",
  );
  assert.equal(pendingTlsRecord?.status, "skipped");
  assert.equal(pendingTlsRecord?.layer, 2);
  assert.ok(!records.some((record) => record.source === "github_actions_live_tls" && record.probe !== "provider_result_status"));

  const run = {
    id: "scan-report-pipeline-fixture",
    target: baseInput.target,
    normalizedTarget: baseInput.normalizedTarget,
    createdAt: baseInput.snapshotAt,
    source: "provider",
    records,
  };

  const analysis = createAnalysisReport(run);
  assert.equal(analysis.schema_version, "site-10-layer-analysis/v0.1");
  assert.equal(analysis.run.record_count, records.length);
  assert.ok(analysis.coverage.collected_layers.includes(4), "completed browser runtime evidence should collect L4");
  assert.ok(!analysis.coverage.collected_layers.includes(2), "pending live TLS job must not collect L2");

  const brief = createReportBrief(run, analysis);
  assert.equal(brief.schema_version, "site-10-layer-report-brief/v0.1");
  assert.ok(brief.evidence_index.some((item) => item.probe === "browser_page_probe"));
  assert.ok(!brief.evidence_index.some((item) => item.source === "github_actions_live_tls"));
  assert.ok(
    brief.missing_data.some(
      (item) => item.layer === 2 && /github_actions_live_tls|live_tls|pending/i.test(item.description),
    ),
    "pending live TLS async provider should be visible as a missing-data boundary",
  );

  const markdown = renderNarrativeMarkdown(brief);
  assert.match(markdown, /^# Site Narrative Report: example\.com/m);
  assert.match(markdown, /## Missing Data/);
  assert.match(markdown, /github_actions_live_tls|live_tls|pending/i);
  assert.ok(!markdown.includes("undefined"));

  console.log("scan report pipeline check passed.");
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
    sync_probes: ["remote_fetch", "performance_basic"],
    async_providers: ["browser_runtime", "live_tls"],
    sync_results: {
      remote_fetch: {
        status: "fulfilled",
        result: createRemoteFetchFixture(),
      },
      performance_basic: {
        status: "fulfilled",
        result: createBasicPerformanceFixture(),
      },
    },
    async_jobs: [
      {
        capability: "browser_runtime",
        provider: "github_actions_browser_runtime",
        request_id: "browser-request",
        run_id: 123,
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/example/actions/runs/123",
        endpoints: {
          status: "/provider/github/browser-runtime/status?id=browser-request",
          result: "/provider/github/browser-runtime/result?id=browser-request",
        },
      },
      {
        capability: "live_tls",
        provider: "github_actions_live_tls",
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
      collected: ["remote_fetch", "performance_basic"],
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

function createBrowserRuntimeRecord(baseInput) {
  return {
    target: baseInput.target,
    normalized_target: baseInput.normalizedTarget,
    snapshot_at: baseInput.snapshotAt,
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
      resource_counts: {
        document: 1,
        fetch: 1,
        script: 1,
      },
      resources: [
        {
          request_id: "runtime-api",
          url: "https://example.com/api/status",
          method: "GET",
          resource_type: "fetch",
          status_code: 200,
          failure: null,
          domain: "example.com",
          same_origin: true,
          content_type: "application/json",
          cache_control: "no-cache",
          cdn_headers: {},
          transfer_size: 300,
          encoded_body_size: 180,
          decoded_body_size: 220,
          duration_ms: 18,
          start_time_ms: 50,
          timing_source: "performance_resource_timing",
        },
        {
          request_id: "runtime-script",
          url: "https://example.com/app.js",
          method: "GET",
          resource_type: "script",
          status_code: 200,
          failure: null,
          domain: "example.com",
          same_origin: true,
          content_type: "application/javascript",
          cache_control: "max-age=31536000",
          cdn_headers: { "cf-cache-status": "HIT" },
          transfer_size: 1024,
          encoded_body_size: 900,
          decoded_body_size: 1400,
          duration_ms: 22,
          start_time_ms: 35,
          timing_source: "performance_resource_timing",
        },
      ],
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

function createBasicPerformanceFixture() {
  return {
    requested_url: "https://example.com/",
    final_url: "https://example.com/",
    status_code: 200,
    ok: true,
    timings: {
      ttfb_ms: 120,
      total_ms: 260,
      body_read_ms: 80,
      redirect_count: 0,
    },
    document: {
      html_bytes: 1024,
      encoded_content_length: 1024,
      content_type: "text/html; charset=utf-8",
      content_encoding: null,
      cache_control: "max-age=60",
      cdn_cache_status: "HIT",
    },
    declared_resources: {
      scripts: 1,
      stylesheets: 0,
      images: 0,
      preloads: 0,
      total: 1,
    },
    sampled_resources: [],
    page_weight_estimate: {
      known_bytes: 1024,
      html_bytes: 1024,
      sampled_resource_bytes: 0,
      unknown_sampled_resources: 0,
      sampled_resource_count: 0,
      declared_resource_count: 1,
      note: "Fixture page-weight estimate.",
    },
    coverage: {
      collected: ["ttfb", "html_bytes"],
      missing: ["runtime_resource_waterfall"],
    },
    duration_ms: 260,
    provider_id: "cloudflare_worker_performance_basic",
    source: "cloudflare_worker_performance_basic",
  };
}

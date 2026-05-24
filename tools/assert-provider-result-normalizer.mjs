#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { normalizeProviderResult, normalizeSiteScanProviderResults } = await server.ssrLoadModule(
    "/src/providers/results/normalize.ts",
  );

  const baseInput = {
    target: "https://example.com/",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-21T00:00:00.000Z",
    providers: [],
  };

  const pagespeedRecords = normalizeProviderResult({
    ...baseInput,
    envelope: {
      ok: true,
      schema_version: "site-10-layer-performance-provider-result/v0.1",
      provider: "pagespeed",
      result: {
        requested_url: "https://example.com/",
        final_url: "https://example.com/",
        strategy: "mobile",
        provider: "pagespeed",
        metrics: [
          {
            id: "largest-contentful-paint",
            label: "Largest Contentful Paint",
            value: 1250,
            unit: "ms",
            rating: "good",
          },
        ],
        opportunities: [],
        raw_summary: { performance_score: 0.92 },
        duration_ms: 410,
        provider_id: "pagespeed",
        source: "pagespeed_api",
      },
    },
  });

  assert.equal(pagespeedRecords.length, 1);
  assert.equal(pagespeedRecords[0].layer, 5);
  assert.equal(pagespeedRecords[0].probe, "performance_probe");
  assert.equal(pagespeedRecords[0].source, "pagespeed_api");

  const webPageTestRecords = normalizeProviderResult({
    ...baseInput,
    envelope: {
      ok: true,
      schema_version: "site-10-layer-webpagetest-result/v0.1",
      provider: "webpagetest",
      request_id: "250521_AiDc7_TEST",
      status_code: 200,
      result: {
        provider: "webpagetest",
        request_id: "250521_AiDc7_TEST",
        url: "https://example.com/",
        summary: "https://www.webpagetest.org/result/250521_AiDc7_TEST/",
        location: "Dulles",
        metrics: [
          { id: "TTFB", label: "TTFB", value: 230, unit: "ms" },
          { id: "bytesIn", label: "Bytes In", value: 245000, unit: "bytes" },
        ],
        limitations: ["WebPageTest result timing depends on test location."],
      },
    },
  });

  assert.equal(webPageTestRecords.length, 1);
  assert.equal(webPageTestRecords[0].layer, 5);
  assert.equal(webPageTestRecords[0].probe, "performance_probe");
  assert.equal(webPageTestRecords[0].source, "webpagetest_api");
  assert.equal(webPageTestRecords[0].value.provider, "webpagetest");

  const missingConfigRecords = normalizeProviderResult({
    ...baseInput,
    envelope: {
      ok: false,
      schema_version: "site-10-layer-performance-provider-result/v0.1",
      provider: "pagespeed",
      error_code: "missing_performance_provider_config",
      error: "Missing required pagespeed configuration: PAGESPEED_API_KEY.",
      missing_config: ["PAGESPEED_API_KEY"],
      status: 503,
      coverage: { collected: [], missing: ["pagespeed_provider_config"] },
    },
  });

  assert.equal(missingConfigRecords.length, 1);
  assert.equal(missingConfigRecords[0].layer, 5);
  assert.equal(missingConfigRecords[0].probe, "provider_result_status");
  assert.equal(missingConfigRecords[0].status, "error");
  assert.equal(missingConfigRecords[0].value.error_code, "missing_performance_provider_config");
  assert.ok(!missingConfigRecords.some((record) => record.probe === "performance_probe"));

  const pendingRecords = normalizeProviderResult({
    ...baseInput,
    envelope: {
      ok: true,
      schema_version: "site-10-layer-webpagetest-status/v0.1",
      provider: "webpagetest",
      request_id: "250521_AiDc7_TEST",
      status_code: 101,
      status_text: "Test Started",
    },
  });

  assert.equal(pendingRecords.length, 1);
  assert.equal(pendingRecords[0].layer, 5);
  assert.equal(pendingRecords[0].probe, "provider_result_status");
  assert.equal(pendingRecords[0].status, "skipped");
  assert.ok(!pendingRecords.some((record) => record.probe === "performance_probe"));

  const importedRecord = {
    target: baseInput.target,
    normalized_target: baseInput.normalizedTarget,
    snapshot_at: baseInput.snapshotAt,
    probe: "github_lighthouse_fixture",
    layer: 5,
    item: "performance",
    probe_type: "performance",
    source: "github_actions_lighthouse",
    status: "ok",
    value: { score: 0.9 },
    risk: { level: "info", summary: "Fixture record." },
    evidence: [{ type: "fixture", value: "record" }],
  };
  const githubRecords = normalizeProviderResult({
    ...baseInput,
    envelope: {
      provider: "github_actions_lighthouse",
      request_id: "fixture-request",
      run_id: 123,
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/example/actions/runs/123",
      records: [importedRecord],
    },
  });

  assert.equal(githubRecords.length, 1);
  assert.equal(githubRecords[0].probe, importedRecord.probe);
  assert.equal(githubRecords[0].source, importedRecord.source);

  const scanRecords = normalizeProviderResult({
    ...baseInput,
    envelope: {
      schema_version: "site-10-layer-scan-start/v0.1",
      provider: "cloudflare_worker_site_scan",
      requested_url: "https://example.com/",
      normalized_url: "https://example.com/",
      normalized_target: "example.com",
      status: "partial",
      sync_probes: ["remote_fetch", "performance_basic", "failing_remote_fetch"],
      async_providers: [],
      sync_results: {
        remote_fetch: {
          status: "fulfilled",
          result: createRemoteFetchFixture(),
        },
        performance_basic: {
          status: "fulfilled",
          result: createBasicPerformanceFixture(),
        },
        failing_remote_fetch: {
          status: "rejected",
          error: "Synthetic fetch failure.",
        },
      },
      async_jobs: [],
      coverage: {
        collected: ["remote_fetch", "performance_basic"],
        pending: [],
        failed: ["failing_remote_fetch"],
      },
    },
  });

  assert.ok(scanRecords.some((record) => record.probe === "http_headers_probe"));
  assert.ok(scanRecords.some((record) => record.probe === "frontend_assets_probe"));
  assert.ok(scanRecords.some((record) => record.probe === "basic_performance_probe"));
  const rejectedScanRecord = scanRecords.find((record) => record.probe === "provider_result_status");
  assert.equal(rejectedScanRecord?.status, "error");
  assert.equal(rejectedScanRecord?.value.error_code, "site_scan_sync_probe_failed");
  assert.ok(!scanRecords.some((record) => record.source === "site_scan_sync_failing_remote_fetch" && record.probe !== "provider_result_status"));

  const scanRunRecords = normalizeSiteScanProviderResults({
    ...baseInput,
    scanStartEnvelope: {
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
    },
    asyncResultEnvelopes: {
      browser_runtime: {
        provider: "github_actions_browser_runtime",
        request_id: "browser-request",
        run_id: 123,
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/example/actions/runs/123",
        records: [createBrowserRuntimeRecord(baseInput)],
      },
    },
  });

  assert.ok(scanRunRecords.some((record) => record.probe === "http_headers_probe"));
  assert.ok(scanRunRecords.some((record) => record.probe === "browser_page_probe"));
  assert.ok(scanRunRecords.some((record) => record.probe === "runtime_api_requests_probe"));
  const pendingAsyncRecord = scanRunRecords.find(
    (record) => record.probe === "provider_result_status" && record.source === "github_actions_live_tls",
  );
  assert.equal(pendingAsyncRecord?.status, "skipped");
  assert.equal(pendingAsyncRecord?.value.request_id, "tls-request");
  assert.ok(!scanRunRecords.some((record) => record.source === "github_actions_live_tls" && record.probe !== "provider_result_status"));

  console.log("provider result normalizer check passed.");
} finally {
  await server.close();
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
    html: "<!doctype html><title>Example</title><script src=\"/app.js\"></script><a href=\"/api/status\">API</a>",
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

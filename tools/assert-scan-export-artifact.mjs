#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createScanExportArtifact } = await server.ssrLoadModule("/src/reporters/artifact.ts");

  const artifact = createScanExportArtifact({
    id: "scan-export-artifact-fixture",
    target: "https://example.com/",
    normalizedTarget: "example.com",
    createdAt: "2026-05-21T00:00:00.000Z",
    generatedAt: "2026-05-21T00:00:01.000Z",
    source: "provider",
    providers: [],
    scanStartEnvelope: createScanStartEnvelope(),
  });

  assert.equal(artifact.schema_version, "site-10-layer-scan-export-artifact/v0.1");
  assert.equal(artifact.generated_at, "2026-05-21T00:00:01.000Z");
  assert.equal(artifact.run.id, "scan-export-artifact-fixture");
  assert.equal(artifact.run.normalized_target, "example.com");
  assert.equal(artifact.run.record_count, artifact.records.length);
  assert.equal(artifact.boundaries.invokes_ai_provider, false);
  assert.equal(artifact.boundaries.storage_persisted, false);
  assert.equal(artifact.boundaries.frontend_state_mutated, false);

  assert.equal(artifact.raw_inputs.scan_start_envelope.schema_version, "site-10-layer-scan-start/v0.1");
  assert.deepEqual(artifact.raw_inputs.async_result_envelopes, {});

  assert.ok(artifact.records.some((record) => record.probe === "http_headers_probe"));
  assert.ok(artifact.records.some((record) => record.probe === "basic_performance_probe"));
  assert.ok(
    artifact.records.some((record) => record.layer === 5 && record.probe === "performance_probe" && record.source === "pagespeed_api"),
    "embedded PageSpeed result should become L5 performance evidence",
  );
  assert.ok(
    !artifact.records.some((record) => record.layer === 5 && record.probe === "performance_probe" && record.source === "webpagetest_api"),
    "queued WebPageTest job must not become positive L5 performance evidence",
  );

  const webPageTestStatus = artifact.records.find(
    (record) => record.probe === "provider_result_status" && record.source === "webpagetest",
  );
  assert.equal(webPageTestStatus?.layer, 5);
  assert.equal(webPageTestStatus?.status, "skipped");

  assert.equal(artifact.analysis.schema_version, "site-10-layer-analysis/v0.1");
  assert.equal(artifact.analysis.run.record_count, artifact.records.length);
  assert.ok(artifact.analysis.coverage.collected_layers.includes(5));
  assert.ok(!artifact.analysis.evidence_index.some((item) => item.source === "webpagetest"));

  assert.equal(artifact.brief.schema_version, "site-10-layer-report-brief/v0.1");
  assert.equal(artifact.brief.ai_boundary.invokes_ai_provider, false);
  assert.ok(artifact.brief.evidence_index.some((item) => item.source === "pagespeed_api"));
  assert.ok(
    artifact.brief.missing_data.some(
      (item) =>
        item.layer === 5 &&
        item.classification === "add_provider" &&
        /webpagetest.*queued|webpagetest.*no completed target evidence/i.test(item.description),
    ),
    "queued WebPageTest should remain a missing-data boundary",
  );

  assert.match(artifact.markdown.analysis, /^# Site 10-Layer Analysis: example\.com/m);
  assert.match(artifact.markdown.narrative, /^# Site Narrative Report: example\.com/m);
  assert.match(artifact.markdown.narrative, /## Missing Data/);
  assert.match(artifact.markdown.narrative, /webpagetest/i);
  assert.ok(!artifact.markdown.analysis.includes("undefined"));
  assert.ok(!artifact.markdown.narrative.includes("undefined"));

  const serialized = JSON.stringify(artifact);
  assert.ok(serialized.includes("site-10-layer-scan-export-artifact/v0.1"));
  assert.ok(serialized.includes("site-10-layer-scan-start/v0.1"));
  assert.doesNotThrow(() => JSON.parse(serialized));

  console.log("scan export artifact check passed.");
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
    async_providers: ["pagespeed", "webpagetest"],
    sync_results: {
      remote_fetch: { status: "fulfilled", result: createRemoteFetchFixture() },
      performance_basic: { status: "fulfilled", result: createBasicPerformanceFixture() },
    },
    async_jobs: [
      {
        capability: "pagespeed",
        provider: "pagespeed",
        provider_schema_version: "site-10-layer-performance-provider-result/v0.1",
        request_id: null,
        run_id: null,
        status: "completed",
        status_code: null,
        conclusion: "success",
        html_url: null,
        endpoints: { status: null, result: null },
        result_envelope: createPageSpeedEnvelope(),
      },
      {
        capability: "webpagetest",
        provider: "webpagetest",
        provider_schema_version: "site-10-layer-webpagetest-start/v0.1",
        request_id: "250521_AiDc7_TEST",
        run_id: null,
        status: "queued",
        status_code: 200,
        conclusion: null,
        html_url: "https://www.webpagetest.org/result/250521_AiDc7_TEST/",
        endpoints: {
          status: "/provider/performance/webpagetest/status?id=250521_AiDc7_TEST",
          result: "/provider/performance/webpagetest/result?id=250521_AiDc7_TEST",
        },
      },
    ],
    coverage: {
      collected: ["remote_fetch", "performance_basic", "pagespeed"],
      pending: ["webpagetest"],
      failed: [],
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
    html: '<!doctype html><title>Example</title><meta name="generator" content="Next.js"><script src="/app.js"></script><a href="/api/status">API</a>',
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
    timings: { ttfb_ms: 120, total_ms: 260, body_read_ms: 80, redirect_count: 0 },
    document: {
      html_bytes: 1024,
      encoded_content_length: 1024,
      content_type: "text/html; charset=utf-8",
      content_encoding: null,
      cache_control: "max-age=60",
      cdn_cache_status: "HIT",
    },
    declared_resources: { scripts: 1, stylesheets: 0, images: 0, preloads: 0, total: 1 },
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
    coverage: { collected: ["ttfb", "html_bytes"], missing: ["runtime_resource_waterfall"] },
    duration_ms: 260,
    provider_id: "cloudflare_worker_performance_basic",
    source: "cloudflare_worker_performance_basic",
  };
}

function createPageSpeedEnvelope() {
  return {
    ok: true,
    schema_version: "site-10-layer-performance-provider-result/v0.1",
    provider: "pagespeed",
    result: {
      requested_url: "https://example.com/",
      final_url: "https://example.com/",
      strategy: "mobile",
      provider: "pagespeed",
      metrics: [
        { id: "first-contentful-paint", label: "First Contentful Paint", value: 810, unit: "ms", rating: "good" },
        { id: "largest-contentful-paint", label: "Largest Contentful Paint", value: 1340, unit: "ms", rating: "good" },
      ],
      opportunities: [],
      raw_summary: { performance_score: 0.91, accessibility_score: 0.82, best_practices_score: 0.88, seo_score: 0.93 },
      duration_ms: 410,
      provider_id: "pagespeed",
      source: "pagespeed_api",
    },
    coverage: {
      collected: ["lighthouse_lab_metrics", "performance_opportunities"],
      missing: ["webpagetest_waterfall", "multi_location_performance"],
    },
  };
}

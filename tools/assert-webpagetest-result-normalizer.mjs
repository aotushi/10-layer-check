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
  });

  const webPageTestRecord = records.find(
    (record) => record.probe === "performance_probe" && record.source === "webpagetest_api",
  );
  assert.equal(webPageTestRecord?.layer, 5);
  assert.equal(webPageTestRecord?.item, "performance");
  assert.equal(webPageTestRecord?.value.provider, "webpagetest");
  assert.deepEqual(
    webPageTestRecord?.value.metrics.map((metric) => metric.id),
    ["TTFB", "firstContentfulPaint", "SpeedIndex", "bytesIn"],
  );
  assert.ok(
    webPageTestRecord?.evidence.some((item) => item.type === "performance_metrics" && item.name === "webpagetest"),
    "completed WebPageTest result should preserve metric evidence",
  );
  assert.ok(
    !records.some((record) => record.probe === "provider_result_status" && record.source === "webpagetest"),
    "completed WebPageTest result must not remain a provider-status placeholder",
  );

  const run = {
    id: "webpagetest-normalizer-fixture",
    target: baseInput.target,
    normalizedTarget: baseInput.normalizedTarget,
    createdAt: baseInput.snapshotAt,
    source: "provider",
    records,
  };

  const analysis = createAnalysisReport(run);
  assert.ok(analysis.coverage.collected_layers.includes(5), "completed WebPageTest evidence should collect L5");
  assert.ok(
    analysis.evidence_index.some((item) => item.layer === 5 && item.source === "webpagetest_api"),
    "analysis evidence index should include WebPageTest evidence",
  );

  const brief = createReportBrief(run, analysis);
  const briefEvidence = brief.evidence_index.find((item) => item.source === "webpagetest_api");
  assert.equal(briefEvidence?.layer, 5);
  assert.ok(
    briefEvidence?.evidence_items.some((item) => item.type === "performance_metrics"),
    "ReportBrief should carry compact WebPageTest metric evidence",
  );
  assert.ok(
    !brief.missing_data.some((item) => item.layer === 5 && /webpagetest.*queued|webpagetest.*no completed/i.test(item.description)),
    "completed WebPageTest result should not remain a queued missing-data boundary",
  );

  const markdown = renderNarrativeMarkdown(brief);
  assert.match(markdown, /^# Site Narrative Report: example\.com/m);
  assert.match(markdown, /webpagetest_api|performance_probe/i);
  assert.ok(!markdown.includes("undefined"));

  console.log("WebPageTest result normalizer check passed.");
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
    sync_probes: [],
    async_providers: ["webpagetest"],
    sync_results: {},
    async_jobs: [
      {
        capability: "webpagetest",
        provider: "webpagetest",
        provider_schema_version: "site-10-layer-webpagetest-result/v0.1",
        request_id: "250521_AiDc7_TEST",
        run_id: null,
        status: "completed",
        status_code: 200,
        conclusion: "success",
        html_url: "https://www.webpagetest.org/result/250521_AiDc7_TEST/",
        endpoints: {
          status: "/provider/performance/webpagetest/status?id=250521_AiDc7_TEST",
          result: "/provider/performance/webpagetest/result?id=250521_AiDc7_TEST",
        },
        result_envelope: createWebPageTestEnvelope(),
      },
    ],
    coverage: {
      collected: ["webpagetest"],
      pending: [],
      failed: [],
    },
  };
}

function createWebPageTestEnvelope() {
  return {
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
      location: "Dulles:Chrome.Cable",
      metrics: [
        { id: "TTFB", label: "TTFB", value: 230, unit: "ms" },
        { id: "firstContentfulPaint", label: "First Contentful Paint", value: 840, unit: "ms" },
        { id: "SpeedIndex", label: "Speed Index", value: 1120, unit: "ms" },
        { id: "bytesIn", label: "Bytes In", value: 245000, unit: "bytes" },
      ],
      limitations: [
        "WebPageTest result timing depends on selected test location, browser profile, connectivity, and run time.",
      ],
    },
  };
}

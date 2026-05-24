#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

const originalFetch = globalThis.fetch;
const requestedUrls = [];

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");
  const { normalizeSiteScanProviderResults } = await server.ssrLoadModule("/src/providers/results/normalize.ts");

  globalThis.fetch = async (request) => {
    const url = String(request);
    requestedUrls.push(url);

    if (url.startsWith("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?")) {
      if (url.includes("rate-limit.example.com")) {
        return jsonResponse(
          {
            error: {
              message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per minute'.",
              status: "RESOURCE_EXHAUSTED",
            },
          },
          {
            status: 429,
            headers: { "retry-after": "90" },
          },
        );
      }

      return jsonResponse({
        id: "https://example.com/",
        loadingExperience: {
          id: "https://example.com/",
          overall_category: "FAST",
          metrics: {
            LARGEST_CONTENTFUL_PAINT_MS: {
              percentile: 1200,
              category: "FAST",
              distributions: [
                { min: 0, max: 2500, proportion: 0.94 },
                { min: 2500, max: 4000, proportion: 0.04 },
                { min: 4000, proportion: 0.02 },
              ],
            },
          },
        },
        originLoadingExperience: {
          id: "https://example.com",
          overall_category: "AVERAGE",
          metrics: {
            CUMULATIVE_LAYOUT_SHIFT_SCORE: {
              percentile: 0,
              category: "FAST",
              distributions: [{ min: 0, max: 10, proportion: 1 }],
            },
          },
        },
        lighthouseResult: {
          finalDisplayedUrl: "https://example.com/",
          categories: {
            performance: { score: 0.91 },
            accessibility: { score: 0.82 },
            "best-practices": { score: 0.88 },
            seo: { score: 0.93 },
          },
          audits: {
            "first-contentful-paint": metricAudit("First Contentful Paint", 810, 0.92),
            "largest-contentful-paint": metricAudit("Largest Contentful Paint", 1340, 0.88),
            "total-blocking-time": metricAudit("Total Blocking Time", 20, 0.99),
            "cumulative-layout-shift": metricAudit("Cumulative Layout Shift", 0.01, 0.99),
            "speed-index": metricAudit("Speed Index", 1100, 0.94),
            interactive: metricAudit("Time to Interactive", 1600, 0.9),
          },
        },
      });
    }

    if (url.startsWith("https://www.webpagetest.org/runtest.php?")) {
      return jsonResponse({
        statusCode: 200,
        statusText: "Ok",
        data: {
          testId: "250521_AiDc7_TEST",
          jsonUrl: "https://www.webpagetest.org/jsonResult.php?test=250521_AiDc7_TEST",
          userUrl: "https://www.webpagetest.org/result/250521_AiDc7_TEST/",
        },
      });
    }

    throw new Error(`Unexpected fetch in scan performance provider check: ${url}`);
  };

  const missingConfig = await postScan(worker, {
    target: "https://example.com",
    sync_probes: [],
    async_providers: ["pagespeed", "webpagetest"],
  });
  assert.equal(missingConfig.status, 200);

  const missingPagespeed = findJob(missingConfig.body, "pagespeed");
  assert.equal(missingPagespeed.status, "error");
  assert.equal(missingPagespeed.provider, "pagespeed");
  assert.equal(missingPagespeed.error_code, "missing_performance_provider_config");
  assert.deepEqual(missingPagespeed.missing_config, ["PAGESPEED_API_KEY"]);

  const missingWebPageTest = findJob(missingConfig.body, "webpagetest");
  assert.equal(missingWebPageTest.status, "error");
  assert.equal(missingWebPageTest.provider, "webpagetest");
  assert.equal(missingWebPageTest.error_code, "missing_performance_provider_config");
  assert.deepEqual(missingWebPageTest.missing_config, ["WEBPAGETEST_API_KEY"]);
  assert.ok(missingConfig.body.coverage.failed.includes("pagespeed"));
  assert.ok(missingConfig.body.coverage.failed.includes("webpagetest"));
  assert.ok(!missingConfig.body.coverage.pending.includes("pagespeed"));
  assert.ok(!missingConfig.body.coverage.pending.includes("webpagetest"));

  const rateLimited = await postScan(
    worker,
    {
      target: "https://rate-limit.example.com",
      sync_probes: [],
      async_providers: ["pagespeed"],
      strategy: "mobile",
    },
    {
      PAGESPEED_API_KEY: "test-pagespeed-key",
    },
  );
  assert.equal(rateLimited.status, 200);
  const rateLimitedPagespeed = findJob(rateLimited.body, "pagespeed");
  assert.equal(rateLimitedPagespeed.status, "error");
  assert.equal(rateLimitedPagespeed.status_code, 429);
  assert.equal(rateLimitedPagespeed.error_code, "performance_provider_rate_limited");
  assert.equal(rateLimitedPagespeed.retryable, true);
  assert.equal(rateLimitedPagespeed.retry_after_seconds, 90);
  assert.ok(rateLimited.body.coverage.failed.includes("pagespeed"));
  assert.ok(!rateLimited.body.coverage.collected.includes("pagespeed"));

  const success = await postScan(
    worker,
    {
      target: "https://example.com",
      sync_probes: [],
      async_providers: ["pagespeed", "webpagetest"],
      strategy: "mobile",
      location: "Dulles",
    },
    {
      PAGESPEED_API_KEY: "test-pagespeed-key",
      WEBPAGETEST_API_KEY: "test-wpt-key",
    },
  );
  assert.equal(success.status, 200);
  assert.equal(success.body.schema_version, "site-10-layer-scan-start/v0.1");
  assert.deepEqual(success.body.async_providers, ["pagespeed", "webpagetest"]);

  const pagespeedJob = findJob(success.body, "pagespeed");
  assert.equal(pagespeedJob.status, "completed");
  assert.equal(pagespeedJob.provider, "pagespeed");
  assert.equal(pagespeedJob.provider_schema_version, "site-10-layer-performance-provider-result/v0.1");
  assert.equal(pagespeedJob.result_envelope.provider, "pagespeed");
  assert.equal(pagespeedJob.result_envelope.result.raw_summary.performance_score, 0.91);
  assert.equal(pagespeedJob.result_envelope.result.raw_summary.field_data.available, true);
  assert.equal(pagespeedJob.result_envelope.result.raw_summary.field_data.page.overall_category, "FAST");
  assert.equal(
    pagespeedJob.result_envelope.result.raw_summary.field_data.page.metrics[0].id,
    "LARGEST_CONTENTFUL_PAINT_MS",
  );
  assert.ok(pagespeedJob.result_envelope.coverage.collected.includes("crux_field_data"));
  assert.ok(!pagespeedJob.result_envelope.coverage.missing.includes("field_data_when_unavailable"));
  assert.equal(pagespeedJob.endpoints.status, null);
  assert.equal(pagespeedJob.endpoints.result, null);

  const webPageTestJob = findJob(success.body, "webpagetest");
  assert.equal(webPageTestJob.status, "queued");
  assert.equal(webPageTestJob.provider, "webpagetest");
  assert.equal(webPageTestJob.request_id, "250521_AiDc7_TEST");
  assert.match(webPageTestJob.endpoints.status, /\/provider\/performance\/webpagetest\/status\?id=250521_AiDc7_TEST$/);
  assert.match(webPageTestJob.endpoints.result, /\/provider\/performance\/webpagetest\/result\?id=250521_AiDc7_TEST$/);
  assert.ok(success.body.coverage.collected.includes("pagespeed"));
  assert.ok(success.body.coverage.pending.includes("webpagetest"));

  const normalizedRecords = normalizeSiteScanProviderResults({
    target: "https://example.com/",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-21T00:00:00.000Z",
    providers: [],
    scanStartEnvelope: success.body,
  });

  assert.ok(
    normalizedRecords.some((record) => record.layer === 5 && record.probe === "performance_probe" && record.source === "pagespeed_api"),
    "Embedded PageSpeed scan result must normalize into L5 performance evidence.",
  );
  const pagespeedRecord = normalizedRecords.find(
    (record) => record.layer === 5 && record.probe === "performance_probe" && record.source === "pagespeed_api",
  );
  assert.equal(pagespeedRecord?.value.raw_summary.field_data.available, true);

  const pendingWebPageTest = normalizedRecords.find(
    (record) => record.probe === "provider_result_status" && record.source === "webpagetest",
  );
  assert.equal(pendingWebPageTest?.status, "skipped");
  assert.equal(pendingWebPageTest?.value.provider, "webpagetest");
  assert.equal(pendingWebPageTest?.value.request_id, "250521_AiDc7_TEST");
  assert.ok(
    !normalizedRecords.some((record) => record.source === "webpagetest_api" && record.probe === "performance_probe"),
    "Queued WebPageTest jobs must not become performance evidence before a completed result envelope is supplied.",
  );

  assert.ok(requestedUrls.some((url) => url.includes("key=test-pagespeed-key")));
  assert.ok(requestedUrls.some((url) => url.includes("k=test-wpt-key")));

  console.log("scan performance providers check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

function metricAudit(title, numericValue, score) {
  return { title, numericValue, score };
}

function findJob(body, capability) {
  const job = body.async_jobs?.find((item) => item.capability === capability);
  assert.ok(job, `Expected async job for ${capability}.`);
  return job;
}

async function postScan(worker, body, env = {}) {
  const response = await worker.default.fetch(
    new Request("http://worker.local/scan/site/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true", ...env },
  );

  return { status: response.status, body: await response.json() };
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

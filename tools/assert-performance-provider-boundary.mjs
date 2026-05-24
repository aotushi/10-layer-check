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
const pagespeedCacheKv = createMemoryKv();

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");

  globalThis.fetch = async (request) => {
    const url = String(request);
    requestedUrls.push(url);

    if (url.startsWith("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?")) {
      if (url.includes("rate-limit.example.com")) {
        return jsonResponse(
          {
            error: {
              code: 429,
              message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per minute'.",
              status: "RESOURCE_EXHAUSTED",
            },
          },
          {
            status: 429,
            headers: { "retry-after": "120" },
          },
        );
      }

      return jsonResponse({
        id: "https://example.com/",
        lighthouseResult: {
          finalDisplayedUrl: "https://example.com/",
          categories: {
            performance: { score: 0.91 },
          },
          audits: {
            "first-contentful-paint": metricAudit("First Contentful Paint", 810, 0.92),
            "largest-contentful-paint": metricAudit("Largest Contentful Paint", 1340, 0.88),
            "total-blocking-time": metricAudit("Total Blocking Time", 20, 0.99),
            "cumulative-layout-shift": metricAudit("Cumulative Layout Shift", 0.01, 0.99),
            "speed-index": metricAudit("Speed Index", 1100, 0.94),
            interactive: metricAudit("Time to Interactive", 1600, 0.9),
            "unused-javascript": {
              title: "Reduce unused JavaScript",
              score: 0.4,
              details: {
                type: "opportunity",
                overallSavingsMs: 120,
                overallSavingsBytes: 20000,
              },
            },
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

    if (url.startsWith("https://www.webpagetest.org/testStatus.php?")) {
      return jsonResponse({
        statusCode: 101,
        statusText: "Test Started",
      });
    }

    if (url.startsWith("https://www.webpagetest.org/jsonResult.php?")) {
      return jsonResponse({
        statusCode: 200,
        data: {
          url: "https://example.com/",
          summary: "https://www.webpagetest.org/result/250521_AiDc7_TEST/",
          location: "Dulles",
          median: {
            firstView: {
              loadTime: 1234,
              TTFB: 230,
              render: 650,
              SpeedIndex: 1100,
              bytesIn: 245000,
              requests: 18,
            },
          },
        },
      });
    }

    throw new Error(`Unexpected fetch in performance provider boundary check: ${url}`);
  };

  const missingPagespeed = await postJson(worker, "/provider/performance/pagespeed/run", {
    target: "https://example.com",
  });
  assert.equal(missingPagespeed.status, 503);
  assert.equal(missingPagespeed.body.ok, false);
  assert.equal(missingPagespeed.body.error_code, "missing_performance_provider_config");
  assert.deepEqual(missingPagespeed.body.missing_config, ["PAGESPEED_API_KEY"]);

  const pagespeed = await postJson(
    worker,
    "/provider/performance/pagespeed/run",
    { target: "https://example.com", strategy: "mobile" },
    { PAGESPEED_API_KEY: "test-pagespeed-key" },
  );
  assert.equal(pagespeed.status, 200);
  assert.equal(pagespeed.body.schema_version, "site-10-layer-performance-provider-result/v0.1");
  assert.equal(pagespeed.body.result.provider, "pagespeed");
  assert.equal(pagespeed.body.result.raw_summary.performance_score, 0.91);
  assert.ok(pagespeed.body.result.metrics.some((metric) => metric.id === "largest-contentful-paint"));
  assert.ok(pagespeed.body.result.opportunities.some((item) => item.id === "unused-javascript"));

  const rateLimitedPagespeed = await postJson(
    worker,
    "/provider/performance/pagespeed/run",
    { target: "https://rate-limit.example.com", strategy: "mobile" },
    { PAGESPEED_API_KEY: "test-pagespeed-key" },
  );
  assert.equal(rateLimitedPagespeed.status, 429);
  assert.equal(rateLimitedPagespeed.body.ok, false);
  assert.equal(rateLimitedPagespeed.body.error_code, "performance_provider_rate_limited");
  assert.equal(rateLimitedPagespeed.body.retryable, true);
  assert.equal(rateLimitedPagespeed.body.retry_after_seconds, 120);
  assert.ok(rateLimitedPagespeed.body.coverage.missing.includes("pagespeed_rate_limit"));

  const beforeCachedPageSpeedRequests = requestedUrls.filter((url) =>
    url.startsWith("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?") && url.includes("cached.example.com"),
  ).length;
  const cachedFirst = await postJson(
    worker,
    "/provider/performance/pagespeed/run",
    { target: "https://cached.example.com", strategy: "mobile" },
    {
      PAGESPEED_API_KEY: "test-pagespeed-key",
      SCAN_JOB_KV: pagespeedCacheKv,
      PAGESPEED_CACHE_TTL_SECONDS: "300",
    },
  );
  assert.equal(cachedFirst.status, 200);
  assert.equal(cachedFirst.body.cache.status, "stored");

  const cachedSecond = await postJson(
    worker,
    "/provider/performance/pagespeed/run",
    { target: "https://cached.example.com", strategy: "mobile" },
    {
      PAGESPEED_API_KEY: "test-pagespeed-key",
      SCAN_JOB_KV: pagespeedCacheKv,
      PAGESPEED_CACHE_TTL_SECONDS: "300",
    },
  );
  assert.equal(cachedSecond.status, 200);
  assert.equal(cachedSecond.body.cache.status, "hit");
  const afterCachedPageSpeedRequests = requestedUrls.filter((url) =>
    url.startsWith("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?") && url.includes("cached.example.com"),
  ).length;
  assert.equal(afterCachedPageSpeedRequests - beforeCachedPageSpeedRequests, 1);

  const missingWebPageTest = await postJson(worker, "/provider/performance/webpagetest/start", {
    target: "https://example.com",
  });
  assert.equal(missingWebPageTest.status, 503);
  assert.equal(missingWebPageTest.body.schema_version, "site-10-layer-webpagetest-start/v0.1");
  assert.equal(missingWebPageTest.body.error_code, "missing_performance_provider_config");
  assert.deepEqual(missingWebPageTest.body.missing_config, ["WEBPAGETEST_API_KEY"]);

  const missingWebPageTestStatus = await getJson(worker, "/provider/performance/webpagetest/status?id=250521_AiDc7_TEST");
  assert.equal(missingWebPageTestStatus.status, 503);
  assert.equal(missingWebPageTestStatus.body.schema_version, "site-10-layer-webpagetest-status/v0.1");
  assert.equal(missingWebPageTestStatus.body.error_code, "missing_performance_provider_config");

  const missingWebPageTestResult = await getJson(worker, "/provider/performance/webpagetest/result?id=250521_AiDc7_TEST");
  assert.equal(missingWebPageTestResult.status, 503);
  assert.equal(missingWebPageTestResult.body.schema_version, "site-10-layer-webpagetest-result/v0.1");
  assert.equal(missingWebPageTestResult.body.error_code, "missing_performance_provider_config");

  const webPageTest = await postJson(
    worker,
    "/provider/performance/webpagetest/start",
    { target: "https://example.com", location: "Dulles" },
    { WEBPAGETEST_API_KEY: "test-wpt-key" },
  );
  assert.equal(webPageTest.status, 200);
  assert.equal(webPageTest.body.schema_version, "site-10-layer-webpagetest-start/v0.1");
  assert.equal(webPageTest.body.request_id, "250521_AiDc7_TEST");
  assert.match(webPageTest.body.endpoints.status, /\/provider\/performance\/webpagetest\/status\?id=250521_AiDc7_TEST$/);
  assert.match(webPageTest.body.endpoints.result, /\/provider\/performance\/webpagetest\/result\?id=250521_AiDc7_TEST$/);

  const webPageTestStatus = await getJson(
    worker,
    "/provider/performance/webpagetest/status?id=250521_AiDc7_TEST",
    { WEBPAGETEST_API_KEY: "test-wpt-key" },
  );
  assert.equal(webPageTestStatus.status, 200);
  assert.equal(webPageTestStatus.body.schema_version, "site-10-layer-webpagetest-status/v0.1");
  assert.equal(webPageTestStatus.body.status_code, 101);

  const webPageTestResult = await getJson(
    worker,
    "/provider/performance/webpagetest/result?id=250521_AiDc7_TEST",
    { WEBPAGETEST_API_KEY: "test-wpt-key" },
  );
  assert.equal(webPageTestResult.status, 200);
  assert.equal(webPageTestResult.body.schema_version, "site-10-layer-webpagetest-result/v0.1");
  assert.equal(webPageTestResult.body.result.request_id, "250521_AiDc7_TEST");
  assert.ok(webPageTestResult.body.result.metrics.some((metric) => metric.id === "TTFB"));

  assert.ok(requestedUrls.some((url) => url.includes("key=test-pagespeed-key")));
  assert.ok(requestedUrls.some((url) => url.includes("k=test-wpt-key")));

  console.log("performance provider boundary check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

function metricAudit(title, numericValue, score) {
  return { title, numericValue, score };
}

async function postJson(worker, pathname, body, env = {}) {
  const response = await worker.default.fetch(
    new Request(`http://worker.local${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true", ...env },
  );

  return { status: response.status, body: await response.json() };
}

async function getJson(worker, pathname, env = {}) {
  const response = await worker.default.fetch(
    new Request(`http://worker.local${pathname}`, {
      method: "GET",
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

function createMemoryKv() {
  const values = new Map();
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    },
  };
}

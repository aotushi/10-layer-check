#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

const originalFetch = globalThis.fetch;

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");

  globalThis.fetch = async (request) => {
    const url = String(request);

    if (url === "https://example.com/") {
      return new Response(
        '<!doctype html><title>Example</title><meta name="generator" content="Next.js"><script src="/app.js"></script><a href="/api/status">API</a>',
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "max-age=60",
            server: "cloudflare",
            "cf-ray": "fixture-ray",
          },
        },
      );
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

    if (url.startsWith("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?")) {
      return jsonResponse({
        id: "https://example.com/",
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

    throw new Error(`Unexpected fetch in worker scan export check: ${url}`);
  };

  const requestBody = {
    target: "https://example.com",
    sync_probes: ["remote_fetch", "performance_basic"],
    async_providers: ["pagespeed", "webpagetest"],
    strategy: "mobile",
  };
  const env = {
    ALLOW_LOCAL_DEV_NO_AUTH: "true",
    PAGESPEED_API_KEY: "test-pagespeed-key",
    WEBPAGETEST_API_KEY: "test-wpt-key",
  };

  const start = await postWorker(worker, "/scan/site/start", requestBody, env);
  assert.equal(start.status, 200);
  assert.equal(start.body.schema_version, "site-10-layer-scan-start/v0.1");
  assert.ok(start.body.sync_results?.remote_fetch);
  assert.ok(start.body.async_jobs?.some((job) => job.capability === "pagespeed" && job.status === "completed"));
  assert.ok(start.body.async_jobs?.some((job) => job.capability === "webpagetest" && job.status === "queued"));
  assert.equal(start.body.records, undefined, "/scan/site/start must remain raw-only and not return normalized records");
  assert.equal(start.body.analysis, undefined, "/scan/site/start must not return AnalysisReport");
  assert.equal(start.body.brief, undefined, "/scan/site/start must not return ReportBrief");

  const artifact = await postWorker(worker, "/scan/site/export", requestBody, env);
  assert.equal(artifact.status, 200);
  assert.equal(artifact.body.schema_version, "site-10-layer-scan-export-artifact/v0.1");
  assert.equal(artifact.body.raw_inputs.scan_start_envelope.schema_version, "site-10-layer-scan-start/v0.1");
  assert.equal(artifact.body.run.normalized_target, "example.com");
  assert.equal(artifact.body.run.record_count, artifact.body.records.length);
  assert.equal(artifact.body.boundaries.invokes_ai_provider, false);
  assert.equal(artifact.body.boundaries.storage_persisted, false);
  assert.equal(artifact.body.boundaries.frontend_state_mutated, false);

  assert.ok(artifact.body.records.some((record) => record.probe === "http_headers_probe"));
  assert.ok(artifact.body.records.some((record) => record.probe === "basic_performance_probe"));
  assert.ok(
    artifact.body.records.some((record) => record.layer === 5 && record.probe === "performance_probe" && record.source === "pagespeed_api"),
    "Embedded PageSpeed result should normalize inside the Worker export artifact.",
  );
  assert.ok(
    !artifact.body.records.some((record) => record.layer === 5 && record.probe === "performance_probe" && record.source === "webpagetest_api"),
    "Queued WebPageTest must not become L5 evidence in Worker export artifact.",
  );

  const webPageTestStatus = artifact.body.records.find(
    (record) => record.probe === "provider_result_status" && record.source === "webpagetest",
  );
  assert.equal(webPageTestStatus?.status, "skipped");
  assert.equal(webPageTestStatus?.value.request_id, "250521_AiDc7_TEST");

  assert.equal(artifact.body.analysis.schema_version, "site-10-layer-analysis/v0.1");
  assert.equal(artifact.body.brief.schema_version, "site-10-layer-report-brief/v0.1");
  assert.match(artifact.body.markdown.analysis, /^# Site 10-Layer Analysis: example\.com/m);
  assert.match(artifact.body.markdown.narrative, /^# Site Narrative Report: example\.com/m);
  assert.ok(
    artifact.body.brief.missing_data.some((item) => item.layer === 5 && /webpagetest/i.test(item.description)),
    "Worker export artifact should expose queued WebPageTest as missing data.",
  );
  assert.ok(!artifact.body.markdown.analysis.includes("undefined"));
  assert.ok(!artifact.body.markdown.narrative.includes("undefined"));

  console.log("worker scan export check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

function metricAudit(title, numericValue, score) {
  return { title, numericValue, score };
}

async function postWorker(worker, path, body, env = {}) {
  const response = await worker.default.fetch(
    new Request(`http://worker.local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );

  return { status: response.status, body: await response.json() };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

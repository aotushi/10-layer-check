#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

class FakeKvNamespace {
  #values = new Map();

  async get(key) {
    return this.#values.get(key) ?? null;
  }

  async put(key, value) {
    this.#values.set(key, value);
  }

  async delete(key) {
    this.#values.delete(key);
  }
}

const originalFetch = globalThis.fetch;

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");
  const env = {
    ALLOW_LOCAL_DEV_NO_AUTH: "true",
    SCAN_JOB_KV: new FakeKvNamespace(),
    SCAN_JOB_TTL_SECONDS: "3600",
    WEBPAGETEST_API_KEY: "fixture-wpt-key",
    WEBPAGETEST_BASE_URL: "https://wpt.test",
  };

  globalThis.fetch = async (request) => {
    const url = String(request);

    if (url === "https://example.com/") {
      return new Response("<!doctype html><title>Example</title>", {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "max-age=60",
          server: "test-server",
        },
      });
    }

    if (url === "https://example.com/robots.txt") {
      return new Response("User-agent: *\n", {
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

    if (url.startsWith("https://wpt.test/runtest.php?")) {
      return jsonResponse({
        statusCode: 101,
        statusText: "Test Started",
        data: {
          testId: "wpt-fixture-1",
          userUrl: "https://wpt.test/result/wpt-fixture-1/",
          jsonUrl: "https://wpt.test/jsonResult.php?test=wpt-fixture-1",
        },
      });
    }

    if (url.startsWith("https://wpt.test/testStatus.php?")) {
      return jsonResponse({
        statusCode: 200,
        statusText: "Complete",
      });
    }

    if (url.startsWith("https://wpt.test/jsonResult.php?")) {
      return jsonResponse({
        statusCode: 200,
        data: {
          url: "https://example.com/",
          summary: "https://wpt.test/result/wpt-fixture-1/",
          location: "Dulles:Chrome",
          median: {
            firstView: {
              loadTime: 1234,
              TTFB: 120,
              render: 456,
              SpeedIndex: 789,
              bytesIn: 45678,
              requests: 12,
            },
          },
        },
      });
    }

    throw new Error(`Unexpected fetch in persisted job polling check: ${url}`);
  };

  const start = await request(worker, "POST", "http://worker.local/scan/jobs", {
    target: "https://example.com",
    sync_probes: ["remote_fetch"],
    async_providers: ["webpagetest"],
  }, env);
  assert.equal(start.status, 200);
  assert.equal(start.body.boundaries.storage_persisted, true);
  assert.equal(start.body.job.status, "async_pending");
  assert.equal(start.body.job.provider_jobs[0].capability, "webpagetest");

  const poll = await request(worker, "POST", `http://worker.local/scan/jobs/${start.body.job.id}/poll`, {}, env);
  assert.equal(poll.status, 200);
  assert.equal(poll.body.schema_version, "site-10-layer-scan-job/v0.1");
  assert.equal(poll.body.boundaries.storage_persisted, true);
  assert.equal(poll.body.job.status, "completed");
  assert.equal(poll.body.job.provider_jobs[0].status, "completed");
  assert.equal(poll.body.poll.checked_provider_jobs[0].result_collected, true);
  assert.ok(poll.body.job.records.some((record) => record.layer === 5 && record.probe === "performance_probe"));

  const read = await request(worker, "GET", `http://worker.local/scan/jobs/${start.body.job.id}`, null, env);
  assert.equal(read.status, 200);
  assert.equal(read.body.meta.status, "completed");
  assert.equal(read.body.meta.provider_jobs[0].normalized_record_count > 0, true);

  const noStorage = await request(worker, "POST", "http://worker.local/scan/jobs/missing_store/poll", {}, {
    ALLOW_LOCAL_DEV_NO_AUTH: "true",
  });
  assert.equal(noStorage.status, 503);
  assert.equal(noStorage.body.error_code, "storage_not_configured");

  console.log("backend persisted job store polling check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

async function request(worker, method, url, body, env) {
  const response = await worker.default.fetch(
    new Request(url, {
      method,
      headers: body === null ? {} : { "content-type": "application/json" },
      body: body === null ? null : JSON.stringify(body),
    }),
    env,
  );
  return {
    status: response.status,
    body: await response.json(),
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

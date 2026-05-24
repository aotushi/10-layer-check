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
  const kv = new FakeKvNamespace();
  const env = {
    ALLOW_LOCAL_DEV_NO_AUTH: "true",
    SCAN_JOB_KV: kv,
    SCAN_JOB_TTL_SECONDS: "3600",
  };

  globalThis.fetch = async (request) => {
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

    throw new Error(`Unexpected fetch in persisted KV job route check: ${url}`);
  };

  const created = await request(worker, "POST", "http://worker.local/scan/jobs", {
    target: "https://example.com",
    sync_probes: ["remote_fetch"],
    async_providers: [],
  }, env);

  assert.equal(created.status, 200);
  assert.equal(created.body.schema_version, "site-10-layer-scan-job/v0.1");
  assert.equal(created.body.boundaries.storage_persisted, true);
  assert.equal(created.body.persisted.raw_ref, `scan-jobs/raw/${created.body.job.id}.json`);
  assert.equal(typeof created.body.persisted.ttl_expires_at, "string");

  const read = await request(worker, "GET", `http://worker.local/scan/jobs/${created.body.job.id}`, null, env);
  assert.equal(read.status, 200);
  assert.equal(read.body.schema_version, "site-10-layer-persisted-scan-job/v0.1");
  assert.equal(read.body.boundaries.storage_persisted, true);
  assert.equal(read.body.meta.id, created.body.job.id);
  assert.equal(read.body.meta.status, "completed");

  const collect = await request(worker, "POST", `http://worker.local/scan/jobs/${created.body.job.id}/collect`, {
    async_result_envelopes: {},
  }, env);
  assert.equal(collect.status, 200);
  assert.equal(collect.body.schema_version, "site-10-layer-scan-job/v0.1");
  assert.equal(collect.body.boundaries.storage_persisted, true);
  assert.equal(collect.body.job.id, created.body.job.id);
  assert.equal(collect.body.job.status, "completed");

  const artifact = await request(worker, "GET", `http://worker.local/scan/jobs/${created.body.job.id}/artifact`, null, env);
  assert.equal(artifact.status, 200);
  assert.equal(artifact.body.schema_version, "site-10-layer-scan-export-artifact/v0.1");
  assert.equal(artifact.body.boundaries.storage_persisted, true);
  assert.equal(artifact.body.run.id, created.body.job.id);
  assert.ok(artifact.body.records.some((record) => record.probe === "http_headers_probe"));

  const cancel = await request(worker, "POST", `http://worker.local/scan/jobs/${created.body.job.id}/cancel`, {}, env);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.schema_version, "site-10-layer-scan-job/v0.1");
  assert.equal(cancel.body.boundaries.storage_persisted, true);
  assert.equal(cancel.body.job.status, "cancelled");
  assert.equal(cancel.body.job.error.code, "scan_job_cancelled");

  const missing = await request(worker, "GET", "http://worker.local/scan/jobs/missing_scan_id", null, env);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error_code, "scan_job_not_found");

  const wrongMethod = await request(worker, "POST", `http://worker.local/scan/jobs/${created.body.job.id}/artifact`, {}, env);
  assert.equal(wrongMethod.status, 405);

  console.log("backend persisted job store KV route check passed.");
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

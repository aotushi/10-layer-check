#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");
  const env = { ALLOW_LOCAL_DEV_NO_AUTH: "true" };

  const read = await request(worker, "GET", "http://worker.local/scan/jobs/scan_fixture", null, env);
  assert.equal(read.status, 503);
  assert.equal(read.body.error_code, "storage_not_configured");
  assert.equal(read.body.resource, "job_store");

  const artifact = await request(worker, "GET", "http://worker.local/scan/jobs/scan_fixture/artifact", null, env);
  assert.equal(artifact.status, 503);
  assert.equal(artifact.body.error_code, "storage_not_configured");
  assert.equal(artifact.body.resource, "artifact_store");

  const collect = await request(worker, "POST", "http://worker.local/scan/jobs/scan_fixture/collect", {}, env);
  assert.equal(collect.status, 503);
  assert.equal(collect.body.error_code, "storage_not_configured");
  assert.equal(collect.body.resource, "job_store");

  const cancel = await request(worker, "POST", "http://worker.local/scan/jobs/scan_fixture/cancel", {}, env);
  assert.equal(cancel.status, 503);
  assert.equal(cancel.body.error_code, "storage_not_configured");
  assert.equal(cancel.body.resource, "job_store");

  const wrongMethod = await request(worker, "POST", "http://worker.local/scan/jobs/scan_fixture/artifact", {}, env);
  assert.equal(wrongMethod.status, 405);
  assert.match(wrongMethod.body.error, /Use GET/);

  const unknown = await request(worker, "GET", "http://worker.local/scan/jobs/collect", null, env);
  assert.equal(unknown.status, 405);

  console.log("backend persisted job store route check passed.");
} finally {
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

#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const workerSource = await readFile(new URL("../worker/remote-fetch.ts", import.meta.url), "utf8");

if (!workerSource.includes('from "./routes/dispatch"')) {
  throw new Error("Worker entry should delegate endpoint handling to worker/routes/dispatch.ts.");
}

for (const forbidden of ["/probe/remote-fetch", "/scan/site/start", "/provider/github/live-tls/start", "executeSiteScanSyncProbe"]) {
  if (workerSource.includes(forbidden)) {
    throw new Error(`worker/remote-fetch.ts should not contain route implementation detail: ${forbidden}`);
  }
}

for (const path of ["dispatch.ts", "scan.ts", "probes.ts", "github.ts", "performance.ts", "ai.ts"]) {
  const source = await readFile(new URL(`../worker/routes/${path}`, import.meta.url), "utf8").catch(() => "");
  if (!source.trim()) {
    throw new Error(`Expected worker/routes/${path} to exist and contain route logic.`);
  }
}

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

const originalFetch = globalThis.fetch;

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");

  const notFound = await worker.default.fetch(new Request("http://worker.local/not-found"), {});
  assert.equal(notFound.status, 404);

  const apiHealth = await worker.default.fetch(new Request("http://worker.local/api/health"), {});
  assert.equal(apiHealth.status, 200);
  assert.equal((await apiHealth.json()).ok, true);

  const wrongMethod = await worker.default.fetch(
    new Request("http://worker.local/provider/github/live-tls/status", { method: "POST" }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );
  assert.equal(wrongMethod.status, 405);
  assert.match((await wrongMethod.text()), /Use GET for GitHub live TLS status/);

  const originalRandomUUID = globalThis.crypto.randomUUID;
  globalThis.crypto.randomUUID = () => "route-test";
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url === "https://example.com/") {
      return new Response("<!doctype html><title>Example</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url === "https://example.com/robots.txt") return new Response("", { status: 404 });
    if (url === "https://example.com/sitemap.xml") return new Response("", { status: 404 });
    if (url.startsWith("https://www.webpagetest.org/runtest.php?")) {
      return Response.json({ statusCode: 200, data: { testId: "wpt-route-test" } });
    }
    throw new Error(`Unexpected fetch in route module check: ${url}`);
  };

  const scan = await worker.default.fetch(
    new Request("http://worker.local/api/scan/site/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://example.com", sync_probes: ["remote_fetch"], async_providers: [] }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );
  globalThis.crypto.randomUUID = originalRandomUUID;
  assert.equal(scan.status, 200);
  const scanBody = await scan.json();
  assert.equal(scanBody.schema_version, "site-10-layer-scan-start/v0.1");
  assert.equal(scanBody.sync_results.remote_fetch.status, "fulfilled");
  assert.equal(scanBody.sync_results.remote_fetch.result.status_code, 200);

  const webPageTest = await worker.default.fetch(
    new Request("http://worker.local/api/provider/performance/webpagetest/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://example.com" }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true", WEBPAGETEST_API_KEY: "test-key" },
  );
  assert.equal(webPageTest.status, 200);
  const webPageTestBody = await webPageTest.json();
  assert.equal(webPageTestBody.endpoints.status, "http://worker.local/api/provider/performance/webpagetest/status?id=wpt-route-test");
  assert.equal(webPageTestBody.endpoints.result, "http://worker.local/api/provider/performance/webpagetest/result?id=wpt-route-test");

  console.log("worker route module check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const routeSource = await readFile(new URL("../worker/routes/probes.ts", import.meta.url), "utf8");
const probeSource = await readFile(new URL("../worker/probes/performance-basic.ts", import.meta.url), "utf8").catch(() => "");

if (!routeSource.includes('from "../probes/performance-basic"')) {
  throw new Error("Worker performance-basic route should delegate through worker/probes/performance-basic.ts.");
}

if (routeSource.includes("async function performanceBasicProbe") || routeSource.includes("function extractPerformanceResourceCandidates")) {
  throw new Error("worker/routes/probes.ts should not own performance-basic probe implementation details.");
}

for (const token of [
  "performanceBasicProbe",
  "extractPerformanceResourceCandidates",
  "probePerformanceResource",
  "page_weight_estimate",
  "sampled_resource_content_length",
]) {
  if (!probeSource.includes(token)) {
    throw new Error(`worker/probes/performance-basic.ts should contain ${token}.`);
  }
}

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

const originalFetch = globalThis.fetch;
const requested = [];

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");

  globalThis.fetch = async (request, init = {}) => {
    const url = String(request);
    requested.push({ url, method: init.method ?? "GET" });

    if (url === "https://example.com/") {
      return new Response(
        '<!doctype html><script src="/app.js"></script><link rel="stylesheet" href="/app.css"><img src="https://cdn.example.net/hero.png">',
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-length": "128",
            "cache-control": "max-age=60",
            "cf-cache-status": "DYNAMIC",
          },
        },
      );
    }

    if (url === "https://example.com/app.js") {
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "application/javascript",
          "content-length": "2048",
          "cache-control": "public, max-age=31536000, immutable",
          "cf-cache-status": "HIT",
        },
      });
    }

    if (url === "https://example.com/app.css") {
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "text/css",
          "content-length": "1024",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }

    if (url === "https://cdn.example.net/hero.png") {
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": "4096",
          "x-cache": "Hit from cloudfront",
        },
      });
    }

    throw new Error(`Unexpected fetch in performance-basic probe module check: ${url}`);
  };

  const response = await worker.default.fetch(
    new Request("http://worker.local/probe/performance-basic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://example.com" }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status_code, 200);
  assert.equal(body.provider_id, "worker-fetch");
  assert.equal(body.document.encoded_content_length, 128);
  assert.equal(body.declared_resources.total, 3);
  assert.equal(body.sampled_resources.length, 3);
  assert.equal(body.page_weight_estimate.sampled_resource_bytes, 7168);
  assert.equal(body.page_weight_estimate.known_bytes > body.document.html_bytes, true);
  assert.ok(body.coverage.collected.includes("sampled_resource_content_length"));
  assert.ok(requested.some((item) => item.url === "https://example.com/app.js" && item.method === "HEAD"));

  console.log("performance-basic probe module check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

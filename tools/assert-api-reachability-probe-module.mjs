#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

const originalFetch = globalThis.fetch;
const requests = [];

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");
  const { normalizeProviderResult } = await server.ssrLoadModule("/src/providers/results/normalize.ts");

  globalThis.fetch = async (request, init = {}) => {
    const url = String(request);
    const method = init.method ?? "GET";
    requests.push({ url, method });

    if (url === "https://example.com/" && method === "GET") {
      return htmlResponse(`<!doctype html>
        <a href="/api/status">status</a>
        <script>window.API="/graphql"; window.admin="/api/admin/delete";</script>
        <a href="https://other.example/api/public">cross</a>`);
    }

    if (url === "https://example.com/robots.txt") {
      return textResponse("User-agent: *\nAllow: /");
    }

    if (url === "https://example.com/sitemap.xml") {
      return textResponse("<urlset></urlset>", { "content-type": "application/xml" });
    }

    if (url === "https://example.com/api/status" && method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "max-age=30",
          "access-control-allow-origin": "https://example.com",
        },
      });
    }

    if (url === "https://example.com/graphql" && method === "HEAD") {
      return new Response(null, { status: 405, headers: { "content-type": "application/json" } });
    }

    if (url === "https://example.com/graphql" && method === "GET") {
      return new Response(JSON.stringify({ error: "GraphQL GET query required." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch in api reachability check: ${method} ${url}`);
  };

  const direct = await post(worker, "/probe/api-reachability", {
    target: "https://example.com/",
    max_candidates: 5,
  });
  assert.equal(direct.status, 200);
  assert.equal(direct.body.provider_id, "cloudflare_worker_api_reachability");
  assert.equal(direct.body.checks.length, 2);
  assert.equal(direct.body.skipped.some((item) => item.reason === "cross_origin_candidate"), true);
  assert.equal(direct.body.skipped.some((item) => item.reason === "sensitive_or_destructive_path"), true);
  assert.deepEqual(direct.body.limits.methods, ["HEAD", "GET"]);

  const graphql = direct.body.checks.find((check) => check.url === "https://example.com/graphql");
  assert.equal(graphql.method, "GET");
  assert.equal(graphql.status_code, 400);
  assert.ok(graphql.error_surface_signals.includes("client_error_status"));
  assert.ok(graphql.error_surface_signals.includes("json_error_shape"));

  assert.ok(!requests.some((entry) => entry.url === "https://other.example/api/public"));
  assert.ok(!requests.some((entry) => entry.url === "https://example.com/api/admin/delete"));
  assert.ok(!requests.some((entry) => !["GET", "HEAD"].includes(entry.method)));

  const scan = await post(worker, "/scan/site/start", {
    target: "https://example.com/",
    sync_probes: ["api_reachability"],
  });
  assert.equal(scan.status, 200);
  assert.deepEqual(scan.body.sync_probes, ["api_reachability"]);
  assert.equal(scan.body.sync_results.api_reachability.status, "fulfilled");

  const records = normalizeProviderResult({
    target: "https://example.com/",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-22T00:00:00.000Z",
    providers: [],
    envelope: scan.body,
  });
  const reachabilityRecord = records.find((record) => record.probe === "api_reachability_probe");
  assert.equal(reachabilityRecord?.layer, 6);
  assert.equal(reachabilityRecord?.source, "cloudflare_worker_api_reachability");
  assert.equal(reachabilityRecord?.value.checks.length, 2);
  assert.equal(reachabilityRecord?.status, "warning");

  console.log("api reachability probe module check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

async function post(worker, path, body) {
  const response = await worker.default.fetch(
    new Request(`http://worker.local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );

  return { status: response.status, body: await response.json() };
}

function htmlResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function textResponse(body, headers = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain", ...headers },
  });
}

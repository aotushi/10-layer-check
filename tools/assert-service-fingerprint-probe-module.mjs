#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const routeSource = await readFile(new URL("../worker/routes/probes.ts", import.meta.url), "utf8");
const dispatchSource = await readFile(new URL("../worker/routes/dispatch.ts", import.meta.url), "utf8");
const probeSource = await readFile(new URL("../worker/probes/service-fingerprint.ts", import.meta.url), "utf8");
const normalizerSource = await readFile(new URL("../src/providers/results/normalize.ts", import.meta.url), "utf8");

for (const token of [
  'from "../probes/service-fingerprint"',
  "serviceFingerprintProbe",
  "/probe/service-fingerprint",
]) {
  if (!routeSource.includes(token) && !dispatchSource.includes(token)) {
    throw new Error(`Worker route wiring should include ${token}.`);
  }
}

for (const forbidden of ["nmap", "masscan", "net.connect", "Deno.connect"]) {
  if (probeSource.toLowerCase().includes(forbidden.toLowerCase())) {
    throw new Error(`Default service fingerprint probe must not include forbidden behavior: ${forbidden}`);
  }
}

for (const token of ["service_fingerprint", "ServiceFingerprintResult", "createServiceFingerprintLayerRecords"]) {
  if (!normalizerSource.includes(token)) {
    throw new Error(`Provider normalizer should include ${token}.`);
  }
}

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

const originalFetch = globalThis.fetch;
const requestedUrls = [];

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");
  const { normalizeProviderResult } = await server.ssrLoadModule("/src/providers/results/normalize.ts");

  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    requestedUrls.push({ url: url.toString(), method: init?.method ?? "GET" });

    if (url.hostname === "example.com") {
      return new Response(
        "<!doctype html><title>Example Dashboard</title><meta name=\"generator\" content=\"Nuxt\">",
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            server: "cloudflare",
            "x-powered-by": "Nuxt",
            "cf-ray": "fixture-ray",
          },
        },
      );
    }

    if (url.hostname === "admin.example.com") {
      return new Response("<!doctype html><title>Admin Console</title>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          server: "nginx",
        },
      });
    }

    throw new Error(`Unexpected fetch in service fingerprint probe check: ${url.toString()}`);
  };

  const response = await worker.default.fetch(
    new Request("http://worker.local/probe/service-fingerprint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: "https://example.com",
        hosts: ["admin.example.com", "evil.test"],
        max_hosts: 10,
      }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.host, "example.com");
  assert.equal(body.checked_hosts.length, 2);
  assert.equal(body.limits.max_hosts, 10);
  assert.equal(body.limits.max_requests_per_host, 1);
  assert.ok(!body.checked_hosts.some((host) => host.host === "evil.test"));
  assert.ok(body.checked_hosts.some((host) => host.service_hints.some((hint) => hint.category === "cdn")));
  assert.ok(body.checked_hosts.some((host) => host.service_hints.some((hint) => hint.category === "admin_surface")));
  assert.ok(body.coverage.missing.every((item) => item.startsWith("l7_permissioned_")));
  assert.ok(!body.coverage.missing.includes("l7_external_service_intel"));
  assert.deepEqual(
    requestedUrls.map((item) => item.method),
    ["GET", "GET"],
  );

  const records = normalizeProviderResult({
    target: "https://example.com",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-21T00:00:00.000Z",
    providers: [],
    envelope: {
      schema_version: "site-10-layer-scan-start/v0.1",
      provider: "cloudflare_worker_site_scan",
      requested_url: "https://example.com",
      normalized_url: "https://example.com/",
      normalized_target: "example.com",
      status: "ok",
      sync_probes: ["service_fingerprint"],
      async_providers: [],
      sync_results: {
        service_fingerprint: {
          status: "fulfilled",
          result: body,
        },
      },
      async_jobs: [],
      coverage: {
        collected: ["service_fingerprint"],
        pending: [],
        failed: [],
      },
    },
  });

  const record = records.find((item) => item.layer === 7 && item.probe === "service_fingerprint_probe");
  assert.ok(record, "service_fingerprint sync result should normalize into L7 service_fingerprint_probe.");
  assert.equal(record.value.limits.max_requests_per_host, 1);
  assert.ok(record.evidence_metadata.limitations.some((item) => item.includes("does not perform TCP/UDP port scanning")));

  console.log("service fingerprint probe module check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

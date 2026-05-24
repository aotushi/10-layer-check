#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const routeSource = await readFile(new URL("../worker/routes/probes.ts", import.meta.url), "utf8");
const orchestratorSource = await readFile(new URL("../worker/services/scan-orchestrator.ts", import.meta.url), "utf8");
const probeSource = await readFile(new URL("../worker/probes/public-host-fingerprint.ts", import.meta.url), "utf8");
const recordSource = await readFile(new URL("../src/probes/layer-07-subdomains.ts", import.meta.url), "utf8");
const normalizerSource = await readFile(new URL("../src/providers/results/normalize.ts", import.meta.url), "utf8");
const smokeSource = await readFile(new URL("../tools/smoke-persisted-selected-full-ai-report-remote.mjs", import.meta.url), "utf8");

for (const token of [
  'from "../probes/public-host-fingerprint"',
  "publicHostFingerprintProbe",
  "/probe/public-host-fingerprint",
]) {
  if (!routeSource.includes(token)) {
    throw new Error(`Worker probe route wiring should include ${token}.`);
  }
}

for (const token of ["public_host_fingerprint", "SiteScanSyncProbe", "parseSiteScanSyncProbes"]) {
  if (!orchestratorSource.includes(token)) {
    throw new Error(`Scan orchestrator should include ${token}.`);
  }
}

for (const forbidden of ["nmap", "masscan", "net.connect", "Deno.connect", "user_enumeration", "password"]) {
  if (probeSource.toLowerCase().includes(forbidden.toLowerCase())) {
    throw new Error(`Public host fingerprint probe must not include forbidden behavior: ${forbidden}`);
  }
}

for (const token of [
  "PublicHostFingerprintResult",
  "isPublicHostFingerprintResult",
  "createPublicHostFingerprintLayerRecords",
  "public_app_marker_probe",
]) {
  if (!normalizerSource.includes(token) && !probeSource.includes(token) && !recordSource.includes(token)) {
    throw new Error(`Normalizer/probe code should include ${token}.`);
  }
}

if (!smokeSource.includes("public_host_fingerprint")) {
  throw new Error("Selected full remote smoke should request public_host_fingerprint by default.");
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
  const { normalizeProviderResult } = await server.ssrLoadModule("/src/providers/results/normalize.ts");
  const { createAnalysisReport } = await server.ssrLoadModule("/src/reporters/analysis.ts");
  const { createReportBrief } = await server.ssrLoadModule("/src/reporters/brief.ts");
  const { createAiNarrativeReportContract } = await server.ssrLoadModule("/src/providers/narrative-report/contract.ts");

  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    requested.push(url.toString());

    if (url.hostname === "example.com" && url.pathname === "/sitemap.xml") {
      return new Response(
        "<urlset><url><loc>https://docs.example.com/guide</loc></url><url><loc>https://community.example.com/t/1</loc></url></urlset>",
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    }

    if (url.hostname === "example.com" && url.pathname === "/") {
      return html("<title>Example Home</title>");
    }

    if (url.hostname === "docs.example.com" && url.pathname === "/") {
      return html("<title>Example Docs</title><script src=\"/_next/static/mintlify-assets/app.js\"></script>");
    }

    if (url.hostname === "api.example.com" && url.pathname === "/") {
      return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json", server: "cloudflare" } });
    }

    if (url.hostname === "blog.example.com" && url.pathname === "/") {
      return html('<title>Example Blog</title><meta name="generator" content="WordPress 6.5"><link href="/wp-content/theme.css">');
    }

    if (url.hostname === "blog.example.com" && url.pathname === "/wp-json/") {
      return new Response('{"name":"Example Blog"}', { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.hostname === "community.example.com" && url.pathname === "/") {
      return html("<title>Example Community</title><script src=\"/assets/discourse.js\"></script>");
    }

    if (url.hostname === "status.example.com" && url.pathname === "/") {
      return html("<title>Status Page</title>");
    }

    if (url.pathname === "/wp-json/") {
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }

    throw new Error(`Unexpected fetch in public host fingerprint probe check: ${url.toString()}`);
  };

  const response = await worker.default.fetch(
    new Request("http://worker.local/probe/public-host-fingerprint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://example.com", max_hosts: 6 }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.host, "example.com");
  assert.equal(body.limits.max_hosts, 6);
  assert.equal(body.limits.max_requests_per_host, 2);
  assert.equal(body.limits.max_concurrency, 3);
  assert.ok(body.checked_hosts.some((host) => host.host === "docs.example.com"));
  assert.ok(body.checked_hosts.some((host) => host.host === "blog.example.com"));
  assert.ok(body.checked_hosts.some((host) => host.host === "community.example.com"));
  assert.ok(body.checked_hosts.some((host) => host.app_markers.some((marker) => marker.name === "Mintlify")));
  assert.ok(body.checked_hosts.some((host) => host.app_markers.some((marker) => marker.name === "WordPress")));
  assert.ok(body.checked_hosts.some((host) => host.app_markers.some((marker) => marker.name === "Discourse")));
  assert.ok(body.checked_hosts.some((host) => host.app_markers.some((marker) => marker.name === "wp-json")));
  assert.ok(body.coverage.missing.every((item) => item.startsWith("permissioned_")));

  const records = normalizeProviderResult({
    target: "https://example.com",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-23T00:00:00.000Z",
    providers: [],
    envelope: {
      schema_version: "site-10-layer-scan-start/v0.1",
      provider: "cloudflare_worker_site_scan",
      requested_url: "https://example.com",
      normalized_url: "https://example.com/",
      normalized_target: "example.com",
      status: "ok",
      sync_probes: ["public_host_fingerprint"],
      async_providers: [],
      sync_results: {
        public_host_fingerprint: {
          status: "fulfilled",
          result: body,
        },
      },
      async_jobs: [],
      coverage: {
        collected: ["public_host_fingerprint"],
        pending: [],
        failed: [],
      },
    },
  });

  const hostRecord = records.find((item) => item.probe === "public_host_fingerprint_probe");
  const markerRecord = records.find((item) => item.probe === "public_app_marker_probe");
  assert.ok(hostRecord, "public_host_fingerprint should normalize into a Layer 7 host record.");
  assert.ok(markerRecord, "public_host_fingerprint should normalize into a Layer 8 app marker record.");
  assert.equal(hostRecord.layer, 7);
  assert.equal(markerRecord.layer, 8);
  assert.ok(hostRecord.value.limits.max_requests_per_host === 2);
  assert.ok(markerRecord.value.app_markers.some((marker) => marker.name === "Mintlify"));
  assert.ok(markerRecord.value.app_markers.some((marker) => marker.name === "WordPress"));
  assert.ok(markerRecord.value.app_markers.some((marker) => marker.name === "Discourse"));
  assert.ok(markerRecord.value.app_markers.some((marker) => marker.name === "wp-json"));
  assert.ok(markerRecord.evidence_metadata.limitations.some((item) => item.includes("directory brute forcing")));

  const run = {
    id: "public-host-fingerprint-fixture",
    target: "https://example.com",
    normalizedTarget: "example.com",
    createdAt: "2026-05-23T00:00:00.000Z",
    source: "provider",
    records,
  };
  const analysis = createAnalysisReport(run);
  const brief = createReportBrief(run, analysis);
  const contract = createAiNarrativeReportContract(brief);
  const factHints = contract.output_contract.section_guidance.flatMap((section) => section.fact_hints ?? []);

  for (const expected of ["docs.example.com", "blog.example.com", "Mintlify", "WordPress", "Discourse", "wp-json"]) {
    assert.ok(
      factHints.some((hint) => hint.toLowerCase().includes(expected.toLowerCase())),
      `Expected narrative fact hints to include ${expected}.`,
    );
  }

  assert.ok(requested.length <= 9, "Fixture should stay within bounded request expectations.");
  console.log("public host fingerprint probe module check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

function html(body) {
  return new Response(`<!doctype html>${body}`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", server: "cloudflare" },
  });
}

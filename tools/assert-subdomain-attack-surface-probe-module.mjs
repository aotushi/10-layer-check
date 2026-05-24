#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const routeSource = await readFile(new URL("../worker/routes/probes.ts", import.meta.url), "utf8");
const probeSource = await readFile(new URL("../worker/probes/subdomain-attack-surface.ts", import.meta.url), "utf8").catch(() => "");

if (!routeSource.includes('from "../probes/subdomain-attack-surface"')) {
  throw new Error("Worker subdomain attack surface route should delegate through worker/probes/subdomain-attack-surface.ts.");
}

for (const forbidden of ["async function subdomainAttackSurfaceProbe", "function extractSubdomainsFromCertificates", "function detectSubdomainSurfaceHints"]) {
  if (routeSource.includes(forbidden)) {
    throw new Error(`worker/routes/probes.ts should not contain ${forbidden}.`);
  }
}

for (const token of [
  "subdomainAttackSurfaceProbe",
  "fetchCtLogForDomain",
  "fetchCertSpotterCertificates",
  "fetchCrtShCertificates",
  "extractTitle",
  "detectSubdomainSurfaceHints",
  "max_reachability_checks",
]) {
  if (!probeSource.includes(token)) {
    throw new Error(`worker/probes/subdomain-attack-surface.ts should contain ${token}.`);
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

  globalThis.fetch = async (request) => {
    const url = new URL(String(request));

    if (url.hostname === "api.certspotter.com") {
      return new Response(
        JSON.stringify([
          {
            id: "cert-1",
            dns_names: ["example.com", "admin.example.com", "*.staging.example.com"],
            issuer: { friendly_name: "Example CA" },
            revoked: false,
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.hostname === "admin.example.com") {
      return new Response("<!doctype html><title>Admin Console</title>", {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          server: "nginx",
          "x-powered-by": "vite",
        },
      });
    }

    if (url.hostname === "staging.example.com") {
      return new Response("<!doctype html><title>Staging App</title>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          server: "cloudflare",
        },
      });
    }

    throw new Error(`Unexpected fetch in subdomain attack surface probe module check: ${url.toString()}`);
  };

  const response = await worker.default.fetch(
    new Request("http://worker.local/probe/subdomain-attack-surface", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://example.com" }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.host, "example.com");
  assert.equal(body.ct_log.status, "ok");
  assert.equal(body.discovered_subdomains.length, 2);
  assert.ok(body.exposed_surface_hints.some((hint) => hint.hint === "admin"));
  assert.ok(body.exposed_surface_hints.some((hint) => hint.hint === "staging"));
  assert.equal(body.limits.checked_count, 2);
  assert.ok(Array.isArray(body.ct_log.providers));
  assert.equal(body.ct_log.providers[0].provider, "certspotter");
  assert.equal(body.reachability[0].https.title, "Admin Console");
  assert.equal(body.reachability[0].https.server, "nginx");
  assert.equal(body.reachability[0].https.x_powered_by, "vite");

  globalThis.fetch = async (request) => {
    const url = new URL(String(request));

    if (url.hostname === "api.certspotter.com") {
      return new Response("unavailable", { status: 503 });
    }

    if (url.hostname === "crt.sh") {
      return new Response(
        JSON.stringify([
          {
            id: 123,
            name_value: "example.com\napi.example.com\n*.dev.example.com",
            issuer_name: "crt.sh Example CA",
            not_before: "2026-01-01T00:00:00",
            not_after: "2026-04-01T00:00:00",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.hostname === "api.example.com" || url.hostname === "dev.example.com") {
      return new Response("<title>Fallback Host</title>", { status: 200, headers: { "content-type": "text/html" } });
    }

    throw new Error(`Unexpected fallback fetch in subdomain attack surface probe module check: ${url.toString()}`);
  };

  const fallbackResponse = await worker.default.fetch(
    new Request("http://worker.local/probe/subdomain-attack-surface", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://example.com" }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );

  const fallbackBody = await fallbackResponse.json();
  assert.equal(fallbackResponse.status, 200);
  assert.equal(fallbackBody.ct_log.status, "ok");
  assert.equal(fallbackBody.ct_log.provider, "crtsh");
  assert.equal(fallbackBody.ct_log.providers[0].provider, "certspotter");
  assert.equal(fallbackBody.ct_log.providers[0].status, "error");
  assert.equal(fallbackBody.ct_log.providers[1].provider, "crtsh");
  assert.equal(fallbackBody.ct_log.providers[1].status, "ok");
  assert.deepEqual(
    fallbackBody.discovered_subdomains.map((item) => item.host),
    ["api.example.com", "dev.example.com"],
  );

  console.log("subdomain attack surface probe module check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const routeSource = await readFile(new URL("../worker/routes/probes.ts", import.meta.url), "utf8");
const probeSource = await readFile(new URL("../worker/probes/tls-certificate.ts", import.meta.url), "utf8").catch(() => "");

if (!routeSource.includes('from "../probes/tls-certificate"')) {
  throw new Error("Worker TLS certificate route should delegate through worker/probes/tls-certificate.ts.");
}

for (const forbidden of ["async function tlsCertificateProbe", "function parseHsts", "async function fetchCtLog("]) {
  if (routeSource.includes(forbidden)) {
    throw new Error(`worker/routes/probes.ts should not contain ${forbidden}.`);
  }
}

for (const token of ["tlsCertificateProbe", "fetchHstsPolicy", "parseHsts", "fetchCtLog", "current_certificate"]) {
  if (!probeSource.includes(token)) {
    throw new Error(`worker/probes/tls-certificate.ts should contain ${token}.`);
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

    if (url.toString() === "https://example.com/") {
      return new Response("", {
        status: 200,
        headers: {
          "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
        },
      });
    }

    if (url.hostname === "api.certspotter.com") {
      return new Response(
        JSON.stringify([
          {
            id: "cert-1",
            dns_names: ["example.com"],
            issuer: { name: "Example Issuer", friendly_name: "Example CA" },
            not_before: "2026-01-01T00:00:00Z",
            not_after: "2026-12-31T23:59:59Z",
            revoked: false,
            cert_sha256: "abc123",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch in TLS certificate probe module check: ${url.toString()}`);
  };

  const response = await worker.default.fetch(
    new Request("http://worker.local/probe/tls-certificate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://example.com" }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.host, "example.com");
  assert.equal(body.https_reachability.reachable, true);
  assert.equal(body.hsts.present, true);
  assert.equal(body.hsts.max_age_seconds, 31536000);
  assert.equal(body.ct_log.certificates.length, 1);
  assert.equal(body.current_certificate.status, "not_collected");

  console.log("TLS certificate probe module check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

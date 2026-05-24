#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const routeSource = await readFile(new URL("../worker/routes/probes.ts", import.meta.url), "utf8");
const probeSource = await readFile(new URL("../worker/probes/dns-infrastructure.ts", import.meta.url), "utf8").catch(() => "");

if (!routeSource.includes('from "../probes/dns-infrastructure"')) {
  throw new Error("Worker DNS infrastructure route should delegate through worker/probes/dns-infrastructure.ts.");
}

for (const forbidden of ["async function dnsInfrastructureProbe", "function detectCdn", "function buildCymruAsnQueryName"]) {
  if (routeSource.includes(forbidden)) {
    throw new Error(`worker/routes/probes.ts should not contain ${forbidden}.`);
  }
}

for (const token of ["dnsInfrastructureProbe", "fetchAsnEnrichment", "detectCdn", "team_cymru_dns"]) {
  if (!probeSource.includes(token)) {
    throw new Error(`worker/probes/dns-infrastructure.ts should contain ${token}.`);
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

    if (url.hostname === "cloudflare-dns.com") {
      const name = url.searchParams.get("name");
      const type = url.searchParams.get("type");
      if (name === "example.com" && type === "A") return dnsJson(0, [{ name, type: 1, TTL: 300, data: "93.184.216.34" }]);
      if (name === "example.com" && type === "AAAA") return dnsJson(0, [{ name, type: 28, TTL: 300, data: "2606:2800:220:1:248:1893:25c8:1946" }]);
      if (name === "example.com" && type === "CNAME") return dnsJson(0, [{ name, type: 5, TTL: 300, data: "example.cloudflare.net" }]);
      if (name === "example.com" && type === "HTTPS") return dnsJson(0, []);
      if (name?.endsWith(".origin.asn.cymru.com") || name?.endsWith(".origin6.asn.cymru.com")) {
        return dnsJson(0, [{ name, type: 16, TTL: 300, data: "\"15133 | 93.184.216.0/24 | US | arin | 2008-06-02 | EDGECAST\"" }]);
      }
      return dnsJson(0, []);
    }

    if (url.toString() === "http://example.com/") {
      return new Response("", { status: 301, headers: { location: "https://example.com/" } });
    }

    if (url.toString() === "https://example.com/") {
      return new Response("", { status: 200 });
    }

    throw new Error(`Unexpected fetch in DNS infrastructure probe module check: ${url.toString()}`);
  };

  const response = await worker.default.fetch(
    new Request("http://worker.local/probe/dns-infrastructure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://example.com" }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.host, "example.com");
  assert.deepEqual(body.ip_addresses.ipv4, ["93.184.216.34"]);
  assert.equal(body.cdn.providers.includes("Cloudflare"), true);
  assert.equal(body.asn.provider, "team_cymru_dns");
  assert.equal(body.protocol_reachability.https.reachable, true);

  console.log("DNS infrastructure probe module check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

function dnsJson(status, answer) {
  return new Response(JSON.stringify({ Status: status, Answer: answer }), {
    status: 200,
    headers: { "content-type": "application/dns-json" },
  });
}

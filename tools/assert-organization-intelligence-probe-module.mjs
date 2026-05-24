#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const routeSource = await readFile(new URL("../worker/routes/probes.ts", import.meta.url), "utf8");
const probeSource = await readFile(new URL("../worker/probes/organization-intelligence.ts", import.meta.url), "utf8").catch(
  () => "",
);

if (!routeSource.includes('from "../probes/organization-intelligence"')) {
  throw new Error("Worker organization intelligence route should delegate through worker/probes/organization-intelligence.ts.");
}

for (const forbidden of [
  "async function organizationIntelligenceProbe",
  "async function fetchRdapWhoisLite",
  "function extractRelatedDomainCandidates",
]) {
  if (routeSource.includes(forbidden)) {
    throw new Error(`worker/routes/probes.ts should not contain ${forbidden}.`);
  }
}

for (const token of [
  "organizationIntelligenceProbe",
  "fetchRdapWhoisLite",
  "fetchWaybackHistory",
  "extractRelatedDomainCandidates",
  "rdap.org",
  "web.archive.org",
]) {
  if (!probeSource.includes(token)) {
    throw new Error(`worker/probes/organization-intelligence.ts should contain ${token}.`);
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
      if (name === "example.com" && type === "MX") {
        return dnsJson(0, [{ name, type: 15, TTL: 300, data: "10 aspmx.l.google.com." }]);
      }
      if (name === "example.com" && type === "NS") {
        return dnsJson(0, [{ name, type: 2, TTL: 300, data: "a.iana-servers.net." }]);
      }
      if (name === "example.com" && type === "TXT") {
        return dnsJson(0, [{ name, type: 16, TTL: 300, data: "\"v=spf1 include:_spf.google.com ~all\"" }]);
      }
      if (name === "example.com" && type === "CAA") return dnsJson(0, []);
      return dnsJson(0, []);
    }

    if (url.toString() === "https://example.com/") {
      return new Response(
        [
          "<!doctype html>",
          '<a href="https://github.com/example">GitHub</a>',
          '<a href="https://docs.example.net/start">Docs</a>',
          '<a href="https://plausible.io/about">Analytics product docs, not a tracker endpoint</a>',
          '<a href="https://www.google-analytics.com/">Analytics product homepage, not a tracker endpoint</a>',
          '<script src="https://assets.example-cdn.net/app.js"></script>',
          '<img src="https://m-img.org/spai/w_200/matomo.org/wp-content/uploads/logo_matomo.png">',
          "<script>",
          "var _paq = window._paq = window._paq || [];",
          "_paq.push(['setTrackerUrl', 'https://analytics.example.net/matomo.php']);",
          "_paq.push(['setSiteId', '36']);",
          "</script>",
        ].join(""),
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    if (url.hostname === "rdap.org" && url.pathname === "/domain/example.com") {
      return new Response("Forbidden", { status: 403, statusText: "Forbidden" });
    }

    if (url.hostname === "rdap.verisign.com" && url.pathname === "/com/v1/domain/example.com") {
      return new Response(JSON.stringify(createRdapFixture()), {
        status: 200,
        headers: { "content-type": "application/rdap+json" },
      });
    }

    if (url.hostname === "web.archive.org" && url.pathname === "/cdx/search/cdx") {
      return new Response("Bad Request", { status: 400, statusText: "Bad Request" });
    }

    if (url.hostname === "archive.org" && url.pathname === "/wayback/available") {
      return new Response(
        JSON.stringify({
          archived_snapshots: {
            closest: {
              available: true,
              url: "https://web.archive.org/web/20260521021504/https://example.com/",
              timestamp: "20260521021504",
              status: "200",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch in organization intelligence probe module check: ${url.toString()}`);
  };

  const response = await worker.default.fetch(
    new Request("http://worker.local/probe/organization-intelligence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://example.com" }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.host, "example.com");
  assert.equal(body.provider_id, "worker-organization-intelligence");
  assert.equal(body.mail_providers.some((item) => item.provider === "Google Workspace"), true);
  assert.equal(body.social_links.some((item) => item.platform === "GitHub"), true);
  assert.equal(
    body.related_domain_candidates.some((item) => item.host === "docs.example.net" && item.role === "documentation"),
    true,
  );
  assert.equal(
    body.related_domain_candidates.some((item) => item.host === "assets.example-cdn.net" && item.role === "cdn_asset"),
    true,
  );
  assert.equal(
    body.related_domain_candidates.some((item) => item.host === "plausible.io" && item.role === "analytics"),
    false,
  );
  assert.equal(
    body.related_domain_candidates.some((item) => item.host === "m-img.org" && item.role === "analytics"),
    false,
  );
  assert.equal(
    body.related_domain_candidates.some((item) => item.host === "www.google-analytics.com" && item.role === "analytics"),
    false,
  );
  const analyticsCandidate = body.related_domain_candidates.find((item) => item.host === "analytics.example.net");
  assert.equal(analyticsCandidate?.signal, "analytics_tracker_endpoint");
  assert.equal(analyticsCandidate?.role, "analytics");
  assert.equal(analyticsCandidate?.evidence?.some((item) => item.name === "matomo_site_id" && item.value === "36"), true);
  assert.equal(body.external_intelligence.whois.status, "rdap_collected");
  assert.equal(body.external_intelligence.whois.provider, "rdap.verisign.com/com/v1");
  assert.equal(body.external_intelligence.whois.registrar, "Example Registrar, Inc.");
  assert.equal(body.external_intelligence.wayback.status, "wayback_collected");
  assert.equal(body.external_intelligence.wayback.provider, "archive.org_wayback_available");
  assert.equal(body.external_intelligence.wayback.snapshot_count_estimate, null);

  console.log("organization intelligence probe module check passed.");
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

function createRdapFixture() {
  return {
    objectClassName: "domain",
    handle: "2336799_DOMAIN_COM-VRSN",
    ldhName: "EXAMPLE.COM",
    entities: [
      {
        roles: ["registrar"],
        vcardArray: ["vcard", [["fn", {}, "text", "Example Registrar, Inc."]]],
      },
    ],
    nameservers: [{ ldhName: "A.IANA-SERVERS.NET" }],
    status: ["client delete prohibited"],
    events: [{ eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" }],
    notices: [{ title: "Terms", description: ["RDAP fixture notice."] }],
    links: [{ rel: "self", href: "https://rdap.org/domain/example.com" }],
  };
}

#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

const originalFetch = globalThis.fetch;

try {
  const probesRoute = readFileSync(new URL("../worker/routes/probes.ts", import.meta.url), "utf8");
  const orchestrator = readFileSync(new URL("../worker/services/scan-orchestrator.ts", import.meta.url), "utf8");
  const normalizer = readFileSync(new URL("../src/providers/results/normalize.ts", import.meta.url), "utf8");
  assert.match(probesRoute, /publicSecurityDetailsProbe/);
  assert.match(orchestrator, /public_security_details/);
  assert.match(normalizer, /createPublicSecurityDetailsLayerRecords/);

  const { publicSecurityDetailsProbe } = await server.ssrLoadModule("/worker/probes/public-security-details.ts");
  const { normalizeSiteScanProviderResults } = await server.ssrLoadModule("/src/providers/results/normalize.ts");
  const { createDefaultScanPolicy } = await server.ssrLoadModule("/src/scan/policy.ts");

  globalThis.fetch = async (request, init) => {
    const url = String(request);
    const method = init?.method ?? "GET";

    if (url === "https://example.com/") {
      return new Response("<!doctype html><title>Example</title>", {
        status: 200,
        headers: { "content-type": "text/html", server: "root" },
      });
    }

    if (url === "https://api.example.com/" || url === "https://api.example.com/health") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "https://site-10-layer-check.invalid",
          "access-control-allow-credentials": "true",
          "x-request-id": "req_fixture",
        },
      });
    }

    if (url === "https://api.example.com/v1/models") {
      return new Response(JSON.stringify({ error: "missing_api_key", request_id: "req_models" }), {
        status: method === "OPTIONS" ? 204 : 401,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "https://site-10-layer-check.invalid",
          "access-control-allow-credentials": "true",
        },
      });
    }

    if (url === "https://blog.example.com/") {
      return new Response('<!doctype html><title>Blog</title><script src="/wp-includes/js/wp-emoji-release.min.js?ver=6.9.4"></script>', {
        status: 200,
        headers: { "content-type": "text/html", "set-cookie": "wordpress_test_cookie=WP Cookie check; Secure; SameSite=Lax" },
      });
    }

    if (url === "https://blog.example.com/wp-json/") {
      return new Response(JSON.stringify({
        name: "Fixture Blog",
        description: "Fixture",
        timezone_string: "Asia/Shanghai",
        gmt_offset: 8,
        namespaces: ["wp/v2", "oembed/1.0"],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url === "https://blog.example.com/wp-login.php") {
      return new Response("", { status: 200, headers: { "content-type": "text/html" } });
    }

    if (url === "https://community.example.com/" || url === "https://community.example.com/latest.json") {
      return new Response(JSON.stringify({ topic_list: { topics: [] } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-discourse-route": "list/latest",
          "x-discourse-cached": "store",
          "x-runtime": "0.809627",
          "content-security-policy": "script-src 'nonce-fixture' 'strict-dynamic'",
        },
      });
    }

    if (url.startsWith("https://docs.example.com/")) {
      return new Response("<!doctype html><title>Docs</title>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "x-mint-proxy-version": "1.0.0-prod",
          "x-mintlify-client-version": "0.0.fixture",
          "x-vercel-cache": "HIT",
          "x-vercel-id": "iad1::fixture",
          "x-served-version": "dpl_fixture",
          "x-vercel-project-id": "prj_fixture",
          vary: "rsc, next-router-state-tree, next-router-prefetch",
          link: "</llms.txt>; rel=\"llms-txt\"",
        },
      });
    }

    return new Response("", { status: 404, headers: { "content-type": "text/plain" } });
  };

  const result = await publicSecurityDetailsProbe("https://example.com", { maxHosts: 6 });
  assert.equal(result.provider_id, "cloudflare_worker_public_security_details");
  assert.ok(result.checks.some((check) => check.kind === "cors" && check.signals.includes("cors_allow_credentials:true")));
  assert.ok(result.checks.some((check) => check.kind === "api_endpoint" && check.parsed.api_request_id === "req_models"));
  assert.ok(result.checks.some((check) => check.kind === "cms_metadata" && check.parsed.wordpress_timezone === "Asia/Shanghai"));
  assert.ok(result.checks.some((check) => check.kind === "forum_metadata" && check.signals.includes("discourse_header_observed")));
  assert.ok(result.checks.some((check) => check.host === "docs.example.com" && check.signals.includes("mintlify_header_observed")));
  assert.ok(result.checks.some((check) => check.host === "docs.example.com" && check.signals.includes("vercel_header_observed")));
  assert.ok(result.checks.some((check) => check.host === "docs.example.com" && check.parsed.next_rsc_vary));
  assert.ok(result.checks.some((check) => check.host === "blog.example.com" && check.signals.includes("wordpress_asset_version_observed")));
  assert.ok(result.checks.some((check) => check.kind === "route_presence" && check.path === "/wp-login.php"));

  const policy = createDefaultScanPolicy({
    target: "https://example.com",
    normalizedTarget: "example.com",
    requestedSyncProbes: ["public_security_details"],
  });
  assert.ok(policy.allowed_checks.some((check) => check.id === "public_security_details"));
  assert.ok(policy.allowed_checks.some((check) => check.id === "bounded_cors_header_validation"));
  assert.ok(policy.denied_checks.some((check) => check.id === "wordpress_user_enumeration"));

  const records = normalizeSiteScanProviderResults({
    target: "https://example.com",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-23T00:00:00.000Z",
    providers: [],
    scanStartEnvelope: {
      schema_version: "site-10-layer-scan-start/v0.1",
      provider: "cloudflare_worker_site_scan",
      requested_url: "https://example.com",
      normalized_url: "https://example.com/",
      normalized_target: "example.com",
      status: "ok",
      sync_probes: ["public_security_details"],
      async_providers: [],
      sync_results: {
        public_security_details: { status: "fulfilled", result },
      },
      async_jobs: [],
      coverage: { collected: ["public_security_details"], pending: [], failed: [], limitations: [] },
    },
  });

  assert.ok(records.some((record) => record.probe === "bounded_cors_header_validation_probe"));
  assert.ok(records.some((record) => record.probe === "bounded_public_api_error_surface_probe"));
  assert.ok(records.some((record) => record.probe === "bounded_public_api_endpoint_inventory_probe"));
  assert.ok(records.some((record) => record.probe === "bounded_public_metadata_probe"));
  assert.ok(records.some((record) => record.probe === "bounded_public_app_header_metadata_probe"));
  assert.ok(records.some((record) => record.probe === "bounded_cookie_attribute_observation_probe"));

  const endpointInventory = records.find((record) => record.probe === "bounded_public_api_endpoint_inventory_probe");
  assert.ok(endpointInventory?.risk.summary.includes("/v1/models"));
  const appHeaders = records.find((record) => record.probe === "bounded_public_app_header_metadata_probe");
  assert.ok(JSON.stringify(appHeaders?.evidence).includes("mintlify_client_version"));
  assert.ok(JSON.stringify(appHeaders?.evidence).includes("wordpress_asset_versions"));

  console.log("public security details probe module check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

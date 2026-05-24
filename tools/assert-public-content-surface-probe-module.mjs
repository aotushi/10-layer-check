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
  const dispatchRoute = readFileSync(new URL("../worker/routes/dispatch.ts", import.meta.url), "utf8");
  const orchestrator = readFileSync(new URL("../worker/services/scan-orchestrator.ts", import.meta.url), "utf8");
  const normalizer = readFileSync(new URL("../src/providers/results/normalize.ts", import.meta.url), "utf8");
  const smoke = readFileSync(new URL("../tools/smoke-persisted-selected-full-ai-report-remote.mjs", import.meta.url), "utf8");

  assert.match(probesRoute, /publicContentSurfaceProbe/);
  assert.match(dispatchRoute, /\/probe\/public-content-surface/);
  assert.match(orchestrator, /public_content_surface/);
  assert.match(normalizer, /createPublicContentSurfaceLayerRecords/);
  assert.match(smoke, /public_content_surface/);

  const { publicContentSurfaceProbe } = await server.ssrLoadModule("/worker/probes/public-content-surface.ts");
  const { normalizeSiteScanProviderResults } = await server.ssrLoadModule("/src/providers/results/normalize.ts");
  const { createAnalysisReport } = await server.ssrLoadModule("/src/reporters/analysis.ts");
  const { createReportBrief } = await server.ssrLoadModule("/src/reporters/brief.ts");
  const { createAiNarrativeReportContract } = await server.ssrLoadModule("/src/providers/narrative-report/contract.ts");

  globalThis.fetch = async (request) => {
    const url = new URL(String(request));

    if (url.hostname !== "example.com" && url.hostname !== "docs.example.com") {
      throw new Error(`Unexpected off-target fetch: ${url.toString()}`);
    }

    if (url.hostname === "docs.example.com" && url.pathname === "/") {
      return html(`
        <title>Docs Host - Example</title>
        <h1>Developer documentation</h1><h2>API reference</h2>
      `);
    }

    if (url.pathname === "/robots.txt") {
      return new Response("Sitemap: https://example.com/sitemap.xml", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    if (url.pathname === "/sitemap.xml") {
      return new Response(
        "<urlset><url><loc>https://example.com/blog/launch</loc></url><url><loc>https://example.com/legal/privacy</loc></url></urlset>",
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    }

    if (url.pathname === "/") {
      return html(`
        <title>Example AI Platform</title>
        <meta name="description" content="Example helps teams build and operate AI products.">
        <link rel="canonical" href="https://example.com/">
        <nav>
          <a href="/products">Products</a>
          <a href="/pricing">Pricing</a>
          <a href="/docs">Docs</a>
          <a href="/support">Support</a>
        </nav>
        <script type="application/ld+json">{"@type":"Organization","name":"Example"}</script>
        <h1>Build AI products faster</h1>
      `);
    }

    if (url.pathname === "/products") {
      return html(`
        <title>Products - Example</title>
        <meta name="description" content="Product suite for AI workflow automation and model operations.">
        <h1>Products</h1><h2>Workflow automation</h2>
      `);
    }

    if (url.pathname === "/pricing") {
      return html(`
        <title>Pricing - Example</title>
        <meta name="description" content="Plans for startups and enterprise teams.">
        <h1>Pricing</h1><h2>Enterprise plans</h2>
      `);
    }

    if (url.pathname === "/docs") {
      return html(`
        <title>Documentation - Example</title>
        <h1>Developer documentation</h1><h2>API reference</h2>
      `);
    }

    if (url.pathname === "/support") {
      return html(`
        <title>Support - Example</title>
        <h1>Help center</h1><h2>Contact support</h2>
      `);
    }

    if (url.pathname === "/blog/launch") {
      return html(`
        <title>Launch Notes - Example</title>
        <h1>Launch notes</h1><p>New release information for customers.</p>
      `);
    }

    if (url.pathname === "/legal/privacy") {
      return html(`
        <title>Privacy - Example</title>
        <h1>Privacy policy</h1>
      `);
    }

    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  };

  const result = await publicContentSurfaceProbe("https://example.com", { maxPages: 6, maxCandidateUrls: 12 });
  assert.equal(result.provider_id, "cloudflare_worker_public_content_surface");
  assert.equal(result.limits.max_pages, 6);
  assert.ok(result.candidate_urls.length >= 5);
  assert.ok(result.surfaces.some((surface) => surface.path === "/" && surface.classification.label === "homepage"));
  assert.ok(result.surfaces.some((surface) => surface.path === "/products" && surface.classification.controlled_hint === "product"));
  assert.ok(result.surfaces.some((surface) => surface.path === "/pricing" && surface.classification.controlled_hint === "commercial"));
  assert.ok(result.surfaces.some((surface) => surface.path === "/docs" && surface.classification.controlled_hint === "technical_documentation"));
  assert.ok(result.surfaces.every((surface) => !("html_sample" in surface)));

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
      sync_probes: ["public_content_surface"],
      async_providers: [],
      sync_results: {
        public_content_surface: { status: "fulfilled", result },
      },
      async_jobs: [],
      coverage: { collected: ["public_content_surface"], pending: [], failed: [], limitations: [] },
    },
  });

  const surfaceRecord = records.find((record) => record.probe === "public_content_surface_probe");
  const businessRecord = records.find((record) => record.probe === "public_business_content_probe");
  assert.ok(surfaceRecord, "public_content_surface should normalize into a Layer 4 content surface record.");
  assert.ok(businessRecord, "public_content_surface should normalize into a Layer 9 business content record.");
  assert.equal(surfaceRecord.layer, 4);
  assert.equal(businessRecord.layer, 9);
  assert.ok(surfaceRecord.risk.summary.includes("bounded public content surface"));
  assert.ok(businessRecord.risk.summary.includes("business/product text snippets"));
  assert.ok(JSON.stringify(businessRecord.evidence).includes("Workflow automation"));

  const run = {
    id: "public-content-surface-fixture",
    target: "https://example.com",
    normalizedTarget: "example.com",
    createdAt: "2026-05-23T00:00:00.000Z",
    source: "provider",
    records,
  };
  const analysis = createAnalysisReport(run);
  const brief = createReportBrief(run, analysis);
  const contract = createAiNarrativeReportContract(brief);
  const publicIa = contract.output_contract.section_guidance.find((section) => section.id === "public_information_architecture");
  const orgOps = contract.output_contract.section_guidance.find((section) => section.id === "organization_operations");

  assert.ok(publicIa?.evidence_ref_hints.some((ref) => ref.startsWith("E")));
  assert.ok(orgOps?.evidence_ref_hints.some((ref) => ref.startsWith("E")));
  assert.ok(publicIa?.fact_hints.some((hint) => hint.includes("Public content surface map")));
  assert.ok(orgOps?.fact_hints.some((hint) => hint.includes("Public business/product content")));

  console.log("public content surface probe module check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

function html(body) {
  return new Response(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

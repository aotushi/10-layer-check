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
  const contract = readFileSync(new URL("../src/providers/narrative-report/contract.ts", import.meta.url), "utf8");
  const smoke = readFileSync(new URL("../tools/smoke-persisted-selected-full-ai-report-remote.mjs", import.meta.url), "utf8");

  assert.match(probesRoute, /publicContentDetailProbe/);
  assert.match(dispatchRoute, /\/probe\/public-content-detail/);
  assert.match(orchestrator, /public_content_detail/);
  assert.match(normalizer, /createPublicContentDetailLayerRecords/);
  assert.match(contract, /public_product_business_detail_probe/);
  assert.match(smoke, /public_content_detail/);

  const { publicContentDetailProbe } = await server.ssrLoadModule("/worker/probes/public-content-detail.ts");
  const { normalizeSiteScanProviderResults } = await server.ssrLoadModule("/src/providers/results/normalize.ts");
  const { createAnalysisReport } = await server.ssrLoadModule("/src/reporters/analysis.ts");
  const { createReportBrief } = await server.ssrLoadModule("/src/reporters/brief.ts");
  const { createAiNarrativeReportContract } = await server.ssrLoadModule("/src/providers/narrative-report/contract.ts");

  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    if (url.hostname !== "example.com" && url.hostname !== "docs.example.com" && url.hostname !== "blog.example.com") {
      throw new Error(`Unexpected off-target fetch: ${url.toString()}`);
    }

    if (url.hostname === "docs.example.com" && url.pathname === "/") {
      return html(`
        <title>Docs - Example</title>
        <h1>Documentation</h1>
        <a href="/guides/vendor-onboarding">Vendor onboarding guide</a>
        <a href="/reference/api">API reference</a>
      `);
    }

    if (url.hostname === "docs.example.com" && url.pathname === "/guides/vendor-onboarding") {
      return html(`
        <title>Vendor onboarding guide - Example Docs</title>
        <meta name="description" content="Guide for vendors connecting catalog, billing, and order automation to Example.">
        <script type="application/ld+json">{"@type":"TechArticle","headline":"Vendor onboarding guide"}</script>
        <h1>Vendor onboarding guide</h1>
        <h2>Connect catalog and billing workflows</h2>
        <p>Example helps vendors publish products, automate fulfillment, and connect billing workflows through public APIs.</p>
      `);
    }

    if (url.hostname === "blog.example.com" && url.pathname === "/") {
      return html(`
        <title>Example Blog</title>
        <h1>Blog</h1>
        <a href="/launch/vendor-platform">Introducing the vendor platform</a>
      `);
    }

    if (url.hostname === "blog.example.com" && url.pathname === "/launch/vendor-platform") {
      return html(`
        <title>Introducing the vendor platform - Example Blog</title>
        <meta property="article:published_time" content="2026-04-01T00:00:00Z">
        <script type="application/ld+json">{"@type":"BlogPosting","headline":"Introducing the vendor platform"}</script>
        <h1>Introducing the vendor platform</h1>
        <p>The platform gives merchants dashboards for product listings, revenue reporting, and customer support operations.</p>
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
        "<urlset><url><loc>https://example.com/product/platform</loc></url><url><loc>https://example.com/legal/privacy</loc></url></urlset>",
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    }

    if (url.hostname === "example.com" && url.pathname === "/") {
      return html(`
        <title>Example Vendor Platform</title>
        <meta name="description" content="Example is a platform for vendors, merchants, and automation teams.">
        <a href="https://docs.example.com/">Docs</a>
        <a href="https://blog.example.com/">Blog</a>
        <a href="/product/platform">Platform</a>
        <h1>Operate vendor workflows</h1>
      `);
    }

    if (url.hostname === "example.com" && url.pathname === "/product/platform") {
      return html(`
        <title>Platform - Example</title>
        <meta name="description" content="Product pages explain vendor catalog, billing, and workflow automation.">
        <h1>Vendor platform</h1>
        <h2>Catalog automation</h2>
        <p>Public product content describes merchant operations, vendor analytics, and integrations.</p>
      `);
    }

    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  };

  const result = await publicContentDetailProbe("https://example.com", {
    maxSeedPages: 4,
    maxCandidateUrls: 16,
    maxDetailPages: 5,
  });
  assert.equal(result.provider_id, "cloudflare_worker_public_content_detail");
  assert.equal(result.limits.max_seed_pages, 4);
  assert.equal(result.limits.max_detail_pages, 5);
  assert.ok(result.candidate_urls.length >= 2);
  assert.ok(result.detail_pages.some((page) => page.detail_kind === "documentation"));
  assert.ok(result.detail_pages.some((page) => page.detail_kind === "article"));
  assert.ok(result.detail_pages.some((page) => page.classification.controlled_hint === "product"));
  assert.ok(JSON.stringify(result.detail_pages).includes("Vendor onboarding guide"));
  assert.ok(result.detail_pages.every((page) => !("html_sample" in page)));

  const records = normalizeSiteScanProviderResults({
    target: "https://example.com",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-24T00:00:00.000Z",
    providers: [],
    scanStartEnvelope: {
      schema_version: "site-10-layer-scan-start/v0.1",
      provider: "cloudflare_worker_site_scan",
      requested_url: "https://example.com",
      normalized_url: "https://example.com/",
      normalized_target: "example.com",
      status: "ok",
      sync_probes: ["public_content_detail"],
      async_providers: [],
      sync_results: {
        public_content_detail: { status: "fulfilled", result },
      },
      async_jobs: [],
      coverage: { collected: ["public_content_detail"], pending: [], failed: [], limitations: [] },
    },
  });

  const detailRecord = records.find((record) => record.probe === "public_content_detail_probe");
  const productRecord = records.find((record) => record.probe === "public_product_business_detail_probe");
  assert.ok(detailRecord, "public_content_detail should normalize into a Layer 4 detail record.");
  assert.ok(productRecord, "public_content_detail should normalize into a Layer 9 product/business detail record.");
  assert.equal(detailRecord.layer, 4);
  assert.equal(productRecord.layer, 9);
  assert.ok(detailRecord.risk.summary.includes("bounded public content detail page"));
  assert.ok(productRecord.risk.summary.includes("product/business detail snippets"));
  assert.ok(JSON.stringify(productRecord.evidence).includes("vendor platform"));

  const run = {
    id: "public-content-detail-fixture",
    target: "https://example.com",
    normalizedTarget: "example.com",
    createdAt: "2026-05-24T00:00:00.000Z",
    source: "provider",
    records,
  };
  const analysis = createAnalysisReport(run);
  const brief = createReportBrief(run, analysis);
  const narrativeContract = createAiNarrativeReportContract(brief);
  const publicIa = narrativeContract.output_contract.section_guidance.find((section) => section.id === "public_information_architecture");
  const orgOps = narrativeContract.output_contract.section_guidance.find((section) => section.id === "organization_operations");

  assert.ok(publicIa?.fact_hints.some((hint) => hint.includes("Public content detail map")));
  assert.ok(orgOps?.fact_hints.some((hint) => hint.includes("Public product/business detail")));
  assert.ok(
    orgOps?.fact_hints.some((hint) => hint.includes("Observed operation topics: supplier/vendor onboarding")),
    "Organization operations facts should summarize product/business detail pages as readable operation topics.",
  );
  assert.ok(
    orgOps?.fact_hints.some((hint) => hint.includes("Evidence pages:")),
    "Organization operations facts should preserve readable public detail page evidence.",
  );

  console.log("public content detail probe module check passed.");
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

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

  assert.match(probesRoute, /publicSpaMetadataProbe/);
  assert.match(dispatchRoute, /\/probe\/public-spa-metadata/);
  assert.match(orchestrator, /public_spa_metadata/);
  assert.match(normalizer, /createPublicSpaMetadataLayerRecords/);
  assert.match(smoke, /public_spa_metadata/);

  const { publicSpaMetadataProbe } = await server.ssrLoadModule("/worker/probes/public-spa-metadata.ts");
  const { normalizeSiteScanProviderResults } = await server.ssrLoadModule("/src/providers/results/normalize.ts");
  const { createAnalysisReport } = await server.ssrLoadModule("/src/reporters/analysis.ts");
  const { createReportBrief } = await server.ssrLoadModule("/src/reporters/brief.ts");
  const { createAiNarrativeReportContract } = await server.ssrLoadModule("/src/providers/narrative-report/contract.ts");

  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    if (url.hostname !== "example.com") {
      throw new Error(`Unexpected off-target fetch: ${url.toString()}`);
    }

    if (url.pathname === "/") {
      return html(`
        <title>Example App</title>
        <div id="root"></div>
        <script type="module" crossorigin src="/assets/index-AbCdEf12.js"></script>
        <link rel="stylesheet" href="/assets/index-a1b2c3.css">
      `);
    }

    if (url.pathname === "/assets/index-AbCdEf12.js") {
      return javascript(`
        const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/vendor-Qwer1234.js","assets/ProfilePage-AaBb.js","assets/VendorPanel-CcDd.js","assets/settings-payment-Zz99.js"])))=>i.map(i=>d[i]);
        Symbol.for("react.element"); Symbol.for("react.fragment");
        import("/assets/ProfilePage-AaBb.js");
        import("/assets/settings-payment-Zz99.js");
        const routes=[{path:"/login",element:"LoginPage"},{path:"/signup",element:"SignupPage"},{path:"/pricing",element:"PricingPage"},{path:"/vendor/revenue",element:"VendorRevenuePage"}];
        function DashboardPanel(){} function VendorPanel(){} function Terms(){} function Privacy(){}
        const BrowserRouter = "react-router BrowserRouter useNavigate";
      `);
    }

    if (url.pathname === "/assets/settings-payment-Zz99.js") {
      return javascript(`
        export const routes=[{path:"/setting",element:"SettingPage"}];
        const api="/setting/payment/withdraw_methods";
      `);
    }

    if (url.pathname === "/assets/index-a1b2c3.css") {
      return new Response("body{font-family:Inter}", {
        status: 200,
        headers: { "content-type": "text/css; charset=utf-8" },
      });
    }

    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  };

  const result = await publicSpaMetadataProbe("https://example.com", { maxAssetPreviews: 3 });
  assert.equal(result.provider_id, "cloudflare_worker_public_spa_metadata");
  assert.equal(result.limits.max_asset_previews, 3);
  assert.equal(result.limits.max_referenced_asset_previews, 40);
  assert.ok(result.html_shell.root_containers.includes("root"));
  assert.equal(result.html_shell.rendering_assessment.mode, "csr_candidate");
  assert.ok(result.declared_assets.some((asset) => asset.path === "/assets/index-AbCdEf12.js"));
  assert.ok(result.fetched_asset_previews.some((preview) => preview.signals.includes("vite_map_deps")));
  assert.ok(result.detected_signals.some((signal) => signal.label === "React"));
  assert.ok(result.detected_signals.some((signal) => signal.label.includes("Vite")));
  assert.ok(result.detected_signals.some((signal) => signal.label.includes("React Router")));
  assert.ok(result.route_candidates.some((route) => route.value === "/vendor/revenue"));
  assert.ok(
    result.route_candidates.some((route) => route.value === "/setting/payment"),
    "public SPA metadata should derive bounded parent route hints from same-origin chunk API-like paths.",
  );
  assert.ok(
    result.fetched_asset_previews.some((preview) => preview.path === "/assets/settings-payment-Zz99.js"),
    "public SPA metadata should preview selected same-origin referenced chunks.",
  );
  assert.ok(result.component_candidates.some((component) => component.value === "DashboardPanel"));

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
      sync_probes: ["public_spa_metadata"],
      async_providers: [],
      sync_results: {
        public_spa_metadata: { status: "fulfilled", result },
      },
      async_jobs: [],
      coverage: { collected: ["public_spa_metadata"], pending: [], failed: [], limitations: [] },
    },
  });

  const assetRecord = records.find((record) => record.probe === "public_spa_asset_metadata_probe");
  const routeRecord = records.find((record) => record.probe === "public_spa_route_metadata_probe");
  assert.ok(assetRecord, "public_spa_metadata should normalize into a Layer 4 SPA asset metadata record.");
  assert.ok(routeRecord, "public_spa_metadata should normalize into a Layer 4 SPA route metadata record.");
  assert.equal(assetRecord.layer, 4);
  assert.equal(routeRecord.layer, 4);
  assert.ok(assetRecord.risk.summary.includes("SPA asset metadata"));
  assert.ok(routeRecord.risk.summary.includes("route-like string"));

  const run = {
    id: "public-spa-metadata-fixture",
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
  const tech = contract.output_contract.section_guidance.find((section) => section.id === "technology_stack");

  assert.ok(publicIa?.fact_hints.some((hint) => hint.includes("Public SPA route metadata")));
  assert.ok(tech?.fact_hints.some((hint) => hint.includes("Public SPA asset metadata")));

  console.log("public SPA metadata probe module check passed.");
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

function javascript(body) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/javascript; charset=utf-8" },
  });
}

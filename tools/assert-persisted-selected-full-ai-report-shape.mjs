#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

class FakeKvNamespace {
  #values = new Map();

  async get(key) {
    return this.#values.get(key) ?? null;
  }

  async put(key, value) {
    this.#values.set(key, value);
  }

  async delete(key) {
    this.#values.delete(key);
  }
}

try {
  const { createAnalysisReport } = await server.ssrLoadModule("/src/reporters/analysis.ts");
  const { createReportBrief } = await server.ssrLoadModule("/src/reporters/brief.ts");
  const { createAiNarrativeReportContract } = await server.ssrLoadModule(
    "/src/providers/narrative-report/contract.ts",
  );
  const { runWorkerAiNarrativeReportProvider } = await server.ssrLoadModule(
    "/src/providers/narrative-report/worker-adapter.ts",
  );
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");

  const run = createFullSelectedFixtureRun();
  const analysis = createAnalysisReport(run);
  const brief = createReportBrief(run, analysis);
  const contract = createAiNarrativeReportContract(brief);

  assert.deepEqual(analysis.coverage.collected_layers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(brief.missing_data.length > 0, "Full selected fixture should expose explicit missing-data boundaries.");
  assert.ok(
    brief.missing_data.some((item) => item.classification === "add_provider"),
    "Fixture should expose at least one add_provider gap.",
  );
  assert.ok(
    contract.output_contract.required_section_ids.includes("security_posture"),
    "Security posture must be required when Layer 10 evidence is present.",
  );
  assert.ok(
    contract.output_contract.required_section_ids.includes("missing_data_next_steps"),
    "Missing Data and Next Steps must be required when missing_data refs are present.",
  );
  assertConcreteFactHints(contract);
  assertSectionGuidancePlacement(contract);

  const fullReport = await runWorkerAiNarrativeReportProvider(
    contract,
    { AI_PROVIDER_API_KEY: "test-key", AI_PROVIDER_MODEL: "test-model" },
    { modelClient: async () => createSparseModelOutput(contract) },
  );
  assert.equal(fullReport.ok, true);
  const markdown = fullReport.result.markdown;

  assertExpectedSectionHeadings(markdown);
  assert.ok(!markdown.includes("undefined"), "Generated Markdown must not contain undefined text.");
  assert.ok(!markdown.includes("Current evidence highlights"), "Generated Markdown should not repeat generic fact-pack labels.");
  assertConcreteFacts(markdown);
  assertMarkdownPlacement(markdown);
  assertSectionDensityShape(markdown);
  assertSectionCitationShape(markdown);
  assertKnownRefs(markdown, brief);

  await assertPersistedJsonAndMarkdownShareAiResult(worker);

  console.log("persisted selected full AI report shape check passed.");
} finally {
  await server.close();
}

function createSparseModelOutput(contract) {
  const evidenceRef = contract.input.brief.evidence_index[0]?.id ?? "E001";
  const missingRef = contract.input.brief.missing_data[0]?.id;

  return {
    sections: [
      {
        id: "summary",
        title: "Public Information Architecture",
        content:
          "## Executive Summary\n\nThe selected full fixture has collected evidence across all ten layers and leaves explicit missing-data boundaries.",
        evidence_refs: [evidenceRef],
        missing_data_refs: missingRef ? [missingRef] : [],
        limitations: ["Generated from bounded local fixture evidence."],
      },
    ],
    markdown: "",
  };
}

async function assertPersistedJsonAndMarkdownShareAiResult(worker) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url === "https://example.com/") {
      return new Response("<!doctype html><title>Example Domain</title>", {
        status: 200,
        headers: { "content-type": "text/html", server: "example" },
      });
    }
    if (url === "https://example.com/robots.txt" || url === "https://example.com/sitemap.xml") {
      return new Response("", { status: 404 });
    }
    throw new Error(`Unexpected fetch in persisted AI report shape check: ${url}`);
  };

  try {
    let aiCallCount = 0;
    const env = {
      ALLOW_LOCAL_DEV_NO_AUTH: "true",
      SCAN_JOB_KV: new FakeKvNamespace(),
      SCAN_JOB_TTL_SECONDS: "3600",
      AI_PROVIDER_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
      AI: {
        run: async (_model, input) => {
          aiCallCount += 1;
          return { response: JSON.stringify(createWorkerModelOutput(input)) };
        },
      },
    };

    const start = await worker.default.fetch(
      new Request("http://worker.local/scan/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "https://example.com", sync_probes: ["remote_fetch"], async_providers: [] }),
      }),
      env,
    );
    const startBody = await start.json();
    const jobId = startBody.job?.id;
    assert.equal(start.status, 200);
    assert.ok(jobId, "Persisted job start should return a job id.");

    const jsonReport = await worker.default.fetch(
      new Request(`http://worker.local/scan/jobs/${encodeURIComponent(jobId)}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
    );
    const jsonBody = await jsonReport.json();
    assert.equal(jsonReport.status, 200);
    assert.equal(jsonBody.ai_report_cache?.hit, false);

    const markdownReport = await worker.default.fetch(
      new Request(`http://worker.local/scan/jobs/${encodeURIComponent(jobId)}/report.md`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
    );
    const directMarkdown = await markdownReport.text();
    assert.equal(markdownReport.status, 200);
    assert.ok(markdownReport.headers.get("content-type")?.includes("text/markdown"));
    assert.equal(directMarkdown, jsonBody.ai_narrative_report.markdown);
    assert.equal(aiCallCount, 1, "Persisted JSON and direct Markdown reports should share one AI invocation.");

    const cachedJsonReport = await worker.default.fetch(
      new Request(`http://worker.local/scan/jobs/${encodeURIComponent(jobId)}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
    );
    const cachedJsonBody = await cachedJsonReport.json();
    assert.equal(cachedJsonReport.status, 200);
    assert.equal(cachedJsonBody.ai_report_cache?.hit, true);
    assert.equal(cachedJsonBody.ai_narrative_report.markdown, directMarkdown);
    assert.equal(aiCallCount, 1, "Cached persisted JSON report should not invoke AI again.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function createWorkerModelOutput(input) {
  const contract = JSON.parse(input.messages[1].content);
  const evidenceRef = contract.input.brief.evidence_index[0]?.id ?? "E001";
  const missingRef = contract.input.brief.missing_data[0]?.id;

  return {
    sections: [
      {
        id: "summary",
        title: "Public Information Architecture",
        content:
          "## Executive Summary\n\nThe persisted report route generated one validated AI report for the stored deterministic artifact.",
        evidence_refs: [evidenceRef],
        missing_data_refs: missingRef ? [missingRef] : [],
        limitations: ["Generated from bounded persisted job evidence."],
      },
    ],
    markdown: "",
  };
}

function assertKnownRefs(markdown, brief) {
  const evidenceRefs = new Set(brief.evidence_index.map((item) => item.id));
  const missingRefs = new Set(brief.missing_data.map((item) => item.id));

  for (const ref of markdown.matchAll(/\[(E\d{3})\]/g)) {
    assert.ok(evidenceRefs.has(ref[1]), `Markdown cites unknown evidence ref ${ref[1]}.`);
  }
  for (const ref of markdown.matchAll(/\[(M\d{3})\]/g)) {
    assert.ok(missingRefs.has(ref[1]), `Markdown cites unknown missing-data ref ${ref[1]}.`);
  }
}

function assertExpectedSectionHeadings(markdown) {
  const headings = Array.from(markdown.matchAll(/^## ([^\n]+)$/gm)).map((match) => match[1]);
  for (const expected of [
    "Executive Summary",
    "Public Information Architecture",
    "Technology Stack",
    "Deployment and Network Surface",
    "Request and Rendering Chain",
    "API and Protocol Surface",
    "Subdomains and Attack Surface",
    "Organization and Operations Signals",
    "Security Posture",
    "Missing Data and Next Steps",
  ]) {
    assert.equal(
      headings.filter((heading) => heading === expected).length,
      1,
      `Expected generated Markdown to include exactly one ${expected} section.`,
    );
  }
}

function assertConcreteFactHints(contract) {
  const factHints = contract.output_contract.section_guidance.flatMap((section) => section.fact_hints ?? []);
  for (const expected of [
    "Next.js",
    "0.91",
    "Example CA",
    "content-security-policy",
    "rdap",
    "larksuite",
    "CORS",
    "Cookie",
    "Subdomain/reachability matrix",
    "/v1/models",
    "wordpress_name",
  ]) {
    if (!factHints.some((hint) => hint.toLowerCase().includes(expected.toLowerCase())) && process.env.DEBUG_FACT_HINTS) {
      console.log(factHints.join("\n---\n"));
    }
    assert.ok(
      factHints.some((hint) => hint.toLowerCase().includes(expected.toLowerCase())),
      `Expected section fact hints to include ${expected}.`,
    );
  }
  if (factHints.some((hint) => hint.includes("Evidence values:"))) {
    throw new Error("Section fact hints should be human-readable summaries, not raw evidence value dumps.");
  }
}

function assertSectionGuidancePlacement(contract) {
  const byId = new Map(contract.input.brief.evidence_index.map((item) => [item.id, item]));
  const section = (id) => contract.output_contract.section_guidance.find((item) => item.id === id);
  const probes = (id) => (section(id)?.evidence_ref_hints ?? []).map((ref) => byId.get(ref)?.probe).filter(Boolean);
  const facts = (id) => (section(id)?.fact_hints ?? []).join("\n").toLowerCase();

  for (const blocked of [
    "bounded_cors_header_validation_probe",
    "bounded_public_api_error_surface_probe",
    "bounded_public_metadata_probe",
    "bounded_cookie_attribute_observation_probe",
  ]) {
    assert.ok(
      !probes("public_information_architecture").includes(blocked),
      `Public IA should not receive detailed public-security probe ${blocked}.`,
    );
  }

  assert.ok(
    probes("api_protocol_surface").includes("bounded_cors_header_validation_probe"),
    "API section should receive bounded CORS evidence.",
  );
  assert.ok(
    probes("api_protocol_surface").includes("bounded_public_api_error_surface_probe"),
    "API section should receive bounded public API evidence.",
  );
  assert.ok(
    probes("technology_stack").includes("bounded_public_metadata_probe"),
    "Technology section should receive bounded public metadata evidence.",
  );
  assert.ok(
    probes("security_posture").includes("bounded_cookie_attribute_observation_probe"),
    "Security section should receive bounded cookie evidence.",
  );
  assert.ok(facts("api_protocol_surface").includes("/v1/models"), "API facts should include concrete endpoint paths.");
  assert.ok(facts("technology_stack").includes("wordpress_name"), "Technology facts should include parsed WordPress metadata.");
  assert.ok(facts("security_posture").includes("set-cookie"), "Security facts should include cookie observations.");
}

function assertMarkdownPlacement(markdown) {
  const publicIa = sectionText(markdown, "Public Information Architecture").toLowerCase();
  const technology = sectionText(markdown, "Technology Stack").toLowerCase();
  const api = sectionText(markdown, "API and Protocol Surface").toLowerCase();
  const security = sectionText(markdown, "Security Posture").toLowerCase();

  for (const misplaced of ["access-control", "set-cookie", "wordpress_name", "mintlify", "wp-json"]) {
    assert.ok(!publicIa.includes(misplaced), `Public IA should not carry detailed ${misplaced} facts.`);
  }
  assert.ok(api.includes("cors") || api.includes("access-control"), "API section should carry CORS/API protocol facts.");
  assert.ok(api.includes("/v1/models") || api.includes("/health"), "API section should carry bounded API endpoint paths.");
  assert.ok(technology.includes("wordpress") || technology.includes("discourse") || technology.includes("mintlify"));
  assert.ok(security.includes("set-cookie") || security.includes("cookie"));
}

function assertSectionDensityShape(markdown) {
  const publicIa = sectionText(markdown, "Public Information Architecture");
  const summary = sectionText(markdown, "Executive Summary");
  const technology = sectionText(markdown, "Technology Stack");
  const deployment = sectionText(markdown, "Deployment and Network Surface");
  const rendering = sectionText(markdown, "Request and Rendering Chain");
  const api = sectionText(markdown, "API and Protocol Surface");
  const subdomains = sectionText(markdown, "Subdomains and Attack Surface");
  const security = sectionText(markdown, "Security Posture");
  const missingData = sectionText(markdown, "Missing Data and Next Steps");

  assert.ok(!summary.includes("Key evidence:"), "Summary should not keep duplicated Key evidence labels.");
  assert.ok(!publicIa.includes("Public map evidence:"), "Public IA should not keep dense Public map evidence labels.");
  assert.ok(!technology.includes("Technology evidence:"), "Technology section should not keep duplicated evidence labels.");
  assert.ok(!deployment.includes("Network evidence:"), "Deployment section should not keep duplicated evidence labels.");
  assert.ok(!rendering.includes("Rendering-chain evidence:"), "Rendering section should not keep duplicated evidence labels.");
  assert.ok(!api.includes("API/protocol evidence:"), "API section should not keep duplicated evidence labels.");
  assert.ok(!subdomains.includes("Subdomain evidence:"), "Subdomain section should not keep duplicated evidence labels.");
  assert.ok(!security.includes("Security evidence:"), "Security section should not keep duplicated evidence labels.");
  assert.ok(!missingData.includes("Gap examples:"), "Missing-data section should not keep dense Gap examples labels.");
  assert.ok(!/Boundaries:[^\n]*(Evidence:|status_code=|metric\(s\)|certificate\(s\))/i.test(markdown), "Boundaries should not contain fact-like evidence prose.");
  if (publicIa.includes("Public content detail map:") || publicIa.includes("Public content surface map:")) {
    assert.ok(
      publicIa.includes("\n\nPublic content detail map:") || publicIa.includes("\n\nPublic content surface map:"),
      "Public IA should split content maps into topical paragraphs.",
    );
  }
  if (summary.includes("Performance score") || summary.includes("Lighthouse performance score")) {
    assert.ok(
      summary.includes("\n\nPerformance score") || summary.includes("\n\nLighthouse performance score"),
      "Summary should split performance facts into topical paragraphs.",
    );
  }
  if (technology.includes("Public SPA asset metadata:")) {
    assert.ok(
      technology.includes("\n\nPublic SPA asset metadata:"),
      "Technology section should split public SPA metadata into a topical paragraph.",
    );
  }
  if (deployment.includes("CDN header signal(s) found:")) {
    assert.ok(
      deployment.includes("\n\nCDN header signal(s) found:"),
      "Deployment section should split CDN facts into a topical paragraph.",
    );
  }
  if (rendering.includes("Final response returned")) {
    assert.ok(
      rendering.includes("\n\nFinal response returned"),
      "Rendering section should split final-response facts into a topical paragraph.",
    );
  }
  if (api.includes("Bounded public API endpoint inventory:")) {
    assert.ok(
      api.includes("\n\nBounded public API endpoint inventory:"),
      "API section should split endpoint inventory into a topical paragraph.",
    );
  }
  if (subdomains.includes("Checked 6 bounded public host")) {
    assert.ok(
      subdomains.includes("\n\nChecked 6 bounded public host"),
      "Subdomain section should split bounded public host facts into a topical paragraph.",
    );
  }
  if (security.includes("Missing security headers:")) {
    assert.ok(
      security.includes("\n\nMissing security headers:"),
      "Security section should split security header facts into a topical paragraph.",
    );
  }
  if (missingData.includes("Gap groups:")) {
    assert.ok(
      missingData.startsWith("Gap groups:") || missingData.includes("\n\nGap groups:"),
      "Missing-data section should split grouped gaps into a topical paragraph.",
    );
  }
}

function assertSectionCitationShape(markdown) {
  const maxEvidenceRefs = {
    "Executive Summary": 6,
    "Public Information Architecture": 7,
    "Technology Stack": 7,
    "Deployment and Network Surface": 7,
    "Request and Rendering Chain": 6,
    "API and Protocol Surface": 6,
    "Subdomains and Attack Surface": 5,
    "Organization and Operations Signals": 7,
    "Security Posture": 6,
    "Missing Data and Next Steps": 0,
  };
  const maxMissingRefs = {
    "Executive Summary": 3,
    "Public Information Architecture": 4,
    "Technology Stack": 3,
    "Deployment and Network Surface": 3,
    "Request and Rendering Chain": 4,
    "API and Protocol Surface": 4,
    "Subdomains and Attack Surface": 4,
    "Organization and Operations Signals": 4,
    "Security Posture": 4,
    "Missing Data and Next Steps": 10,
  };

  for (const [heading, max] of Object.entries(maxEvidenceRefs)) {
    const refs = extractRefs(sectionText(markdown, heading), "E");
    assert.ok(refs.length <= max, `${heading} should cite at most ${max} evidence refs, got ${refs.length}.`);
  }
  for (const [heading, max] of Object.entries(maxMissingRefs)) {
    const refs = extractRefs(sectionText(markdown, heading), "M");
    assert.ok(refs.length <= max, `${heading} should cite at most ${max} missing-data refs, got ${refs.length}.`);
  }
}

function extractRefs(value, prefix) {
  return Array.from(new Set(Array.from(value.matchAll(new RegExp(`\\[(${prefix}\\d{3})\\]`, "g"))).map((match) => match[1])));
}

function sectionText(markdown, heading) {
  const marker = `## ${heading}\n\n`;
  const start = markdown.indexOf(marker);
  if (start < 0) return "";
  const rest = markdown.slice(start + marker.length);
  const next = rest.indexOf("\n\n## ");
  return next >= 0 ? rest.slice(0, next) : rest;
}

function assertConcreteFacts(markdown) {
  for (const expected of [
    "Next.js",
    "0.91",
    "Example CA",
    "content-security-policy",
    "add_provider",
    "larksuite",
    "CORS",
    "Cookie",
    "Subdomain/reachability matrix",
    "Gap groups:",
    "requires_permission",
    "manual_review",
    "out_of_scope",
  ]) {
    assert.ok(markdown.includes(expected), `Expected generated Markdown to surface concrete fact: ${expected}.`);
  }
  assert.ok(!markdown.includes("Evidence values:"), "Generated Markdown must not include raw evidence value dump labels.");
}

function createFullSelectedFixtureRun() {
  const target = "https://poixe.example/";
  const normalizedTarget = "poixe.example";
  const snapshotAt = "2026-05-23T00:00:00.000Z";

  return {
    id: "persisted-selected-full-ai-report-shape-fixture",
    target,
    normalizedTarget,
    createdAt: snapshotAt,
    source: "provider",
    records: [
      record(target, normalizedTarget, snapshotAt, {
        layer: 1,
        probe: "network_infrastructure_probe",
        item: "dns_and_cdn",
        source: "cloudflare_worker_dns_tls",
        summary: "DNS A/AAAA records and a low-confidence CDN signal were collected.",
        value: {
          ip_addresses: { ipv4: ["203.0.113.10"], ipv6: ["2001:db8::10"] },
          cdn: { detected: true, providers: ["cloudflare"], confidence: "low" },
          coverage: { collected: ["dns_records", "cdn_signal"], missing: [] },
        },
        evidence: [{ type: "dns", name: "a", value: "203.0.113.10" }],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 2,
        probe: "tls_live_certificate_probe",
        item: "live_certificate",
        source: "github-actions-live-tls",
        summary: "The live TLS certificate was collected and expires in 84 days.",
        value: {
          certificate: {
            issuer: { common_name: "Example CA" },
            valid_to: "2026-08-15T00:00:00Z",
            subject_alt_names: ["poixe.example", "www.poixe.example"],
          },
          days_until_expiry: 84,
          chain: [{ subject: "poixe.example" }],
          coverage: { collected: ["live_certificate_chain", "live_certificate_expiry"], missing: [] },
        },
        evidence: [{ type: "tls_certificate", name: "issuer", value: "Example CA" }],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 3,
        probe: "http_headers_probe",
        item: "main_response_headers",
        source: "cloudflare_worker_fetch",
        summary: "The main HTTP response returned HTML with Cloudflare and cache headers.",
        value: {
          status_code: 200,
          headers: { server: "cloudflare", "cache-control": "max-age=300", "cf-cache-status": "HIT" },
          coverage: { collected: ["status_code", "response_headers"], missing: [] },
        },
        evidence: [{ type: "http_header", name: "server", value: "cloudflare" }],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 4,
        probe: "browser_page_probe",
        item: "rendered_page",
        source: "github-actions-browser",
        summary: "Browser runtime loaded the page and captured rendered-page evidence.",
        value: {
          title: "Poixe Fixture",
          rendered_text_excerpt: "Poixe fixture page",
          resources: [{ url: "https://poixe.example/assets/app.js", type: "script" }],
          coverage: { collected: ["browser_render", "runtime_resources"], missing: ["authenticated_route_inventory"] },
        },
        evidence: [{ type: "browser_runtime", name: "title", value: "Poixe Fixture" }],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 5,
        probe: "performance_probe",
        item: "pagespeed_mobile",
        source: "pagespeed_api",
        summary: "PageSpeed returned Lighthouse and CrUX performance evidence.",
        value: {
          performance_score: 0.91,
          metrics: [{ id: "largest-contentful-paint", value: 1340, unit: "ms", rating: "good" }],
          raw_summary: { field_data: { available: true } },
          coverage: {
            collected: ["lighthouse_lab_metrics", "crux_field_data"],
            missing: ["webpagetest_waterfall", "multi_location_performance"],
          },
        },
        evidence: [{ type: "performance_metric", name: "performance_score", value: 0.91 }],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 6,
        probe: "runtime_api_requests_probe",
        item: "observed_api_requests",
        source: "github-actions-browser",
        summary: "The browser runtime observed one API-like request.",
        value: {
          api_like_requests: [{ url: "https://poixe.example/api/status", method: "GET", status: 200 }],
          coverage: { collected: ["runtime_api_requests"], missing: ["authenticated_api_behavior"] },
        },
        evidence: [{ type: "api_request", name: "GET", value: "https://poixe.example/api/status" }],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 6,
        probe: "cors_policy_probe",
        item: "cors_policy",
        source: "cloudflare_worker_api_reachability",
        summary: "CORS policy review found no Access-Control-Allow-Origin header on the main response.",
        value: {
          access_control_allow_origin: null,
          access_control_allow_credentials: null,
          coverage: { collected: ["cors_headers"], missing: ["cors_exploit_validation"] },
        },
        evidence: [{ type: "cors_header", name: "access-control-allow-origin", value: "not present" }],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 6,
        probe: "bounded_cors_header_validation_probe",
        item: "bounded_cors_checks",
        source: "cloudflare_worker_public_security_details",
        status: "warning",
        riskLevel: "medium",
        summary: "Observed CORS response header signal(s) on 2 bounded public check(s).",
        value: {
          checks: [
            {
              host: "api.poixe.example",
              method: "GET",
              path: "/v1/models",
              status_code: 200,
              signals: ["access_control_allow_origin_reflects_probe_origin", "access_control_allow_credentials_true"],
            },
            {
              host: "api.poixe.example",
              method: "OPTIONS",
              path: "/v1/models",
              status_code: 204,
              signals: ["access_control_allow_headers_authorization"],
            },
          ],
          limits: { max_hosts: 6, checked_hosts: 6, max_requests_per_host: 5, max_concurrency: 3 },
          coverage: { collected: ["bounded_cors_header_validation"], missing: ["authenticated_cors_behavior"] },
        },
        evidence: [
          {
            type: "bounded_cors_checks",
            name: "bounded_cors_checks",
            value: [
              {
                host: "api.poixe.example",
                method: "GET",
                path: "/v1/models",
                status_code: 200,
                signals: ["access_control_allow_origin_reflects_probe_origin", "access_control_allow_credentials_true"],
              },
              {
                host: "api.poixe.example",
                method: "OPTIONS",
                path: "/v1/models",
                status_code: 204,
                signals: ["access_control_allow_headers_authorization"],
              },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 6,
        probe: "bounded_public_api_error_surface_probe",
        item: "bounded_public_api_checks",
        source: "cloudflare_worker_public_security_details",
        summary: "Checked 2 bounded public API endpoint(s); 0 exposed error/request-id signal(s).",
        value: {
          checks: [
            { host: "api.poixe.example", method: "GET", path: "/health", status_code: 200, signals: [] },
            { host: "api.poixe.example", method: "GET", path: "/v1/models", status_code: 200, signals: [] },
          ],
          limits: { max_hosts: 6, checked_hosts: 6, max_requests_per_host: 5, max_concurrency: 3 },
          coverage: { collected: ["bounded_public_api_error_surface"], missing: ["authenticated_api_behavior"] },
        },
        evidence: [
          {
            type: "bounded_public_api_checks",
            name: "bounded_public_api_checks",
            value: [
              { host: "api.poixe.example", method: "GET", path: "/health", status_code: 200, signals: [] },
              { host: "api.poixe.example", method: "GET", path: "/v1/models", status_code: 200, signals: [] },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 7,
        probe: "subdomain_attack_surface_probe",
        item: "ct_subdomains",
        source: "cloudflare_worker_dns_tls",
        summary: "CT logs exposed one subdomain candidate and bounded reachability was checked.",
        value: {
          discovered_subdomains: [{ host: "admin.poixe.example", source: "ct_log" }],
          reachability: [{ host: "admin.poixe.example", https_status_code: 200 }],
          coverage: { collected: ["ct_subdomain_candidates", "bounded_https_reachability"], missing: ["deep_service_inventory"] },
        },
        evidence: [{ type: "subdomain", name: "ct_log", value: "admin.poixe.example" }],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 8,
        probe: "frontend_technology_probe",
        item: "technology_candidates",
        source: "cloudflare_worker_fetch",
        summary: "Static HTML exposed Next.js and script bundle technology candidates.",
        value: {
          candidates: [{ name: "Next.js", confidence: "medium", evidence: "meta generator" }],
          coverage: { collected: ["static_technology_candidates"], missing: ["runtime_framework_confirmation"] },
        },
        evidence: [{ type: "technology", name: "frontend", value: "Next.js" }],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 8,
        probe: "bounded_public_metadata_probe",
        item: "bounded_public_metadata",
        source: "cloudflare_worker_public_security_details",
        summary: "Collected bounded public metadata from WordPress, Discourse, and Mintlify-like endpoints.",
        value: {
          checks: [
            {
              host: "blog.poixe.example",
              method: "GET",
              path: "/wp-json/",
              status_code: 200,
              parsed: {
                wordpress_name: "Poixe Blog",
                wordpress_timezone: "Asia/Shanghai",
                wordpress_namespaces: ["oembed/1.0", "wp/v2"],
              },
            },
            {
              host: "community.poixe.example",
              method: "GET",
              path: "/latest.json",
              status_code: 200,
              parsed: { x_discourse_route: "list/latest", x_discourse_cached: "skip" },
            },
            {
              host: "docs.poixe.example",
              method: "HEAD",
              path: "/",
              status_code: 308,
              parsed: { x_mint_proxy_version: "1.0.0-prod", x_mintlify_client_version: "0.0.2934" },
            },
          ],
          coverage: { collected: ["bounded_public_cms_metadata"], missing: ["wordpress_user_enumeration"] },
        },
        evidence: [
          {
            type: "bounded_public_metadata_checks",
            name: "bounded_public_metadata_checks",
            value: [
              {
                host: "blog.poixe.example",
                method: "GET",
                path: "/wp-json/",
                status_code: 200,
                parsed: {
                  wordpress_name: "Poixe Blog",
                  wordpress_timezone: "Asia/Shanghai",
                  wordpress_namespaces: ["oembed/1.0", "wp/v2"],
                },
              },
              {
                host: "community.poixe.example",
                method: "GET",
                path: "/latest.json",
                status_code: 200,
                parsed: { x_discourse_route: "list/latest", x_discourse_cached: "skip" },
              },
              {
                host: "docs.poixe.example",
                method: "HEAD",
                path: "/",
                status_code: 308,
                parsed: { x_mint_proxy_version: "1.0.0-prod", x_mintlify_client_version: "0.0.2934" },
              },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 9,
        probe: "organization_intelligence_probe",
        item: "rdap_wayback_dns",
        source: "cloudflare_worker_org_intel",
        summary: "Organization-facing DNS, RDAP, and Wayback signals were collected.",
        value: {
          dns: { mx: ["10 mx1.larksuite.com"], txt: ["v=spf1 include:spf.onlarksuite.com -all"] },
          external_intelligence: {
            whois: { status: "rdap_collected", registrar: "Example Registrar" },
            wayback: { status: "wayback_collected", snapshot_count_estimate: 12 },
            icp: { status: "not_collected", reason: "ICP lookup is out of scope." },
          },
          coverage: { collected: ["rdap", "wayback", "mail_dns"], missing: ["manual_related_domain_confirmation"] },
        },
        evidence: [
          { type: "rdap", name: "registrar", value: "Example Registrar" },
          { type: "dns_mx", name: "mx", value: "10 mx1.larksuite.com" },
          { type: "dns_txt", name: "spf", value: "v=spf1 include:spf.onlarksuite.com -all" },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 10,
        probe: "cookie_security_probe",
        item: "cookie_security",
        source: "cloudflare_worker_fetch",
        summary: "Cookie security review observed one Set-Cookie header with Secure and HttpOnly attributes.",
        value: {
          set_cookie_count: 1,
          cookies: [{ name: "session", secure: true, http_only: true, same_site: "Lax" }],
          coverage: { collected: ["set_cookie_headers"], missing: ["authenticated_cookie_paths"] },
        },
        evidence: [{ type: "cookie", name: "session", value: "Secure; HttpOnly; SameSite=Lax" }],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 10,
        probe: "security_headers_probe",
        item: "security_headers",
        source: "cloudflare_worker_fetch",
        status: "warning",
        riskLevel: "medium",
        summary: "Security header review found missing CSP, X-Frame-Options, and Permissions-Policy.",
        value: {
          present_headers: ["strict-transport-security", "x-content-type-options"],
          missing_headers: ["content-security-policy", "x-frame-options", "permissions-policy"],
          iframe_policy: { frame_ancestors: null, x_frame_options: null },
          mixed_content: { static_urls_found: 0 },
          leakage_signals: [],
          coverage: { collected: ["security_headers", "iframe_policy", "mixed_content"], missing: ["authorized_vulnerability_testing"] },
        },
        evidence: [{ type: "security_header", name: "missing", value: "content-security-policy" }],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 10,
        probe: "bounded_cookie_attribute_observation_probe",
        item: "bounded_cookie_checks",
        source: "cloudflare_worker_public_security_details",
        status: "warning",
        riskLevel: "low",
        summary: "Observed Set-Cookie header(s) on 1 bounded public check(s).",
        value: {
          checks: [
            {
              host: "blog.poixe.example",
              method: "HEAD",
              path: "/wp-login.php",
              status_code: 200,
              parsed: { wordpress_test_cookie: "path,secure,httponly" },
            },
          ],
          limits: { max_hosts: 6, checked_hosts: 6, max_requests_per_host: 5, max_concurrency: 3 },
          coverage: { collected: ["bounded_public_set_cookie_headers"], missing: ["authenticated_cookie_paths"] },
        },
        evidence: [
          {
            type: "bounded_cookie_checks",
            name: "bounded_cookie_checks",
            value: [
              {
                host: "blog.poixe.example",
                method: "HEAD",
                path: "/wp-login.php",
                status_code: 200,
                parsed: { wordpress_test_cookie: "path,secure,httponly" },
              },
            ],
          },
        ],
      }),
    ],
  };
}

function record(target, normalizedTarget, snapshotAt, options) {
  return {
    target,
    normalized_target: normalizedTarget,
    snapshot_at: snapshotAt,
    probe: options.probe,
    layer: options.layer,
    item: options.item,
    probe_type: "active_request",
    source: options.source,
    status: options.status ?? "ok",
    value: options.value,
    risk: {
      level: options.riskLevel ?? "info",
      summary: options.summary,
    },
    evidence: options.evidence,
    evidence_metadata: {
      origin: "direct_observation",
      role: "raw",
      method: "local_fixture",
      limitations: [`Layer ${options.layer} fixture evidence is bounded and not an intrusive scan.`],
    },
    duration_ms: 1,
  };
}

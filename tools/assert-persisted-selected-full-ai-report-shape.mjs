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
  assertSectionFactOwnership(markdown);
  assertRawEvidenceProseCompressed(markdown);
  assertSectionDensityShape(markdown);
  assertSectionSpecificTables(markdown);
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
  const apiGuidance = contract.output_contract.section_guidance.find((section) => section.id === "api_protocol_surface");
  const apiEvidenceRef = apiGuidance?.evidence_ref_hints?.[0] ?? evidenceRef;

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
      {
        id: "api_protocol_surface",
        title: "API and Protocol Surface",
        content:
          "API/protocol evidence: Bounded public CORS check: Observed CORS response header signal(s) on 2 bounded public check(s). Evidence: host=api.poixe.example path=/health access-control=true. No CORS headers were found on the main response. Bounded public CORS check: Observed CORS response header signal(s) on 2 bounded public check(s). CORS response-header signals were observed in bounded public checks. Bounded public API endpoint inventory: Preserved 2 bounded public API endpoint observation(s): /health, /v1/models. Evidence: path=/health access-control=true.",
        evidence_refs: [apiEvidenceRef],
        missing_data_refs: [],
        limitations: [
          "Do not place CORS, cookie, API error-surface, or CMS metadata details here; use the API, Technology, Subdomain, or Security sections.",
          "Do not infer ownership, business model, or related-domain conclusions from technical evidence alone.",
        ],
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
    "Matomo",
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
  assert.ok(
    probes("security_posture").includes("bounded_cors_header_validation_probe"),
    "Security section should receive bounded CORS evidence as a risk signal.",
  );
  assert.ok(
    probes("security_posture").includes("bounded_public_api_endpoint_inventory_probe"),
    "Security section should receive bounded public API endpoint inventory evidence as exposure metadata.",
  );
  assert.ok(
    !probes("organization_operations").includes("public_content_surface_probe"),
    "Organization section should not receive primary content surface map evidence.",
  );
  assert.ok(
    !probes("organization_operations").includes("public_content_detail_probe"),
    "Organization section should not receive primary content detail map evidence.",
  );
  assert.ok(facts("api_protocol_surface").includes("/v1/models"), "API facts should include concrete endpoint paths.");
  assert.ok(facts("security_posture").includes("set-cookie"), "Security facts should include cookie observations.");
  assert.ok(facts("security_posture").includes("cors"), "Security facts should include bounded CORS observations.");
  assert.ok(
    facts("security_posture").includes("/v1/models"),
    "Security facts should include bounded API endpoint inventory observations.",
  );
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

function assertSectionFactOwnership(markdown) {
  const headings = [
    "Executive Summary",
    "Public Information Architecture",
    "Technology Stack",
    "Deployment and Network Surface",
    "Request and Rendering Chain",
    "API and Protocol Surface",
    "Subdomains and Attack Surface",
    "Organization and Operations Signals",
    "Security Posture",
  ];
  for (const heading of headings) {
    const section = sectionText(markdown, heading);
    assert.ok(
      !/Missing data:|Remaining gaps:/i.test(section),
      `${heading} should not carry generic missing-data prose.`,
    );
  }

  const organization = sectionText(markdown, "Organization and Operations Signals").toLowerCase();
  const security = sectionText(markdown, "Security Posture").toLowerCase();

  assert.ok(
    !organization.includes("public content detail map:") && !organization.includes("public content surface map:"),
    "Organization section should not duplicate content map facts owned by Public IA.",
  );
  assert.ok(
    countOccurrences(organization, "public product/business detail:") <= 1,
    "Organization section should not repeat public product/business detail paragraphs.",
  );
  assert.ok(
    !security.includes("cors observation table:"),
    "Security section should not duplicate the API-owned CORS observation table.",
  );
}

function assertRawEvidenceProseCompressed(markdown) {
  const rawEvidenceLines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("Evidence:"))
    .filter((line) => !/^Evidence:\s+(?:\[(?:E|M)\d{3}\]\s*)+$/.test(line));
  assert.equal(
    rawEvidenceLines.length,
    0,
    `Generated Markdown should keep evidence refs, not inline raw key/value evidence prose. Found: ${rawEvidenceLines[0] ?? ""}`,
  );
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
  assert.ok(
    !/^Boundaries:.*(?:Do not place|Do not infer|section_guidance|write one section|cite only|do not invent|keep markdown)/gim.test(markdown),
    "Boundaries should not contain prompt or editorial guidance text.",
  );
  assert.ok(
    countOccurrences(api, "Bounded public CORS check:") <= 1,
    "API section should not repeat bounded CORS prose before the tables.",
  );
  assert.ok(
    countOccurrences(api, "Bounded public checks include `/health` and `/v1/models`.") <= 1,
    "API section should not repeat endpoint summary boilerplate before the tables.",
  );
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
  if (summary.includes("Business model synthesis:")) {
    assert.ok(
      summary.startsWith("Business model synthesis:") || summary.includes("\n\nBusiness model synthesis:"),
      "Summary should split business model synthesis into a topical paragraph.",
    );
  }
  if (technology.includes("Public SPA asset metadata:")) {
    assert.ok(
      technology.startsWith("Public SPA asset metadata:") || technology.includes("\n\nPublic SPA asset metadata:"),
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

function assertSectionSpecificTables(markdown) {
  const summary = sectionText(markdown, "Executive Summary");
  const publicIa = sectionText(markdown, "Public Information Architecture");
  const technology = sectionText(markdown, "Technology Stack");
  const deployment = sectionText(markdown, "Deployment and Network Surface");
  const api = sectionText(markdown, "API and Protocol Surface");
  const subdomains = sectionText(markdown, "Subdomains and Attack Surface");
  const organization = sectionText(markdown, "Organization and Operations Signals");
  const security = sectionText(markdown, "Security Posture");

  for (const expected of [
    "Public content surface table:",
    "Public detail page table:",
    "SPA route candidate table:",
  ]) {
    assert.ok(publicIa.includes(expected), `Public IA should include ${expected}`);
  }
  for (const expected of [
    "Frontend technology evidence table:",
    "SPA signal table:",
    "SPA asset preview table:",
    "Public app marker table:",
    "Public CMS/forum metadata table:",
    "Public app header metadata table:",
  ]) {
    assert.ok(technology.includes(expected), `Technology section should include ${expected}`);
  }
  assert.ok(technology.includes("| Matomo | analytics | confirmed |"), "Technology section should surface static Matomo marker evidence.");
  assert.ok(technology.includes("matomo.gptocean.com"), "Technology section should surface the public tracker host marker.");
  assert.ok(
    technology.includes("runtime-matomo.example"),
    "Technology section should preserve Matomo runtime third-party resource evidence in the merged technology row.",
  );
  assert.ok(
    technology.includes("not ownership proof"),
    "Technology section should bound tracker-host evidence as a signal rather than ownership proof.",
  );
  assert.ok(
    technology.includes("| docs.poixe.example | cors | 308 | Mintlify 0.0.2952, Mint proxy 1.0.0-prod, Vercel MISS, Next/RSC vary |"),
    "Technology section should preserve full docs host app-header metadata without truncated host fragments.",
  );
  assert.ok(
    technology.includes("| blog.poixe.example | WordPress public metadata | /wp-json/ | 200 |"),
    "Technology section should render WordPress public metadata without unsupported admin/version/vulnerability claims.",
  );
  assert.ok(
    technology.includes("wordpress_name=Poixe Blog")
      && technology.includes("wordpress_timezone=Asia/Shanghai")
      && technology.includes("Public metadata; not admin access, vulnerability proof, or exact core version"),
    "Technology section should render WordPress public metadata values and boundary.",
  );
  assert.ok(
    technology.includes("| community.poixe.example | Discourse public metadata | /latest.json | 200 |"),
    "Technology section should render Discourse public route/runtime metadata without authenticated-behavior claims.",
  );
  assert.ok(
    technology.includes("x-discourse-route=list/latest")
      && technology.includes("x-discourse-cached=skip")
      && technology.includes("x-runtime=0.809627")
      && technology.includes("Public headers/metadata; not authenticated community behavior"),
    "Technology section should render Discourse public route/runtime values and boundary.",
  );
  assert.ok(!markdown.includes("docs.poix..."), "Generated Markdown should not include truncated docs host fragments.");
  for (const unexpected of [
    "Public host table: |",
    "SPA signal table: |",
    "Security control table: |",
    "CORS risk signal table: |",
    "Public API endpoint exposure table: |",
    "API model list detail table: |",
  ]) {
    assert.ok(!markdown.includes(unexpected), `Generated Markdown should not include inline table fragment ${unexpected}`);
  }
  assert.ok(deployment.includes("Cache/header evidence table:"), "Deployment section should include cache/header evidence table.");
  for (const expected of ["cloudflare", "cache-control", "cf-cache-status", "last-modified", "etag"]) {
    assert.ok(deployment.toLowerCase().includes(expected), `Deployment cache/header table should include ${expected}.`);
  }
  assert.ok(
    deployment.includes("Header/cache signals do not prove origin topology"),
    "Deployment cache/header table should keep the non-origin-topology boundary.",
  );
  assert.ok(
    !deployment.toLowerCase().includes("nginx"),
    "Deployment section should not include unsupported nginx evidence.",
  );
  for (const expected of [
    "API base URL table:",
    "API compatibility evidence table:",
    "API endpoint table:",
    "API model list detail table:",
    "CORS observation table:",
  ]) {
    assert.ok(api.includes(expected), `API section should include ${expected}`);
  }
  assert.ok(
    api.includes("| api.poixe.example | /v1/models | 200 | 3 | gpt-4o-mini, claude-3-5-sonnet, deepseek-chat |")
      && api.includes("Public endpoint inventory only; not authenticated API validation or availability guarantee"),
    "API model list detail table should preserve public /v1/models count, sample, and boundary.",
  );
  assert.match(
    api,
    /\| Base URL \| https:\/\/api\.poixe\.example\/ \| base URL documentation; regional endpoint documentation \| Primary public API base URL: https:\/\/api\.poixe\.example\/\./,
    "API base URL table should preserve primary base URL-specific snippet evidence.",
  );
  assert.match(
    api,
    /\| Base URL \| https:\/\/api-eu-central-1-dc8\.poixe\.example\/ \| base URL documentation; regional endpoint documentation \| Regional direct endpoint without CDN: https:\/\/api-eu-central-1-dc8\.poixe\.example/,
    "API base URL table should use the dc8 regional endpoint snippet for the dc8 row.",
  );
  assert.match(
    api,
    /\| Base URL \| https:\/\/api-eu-central-1-dc15\.poixe\.example\/ \| base URL documentation; regional endpoint documentation \| Regional direct endpoint without CDN: https:\/\/api-eu-central-1-dc15\.poixe\.example/,
    "API base URL table should use the dc15 regional base URL with its own snippet.",
  );
  assert.match(
    api,
    /\| Base URL \| \/docs\/base-url \| base URL documentation; regional endpoint documentation \| Primary public API base URL: https:\/\/api\.poixe\.example\/\./,
    "API compatibility table should preserve compact public-doc signals and snippets.",
  );
  assert.ok(subdomains.includes("Public host table:"), "Subdomain section should include public host table.");
  assert.ok(
    subdomains.includes("CT-discovered host candidate table:"),
    "Subdomain section should include CT-discovered host candidate table.",
  );
  for (const expected of ["academy.poixe.example", "news.poixe.example", "nav.poixe.example"]) {
    assert.ok(subdomains.includes(expected), `CT candidate table should retain ancillary public host ${expected}.`);
  }
  for (const expected of ["admin.s3.poixe.example", "ci.poixe.example"]) {
    assert.ok(subdomains.includes(expected), `CT candidate table should retain grouped target host candidate ${expected}.`);
  }
  for (const expected of ["placeholder/content", "storage/media", "tooling/ci"]) {
    assert.ok(subdomains.includes(expected), `CT candidate table should include grouped host label ${expected}.`);
  }
  assert.ok(
    subdomains.includes("CT candidate; not service inventory"),
    "CT candidate table should bound CT rows as candidates rather than service inventory.",
  );
  assert.ok(organization.includes("Public business page table:"), "Organization section should include public business page table.");
  assert.ok(organization.includes("SPA operation evidence table:"), "Organization section should include SPA operation evidence table.");
  assert.ok(organization.includes("Organization evidence table:"), "Organization section should include organization evidence table.");
  assert.ok(
    organization.includes("| Mail DNS | MX/TXT | Larksuite mail DNS signals |"),
    "Organization evidence table should preserve Larksuite MX/TXT signals.",
  );
  assert.ok(
    organization.includes("| Registration | Registrar | Example Registrar |"),
    "Organization evidence table should preserve registrar evidence.",
  );
  assert.ok(security.includes("Security control table:"), "Security section should include security control table.");
  assert.ok(security.includes("CORS risk signal table:"), "Security section should include CORS risk signal table.");
  assert.ok(
    security.includes("allow-origin reflected") && security.includes("allow-credentials true"),
    "Security CORS table should surface reflected origin and credentials risk signals.",
  );
  assert.ok(
    security.includes("Risk signal; not confirmed exploitability"),
    "Security CORS table should keep the risk-signal boundary.",
  );
  assert.ok(
    security.includes("Public API endpoint exposure table:"),
    "Security section should include public API endpoint exposure table.",
  );
  assert.ok(
    security.includes("| api.poixe.example | GET | /health | 200 |")
      && security.includes("| api.poixe.example | GET | /v1/models | 200 |"),
    "Security API endpoint exposure table should surface /health and /v1/models observations.",
  );
  assert.ok(
    security.includes("Public endpoint observation; not authenticated API validation"),
    "Security API endpoint exposure table should keep the authenticated-validation boundary.",
  );
  assert.ok(security.includes("Cookie observation table:"), "Security section should include cookie observation table.");
  assert.ok(
    security.includes("wp-login.php") && security.includes("Public route/cookie metadata; not admin access"),
    "Security cookie table should surface wp-login public route metadata with a no-admin-access boundary.",
  );
  assert.ok(
    security.toLowerCase().includes("content-security-policy") && security.toLowerCase().includes("permissions-policy"),
    "Security control table should keep missing CSP/Permissions-Policy controls visible.",
  );

  assert.ok(!publicIa.includes("CORS observation table:"), "Public IA should not own API/CORS tables.");
  assert.ok(!organization.includes("Public content surface table:"), "Organization should not duplicate public content map tables.");
  assert.ok(
    !organization.includes("Public operations evidence: Public SPA operation evidence"),
    "Organization prose should not stack operation evidence lead-in labels.",
  );
  assert.ok(
    !api.includes("| poixe.example | GET | / | 200 |  |"),
    "CORS table should hide low-signal empty rows when stronger CORS rows exist.",
  );
  assert.ok(api.includes("allow-origin reflected"), "CORS table should render readable signal labels.");
  assert.ok(
    subdomains.includes("| docs.poixe.example | docs | 200 | docs host HTTP 200 |"),
    "Public host table should fill observed hints from role/status context when server/title is absent.",
  );
  assert.ok(
    !organization.includes("Poixe Fixture"),
    "Business table should hide generic homepage rows when product/business detail rows exist.",
  );
  assert.ok(
    !security.includes("| poixe.example | GET | / | 200 |  |"),
    "Cookie table should hide low-signal empty rows when stronger cookie observations exist.",
  );
  assert.ok(
    security.includes("wordpress_test_cookie=path,secure,httponly"),
    "Cookie table should preserve parsed cookie attributes from stronger observations.",
  );
  assert.ok(publicIa.includes("| /signup | index-abcd.js | medium | direct |"), "SPA route table should retain signup route.");
  assert.ok(publicIa.includes("| /pricing | index-abcd.js | medium | direct |"), "SPA route table should include the pricing route.");
  assert.ok(
    !publicIa.includes("/dash/model/model_load_stats") && !publicIa.includes("/channel/manage/log"),
    "SPA route table should not expose internal operation strings as public route rows.",
  );
  assert.ok(
    organization.includes("| product | product | /products/vendor/application | Supplier onboarding |"),
    "Business table should retain the late supplier onboarding product row.",
  );
  assert.ok(
    organization.includes("| product | product | /products/vendor | Vendor console |"),
    "Business table should retain the late vendor console product row.",
  );
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

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
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
          headers: {
            server: "cloudflare",
            "cache-control": "max-age=300",
            "cf-cache-status": "HIT",
            "last-modified": "Sun, 24 May 2026 14:58:34 GMT",
            etag: "\"fixture-etag\"",
          },
          coverage: { collected: ["status_code", "response_headers"], missing: [] },
        },
        evidence: [
          { type: "http_header", name: "server", value: "cloudflare" },
          { type: "http_header", name: "cache-control", value: "max-age=300" },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 3,
        probe: "cache_policy_probe",
        item: "cache_policy",
        source: "cloudflare_worker_fetch + cache_header_rules",
        summary: "Response is cacheable for 5m.",
        value: {
          requested_url: target,
          final_url: target,
          status_code: 200,
          response_kind: "html",
          cacheability: "cacheable",
          browser_max_age_seconds: 300,
          shared_max_age_seconds: null,
          immutable: false,
          has_validator: true,
          validator: "etag",
          cdn_cache_status: "HIT",
          raw_headers: {
            "cache-control": "max-age=300",
            "cf-cache-status": "HIT",
            "last-modified": "Sun, 24 May 2026 14:58:34 GMT",
            etag: "\"fixture-etag\"",
          },
        },
        evidence: [
          { type: "http_status", value: 200 },
          { type: "http_header", name: "cache-control", value: "max-age=300" },
          { type: "http_header", name: "cf-cache-status", value: "HIT" },
          { type: "http_header", name: "last-modified", value: "Sun, 24 May 2026 14:58:34 GMT" },
          { type: "http_header", name: "etag", value: "\"fixture-etag\"" },
        ],
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
        layer: 4,
        probe: "public_content_surface_probe",
        item: "public_content_surfaces",
        source: "cloudflare_worker_public_content_surface",
        summary: "Collected 2 bounded public content surface(s): Poixe home; Docs overview.",
        value: {
          surfaces: [
            { host: "poixe.example", path: "/", status_code: 200 },
            { host: "docs.poixe.example", path: "/introduction", status_code: 200 },
          ],
          coverage: { collected: ["public_content_surfaces"], missing: ["deep_public_crawl"] },
        },
        evidence: [
          {
            type: "public_content_surface",
            name: "public_content_surfaces",
            value: [
              {
                host: "poixe.example",
                path: "/",
                status_code: 200,
                title: "Poixe home",
                classification: { label: "homepage", controlled_hint: "homepage", confidence: "high" },
              },
              {
                host: "docs.poixe.example",
                path: "/introduction",
                status_code: 200,
                title: "Docs overview",
                classification: { label: "documentation", controlled_hint: "docs", confidence: "medium" },
              },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 4,
        probe: "public_content_detail_probe",
        item: "public_content_detail",
        source: "cloudflare_worker_public_content_detail",
        summary: "Collected 2 public content detail page(s): Supplier onboarding; Provider routing.",
        value: {
          detail_pages: [
            { host: "docs.poixe.example", path: "/products/vendor/application", status_code: 200 },
            { host: "docs.poixe.example", path: "/docs/route-provider", status_code: 200 },
          ],
          coverage: { collected: ["public_content_detail_pages"], missing: ["authenticated_docs"] },
        },
        evidence: [
          {
            type: "public_content_detail",
            name: "detail_pages",
            value: [
              {
                host: "docs.poixe.example",
                path: "/products/vendor/application",
                status_code: 200,
                title: "Supplier onboarding",
                detail_kind: "product",
                classification: { label: "vendor onboarding", controlled_hint: "product", confidence: "high" },
              },
              {
                host: "docs.poixe.example",
                path: "/docs/route-provider",
                status_code: 200,
                title: "Provider routing",
                detail_kind: "docs",
                classification: { label: "provider routing", controlled_hint: "docs", confidence: "medium" },
              },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 4,
        probe: "public_spa_asset_metadata_probe",
        item: "public_spa_asset_metadata",
        source: "cloudflare_worker_public_spa_metadata",
        summary: "Collected bounded SPA asset metadata: Next.js, React, Vite, React Router, and CSR candidate signals.",
        value: {
          detected_signals: ["Next.js", "React", "Vite"],
          coverage: { collected: ["spa_asset_metadata"], missing: ["runtime_route_confirmation"] },
        },
        evidence: [
          {
            type: "spa_asset_preview",
            name: "asset_previews",
            value: [
              {
                host: "poixe.example",
                path: "/assets/index-abcd.js",
                kind: "script",
                role: "main",
                status_code: 200,
                signals: ["nextjs", "react", "vite_manifest", "client_router"],
              },
            ],
          },
          {
            type: "spa_signal",
            name: "detected_signals",
            value: [
              { category: "frontend_framework", label: "Next.js", confidence: "medium", basis: ["route manifest"] },
              { category: "frontend_framework", label: "React", confidence: "high", basis: ["jsx runtime"] },
              { category: "build_tool", label: "Vite", confidence: "medium", basis: ["asset naming"] },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 4,
        probe: "public_spa_route_metadata_probe",
        item: "public_spa_route_metadata",
        source: "cloudflare_worker_public_spa_metadata",
        summary: "Extracted 2 route-like string candidate(s) and component/page-like symbol candidate(s).",
        value: {
          route_candidates: ["/products", "/products/vendor"],
          coverage: { collected: ["route_like_string_candidates"], missing: ["route_reachability_confirmation"] },
        },
        evidence: [
          {
            type: "spa_route_candidate",
            name: "route_candidates",
            value: [
              { route_candidate: "/billing", source_asset: "/assets/index-abcd.js", confidence: "low" },
              { route_candidate: "/dashboard", source_asset: "/assets/index-abcd.js", confidence: "low" },
              { route_candidate: "/log", source_asset: "/assets/index-abcd.js", confidence: "low" },
              { route_candidate: "/login", source_asset: "/assets/index-abcd.js", confidence: "medium" },
              { route_candidate: "/signup", source_asset: "/assets/index-abcd.js", confidence: "medium" },
              { route_candidate: "/model", source_asset: "/assets/index-abcd.js", confidence: "medium" },
              { route_candidate: "/pricing", source_asset: "/assets/index-abcd.js", confidence: "medium" },
              { route_candidate: "/products", source_asset: "/assets/index-abcd.js", confidence: "medium" },
              { route_candidate: "/products/free", source_asset: "/assets/index-abcd.js", confidence: "medium" },
              { route_candidate: "/products/user", source_asset: "/assets/index-abcd.js", confidence: "medium" },
              { route_candidate: "/token", source_asset: "/assets/index-abcd.js", confidence: "medium" },
              { route_candidate: "/vendor", source_asset: "/assets/index-abcd.js", confidence: "medium" },
              { route_candidate: "/setting/payment", source_asset: "/assets/withdrawal_method-abcd.js", confidence: "medium" },
              { route_candidate: "/setting/payment/update_usdt_address", source_asset: "/assets/withdrawal_method-abcd.js", confidence: "low" },
              { route_candidate: "/setting/payment/withdraw_methods", source_asset: "/assets/withdrawal_method-abcd.js", confidence: "low" },
              { route_candidate: "/dash/model/model_load_stats", source_asset: "/assets/model-abcd.js", confidence: "low" },
              { route_candidate: "/dash/model/system_model_stat", source_asset: "/assets/model-abcd.js", confidence: "low" },
              { route_candidate: "/channel/manage/log", source_asset: "/assets/channel_manage_log-abcd.js", confidence: "low" },
              { route_candidate: "/agent/revenue/basic_info", source_asset: "/assets/revenue-abcd.js", confidence: "low" },
              { route_candidate: "/products/vendor", source_asset: "/assets/index-abcd.js", confidence: "medium" },
              { route_candidate: "/products/vendor/application", source_asset: "/assets/index-abcd.js", confidence: "medium" },
            ],
          },
        ],
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
            { host: "poixe.example", method: "GET", path: "/", status_code: 200, signals: [] },
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
              { host: "poixe.example", method: "GET", path: "/", status_code: 200, signals: [] },
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
              {
                host: "api.poixe.example",
                method: "GET",
                path: "/v1/models",
                status_code: 200,
                content_type: "application/json",
                model_count: 3,
                model_sample: ["gpt-4o-mini", "claude-3-5-sonnet", "deepseek-chat"],
                body_preview_bytes: 180,
                body_preview_truncated: false,
                signals: ["public_model_list_observed"],
              },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 6,
        probe: "bounded_public_api_endpoint_inventory_probe",
        item: "bounded_public_api_endpoint_inventory",
        source: "cloudflare_worker_public_security_details",
        summary: "Preserved 2 bounded public API endpoint observation(s): /health, /v1/models.",
        value: {
          endpoints: [
            { host: "api.poixe.example", method: "GET", path: "/health", status_code: 200 },
            { host: "api.poixe.example", method: "GET", path: "/v1/models", status_code: 200 },
          ],
          coverage: { collected: ["bounded_public_api_endpoint_inventory"], missing: ["authenticated_api_behavior"] },
        },
        evidence: [
          {
            type: "api_endpoint",
            name: "public_api_endpoint_inventory",
            value: [
              { host: "api.poixe.example", method: "GET", path: "/health", status_code: 200, signals: [] },
              {
                host: "api.poixe.example",
                method: "GET",
                path: "/v1/models",
                status_code: 200,
                content_type: "application/json",
                model_count: 3,
                model_sample: ["gpt-4o-mini", "claude-3-5-sonnet", "deepseek-chat"],
                body_preview_bytes: 180,
                body_preview_truncated: false,
                signals: ["public_model_list_observed"],
              },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 7,
        probe: "subdomain_attack_surface_probe",
        item: "ct_subdomains",
        source: "cloudflare_worker_dns_tls",
        summary: "CT logs exposed multiple subdomain candidates and bounded reachability was checked.",
        value: {
          discovered_subdomains: [
            { host: "academy.poixe.example", source: "ct_log" },
            { host: "admin.s3.poixe.example", source: "ct_log" },
            { host: "blog.poixe.example", source: "ct_log" },
            { host: "ci.poixe.example", source: "ct_log" },
            { host: "community.poixe.example", source: "ct_log" },
            { host: "docs.poixe.example", source: "ct_log" },
            { host: "nav.poixe.example", source: "ct_log" },
            { host: "news.poixe.example", source: "ct_log" },
            { host: "status.poixe.example", source: "ct_log" },
          ],
          reachability: [{ host: "admin.poixe.example", https_status_code: 200 }],
          coverage: { collected: ["ct_subdomain_candidates", "bounded_https_reachability"], missing: ["deep_service_inventory"] },
        },
        evidence: [
          {
            type: "subdomain",
            name: "subdomains",
            value: [
              { host: "academy.poixe.example", source: "ct_log", sources: ["certspotter"], indicators: ["issuer:Let's Encrypt"] },
              { host: "admin.s3.poixe.example", source: "ct_log", sources: ["certspotter"], indicators: ["issuer:Let's Encrypt"] },
              { host: "blog.poixe.example", source: "ct_log", sources: ["certspotter"], indicators: ["issuer:Let's Encrypt"] },
              { host: "ci.poixe.example", source: "ct_log", sources: ["certspotter"], indicators: ["issuer:Let's Encrypt"] },
              { host: "community.poixe.example", source: "ct_log", sources: ["certspotter"], indicators: ["issuer:Let's Encrypt"] },
              { host: "docs.poixe.example", source: "ct_log", sources: ["certspotter"], indicators: ["issuer:Let's Encrypt"] },
              { host: "nav.poixe.example", source: "ct_log", sources: ["certspotter"], indicators: ["issuer:Let's Encrypt"] },
              { host: "news.poixe.example", source: "ct_log", sources: ["certspotter"], indicators: ["issuer:Let's Encrypt"] },
              { host: "status.poixe.example", source: "ct_log", sources: ["certspotter"], indicators: ["issuer:Let's Encrypt"] },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 8,
        probe: "frontend_technology_probe",
        item: "technology_candidates",
        source: "cloudflare_worker_fetch",
        summary: "Static HTML exposed Next.js and script bundle technology candidates.",
        value: {
          candidates: [
            { name: "Next.js", confidence: "medium", evidence: "meta generator" },
            { name: "Matomo", confidence: "confirmed", evidence: "inline marker" },
          ],
          coverage: { collected: ["static_technology_candidates"], missing: ["runtime_framework_confirmation"] },
        },
        evidence: [
          { type: "technology", name: "frontend", value: "Next.js" },
          {
            type: "technology_candidate",
            name: "Matomo",
            value: { category: "analytics", confidence: "confirmed", evidence_refs: ["marker:matomo", "marker:matomo-host:matomo.gptocean.com"] },
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 7,
        probe: "public_host_fingerprint_probe",
        item: "public_host_fingerprint",
        source: "cloudflare_worker_public_host_fingerprint",
        summary: "Checked 3 bounded public host candidate(s); observed role hint(s): docs, api, blog.",
        value: {
          checked_hosts: [
            { host: "docs.poixe.example", role_hint: "docs", status_code: 200 },
            { host: "api.poixe.example", role_hint: "api", status_code: 200 },
            { host: "blog.poixe.example", role_hint: "blog", status_code: 200 },
          ],
          coverage: { collected: ["bounded_public_host_fingerprints"], missing: ["deep_service_inventory"] },
        },
        evidence: [
          {
            type: "http_observation",
            name: "public_hosts",
            value: [
              { host: "docs.poixe.example", role_hint: "docs", status_code: 200 },
              { host: "api.poixe.example", role_hint: "api", status_code: 200, server: "cloudflare" },
              { host: "blog.poixe.example", role_hint: "blog", status_code: 200, server: "nginx" },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 8,
        probe: "public_app_marker_probe",
        item: "public_app_markers",
        source: "cloudflare_worker_public_host_fingerprint",
        summary: "Observed public app marker(s): Mintlify, WordPress, Discourse.",
        value: {
          app_markers: ["Mintlify", "WordPress", "Discourse"],
          coverage: { collected: ["public_app_markers"], missing: [] },
        },
        evidence: [
          {
            type: "app_marker",
            name: "public_app_marker_names",
            value: [
              { host: "docs.poixe.example", name: "Mintlify", category: "docs", confidence: "high" },
              { host: "blog.poixe.example", name: "WordPress", category: "cms", confidence: "high" },
              { host: "community.poixe.example", name: "Discourse", category: "forum", confidence: "medium" },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 8,
        probe: "runtime_third_party_resources_probe",
        item: "runtime_third_party_resources",
        source: "github-actions-browser",
        summary: "Browser runtime observed third-party scripts and resources.",
        value: {
          third_party_scripts: ["https://runtime-matomo.example/matomo.js"],
          third_party_resources: ["https://runtime-matomo.example/matomo.php?idsite=36"],
          coverage: { collected: ["runtime_third_party_resources"], missing: [] },
        },
        evidence: [
          { type: "runtime_resource", name: "script", value: "https://runtime-matomo.example/matomo.js" },
          { type: "runtime_resource", name: "ping", value: "https://runtime-matomo.example/matomo.php?idsite=36" },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 8,
        probe: "bounded_public_app_header_metadata_probe",
        item: "bounded_public_app_header_metadata",
        source: "cloudflare_worker_public_security_details",
        summary: "Observed public app header metadata signal(s) on bounded check(s).",
        value: {
          checks: [
            {
              host: "docs.poixe.example",
              role_hint: "docs",
              method: "HEAD",
              path: "/",
              status_code: 308,
              kind: "cors",
              signals: ["mintlify_client_version", "mint_proxy_version", "vercel_cache", "next_rsc_vary"],
              mintlify_client_version: "0.0.2952",
              mint_proxy_version: "1.0.0-prod",
              vercel_cache: "MISS",
              next_rsc_vary: "RSC, Next-Router-State-Tree",
            },
          ],
          coverage: { collected: ["bounded_public_app_header_metadata"], missing: [] },
        },
        evidence: [
          {
            type: "app_header_metadata",
            name: "public_app_header_metadata",
            value: [
              {
                host: "docs.poixe.example",
                role_hint: "docs",
                method: "HEAD",
                path: "/",
                status_code: 308,
                kind: "cors",
                signals: ["mintlify_client_version", "mint_proxy_version", "vercel_cache", "next_rsc_vary"],
                mintlify_client_version: "0.0.2952",
                mint_proxy_version: "1.0.0-prod",
                vercel_cache: "MISS",
                next_rsc_vary: "RSC, Next-Router-State-Tree",
              },
            ],
          },
        ],
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
              parsed: { x_discourse_route: "list/latest", x_discourse_cached: "skip", x_runtime: "0.809627" },
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
                parsed: { x_discourse_route: "list/latest", x_discourse_cached: "skip", x_runtime: "0.809627" },
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
        layer: 3,
        probe: "rdap_whois_lite_probe",
        item: "rdap_whois_lite",
        source: "cloudflare_worker_fetch",
        summary: "Collected RDAP / WHOIS-lite registration evidence.",
        value: {
          registrar: "Example Registrar",
          status: "active",
          coverage: { collected: ["rdap_registrar"], missing: ["manual_ownership_confirmation"] },
        },
        evidence: [{ type: "rdap", name: "registrar", value: "Example Registrar" }],
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
        layer: 9,
        probe: "public_product_business_detail_probe",
        item: "public_product_business_detail",
        source: "cloudflare_worker_public_content_detail",
        summary: "Collected public product/business detail snippets from supplier onboarding and provider routing pages.",
        value: {
          pages: [
            { title: "Supplier onboarding", path: "/products/vendor/application" },
            { title: "Provider routing", path: "/docs/route-provider" },
          ],
          coverage: { collected: ["public_product_business_detail"], missing: ["manual_business_confirmation"] },
        },
        evidence: [
          {
            type: "public_product_business_detail",
            name: "product_business_detail_snippets",
            value: [
              {
                host: "docs.poixe.example",
                path: "/docs/get-started/overview",
                title: "Generic overview",
                detail_kind: "docs",
                controlled_hint: "technical_documentation",
                snippets: ["General documentation overview."],
              },
              {
                host: "docs.poixe.example",
                path: "/blog/platform-news",
                title: "Platform news",
                detail_kind: "article",
                controlled_hint: "news",
                snippets: ["Generic release update."],
              },
              {
                host: "docs.poixe.example",
                path: "/docs/route-provider",
                title: "Provider routing",
                detail_kind: "docs",
                controlled_hint: "product",
                snippets: ["Model provider routing can be configured."],
              },
              {
                host: "docs.poixe.example",
                path: "/docs/vendor/onboarding",
                title: "Vendor onboarding",
                detail_kind: "docs",
                controlled_hint: "product",
                snippets: ["Vendors can apply to join the platform."],
              },
              {
                host: "docs.poixe.example",
                path: "/docs/vendor/payouts",
                title: "Vendor payouts",
                detail_kind: "docs",
                controlled_hint: "product",
                snippets: ["Vendors can withdraw settled revenue."],
              },
              {
                host: "poixe.example",
                path: "/products",
                title: "Products",
                detail_kind: "product",
                controlled_hint: "product",
                snippets: ["Generic product page."],
              },
              {
                host: "poixe.example",
                path: "/products/vendor",
                title: "Vendor console",
                detail_kind: "product",
                controlled_hint: "product",
                snippets: ["Vendor product console."],
              },
              {
                host: "poixe.example",
                path: "/products/vendor/application",
                title: "Supplier onboarding",
                detail_kind: "product",
                controlled_hint: "product",
                snippets: ["Vendors can apply to join the platform. 控制台 创建令牌 充值 查看日志 收益提现"],
              },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 9,
        probe: "public_business_content_probe",
        item: "public_business_content",
        source: "cloudflare_worker_public_content_surface",
        summary: "Collected public business/product snippets from root and product pages.",
        value: {
          pages: [{ title: "Poixe Fixture", path: "/" }],
          coverage: { collected: ["public_business_product_snippets"], missing: ["manual_business_confirmation"] },
        },
        evidence: [
          {
            type: "public_business_content",
            name: "business_product_snippets",
            value: [
              {
                host: "poixe.example",
                path: "/",
                title: "Poixe Fixture",
                controlled_hint: "news",
                classification: { controlled_hint: "news", label: "news" },
                snippets: ["Generic homepage copy."],
              },
              {
                host: "docs.poixe.example",
                path: "/cn/docs/get-started/overview",
                title: "Poixe AI - Poixe Docs",
                controlled_hint: "technical_documentation",
                classification: { controlled_hint: "technical_documentation", label: "docs" },
                snippets: ["控制台 创建令牌 充值 查看日志 供应商 入驻 部署资源 收益提现"],
              },
            ],
          },
        ],
      }),
      record(target, normalizedTarget, snapshotAt, {
        layer: 6,
        probe: "public_api_compatibility_detail_probe",
        item: "public_api_compatibility_detail",
        source: "cloudflare_worker_public_content_detail",
        summary: "Collected public API compatibility detail snippets from Base URL and OpenAI compatibility pages.",
        value: {
          snippets: [
            { title: "Base URL", path: "/docs/base-url" },
            { title: "OpenAI compatibility", path: "/docs/openai-compatible" },
          ],
          coverage: { collected: ["public_api_compatibility_docs"], missing: ["authenticated_api_key_validation"] },
        },
        evidence: [
          {
            type: "public_api_compatibility_detail",
            name: "api_compatibility_snippets",
            value: [
              {
                host: "docs.poixe.example",
                path: "/docs/base-url",
                title: "Base URL",
                detail_kind: "docs",
                controlled_hint: "technical_documentation",
                confidence: "medium",
                compatibility_signals: ["base URL documentation", "regional endpoint documentation"],
                api_base_urls: [
                  "https://api.poixe.example/",
                  "https://api-eu-central-1-dc8.poixe.example/",
                  "https://api-eu-central-1-dc15.poixe.example/",
                ],
                snippets: [
                  "Primary public API base URL: https://api.poixe.example/.",
                  "Regional direct endpoint without CDN: https://api-eu-central-1-dc8.poixe.example/.",
                  "Regional direct endpoint without CDN: https://api-eu-central-1-dc15.poixe.example/.",
                ],
              },
              {
                host: "docs.poixe.example",
                path: "/docs/openai-compatible",
                title: "OpenAI compatibility",
                detail_kind: "docs",
                controlled_hint: "technical_documentation",
                confidence: "medium",
                compatibility_signals: [
                  "OpenAI Chat Completions-compatible path",
                  "Anthropic Messages-compatible surface",
                  "model naming/provider routing documentation",
                ],
                snippets: ["Use /v1/chat/completions for OpenAI-compatible requests and provider/<base_model> model naming for routing."],
              },
            ],
          },
        ],
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
            { host: "poixe.example", method: "GET", path: "/", status_code: 200 },
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
              { host: "poixe.example", method: "GET", path: "/", status_code: 200 },
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

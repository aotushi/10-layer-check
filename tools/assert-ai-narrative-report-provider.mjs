#!/usr/bin/env node
import { createServer } from "vite";
import { readFile } from "node:fs/promises";

const aiRouteSource = await readFile(new URL("../worker/routes/ai.ts", import.meta.url), "utf8");
const aiServiceSource = await readFile(new URL("../worker/services/ai-narrative-report.ts", import.meta.url), "utf8");

if (!aiRouteSource.includes("/provider/ai/narrative-report")) {
  throw new Error("Worker AI route should expose /provider/ai/narrative-report.");
}
if (!aiServiceSource.includes("runWorkerAiNarrativeReportProvider")) {
  throw new Error("worker/services/ai-narrative-report.ts should delegate to the provider adapter.");
}

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
  const { createAiNarrativeReportContract, validateAiNarrativeReportResult } = await server.ssrLoadModule(
    "/src/providers/narrative-report/contract.ts",
  );
  const { runWorkerAiNarrativeReportProvider } = await server.ssrLoadModule(
    "/src/providers/narrative-report/worker-adapter.ts",
  );
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");

  const run = createFixtureRun();
  const brief = createReportBrief(run, createAnalysisReport(run));
  const contract = createAiNarrativeReportContract(brief);

  if (contract.input.brief.schema_version !== "site-10-layer-report-brief/v0.1") {
    throw new Error("AI narrative report contract should carry ReportBrief as provider input.");
  }
  if (!contract.output_contract.citation_rules.some((rule) => rule.includes("evidence_refs"))) {
    throw new Error("AI narrative report contract should define evidence citation rules.");
  }
  if (!contract.output_contract.markdown_rules?.some((rule) => rule.includes("H1"))) {
    throw new Error("AI narrative report contract should define Markdown output rules.");
  }
  if (!contract.output_contract.style_rules?.some((rule) => rule.includes("Do not output one section per raw layer"))) {
    throw new Error("AI narrative report contract should forbid one-section-per-layer output.");
  }
  if (!contract.output_contract.section_guidance?.some((item) => item.id === "technology_stack")) {
    throw new Error("AI narrative report contract should include poixe-style topical section guidance.");
  }
  if (!contract.output_contract.section_guidance?.some((item) => item.fact_hints?.some((hint) => hint.includes("server=example")))) {
    throw new Error("AI narrative report contract should include concrete section fact hints.");
  }

  const missingConfigResponse = await worker.default.fetch(
    new Request("http://worker.local/provider/ai/narrative-report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contract }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );
  const missingConfigBody = await missingConfigResponse.json();
  if (missingConfigResponse.status !== 503) {
    throw new Error(`Missing AI narrative provider config should return 503, got ${missingConfigResponse.status}.`);
  }
  if (missingConfigBody.error_code !== "missing_ai_narrative_report_provider_config") {
    throw new Error("Missing config should return missing_ai_narrative_report_provider_config.");
  }

  const workersAiCalls = [];
  const workersAi = await runWorkerAiNarrativeReportProvider(contract, {
    AI_PROVIDER_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    AI: {
      run: async (model, input) => {
        workersAiCalls.push({ model, input });
        return {
          response: JSON.stringify(createValidModelOutput()),
        };
      },
    },
  });
  if (!workersAi.ok || !workersAi.result.markdown.includes("[E001]")) {
    throw new Error("AI narrative report adapter should accept a valid Workers AI JSON response.");
  }
  if (workersAiCalls[0]?.input?.response_format?.type !== "json_schema") {
    throw new Error("AI narrative report adapter should request Workers AI JSON schema mode.");
  }
  if (!workersAiCalls[0]?.input?.messages?.[0]?.content?.includes("Do not write one section per raw layer")) {
    throw new Error("AI narrative report adapter prompt should forbid layer-by-layer output.");
  }
  const schemaSectionId = workersAiCalls[0]?.input?.response_format?.json_schema?.properties?.sections?.items?.properties?.id;
  if (!Array.isArray(schemaSectionId?.enum) || !schemaSectionId.enum.includes("technology_stack")) {
    throw new Error("AI narrative report adapter JSON schema should constrain section ids.");
  }

  const valid = await runWorkerAiNarrativeReportProvider(
    contract,
    {
      AI_PROVIDER_API_KEY: "test-key",
      AI_PROVIDER_MODEL: "test-model",
      AI_PROVIDER_BASE_URL: "https://example.invalid/v1/chat/completions",
    },
    { modelClient: async () => createValidModelOutput() },
  );
  if (!valid.ok || valid.result.sections[0]?.id !== "summary") {
    throw new Error("AI narrative report adapter should accept valid structured model output.");
  }
  if (!valid.result.markdown.startsWith("# Site Analysis:")) {
    throw new Error("AI narrative report adapter should synthesize Markdown with a stable H1 title.");
  }
  if (!valid.result.markdown.includes("Evidence: [E001]")) {
    throw new Error("AI narrative report adapter should synthesize compact evidence blocks.");
  }

  const invalid = await runWorkerAiNarrativeReportProvider(
    contract,
    { AI_PROVIDER_API_KEY: "test-key", AI_PROVIDER_MODEL: "test-model" },
    {
      modelClient: async () => ({
        sections: [
          {
            id: "technology_stack",
            title: "Technology Stack",
            content: "Invalid output cites fabricated evidence.",
            evidence_refs: ["E999"],
            missing_data_refs: [],
            limitations: [],
          },
        ],
        markdown: "Invalid citation [E999].",
      }),
    },
  );
  if (invalid.ok || invalid.error_code !== "invalid_model_output") {
    throw new Error("AI narrative report adapter should reject unknown evidence_refs.");
  }
  if (!invalid.validation_errors?.some((error) => error.includes("E999"))) {
    throw new Error("AI narrative report adapter should expose unknown evidence_ref validation errors.");
  }

  const invalidSection = await runWorkerAiNarrativeReportProvider(
    contract,
    { AI_PROVIDER_API_KEY: "test-key", AI_PROVIDER_MODEL: "test-model" },
    {
      modelClient: async () => ({
        sections: [
          {
            id: "unsupported_section",
            title: "Unsupported Section",
            content: "This output uses a section id that is not part of the report contract.",
            evidence_refs: ["E001"],
            missing_data_refs: [],
            limitations: [],
          },
        ],
        markdown: "# Site Analysis\n\nUnsupported section content [E001].",
      }),
    },
  );
  if (invalidSection.ok || invalidSection.error_code !== "invalid_model_output") {
    throw new Error("AI narrative report adapter should reject section ids outside output_contract.section_ids.");
  }
  if (!invalidSection.validation_errors?.some((error) => error.includes("unsupported_section"))) {
    throw new Error("AI narrative report adapter should expose unsupported section-id validation errors.");
  }

  const directValidation = validateAiNarrativeReportResult(contract, {
    ok: true,
    schema_version: "site-10-layer-ai-narrative-report-result/v0.1",
    provider: "worker_ai_narrative_report",
    invokes_provider: true,
    target: contract.target,
    normalized_target: contract.normalized_target,
    sections: [
      ...contract.output_contract.required_section_ids
        .filter((id) => id !== "missing_data_next_steps")
        .map((id) => {
          const guidance = contract.output_contract.section_guidance.find((item) => item.id === id);
          return {
            id,
            title: guidance?.title ?? id,
            content: "This required section cites known evidence from the contract.",
            evidence_refs: guidance?.evidence_ref_hints?.slice(0, 1) ?? ["E001"],
            missing_data_refs: guidance?.missing_data_ref_hints?.slice(0, 1) ?? [],
            limitations: guidance?.boundary ? [guidance.boundary] : [],
          };
        }),
      {
        id: "missing_data_next_steps",
        title: "Missing Data",
        content: "This section cites a missing-data id.",
        evidence_refs: [],
        missing_data_refs: ["M001"],
        limitations: [],
      },
    ],
    markdown: "# Site Analysis\n\nMissing data remains [M001].",
  });
  if (!directValidation.ok) {
    throw new Error("AI narrative report validation should accept known missing_data_refs.");
  }

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
    throw new Error(`Unexpected fetch in AI narrative product-path check: ${url}`);
  };
  try {
    const productResponse = await worker.default.fetch(
      new Request("http://worker.local/scan/site/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "https://example.com", sync_probes: ["remote_fetch"], async_providers: [] }),
      }),
      {
        ALLOW_LOCAL_DEV_NO_AUTH: "true",
        AI_PROVIDER_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
        AI: {
          run: async (_model, input) => ({ response: JSON.stringify(createValidModelOutputFromWorkerInput(input)) }),
        },
      },
    );
    const productBody = await productResponse.json();
    if (productResponse.status !== 200 || productBody.schema_version !== "site-10-layer-scan-ai-report/v0.1") {
      throw new Error("Product AI report endpoint should return a site-10-layer-scan-ai-report/v0.1 envelope.");
    }
    if (!productBody.artifact?.brief || !productBody.ai_narrative_report?.markdown?.includes("[E001]")) {
      throw new Error("Product AI report endpoint should include deterministic artifact plus validated AI Markdown.");
    }
    if (productBody.boundaries?.deterministic_artifact_preserved !== true) {
      throw new Error("Product AI report endpoint should preserve the deterministic artifact boundary.");
    }

    const productMarkdownResponse = await worker.default.fetch(
      new Request("http://worker.local/scan/site/report.md", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "https://example.com", sync_probes: ["remote_fetch"], async_providers: [] }),
      }),
      {
        ALLOW_LOCAL_DEV_NO_AUTH: "true",
        AI_PROVIDER_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
        AI: {
          run: async (_model, input) => ({ response: JSON.stringify(createValidModelOutputFromWorkerInput(input)) }),
        },
      },
    );
    const productMarkdown = await productMarkdownResponse.text();
    if (productMarkdownResponse.status !== 200) {
      throw new Error(`Product AI markdown endpoint should return 200, got ${productMarkdownResponse.status}.`);
    }
    if (!productMarkdownResponse.headers.get("content-type")?.includes("text/markdown")) {
      throw new Error("Product AI markdown endpoint should return text/markdown.");
    }
    if (!productMarkdown.includes("[E001]") || !productMarkdown.includes("## Executive Summary")) {
      throw new Error("Product AI markdown endpoint should return validated AI Markdown content.");
    }

    const missingProductResponse = await worker.default.fetch(
      new Request("http://worker.local/scan/site/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "https://example.com", sync_probes: ["remote_fetch"], async_providers: [] }),
      }),
      { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
    );
    const missingProductBody = await missingProductResponse.json();
    if (missingProductResponse.status !== 503 || missingProductBody.ok !== false) {
      throw new Error("Product AI report endpoint should surface AI missing config as a provider-state failure.");
    }
    if (!missingProductBody.artifact?.brief || !missingProductBody.provider_error) {
      throw new Error("Product AI report endpoint should still return deterministic artifact context on provider failure.");
    }

    let persistedAiCallCount = 0;
    const persistedEnv = {
      ALLOW_LOCAL_DEV_NO_AUTH: "true",
      SCAN_JOB_KV: new FakeKvNamespace(),
      SCAN_JOB_TTL_SECONDS: "3600",
      AI_PROVIDER_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
      AI: {
        run: async (_model, input) => {
          persistedAiCallCount += 1;
          return { response: JSON.stringify(createValidModelOutputFromWorkerInput(input)) };
        },
      },
    };
    const persistedStart = await worker.default.fetch(
      new Request("http://worker.local/scan/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "https://example.com", sync_probes: ["remote_fetch"], async_providers: [] }),
      }),
      persistedEnv,
    );
    const persistedStartBody = await persistedStart.json();
    const persistedJobId = persistedStartBody.job?.id;
    if (persistedStart.status !== 200 || !persistedJobId || persistedStartBody.boundaries?.storage_persisted !== true) {
      throw new Error("Persisted job setup should create a KV-backed scan job for AI report generation.");
    }

    const persistedReport = await worker.default.fetch(
      new Request(`http://worker.local/scan/jobs/${encodeURIComponent(persistedJobId)}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      persistedEnv,
    );
    const persistedReportBody = await persistedReport.json();
    if (persistedReport.status !== 200 || persistedReportBody.schema_version !== "site-10-layer-persisted-scan-ai-report/v0.1") {
      throw new Error("Persisted job AI report endpoint should return site-10-layer-persisted-scan-ai-report/v0.1.");
    }
    if (persistedReportBody.job_id !== persistedJobId || persistedReportBody.boundaries?.storage_persisted !== true) {
      throw new Error("Persisted job AI report endpoint should preserve job id and storage boundary.");
    }
    if (!persistedReportBody.artifact?.brief || !persistedReportBody.ai_narrative_report?.markdown?.includes("[E001]")) {
      throw new Error("Persisted job AI report endpoint should include artifact context plus validated AI Markdown.");
    }
    if (persistedReportBody.ai_report_cache?.hit !== false || persistedReportBody.boundaries?.ai_report_cache_hit !== false) {
      throw new Error("First persisted AI report request should be a cache miss.");
    }
    if (persistedAiCallCount !== 1) {
      throw new Error(`First persisted AI report request should invoke AI once, got ${persistedAiCallCount}.`);
    }

    const persistedMarkdownReport = await worker.default.fetch(
      new Request(`http://worker.local/scan/jobs/${encodeURIComponent(persistedJobId)}/report.md`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      persistedEnv,
    );
    const persistedMarkdown = await persistedMarkdownReport.text();
    if (persistedMarkdownReport.status !== 200) {
      throw new Error(`Persisted job AI markdown endpoint should return 200, got ${persistedMarkdownReport.status}.`);
    }
    if (!persistedMarkdownReport.headers.get("content-type")?.includes("text/markdown")) {
      throw new Error("Persisted job AI markdown endpoint should return text/markdown.");
    }
    if (!persistedMarkdown.includes("[E001]") || !persistedMarkdown.includes("## Executive Summary")) {
      throw new Error("Persisted job AI markdown endpoint should return validated AI Markdown content.");
    }
    if (persistedAiCallCount !== 1) {
      throw new Error("Persisted job markdown endpoint should reuse the cached AI report instead of invoking AI again.");
    }

    const cachedJsonReport = await worker.default.fetch(
      new Request(`http://worker.local/scan/jobs/${encodeURIComponent(persistedJobId)}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      persistedEnv,
    );
    const cachedJsonReportBody = await cachedJsonReport.json();
    if (cachedJsonReport.status !== 200 || cachedJsonReportBody.ai_report_cache?.hit !== true) {
      throw new Error("Repeated persisted JSON report request should hit the cached AI report.");
    }
    if (cachedJsonReportBody.boundaries?.invokes_ai_provider !== false) {
      throw new Error("Cached persisted JSON report should not mark the AI provider as invoked for this request.");
    }
    if (persistedAiCallCount !== 1) {
      throw new Error("Repeated persisted JSON report request should not invoke AI again.");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("AI narrative report provider check passed.");
} finally {
  await server.close();
}

function createValidModelOutput() {
  return {
    sections: [
      {
        id: "summary",
        title: "Summary",
        content: "The target returned observable HTTP evidence and one explicit missing-data boundary.",
        evidence_refs: ["E001"],
        missing_data_refs: ["M001"],
        limitations: ["This is generated from a bounded ReportBrief."],
      },
      {
        id: "deployment_network_surface",
        title: "Deployment and Network Surface",
        content: "The HTTP response evidence is available, but broader deployment conclusions remain limited.",
        evidence_refs: ["E001"],
        missing_data_refs: [],
        limitations: ["One response is not full infrastructure inventory."],
      },
    ],
    markdown:
      "# Site Analysis\n\nThe target returned observable HTTP evidence [E001]. Missing runtime data remains [M001].",
  };
}

function createValidModelOutputFromWorkerInput(input) {
  const contract = JSON.parse(input.messages[1].content);
  const evidenceRef = contract.input.brief.evidence_index[0]?.id ?? "E001";
  const missingRef = contract.input.brief.missing_data[0]?.id;

  return {
    sections: [
      {
        id: "summary",
        title: "Summary",
        content: "The backend produced a deterministic brief and the AI provider converted it into narrative form.",
        evidence_refs: [evidenceRef],
        missing_data_refs: missingRef ? [missingRef] : [],
        limitations: ["Generated from bounded ReportBrief evidence."],
      },
      {
        id: "deployment_network_surface",
        title: "Deployment and Network Surface",
        content: "The report cites collected evidence only.",
        evidence_refs: [evidenceRef],
        missing_data_refs: [],
        limitations: ["One test response is not full infrastructure inventory."],
      },
    ],
    markdown: `# Site Analysis\n\nCollected evidence is cited as [${evidenceRef}].${
      missingRef ? ` Missing data remains [${missingRef}].` : ""
    }`,
  };
}

function createFixtureRun() {
  return {
    id: "run_ai_narrative_fixture",
    target: "https://example.com/",
    normalizedTarget: "example.com",
    createdAt: "2026-05-22T00:00:00.000Z",
    source: "provider",
    records: [
      {
        target: "https://example.com/",
        normalized_target: "example.com",
        snapshot_at: "2026-05-22T00:00:00.000Z",
        probe: "http_headers_probe",
        layer: 3,
        item: "main_response_headers",
        probe_type: "active_request",
        source: "fixture",
        status: "ok",
        value: {
          status_code: 200,
          headers: { server: "example" },
          coverage: {
            collected: ["status_code", "response_headers"],
            missing: ["runtime_rendering_chain"],
          },
        },
        risk: {
          level: "info",
          summary: "Collected main response status and headers.",
        },
        evidence: [{ type: "http_header", name: "server", value: "example" }],
        evidence_metadata: {
          origin: "direct_observation",
          role: "raw",
          method: "worker_fetch",
          limitations: ["Worker fetch cannot observe browser runtime behavior."],
        },
      },
    ],
  };
}

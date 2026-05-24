#!/usr/bin/env node
import { createServer } from "vite";

const endpoint = process.env.AI_CLASSIFIER_SMOKE_ENDPOINT ?? "http://127.0.0.1:8787/provider/ai/classifier";
const apiKey = process.env.PROBE_API_KEY ?? "";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createAiClassifierContract } = await server.ssrLoadModule("/src/providers/ai-classifier/contract.ts");
  const { createAiClassifierRecords } = await server.ssrLoadModule("/src/providers/ai-classifier/records.ts");
  const { createAnalysisReport } = await server.ssrLoadModule("/src/reporters/analysis.ts");
  const { createReportBrief } = await server.ssrLoadModule("/src/reporters/brief.ts");

  const contract = createAiClassifierContract(createFixtureRun());
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify({ contract }),
  });
  const body = await response.json();
  const workerResponse = normalizeWorkerResponse(body, response.status);
  const records = createAiClassifierRecords(
    {
      target: contract.target,
      normalizedTarget: contract.normalized_target,
      providers: [
        {
          id: "smoke-ai-classifier",
          type: "ai_classifier",
          displayName: "Smoke AI Classifier",
          endpoint,
          authMode: apiKey ? "api_key" : "none",
          secretRef: apiKey ? "configured" : "",
          enabled: true,
          capabilityTags: ["ai_classifier"],
        },
      ],
    },
    workerResponse,
  );
  const run = {
    id: "run_ai_classifier_smoke",
    target: contract.target,
    normalizedTarget: contract.normalized_target,
    createdAt: new Date().toISOString(),
    source: "provider",
    records,
  };
  const analysis = createAnalysisReport(run);
  const brief = createReportBrief(run, analysis);

  const classifierRecords = records.filter((record) => record.probe === "ai_classifier_probe");
  const errorRecords = records.filter((record) => record.probe === "ai_classifier_provider_error");

  if (workerResponse.ok && classifierRecords.length === 0) {
    throw new Error("Smoke response was ok but produced no ai_classifier_probe records.");
  }

  if (!workerResponse.ok && errorRecords.length !== 1) {
    throw new Error("Smoke failure should produce exactly one ai_classifier_provider_error record.");
  }

  if (!brief.evidence_index.some((item) => item.probe === (workerResponse.ok ? "ai_classifier_probe" : "ai_classifier_provider_error"))) {
    throw new Error("Smoke records were not visible in ReportBrief evidence_index.");
  }

  const result = {
    endpoint,
    http_status: response.status,
    worker_ok: Boolean(workerResponse.ok),
    error_code: workerResponse.ok ? null : workerResponse.error_code,
    error_message: workerResponse.ok ? null : truncate(workerResponse.error, 300),
    classifier_record_count: classifierRecords.length,
    provider_error_record_count: errorRecords.length,
    analysis_risk_count: analysis.risks.length,
    brief_evidence_count: brief.evidence_index.length,
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await server.close();
}

function truncate(value, maxLength) {
  return typeof value === "string" && value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function normalizeWorkerResponse(body, status) {
  if (
    body &&
    typeof body === "object" &&
    body.schema_version === "site-10-layer-ai-classifier-worker-response/v0.1" &&
    typeof body.ok === "boolean"
  ) {
    return body;
  }

  return {
    ok: false,
    schema_version: "site-10-layer-ai-classifier-worker-response/v0.1",
    provider: "worker_ai_classifier",
    error_code: status === 401 || status === 403 ? "model_call_failed" : "invalid_model_output",
    error: typeof body?.error === "string" ? body.error : `Unexpected Worker response with HTTP ${status}.`,
    status,
  };
}

function createFixtureRun() {
  return {
    id: "run_ai_classifier_smoke_fixture",
    target: "https://example.com/",
    normalizedTarget: "example.com",
    createdAt: "2026-05-21T00:00:00.000Z",
    source: "provider",
    records: [
      {
        target: "https://example.com/",
        normalized_target: "example.com",
        snapshot_at: "2026-05-21T00:00:00.000Z",
        probe: "ai_frontend_evidence_pack",
        layer: 4,
        item: "ai_frontend_evidence",
        probe_type: "active_request",
        source: "smoke_fixture",
        status: "ok",
        value: {
          deterministic_signals: [
            {
              technology: "Next.js",
              category: "frontend_framework",
              confidence: "likely",
              evidence_refs: ["script:1", "marker:__NEXT_DATA__"],
              source: "deterministic_rule",
            },
          ],
        },
        risk: {
          level: "info",
          summary: "Prepared smoke-test AI classifier evidence.",
        },
        evidence: [
          { type: "script_url", name: "script:1", value: "https://example.com/_next/static/chunk.js" },
          { type: "html_marker", name: "marker:__NEXT_DATA__", value: "__NEXT_DATA__" },
        ],
        evidence_metadata: {
          origin: "direct_observation",
          role: "raw",
          method: "static_parse",
          limitations: ["Smoke fixture evidence is synthetic and only verifies provider wiring."],
        },
      },
      {
        target: "https://example.com/",
        normalized_target: "example.com",
        snapshot_at: "2026-05-21T00:00:00.000Z",
        probe: "app_fingerprint_probe",
        layer: 8,
        item: "app_fingerprint",
        probe_type: "active_request",
        source: "smoke_fixture",
        status: "ok",
        value: {
          fingerprint_candidates: [
            {
              technology: "Google Tag Manager",
              category: "analytics",
              confidence: "possible",
              evidence_refs: ["script:gtm"],
            },
          ],
        },
        risk: {
          level: "info",
          summary: "Prepared smoke-test application fingerprint evidence.",
        },
        evidence: [{ type: "script_url", name: "script:gtm", value: "https://www.googletagmanager.com/gtm.js" }],
        evidence_metadata: {
          origin: "static_heuristic",
          role: "derived",
          method: "static_parse",
          limitations: ["Smoke fixture evidence is synthetic and only verifies provider wiring."],
        },
      },
    ],
  };
}

#!/usr/bin/env node
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createAnalysisReport } = await server.ssrLoadModule("/src/reporters/analysis.ts");
  const { renderAnalysisMarkdown } = await server.ssrLoadModule("/src/reporters/markdown.ts");
  const { createReportBrief } = await server.ssrLoadModule("/src/reporters/brief.ts");

  const run = createFixtureRun();
  const analysis = createAnalysisReport(run);
  const markdown = renderAnalysisMarkdown(analysis);
  const brief = createReportBrief(run, analysis);

  const l4 = analysis.layer_summaries.find((layer) => layer.layer === 4);
  const l8 = analysis.layer_summaries.find((layer) => layer.layer === 8);
  if (!l4 || !l8) throw new Error("Analysis must include L4 and L8 summaries.");

  const successRefs = analysis.evidence_index.filter((item) => item.probe === "ai_classifier_probe");
  if (successRefs.length !== 2) {
    throw new Error("Analysis evidence_index must include both L4 and L8 ai_classifier_probe records.");
  }

  if (!l4.evidence_refs.some((ref) => successRefs.some((item) => item.id === ref && item.layer === 4))) {
    throw new Error("L4 analysis summary must cite ai_classifier_probe evidence.");
  }

  if (!l8.evidence_refs.some((ref) => successRefs.some((item) => item.id === ref && item.layer === 8))) {
    throw new Error("L8 analysis summary must cite ai_classifier_probe evidence.");
  }

  const providerErrorRef = analysis.evidence_index.find((item) => item.probe === "ai_classifier_provider_error");
  if (!providerErrorRef) {
    throw new Error("Analysis evidence_index must include ai_classifier_provider_error records.");
  }

  const providerErrorRisk = analysis.risks.find((risk) => risk.title === "AI classifier provider failed.");
  if (!providerErrorRisk || !providerErrorRisk.evidence_refs.includes(providerErrorRef.id)) {
    throw new Error("Analysis risks must expose provider errors with evidence refs.");
  }

  for (const expected of ["ai_classifier_probe", "ai_classifier_provider_error", providerErrorRef.id]) {
    if (!markdown.includes(expected)) {
      throw new Error(`Markdown report must include ${expected}.`);
    }
  }

  const briefSuccess = brief.evidence_index.find((item) => item.probe === "ai_classifier_probe" && item.layer === 4);
  if (!briefSuccess) {
    throw new Error("ReportBrief evidence_index must include L4 ai_classifier_probe.");
  }

  if (!briefSuccess.evidence_items.some((item) => item.type === "ai_classifier_result" && /Next\.js/.test(item.value))) {
    throw new Error("ReportBrief must preserve compact classifier result evidence.");
  }

  if (!briefSuccess.limitations.some((item) => /static and runtime evidence/i.test(item))) {
    throw new Error("ReportBrief must preserve classifier limitations.");
  }

  const briefError = brief.evidence_index.find((item) => item.probe === "ai_classifier_provider_error");
  if (!briefError) {
    throw new Error("ReportBrief evidence_index must include provider error records.");
  }

  if (!briefError.evidence_items.some((item) => item.type === "provider_error")) {
    throw new Error("ReportBrief must preserve provider error evidence.");
  }

  if (briefError.evidence_items.some((item) => item.type === "ai_classifier_result")) {
    throw new Error("Provider error records must not become positive classifier evidence.");
  }

  console.log("AI classifier reporting check passed.");
} finally {
  await server.close();
}

function createFixtureRun() {
  const base = {
    target: "https://example.com/",
    normalized_target: "example.com",
    snapshot_at: "2026-05-21T00:00:00.000Z",
    probe_type: "external_api",
    source: "worker_ai_classifier",
    evidence_metadata: {
      origin: "external_provider",
      role: "derived",
      method: "external_api",
      limitations: ["AI classifier result is based on static and runtime evidence refs, not complete stack inventory."],
    },
  };

  return {
    id: "run_ai_classifier_reporting_fixture",
    target: "https://example.com/",
    normalizedTarget: "example.com",
    createdAt: "2026-05-21T00:00:00.000Z",
    source: "provider",
    records: [
      {
        ...base,
        probe: "ai_classifier_probe",
        layer: 4,
        item: "frontend_framework",
        status: "ok",
        value: {
          provider: "worker_ai_classifier",
          technology: "Next.js",
          category: "frontend_framework",
          confidence: "likely",
          reasoning: "The evidence includes Next.js script paths.",
          evidence_refs: ["AIC001"],
          source_evidence_refs: ["AIC001"],
          limitations: ["Static and runtime evidence can miss server-side technologies."],
          invokes_ai_provider: true,
        },
        risk: {
          level: "info",
          summary: "AI classifier identified Next.js as likely.",
        },
        evidence: [
          {
            type: "ai_classifier_result",
            name: "Next.js",
            value: {
              technology: "Next.js",
              category: "frontend_framework",
              confidence: "likely",
              evidence_refs: ["AIC001"],
            },
          },
        ],
      },
      {
        ...base,
        probe: "ai_classifier_probe",
        layer: 8,
        item: "analytics",
        status: "ok",
        value: {
          provider: "worker_ai_classifier",
          technology: "Google Tag Manager",
          category: "analytics",
          confidence: "likely",
          reasoning: "The evidence includes gtm.js.",
          evidence_refs: ["AIC002"],
          source_evidence_refs: ["AIC002"],
          limitations: ["Runtime-only tags may still be missing."],
          invokes_ai_provider: true,
        },
        risk: {
          level: "info",
          summary: "AI classifier identified Google Tag Manager as likely.",
        },
        evidence: [
          {
            type: "ai_classifier_result",
            name: "Google Tag Manager",
            value: {
              technology: "Google Tag Manager",
              category: "analytics",
              confidence: "likely",
              evidence_refs: ["AIC002"],
            },
          },
        ],
      },
      {
        target: "https://example.com/",
        normalized_target: "example.com",
        snapshot_at: "2026-05-21T00:00:00.000Z",
        probe: "ai_classifier_provider_error",
        layer: 4,
        item: "ai_classifier_status",
        probe_type: "external_api",
        source: "worker_ai_classifier",
        status: "error",
        value: {
          provider: "worker_ai_classifier",
          error: "missing_ai_provider_config",
          message: "AI_PROVIDER_API_KEY and AI_PROVIDER_MODEL are required.",
          invokes_ai_provider: false,
        },
        risk: {
          level: "medium",
          summary: "AI classifier provider failed.",
        },
        evidence: [
          {
            type: "provider_error",
            name: "missing_ai_provider_config",
            value: "AI_PROVIDER_API_KEY and AI_PROVIDER_MODEL are required.",
          },
        ],
        evidence_metadata: {
          origin: "external_provider",
          role: "derived",
          method: "external_api",
          limitations: ["Provider failure means no AI classifier result was collected."],
        },
      },
    ],
  };
}

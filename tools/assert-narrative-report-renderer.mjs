#!/usr/bin/env node
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createReportBrief } = await server.ssrLoadModule("/src/reporters/brief.ts");
  const { renderNarrativeMarkdown } = await server.ssrLoadModule("/src/reporters/markdown.ts");

  if (typeof renderNarrativeMarkdown !== "function") {
    throw new Error("renderNarrativeMarkdown must be exported.");
  }

  const brief = createReportBrief(createFixtureRun());
  const markdown = renderNarrativeMarkdown(brief);

  for (const heading of [
    "# Site Narrative Report: example.com",
    "## Summary",
    "## Layer Findings",
    "## Technical Surface",
    "## Risks",
    "## Missing Data",
    "## Evidence Appendix",
  ]) {
    if (!markdown.includes(heading)) {
      throw new Error(`Narrative markdown is missing section: ${heading}`);
    }
  }

  for (const required of ["E001", "E002", "M001", "M002", "AI provider invoked: no"]) {
    if (!markdown.includes(required)) {
      throw new Error(`Narrative markdown must preserve boundary token: ${required}`);
    }
  }

  if (!/Layer 1.*E001/s.test(markdown)) {
    throw new Error("Layer findings must cite Layer 1 evidence refs.");
  }

  if (!/Missing Data[\s\S]*M001[\s\S]*edge_routing_trace/.test(markdown)) {
    throw new Error("Missing data section must cite missing-data IDs and descriptions.");
  }

  if (!/Evidence Appendix[\s\S]*E001[\s\S]*cf-ray[\s\S]*fixture-ray/.test(markdown)) {
    throw new Error("Evidence appendix must include compact evidence snippets.");
  }

  if (/business model is|current owner is|related domain is/i.test(markdown)) {
    throw new Error("Deterministic narrative must not emit unsupported business, owner, or related-domain claims.");
  }

  console.log("narrative report renderer check passed.");
} finally {
  await server.close();
}

function createFixtureRun() {
  return {
    id: "run_narrative_fixture",
    target: "https://example.com/",
    normalizedTarget: "example.com",
    createdAt: "2026-05-21T00:00:00.000Z",
    source: "provider",
    records: [
      {
        target: "https://example.com/",
        normalized_target: "example.com",
        snapshot_at: "2026-05-21T00:00:00.000Z",
        probe: "cdn_header_evidence_probe",
        layer: 1,
        item: "cdn_header_evidence",
        probe_type: "remote_fetch",
        source: "fixture",
        status: "ok",
        value: {
          coverage: {
            collected: ["cdn_header_signals"],
            missing: ["edge_routing_trace"],
          },
        },
        risk: {
          level: "info",
          summary: "Collected CDN header evidence.",
        },
        evidence: [{ type: "header", name: "cf-ray", value: "fixture-ray" }],
        evidence_metadata: {
          origin: "external_provider",
          role: "derived",
          method: "fetch",
          limitations: ["CDN header evidence is not full edge routing proof."],
        },
      },
      {
        target: "https://example.com/",
        normalized_target: "example.com",
        snapshot_at: "2026-05-21T00:00:00.000Z",
        probe: "organization_intelligence_probe",
        layer: 9,
        item: "organization_intelligence",
        probe_type: "dns_tls",
        source: "fixture",
        status: "ok",
        value: {
          coverage: {
            collected: ["mx"],
            missing: ["related_domain_confirmation"],
          },
        },
        risk: {
          level: "info",
          summary: "Collected organization hints.",
        },
        evidence: [{ type: "dns", name: "mx", value: [] }],
        evidence_metadata: {
          origin: "external_provider",
          role: "derived",
          method: "doh",
          limitations: ["Related-domain claims require manual review."],
        },
      },
    ],
  };
}

#!/usr/bin/env node
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createReportBrief } = await server.ssrLoadModule("/src/reporters/brief.ts");
  const brief = createReportBrief(createFixtureRun());

  if (brief.schema_version !== "site-10-layer-report-brief/v0.1") {
    throw new Error("ReportBrief schema version is not stable.");
  }

  if (brief.ai_boundary.invokes_ai_provider !== false) {
    throw new Error("ReportBrief must not invoke an AI provider.");
  }

  const evidenceRefIds = new Set(brief.evidence_index.map((item) => item.id));
  if (!evidenceRefIds.has("E001")) {
    throw new Error("ReportBrief must preserve collected evidence refs.");
  }

  const firstEvidence = brief.evidence_index.find((item) => item.id === "E001");
  if (!firstEvidence?.metadata || firstEvidence.metadata.origin !== "external_provider" || firstEvidence.metadata.method !== "fetch") {
    throw new Error("ReportBrief evidence_index must preserve evidence metadata origin/method.");
  }

  if (!firstEvidence.evidence_items.some((item) => item.type === "header" && item.name === "cf-ray" && item.value === "fixture-ray")) {
    throw new Error("ReportBrief evidence_index must include compact evidence items.");
  }

  const layerOne = brief.layers.find((layer) => layer.layer === 1);
  if (!layerOne || !layerOne.evidence_refs.includes("E001")) {
    throw new Error("ReportBrief layer summaries must preserve evidence refs.");
  }

  if (!layerOne.limitations.some((text) => /not full edge routing proof/i.test(text))) {
    throw new Error("ReportBrief must preserve layer limitations.");
  }

  const classifications = new Set(brief.missing_data.map((item) => item.classification));
  for (const expected of ["add_provider", "manual_review"]) {
    if (!classifications.has(expected)) {
      throw new Error(`ReportBrief missing_data must include ${expected}.`);
    }
  }

  if (brief.missing_data.some((item) => /not full edge routing proof/i.test(item.description))) {
    throw new Error("ReportBrief must not promote ordinary limitations into missing_data.");
  }

  const edgeGap = brief.missing_data.find((item) => item.description === "edge_routing_trace");
  if (!edgeGap || edgeGap.classification !== "add_provider" || !edgeGap.evidence_refs.includes("E001")) {
    throw new Error("ReportBrief must classify explicit coverage.missing gaps and preserve related evidence refs.");
  }

  const relatedDomainGap = brief.missing_data.find((item) => item.description === "related_domain_confirmation");
  if (!relatedDomainGap || relatedDomainGap.classification !== "manual_review") {
    throw new Error("ReportBrief must classify related_domain_confirmation as manual_review.");
  }

  const l7PermissionedGaps = brief.missing_data.filter((item) => item.layer === 7);
  if (l7PermissionedGaps.length !== 3) {
    throw new Error("ReportBrief fixture should expose the three explicit L7 permissioned backlog gaps.");
  }

  if (l7PermissionedGaps.some((item) => item.classification !== "requires_permission")) {
    throw new Error("ReportBrief must classify L7 deep/authenticated/external service intelligence gaps as requires_permission.");
  }

  if (l7PermissionedGaps.some((item) => !item.description.startsWith("l7_permissioned_"))) {
    throw new Error("ReportBrief must keep remaining L7 service-inventory gaps named as permissioned backlog.");
  }

  if (
    brief.missing_data.some(
      (item) =>
        item.layer === 5 &&
        (item.description === "browser_resource_waterfall" || item.description === "javascript_runtime_resource_injection"),
    )
  ) {
    throw new Error("ReportBrief must let browser runtime resource waterfall evidence satisfy L5 runtime-waterfall gaps.");
  }

  console.log("ReportBrief check passed.");
} finally {
  await server.close();
}

function createFixtureRun() {
  return {
    id: "run_report_brief_fixture",
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
        probe: "service_fingerprint_probe",
        layer: 7,
        item: "service_fingerprint",
        probe_type: "dns_tls",
        source: "fixture",
        status: "ok",
        value: {
          coverage: {
            collected: ["bounded_https_root_observation", "response_headers", "html_title"],
            missing: [
              "l7_permissioned_deep_port_service_inventory",
              "l7_permissioned_authenticated_surface_check",
              "l7_permissioned_external_service_intelligence",
            ],
          },
        },
        risk: {
          level: "info",
          summary: "Collected bounded service fingerprint data.",
        },
        evidence: [{ type: "http_observation", name: "checked_hosts", value: [] }],
        evidence_metadata: {
          origin: "direct_observation",
          role: "derived",
          method: "fetch",
          limitations: ["Default automation does not perform deep service inventory."],
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
            collected: ["mx", "related_domain_candidates"],
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
      {
        target: "https://example.com/",
        normalized_target: "example.com",
        snapshot_at: "2026-05-21T00:00:00.000Z",
        probe: "basic_performance_probe",
        layer: 5,
        item: "basic_performance",
        probe_type: "remote_fetch",
        source: "fixture",
        status: "partial",
        value: {
          coverage: {
            collected: ["ttfb", "html_bytes"],
            missing: ["browser_resource_waterfall", "javascript_runtime_resource_injection"],
          },
        },
        risk: {
          level: "info",
          summary: "Collected baseline performance data.",
        },
        evidence: [{ type: "timing", name: "ttfb_ms", value: 120 }],
        evidence_metadata: {
          origin: "external_provider",
          role: "derived",
          method: "fetch",
          limitations: ["Baseline fetch does not execute JavaScript."],
        },
      },
      {
        target: "https://example.com/",
        normalized_target: "example.com",
        snapshot_at: "2026-05-21T00:00:00.000Z",
        probe: "runtime_resource_waterfall_probe",
        layer: 4,
        item: "runtime_resource_waterfall",
        probe_type: "browser_runtime",
        source: "fixture",
        status: "ok",
        value: {
          resource_count: 2,
          resources: [
            { url: "https://example.com/", resource_type: "document", start_time_ms: 0, duration_ms: 42 },
            { url: "https://example.com/app.js", resource_type: "script", start_time_ms: 45, duration_ms: 12 },
          ],
        },
        risk: {
          level: "info",
          summary: "Collected runtime resource waterfall.",
        },
        evidence: [{ type: "runtime_resource", name: "app.js", value: "https://example.com/app.js" }],
        evidence_metadata: {
          origin: "external_provider",
          role: "derived",
          method: "browser_runtime",
          limitations: ["Single browser runtime path only."],
        },
      },
    ],
  };
}

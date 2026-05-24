#!/usr/bin/env node
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createOrganizationLayerRecords } = await server.ssrLoadModule("/src/probes/layer-09-organization.ts");
  const { createReportBrief } = await server.ssrLoadModule("/src/reporters/brief.ts");
  const { createRelatedDomainConfirmationContract } = await server.ssrLoadModule(
    "/src/providers/related-domains/contract.ts",
  );
  const context = {
    target: "https://example.com/",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-21T00:00:00.000Z",
    providers: [],
  };
  const records = createOrganizationLayerRecords(context, createFixtureResult());
  const organizationRecord = records.find((record) => record.probe === "organization_intelligence_probe");

  if (!organizationRecord) {
    throw new Error("Expected createOrganizationLayerRecords() to emit organization_intelligence_probe.");
  }

  const value = organizationRecord.value;
  if (!value || typeof value !== "object") {
    throw new Error("Organization record must contain a structured value object.");
  }

  if (!Array.isArray(value.related_domain_candidates) || value.related_domain_candidates.length !== 2) {
    throw new Error("Organization record must preserve related_domain_candidates evidence.");
  }

  if (!value.coverage?.collected?.includes("related_domain_candidates")) {
    throw new Error("Organization coverage must collect related_domain_candidates when candidates exist.");
  }

  if (!value.coverage?.missing?.includes("related_domain_confirmation")) {
    throw new Error("Organization coverage must keep related_domain_confirmation as missing data.");
  }

  if (value.coverage?.missing?.includes("related_domains")) {
    throw new Error("Organization coverage must not use ambiguous related_domains after candidate collection exists.");
  }

  const signals = value.organization_assessment?.signals ?? [];
  if (!signals.some((signal) => signal.type === "related_domain_candidate" && signal.name === "docs.example.net")) {
    throw new Error("Organization assessment must expose related_domain_candidate signals.");
  }
  if (!signals.some((signal) => signal.name === "assets.example-cdn.net" && signal.value?.role === "cdn_asset")) {
    throw new Error("Organization assessment must preserve related-domain candidate role context.");
  }

  const serialized = JSON.stringify(value);
  if (/confirmed related domain|confirmed relationship/i.test(serialized)) {
    throw new Error("Related-domain candidates must not be phrased as confirmed relationships.");
  }

  const brief = createReportBrief({
    id: "run_related_domain_fixture",
    target: "https://example.com/",
    normalizedTarget: "example.com",
    createdAt: "2026-05-21T00:00:00.000Z",
    source: "provider",
    records,
  });
  const relatedConfirmationGap = brief.missing_data.find((item) => item.description === "related_domain_confirmation");
  if (!relatedConfirmationGap || relatedConfirmationGap.classification !== "manual_review") {
    throw new Error("ReportBrief must classify related_domain_confirmation as manual_review.");
  }
  const icpGaps = brief.missing_data.filter((item) => /(^icp$|external_intelligence\.icp)/i.test(item.description));
  if (icpGaps.length !== 1 || icpGaps[0].classification !== "out_of_scope") {
    throw new Error("ReportBrief must emit one out_of_scope ICP gap, not duplicate ICP missing-data entries.");
  }

  const contract = createRelatedDomainConfirmationContract({
    id: "run_related_domain_fixture",
    target: "https://example.com/",
    normalizedTarget: "example.com",
    createdAt: "2026-05-21T00:00:00.000Z",
    source: "provider",
    records,
  });
  const candidate = contract.input.evidence[0]?.candidates.find((item) => item.host === "assets.example-cdn.net");
  if (!candidate || candidate.role !== "cdn_asset") {
    throw new Error("Related-domain confirmation contract must preserve candidate role context.");
  }
  if (!candidate.evidence_items?.some((item) => item.name === "attribute" && item.value === "src")) {
    throw new Error("Related-domain confirmation contract must preserve compact candidate evidence items.");
  }

  console.log("Organization related-domain candidate check passed.");
} finally {
  await server.close();
}

function createFixtureResult() {
  return {
    requested_url: "https://example.com/",
    host: "www.example.com",
    dns: {
      mx: { type: "MX", status: 0, answers: [] },
      ns: { type: "NS", status: 0, answers: [] },
      txt: { type: "TXT", status: 0, answers: [] },
      caa: { type: "CAA", status: 0, answers: [] },
    },
    mail_providers: [],
    social_links: [],
    related_domain_candidates: [
      {
        host: "docs.example.net",
        url: "https://docs.example.net/start",
        signal: "homepage_anchor_host",
        role: "documentation",
        source: "homepage_html",
        evidence: [
          { type: "html_attribute", name: "attribute", value: "href" },
          { type: "url_pattern", name: "path_hint", value: "/start" },
        ],
      },
      {
        host: "assets.example-cdn.net",
        url: "https://assets.example-cdn.net/app.js",
        signal: "homepage_resource_host",
        role: "cdn_asset",
        source: "homepage_html",
        evidence: [
          { type: "html_attribute", name: "attribute", value: "src" },
          { type: "hostname_pattern", name: "cdn_hint", value: "assets.example-cdn.net" },
        ],
      },
    ],
    external_intelligence: {
      whois: { status: "not_collected", reason: "RDAP lookup is out of scope for this fixture." },
      icp: { status: "not_collected", reason: "ICP lookup is out of scope." },
      wayback: { status: "not_collected", reason: "Wayback lookup is out of scope for this fixture." },
    },
    duration_ms: 120,
    provider_id: "worker-organization-intelligence",
    source: "cloudflare_worker_org_intel",
  };
}

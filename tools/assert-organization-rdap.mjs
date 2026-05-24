#!/usr/bin/env node
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createOrganizationLayerRecords } = await server.ssrLoadModule("/src/probes/layer-09-organization.ts");
  const context = {
    target: "https://example.com/",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-21T00:00:00.000Z",
    providers: [],
  };
  const records = createOrganizationLayerRecords(context, createFixtureResult());
  const rdapRecord = records.find((record) => record.probe === "rdap_whois_lite_probe");

  if (!rdapRecord) {
    throw new Error("Expected createOrganizationLayerRecords() to emit rdap_whois_lite_probe.");
  }

  if (rdapRecord.layer !== 9 || rdapRecord.item !== "rdap_whois_lite") {
    throw new Error("RDAP record must be a Layer 9 rdap_whois_lite item.");
  }

  if (rdapRecord.status !== "ok") {
    throw new Error(`Expected RDAP fixture record status ok, received ${rdapRecord.status}.`);
  }

  if (!rdapRecord.value || typeof rdapRecord.value !== "object") {
    throw new Error("RDAP record must contain a structured value object.");
  }

  if (rdapRecord.value.registrar !== "Example Registrar, Inc.") {
    throw new Error("RDAP record did not preserve registrar evidence.");
  }

  const limitations = rdapRecord.evidence_metadata?.limitations;
  if (!Array.isArray(limitations) || !limitations.some((text) => /not proof of current operating entity ownership/i.test(text))) {
    throw new Error("RDAP record must state that registration evidence is not ownership proof.");
  }

  console.log("Organization RDAP check passed.");
} finally {
  await server.close();
}

function createFixtureResult() {
  return {
    requested_url: "https://example.com/",
    host: "www.example.com",
    dns: {
      mx: { type: "MX", status: 0, answers: [] },
      ns: { type: "NS", status: 0, answers: [{ name: "example.com", type: 2, ttl: 3600, data: "a.iana-servers.net." }] },
      txt: { type: "TXT", status: 0, answers: [] },
      caa: { type: "CAA", status: 0, answers: [] },
    },
    mail_providers: [],
    social_links: [],
    external_intelligence: {
      whois: {
        status: "rdap_collected",
        source: "rdap",
        provider: "rdap.org",
        query_domain: "example.com",
        rdap_url: "https://rdap.org/domain/example.com",
        object_class_name: "domain",
        handle: "2336799_DOMAIN_COM-VRSN",
        ldh_name: "EXAMPLE.COM",
        unicode_name: null,
        registrar: "Example Registrar, Inc.",
        nameservers: ["A.IANA-SERVERS.NET", "B.IANA-SERVERS.NET"],
        status_values: ["client delete prohibited"],
        events: [
          { action: "registration", date: "1995-08-14T04:00:00Z" },
          { action: "expiration", date: "2026-08-13T04:00:00Z" },
        ],
        notices: [],
        links: [{ rel: "self", href: "https://rdap.org/domain/example.com" }],
      },
      icp: { status: "not_collected", reason: "ICP lookup is out of scope." },
      wayback: { status: "not_collected", reason: "Wayback lookup is out of scope for this slice." },
    },
    duration_ms: 120,
    provider_id: "worker-organization-intelligence",
    source: "cloudflare_worker_org_intel",
  };
}

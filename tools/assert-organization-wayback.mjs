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
  const waybackRecord = records.find((record) => record.probe === "wayback_history_probe");

  if (!waybackRecord) {
    throw new Error("Expected createOrganizationLayerRecords() to emit wayback_history_probe.");
  }

  if (waybackRecord.layer !== 9 || waybackRecord.item !== "wayback_history") {
    throw new Error("Wayback record must be a Layer 9 wayback_history item.");
  }

  if (waybackRecord.status !== "ok") {
    throw new Error(`Expected Wayback fixture record status ok, received ${waybackRecord.status}.`);
  }

  if (!waybackRecord.value || typeof waybackRecord.value !== "object") {
    throw new Error("Wayback record must contain a structured value object.");
  }

  if (waybackRecord.value.snapshot_count_estimate !== 42) {
    throw new Error("Wayback record did not preserve snapshot count evidence.");
  }

  const limitations = waybackRecord.evidence_metadata?.limitations;
  if (!Array.isArray(limitations) || !limitations.some((text) => /not proof of current operation or ownership/i.test(text))) {
    throw new Error("Wayback record must state that archive evidence is not proof of current operation or ownership.");
  }

  console.log("Organization Wayback check passed.");
} finally {
  await server.close();
}

function createFixtureResult() {
  return {
    requested_url: "https://example.com/",
    host: "example.com",
    dns: {
      mx: { type: "MX", status: 0, answers: [] },
      ns: { type: "NS", status: 0, answers: [] },
      txt: { type: "TXT", status: 0, answers: [] },
      caa: { type: "CAA", status: 0, answers: [] },
    },
    mail_providers: [],
    social_links: [],
    external_intelligence: {
      whois: {
        status: "not_available",
        source: "rdap",
        provider: "rdap.org",
        query_domain: "example.com",
        rdap_url: "https://rdap.org/domain/example.com",
        reason: "RDAP fixture is not relevant for this check.",
        error: null,
      },
      icp: { status: "not_collected", reason: "ICP lookup is out of scope." },
      wayback: {
        status: "wayback_collected",
        source: "internet_archive",
        provider: "web.archive.org_cdx",
        query_url: "https://example.com/",
        cdx_url: "https://web.archive.org/cdx?url=https%3A%2F%2Fexample.com%2F",
        snapshot_count_estimate: 42,
        count_mode: "cdx_show_num_pages_page_size_1",
        first_snapshot: {
          timestamp: "20020120142510",
          date: "2002-01-20T14:25:10.000Z",
          original_url: "http://example.com:80/",
          archive_url: "https://web.archive.org/web/20020120142510/http://example.com:80/",
          status_code: 200,
          mimetype: "text/html",
        },
        last_snapshot: {
          timestamp: "20260521021504",
          date: "2026-05-21T02:15:04.000Z",
          original_url: "https://example.com/",
          archive_url: "https://web.archive.org/web/20260521021504/https://example.com/",
          status_code: 200,
          mimetype: "text/html",
        },
        sample_snapshots: [],
      },
    },
    duration_ms: 120,
    provider_id: "worker-organization-intelligence",
    source: "cloudflare_worker_org_intel",
  };
}

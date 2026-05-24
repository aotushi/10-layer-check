#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { normalizeSiteScanProviderResults } = await server.ssrLoadModule("/src/providers/results/normalize.ts");
  const { createAnalysisReport } = await server.ssrLoadModule("/src/reporters/analysis.ts");
  const { createReportBrief } = await server.ssrLoadModule("/src/reporters/brief.ts");
  const { renderNarrativeMarkdown } = await server.ssrLoadModule("/src/reporters/markdown.ts");

  const baseInput = {
    target: "https://example.com/",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-21T00:00:00.000Z",
    providers: [],
  };

  const records = normalizeSiteScanProviderResults({
    ...baseInput,
    scanStartEnvelope: createScanStartEnvelope(),
    asyncResultEnvelopes: {
      live_tls: createLiveTlsProviderResult(baseInput),
    },
  });

  const liveTlsRecord = records.find((record) => record.probe === "tls_live_certificate_probe");
  assert.equal(liveTlsRecord?.layer, 2);
  assert.equal(liveTlsRecord?.item, "tls_live_certificate");
  assert.equal(liveTlsRecord?.source, "node_tls_socket");
  assert.equal(liveTlsRecord?.value.host, "example.com");
  assert.equal(liveTlsRecord?.value.days_until_expiry, 120);
  assert.ok(
    liveTlsRecord?.evidence.some((item) => item.type === "tls_certificate_chain"),
    "completed live TLS provider result should preserve certificate-chain evidence",
  );
  assert.ok(
    !records.some((record) => record.probe === "provider_result_status" && record.source === "github_actions_live_tls"),
    "completed live TLS result must not remain a provider-status placeholder",
  );

  const run = {
    id: "live-tls-normalizer-fixture",
    target: baseInput.target,
    normalizedTarget: baseInput.normalizedTarget,
    createdAt: baseInput.snapshotAt,
    source: "provider",
    records: [createWorkerTlsMetadataRecord(baseInput), ...records],
  };

  const analysis = createAnalysisReport(run);
  assert.ok(analysis.coverage.collected_layers.includes(2), "completed live TLS evidence should collect L2");
  assert.ok(
    analysis.evidence_index.some((item) => item.layer === 2 && item.probe === "tls_live_certificate_probe"),
    "analysis evidence index should include live TLS evidence",
  );

  const brief = createReportBrief(run, analysis);
  const briefEvidence = brief.evidence_index.find((item) => item.probe === "tls_live_certificate_probe");
  assert.equal(briefEvidence?.layer, 2);
  assert.ok(
    briefEvidence?.evidence_items.some((item) => item.type === "tls_certificate"),
    "ReportBrief should carry compact live certificate evidence",
  );
  assert.ok(
    !brief.missing_data.some((item) => item.layer === 2 && /github_actions_live_tls|live_tls|pending/i.test(item.description)),
    "completed live TLS result should not remain a pending missing-data boundary",
  );
  assert.ok(
    !brief.missing_data.some(
      (item) =>
        item.layer === 2 &&
        /current_certificate|live_certificate_chain|live_certificate_san|live_certificate_issuer|live_certificate_expiry/i.test(
          item.description,
        ),
    ),
    "completed live TLS evidence should satisfy Worker TLS metadata live-certificate gaps",
  );

  const markdown = renderNarrativeMarkdown(brief);
  assert.match(markdown, /^# Site Narrative Report: example\.com/m);
  assert.match(markdown, /tls_live_certificate_probe|tls_live_certificate/i);
  assert.ok(!markdown.includes("undefined"));

  console.log("live TLS result normalizer check passed.");
} finally {
  await server.close();
}

function createScanStartEnvelope() {
  return {
    schema_version: "site-10-layer-scan-start/v0.1",
    provider: "cloudflare_worker_site_scan",
    requested_url: "https://example.com/",
    normalized_url: "https://example.com/",
    normalized_target: "example.com",
    status: "ok",
    sync_probes: [],
    async_providers: ["live_tls"],
    sync_results: {},
    async_jobs: [
      {
        capability: "live_tls",
        provider: "github_actions_live_tls",
        request_id: "tls-request",
        run_id: 456,
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/example/actions/runs/456",
        endpoints: {
          status: "/provider/github/live-tls/status?id=tls-request",
          result: "/provider/github/live-tls/result?id=tls-request",
        },
      },
    ],
    coverage: {
      collected: [],
      pending: ["live_tls"],
      failed: [],
    },
  };
}

function createLiveTlsProviderResult(baseInput) {
  return {
    provider: "github_actions_live_tls",
    request_id: "tls-request",
    run_id: 456,
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/example/actions/runs/456",
    records: [createLiveTlsRecord(baseInput)],
  };
}

function createLiveTlsRecord(baseInput) {
  return {
    target: baseInput.target,
    normalized_target: baseInput.normalizedTarget,
    snapshot_at: baseInput.snapshotAt,
    probe: "tls_live_certificate_probe",
    layer: 2,
    item: "tls_live_certificate",
    probe_type: "node_tls",
    source: "node_tls_socket",
    status: "ok",
    value: {
      host: "example.com",
      port: 443,
      authorized: true,
      authorization_error: null,
      protocol: "TLSv1.3",
      cipher: {
        name: "TLS_AES_256_GCM_SHA384",
        standardName: "TLS_AES_256_GCM_SHA384",
        version: "TLSv1.3",
      },
      certificate: {
        subject: { CN: "example.com" },
        issuer: { CN: "Example CA" },
        subject_alt_names: ["example.com", "www.example.com"],
        valid_from: "May 21 00:00:00 2026 GMT",
        valid_to: "Sep 18 00:00:00 2026 GMT",
        fingerprint256: "AA:BB:CC",
        serial_number: "01",
        raw_subject_alt_name: "DNS:example.com, DNS:www.example.com",
      },
      chain: [
        {
          subject: { CN: "example.com" },
          issuer: { CN: "Example CA" },
          subject_alt_names: ["example.com", "www.example.com"],
          valid_from: "May 21 00:00:00 2026 GMT",
          valid_to: "Sep 18 00:00:00 2026 GMT",
          fingerprint256: "AA:BB:CC",
          serial_number: "01",
          raw_subject_alt_name: "DNS:example.com, DNS:www.example.com",
        },
      ],
      days_until_expiry: 120,
    },
    risk: {
      level: "info",
      summary: "Live certificate expires in 120 day(s).",
    },
    evidence: [
      { type: "tls_protocol", value: "TLSv1.3" },
      {
        type: "tls_cipher",
        value: {
          name: "TLS_AES_256_GCM_SHA384",
          standardName: "TLS_AES_256_GCM_SHA384",
          version: "TLSv1.3",
        },
      },
      {
        type: "tls_certificate",
        name: "leaf",
        value: {
          subject: { CN: "example.com" },
          issuer: { CN: "Example CA" },
          subject_alt_names: ["example.com", "www.example.com"],
          valid_to: "Sep 18 00:00:00 2026 GMT",
        },
      },
      {
        type: "tls_certificate_chain",
        value: [{ subject: { CN: "example.com" }, issuer: { CN: "Example CA" } }],
      },
    ],
    evidence_metadata: {
      origin: "direct_observation",
      role: "raw",
      method: "tls_socket",
      limitations: [
        "This record is collected by Node.js TLS socket inspection, not Cloudflare Worker Fetch.",
        "The certificate reflects the probe runtime network path and SNI target at collection time.",
      ],
    },
    duration_ms: 120,
  };
}

function createWorkerTlsMetadataRecord(baseInput) {
  return {
    target: baseInput.target,
    normalized_target: baseInput.normalizedTarget,
    snapshot_at: baseInput.snapshotAt,
    probe: "tls_certificate_probe",
    layer: 2,
    item: "tls_certificate",
    probe_type: "dns_tls",
    source: "cloudflare_worker_tls",
    status: "warning",
    value: {
      https_reachability: { reachable: true, status_code: 200 },
      hsts: { present: true, raw: "max-age=31536000" },
      ct_log: { status: "ok", certificates: [] },
      current_certificate: {
        status: "not_collected",
        reason: "Worker fetch does not expose the live certificate chain.",
      },
      coverage: {
        collected: ["https_reachability", "hsts", "ct_log"],
        missing: [
          "live_certificate_chain",
          "live_certificate_san",
          "live_certificate_issuer",
          "live_certificate_expiry",
        ],
      },
    },
    risk: {
      level: "info",
      summary: "Worker TLS metadata collected.",
    },
    evidence: [{ type: "http_header", name: "strict-transport-security", value: "max-age=31536000" }],
    evidence_metadata: {
      origin: "external_provider",
      role: "derived",
      method: "worker_fetch",
      limitations: ["Worker fetch does not expose the live certificate chain."],
    },
  };
}

#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { normalizeProviderResult } = await server.ssrLoadModule("/src/providers/results/normalize.ts");

  const baseInput = {
    target: "https://example.com/",
    normalizedTarget: "example.com",
    snapshotAt: "2026-05-21T00:00:00.000Z",
    providers: [],
  };

  const records = normalizeProviderResult({
    ...baseInput,
    envelope: {
      schema_version: "site-10-layer-scan-start/v0.1",
      provider: "cloudflare_worker_site_scan",
      requested_url: "https://example.com/",
      normalized_url: "https://example.com/",
      normalized_target: "example.com",
      status: "ok",
      sync_probes: [
        "dns_infrastructure",
        "tls_certificate",
        "subdomain_attack_surface",
        "organization_intelligence",
        "malformed_probe",
      ],
      async_providers: [],
      sync_results: {
        dns_infrastructure: {
          status: "fulfilled",
          result: createDnsInfrastructureFixture(),
        },
        tls_certificate: {
          status: "fulfilled",
          result: createTlsCertificateFixture(),
        },
        subdomain_attack_surface: {
          status: "fulfilled",
          result: createSubdomainAttackSurfaceFixture(),
        },
        organization_intelligence: {
          status: "fulfilled",
          result: createOrganizationIntelligenceFixture(),
        },
        malformed_probe: {
          status: "fulfilled",
          result: { ok: true },
        },
      },
      async_jobs: [],
      coverage: {
        collected: ["dns_infrastructure", "tls_certificate", "subdomain_attack_surface", "organization_intelligence"],
        pending: [],
        failed: [],
      },
    },
  });

  assertHasRecord(records, 1, "network_infrastructure_probe");
  assertHasRecord(records, 2, "tls_certificate_probe");
  assertHasRecord(records, 7, "subdomain_attack_surface_probe");
  assertHasRecord(records, 9, "organization_intelligence_probe");
  assertHasRecord(records, 9, "rdap_whois_lite_probe");
  assertHasRecord(records, 9, "wayback_history_probe");

  assert.ok(
    !records.some(
      (record) =>
        record.probe === "provider_result_status" &&
        record.value?.error_code === "unsupported_site_scan_sync_result" &&
        record.source !== "site_scan_sync_malformed_probe",
    ),
    "Supported sync probes must not be downgraded to unsupported provider status records.",
  );

  const malformedStatus = records.find(
    (record) => record.probe === "provider_result_status" && record.source === "site_scan_sync_malformed_probe",
  );
  assert.equal(malformedStatus?.status, "skipped");
  assert.equal(malformedStatus?.value.error_code, "unsupported_site_scan_sync_result");

  console.log("scan sync normalizer check passed.");
} finally {
  await server.close();
}

function assertHasRecord(records, layer, probe) {
  assert.ok(
    records.some((record) => record.layer === layer && record.probe === probe),
    `Expected normalized scan records to include L${layer} ${probe}.`,
  );
}

function createDnsQuery(type, answers = []) {
  return { type, status: 0, answers };
}

function createProtocol(url, statusCode = 200) {
  return {
    url,
    reachable: true,
    status_code: statusCode,
    redirected_to: null,
    error: null,
  };
}

function createDnsInfrastructureFixture() {
  return {
    requested_url: "https://example.com/",
    host: "example.com",
    dns: {
      a: createDnsQuery("A", [{ name: "example.com", type: 1, ttl: 300, data: "93.184.216.34" }]),
      aaaa: createDnsQuery("AAAA", [{ name: "example.com", type: 28, ttl: 300, data: "2606:2800:220:1:248:1893:25c8:1946" }]),
      cname: createDnsQuery("CNAME"),
      https: createDnsQuery("HTTPS"),
    },
    ip_addresses: {
      ipv4: ["93.184.216.34"],
      ipv6: ["2606:2800:220:1:248:1893:25c8:1946"],
    },
    cdn: {
      detected: true,
      providers: ["cloudflare"],
      evidence: ["server: cloudflare"],
      confidence: "low",
    },
    asn: {
      status: "ok",
      provider: "bgpview",
      records: [
        {
          ip: "93.184.216.34",
          asn: "15133",
          prefix: "93.184.216.0/24",
          country_code: "US",
          registry: "arin",
          allocated: "2008-06-02",
          name: "EDGECAST",
        },
      ],
      queried_ip_count: 1,
      error: null,
    },
    protocol_reachability: {
      http: createProtocol("http://example.com/", 301),
      https: createProtocol("https://example.com/", 200),
    },
    duration_ms: 91,
    provider_id: "cloudflare_worker_dns_infrastructure",
    source: "cloudflare_worker_dns_tls",
  };
}

function createTlsCertificateFixture() {
  return {
    requested_url: "https://example.com/",
    host: "example.com",
    https_reachability: createProtocol("https://example.com/", 200),
    hsts: {
      present: true,
      raw: "max-age=31536000; includeSubDomains",
      max_age_seconds: 31536000,
      include_subdomains: true,
      preload: false,
    },
    ct_log: {
      provider: "certspotter",
      status: "ok",
      certificates: [
        {
          id: "fixture-cert",
          dns_names: ["example.com", "www.example.com"],
          issuer_name: "CN=Example CA",
          issuer_friendly_name: "Example CA",
          not_before: "2026-01-01T00:00:00Z",
          not_after: "2026-12-31T23:59:59Z",
          revoked: false,
          cert_sha256: "fixture-sha256",
        },
      ],
      error: null,
    },
    current_certificate: {
      status: "not_collected",
      reason: "Worker fetch does not expose the live certificate chain.",
    },
    coverage: {
      collected: ["https_reachability", "hsts", "ct_log"],
      missing: ["live_certificate_chain"],
    },
    duration_ms: 88,
    provider_id: "cloudflare_worker_tls_certificate",
    source: "cloudflare_worker_dns_tls",
  };
}

function createSubdomainAttackSurfaceFixture() {
  return {
    requested_url: "https://example.com/",
    host: "example.com",
    ct_log: {
      provider: "certspotter",
      status: "ok",
      certificate_count: 2,
      error: null,
    },
    discovered_subdomains: [
      {
        host: "admin.example.com",
        source: "ct_log",
        indicators: ["admin"],
      },
    ],
    reachability: [
      {
        host: "admin.example.com",
        https: createProtocol("https://admin.example.com/", 200),
      },
    ],
    exposed_surface_hints: [
      {
        host: "admin.example.com",
        hint: "admin",
        reason: "Hostname contains admin.",
      },
    ],
    limits: {
      max_reachability_checks: 5,
      checked_count: 1,
    },
    duration_ms: 144,
    provider_id: "cloudflare_worker_subdomain_attack_surface",
    source: "cloudflare_worker_dns_tls",
  };
}

function createOrganizationIntelligenceFixture() {
  return {
    requested_url: "https://example.com/",
    host: "example.com",
    dns: {
      mx: createDnsQuery("MX", [{ name: "example.com", type: 15, ttl: 300, data: "10 mail.example.com." }]),
      ns: createDnsQuery("NS", [{ name: "example.com", type: 2, ttl: 300, data: "a.iana-servers.net." }]),
      txt: createDnsQuery("TXT", [{ name: "example.com", type: 16, ttl: 300, data: "v=spf1 include:_spf.example.com ~all" }]),
      caa: createDnsQuery("CAA"),
    },
    mail_providers: [{ provider: "custom_mx", evidence: "mail.example.com." }],
    social_links: [{ platform: "github", url: "https://github.com/example" }],
    related_domain_candidates: [
      {
        host: "docs.example.net",
        url: "https://docs.example.net/start",
        signal: "homepage_anchor_host",
        source: "homepage_html",
      },
    ],
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
        events: [{ action: "registration", date: "1995-08-14T04:00:00Z" }],
        notices: [],
        links: [{ rel: "self", href: "https://rdap.org/domain/example.com" }],
      },
      icp: { status: "not_collected", reason: "ICP lookup is out of scope." },
      wayback: {
        status: "wayback_collected",
        source: "internet_archive",
        provider: "web.archive.org_cdx",
        query_url: "https://example.com/",
        cdx_url: "https://web.archive.org/cdx?url=https%3A%2F%2Fexample.com%2F",
        snapshot_count_estimate: 12,
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
    duration_ms: 166,
    provider_id: "cloudflare_worker_organization_intelligence",
    source: "cloudflare_worker_org_intel",
  };
}

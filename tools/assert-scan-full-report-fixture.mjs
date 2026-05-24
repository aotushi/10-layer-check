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
    scanStartEnvelope: createFullScanStartEnvelope(),
  });

  for (const layer of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    assert.ok(
      records.some((record) => record.layer === layer && record.probe !== "provider_result_status"),
      `Expected full scan fixture to include positive Layer ${layer} evidence.`,
    );
  }

  assert.ok(records.some((record) => record.layer === 5 && record.probe === "performance_probe" && record.source === "pagespeed_api"));
  assert.ok(records.some((record) => record.layer === 5 && record.probe === "basic_performance_probe"));
  assert.ok(!records.some((record) => record.source === "webpagetest_api" && record.probe === "performance_probe"));

  const webPageTestPending = records.find(
    (record) => record.probe === "provider_result_status" && record.source === "webpagetest",
  );
  assert.equal(webPageTestPending?.layer, 5);
  assert.equal(webPageTestPending?.status, "skipped");
  assert.equal(webPageTestPending?.value.request_id, "250521_AiDc7_TEST");

  const run = {
    id: "scan-full-report-fixture",
    target: baseInput.target,
    normalizedTarget: baseInput.normalizedTarget,
    createdAt: baseInput.snapshotAt,
    source: "provider",
    records,
  };
  const analysis = createAnalysisReport(run);
  const brief = createReportBrief(run, analysis);
  const narrative = renderNarrativeMarkdown(brief);

  assert.equal(analysis.schema_version, "site-10-layer-analysis/v0.1");
  assert.deepEqual(analysis.coverage.collected_layers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(analysis.coverage.missing_layers.length, 0);
  assert.ok(analysis.evidence_index.some((item) => item.source === "pagespeed_api"));
  assert.ok(!analysis.evidence_index.some((item) => item.source === "webpagetest"));

  assert.equal(brief.schema_version, "site-10-layer-report-brief/v0.1");
  assert.ok(brief.evidence_index.some((item) => item.source === "pagespeed_api"));
  assert.ok(
    brief.missing_data.some(
      (item) =>
        item.layer === 5 &&
        item.classification === "add_provider" &&
        /webpagetest.*queued|webpagetest.*no completed target evidence/i.test(item.description),
    ),
    "Pending WebPageTest job must be visible as missing-data boundary.",
  );
  assert.ok(
    !brief.missing_data.some((item) => item.layer === 5 && item.description === "lighthouse_score"),
    "PageSpeed performance_score must satisfy the L5 lighthouse_score gap.",
  );
  assert.ok(
    !brief.missing_data.some((item) => item.layer === 5 && item.description === "core_web_vitals_field_data"),
    "PageSpeed CrUX field data must satisfy the L5 core_web_vitals_field_data gap.",
  );

  assert.match(narrative, /^# Site Narrative Report: example\.com/m);
  assert.match(narrative, /## Layer Findings/);
  assert.match(narrative, /## Missing Data/);
  assert.match(narrative, /webpagetest/i);
  assert.ok(!narrative.includes("undefined"));

  console.log("scan full report fixture check passed.");
} finally {
  await server.close();
}

function createFullScanStartEnvelope() {
  return {
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
      "remote_fetch",
      "performance_basic",
    ],
    async_providers: ["pagespeed", "webpagetest"],
    sync_results: {
      dns_infrastructure: { status: "fulfilled", result: createDnsInfrastructureFixture() },
      tls_certificate: { status: "fulfilled", result: createTlsCertificateFixture() },
      subdomain_attack_surface: { status: "fulfilled", result: createSubdomainAttackSurfaceFixture() },
      organization_intelligence: { status: "fulfilled", result: createOrganizationIntelligenceFixture() },
      remote_fetch: { status: "fulfilled", result: createRemoteFetchFixture() },
      performance_basic: { status: "fulfilled", result: createBasicPerformanceFixture() },
    },
    async_jobs: [
      {
        capability: "pagespeed",
        provider: "pagespeed",
        provider_schema_version: "site-10-layer-performance-provider-result/v0.1",
        request_id: null,
        run_id: null,
        status: "completed",
        status_code: null,
        conclusion: "success",
        html_url: null,
        endpoints: { status: null, result: null },
        result_envelope: createPageSpeedEnvelope(),
      },
      {
        capability: "webpagetest",
        provider: "webpagetest",
        provider_schema_version: "site-10-layer-webpagetest-start/v0.1",
        request_id: "250521_AiDc7_TEST",
        run_id: null,
        status: "queued",
        status_code: 200,
        conclusion: null,
        html_url: "https://www.webpagetest.org/result/250521_AiDc7_TEST/",
        endpoints: {
          status: "/provider/performance/webpagetest/status?id=250521_AiDc7_TEST",
          result: "/provider/performance/webpagetest/result?id=250521_AiDc7_TEST",
        },
      },
    ],
    coverage: {
      collected: [
        "dns_infrastructure",
        "tls_certificate",
        "subdomain_attack_surface",
        "organization_intelligence",
        "remote_fetch",
        "performance_basic",
        "pagespeed",
      ],
      pending: ["webpagetest"],
      failed: [],
    },
  };
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
    discovered_subdomains: [{ host: "admin.example.com", source: "ct_log", indicators: ["admin"] }],
    reachability: [{ host: "admin.example.com", https: createProtocol("https://admin.example.com/", 200) }],
    exposed_surface_hints: [{ host: "admin.example.com", hint: "admin", reason: "Hostname contains admin." }],
    limits: { max_reachability_checks: 5, checked_count: 1 },
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
      { host: "docs.example.net", url: "https://docs.example.net/start", signal: "homepage_anchor_host", source: "homepage_html" },
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

function createRemoteFetchFixture() {
  return {
    requested_url: "https://example.com/",
    final_url: "https://example.com/",
    status_code: 200,
    ok: true,
    redirected: false,
    redirect_chain: [],
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "max-age=60",
      server: "cloudflare",
      "cf-ray": "fixture-ray",
      "set-cookie": "session=fixture; HttpOnly; Secure; SameSite=Lax",
    },
    html: '<!doctype html><title>Example</title><meta name="generator" content="Next.js"><script src="/app.js"></script><a href="/api/status">API</a>',
    crawl_metadata: {
      robots_txt: {
        url: "https://example.com/robots.txt",
        status_code: 200,
        found: true,
        body_excerpt: "User-agent: *",
        sitemap_urls: ["https://example.com/sitemap.xml"],
        disallow_count: 0,
      },
      sitemap_xml: {
        url: "https://example.com/sitemap.xml",
        status_code: 200,
        found: true,
        content_type: "application/xml",
        body_excerpt: "<urlset></urlset>",
      },
    },
    duration_ms: 42,
    provider_id: "cloudflare_worker_fetch",
    source: "cloudflare_worker_fetch",
  };
}

function createBasicPerformanceFixture() {
  return {
    requested_url: "https://example.com/",
    final_url: "https://example.com/",
    status_code: 200,
    ok: true,
    timings: { ttfb_ms: 120, total_ms: 260, body_read_ms: 80, redirect_count: 0 },
    document: {
      html_bytes: 1024,
      encoded_content_length: 1024,
      content_type: "text/html; charset=utf-8",
      content_encoding: null,
      cache_control: "max-age=60",
      cdn_cache_status: "HIT",
    },
    declared_resources: { scripts: 1, stylesheets: 0, images: 0, preloads: 0, total: 1 },
    sampled_resources: [],
    page_weight_estimate: {
      known_bytes: 1024,
      html_bytes: 1024,
      sampled_resource_bytes: 0,
      unknown_sampled_resources: 0,
      sampled_resource_count: 0,
      declared_resource_count: 1,
      note: "Fixture page-weight estimate.",
    },
    coverage: {
      collected: ["ttfb", "html_bytes"],
      missing: ["runtime_resource_waterfall", "lighthouse_score", "core_web_vitals_field_data"],
    },
    duration_ms: 260,
    provider_id: "cloudflare_worker_performance_basic",
    source: "cloudflare_worker_performance_basic",
  };
}

function createPageSpeedEnvelope() {
  return {
    ok: true,
    schema_version: "site-10-layer-performance-provider-result/v0.1",
    provider: "pagespeed",
    result: {
      requested_url: "https://example.com/",
      final_url: "https://example.com/",
      strategy: "mobile",
      provider: "pagespeed",
      metrics: [
        { id: "first-contentful-paint", label: "First Contentful Paint", value: 810, unit: "ms", rating: "good" },
        { id: "largest-contentful-paint", label: "Largest Contentful Paint", value: 1340, unit: "ms", rating: "good" },
      ],
      opportunities: [],
      raw_summary: {
        performance_score: 0.91,
        accessibility_score: 0.82,
        best_practices_score: 0.88,
        seo_score: 0.93,
        field_data: {
          available: true,
          page: {
            url: "https://example.com/",
            overall_category: "FAST",
            metrics: [],
          },
          origin: {
            url: "https://example.com",
            overall_category: "FAST",
            metrics: [],
          },
        },
      },
      duration_ms: 410,
      provider_id: "pagespeed",
      source: "pagespeed_api",
    },
    coverage: {
      collected: ["lighthouse_lab_metrics", "performance_opportunities", "crux_field_data"],
      missing: ["webpagetest_waterfall", "multi_location_performance"],
    },
  };
}

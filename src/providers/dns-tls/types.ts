export type DnsAnswer = {
  name: string;
  type: number;
  ttl: number;
  data: string;
};

export type DnsQueryResult = {
  type: "A" | "AAAA" | "CNAME" | "HTTPS" | "MX" | "NS" | "TXT" | "CAA";
  status: number;
  answers: DnsAnswer[];
};

export type ProtocolReachabilityResult = {
  url: string;
  reachable: boolean;
  status_code: number | null;
  redirected_to: string | null;
  final_url?: string | null;
  content_type?: string | null;
  server?: string | null;
  x_powered_by?: string | null;
  title?: string | null;
  body_sample_bytes?: number | null;
  error: string | null;
};

export type AsnRecord = {
  ip: string;
  asn: string;
  prefix: string | null;
  country_code: string | null;
  registry: string | null;
  allocated: string | null;
  name: string | null;
};

export type AsnEnrichmentResult = {
  status: "ok" | "partial" | "not_collected" | "error";
  provider: string;
  records: AsnRecord[];
  queried_ip_count: number;
  error: string | null;
  reason?: string;
};

export type DnsInfrastructureResult = {
  requested_url: string;
  host: string;
  dns: {
    a: DnsQueryResult;
    aaaa: DnsQueryResult;
    cname: DnsQueryResult;
    https: DnsQueryResult;
  };
  ip_addresses: {
    ipv4: string[];
    ipv6: string[];
  };
  cdn: {
    detected: boolean;
    providers: string[];
    evidence: string[];
    confidence: "none" | "low" | "medium" | "high";
  };
  asn: AsnEnrichmentResult;
  protocol_reachability: {
    http: ProtocolReachabilityResult;
    https: ProtocolReachabilityResult;
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export type HstsPolicy = {
  present: boolean;
  raw: string | null;
  max_age_seconds: number | null;
  include_subdomains: boolean;
  preload: boolean;
};

export type CtCertificateSummary = {
  id: string;
  dns_names: string[];
  issuer_name: string | null;
  issuer_friendly_name: string | null;
  not_before: string | null;
  not_after: string | null;
  revoked: boolean;
  cert_sha256: string | null;
};

export type TlsCertificateResult = {
  requested_url: string;
  host: string;
  https_reachability: ProtocolReachabilityResult;
  hsts: HstsPolicy;
  ct_log: {
    provider: string;
    status: "ok" | "error";
    certificates: CtCertificateSummary[];
    error: string | null;
  };
  current_certificate: {
    status: "not_collected";
    reason: string;
  };
  coverage: {
    collected: string[];
    missing: string[];
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export type SubdomainAttackSurfaceResult = {
  requested_url: string;
  host: string;
    ct_log: {
      provider: string;
      status: "ok" | "error";
      certificate_count: number;
      error: string | null;
      providers?: Array<{
        provider: "certspotter" | "crtsh";
        status: "ok" | "error";
        certificate_count: number;
        error: string | null;
      }>;
    };
    discovered_subdomains: Array<{
      host: string;
      source: "ct_log";
      sources?: string[];
      indicators: string[];
    }>;
  reachability: Array<{
    host: string;
    https: ProtocolReachabilityResult;
  }>;
  exposed_surface_hints: Array<{
    host: string;
    hint: string;
    reason: string;
  }>;
  limits: {
    max_reachability_checks: number;
    checked_count: number;
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export type ServiceFingerprintResult = {
  requested_url: string;
  host: string;
  checked_hosts: Array<{
    host: string;
    url: string;
    observed_status: number | null;
    redirected_to: string | null;
    title: string | null;
    service_hints: Array<{
      category: "cdn" | "server" | "framework" | "admin_surface" | "monitoring_surface" | "mail" | "unknown";
      label: string;
      evidence: Array<{
        type: string;
        name: string;
        value: string;
      }>;
    }>;
    error: string | null;
    limitations: string[];
  }>;
  limits: {
    max_hosts: number;
    checked_hosts: number;
    max_requests_per_host: number;
    max_concurrency: number;
    timeout_ms: number;
  };
  coverage: {
    collected: string[];
    missing: string[];
    limitations: string[];
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export type PublicHostFingerprintResult = {
  requested_url: string;
  host: string;
  candidate_hosts: Array<{
    host: string;
    role_hint: "root" | "docs" | "api" | "blog" | "community" | "status" | "unknown";
    sources: Array<"root_domain" | "sitemap" | "user_input">;
  }>;
  checked_hosts: Array<{
    host: string;
    role_hint: "root" | "docs" | "api" | "blog" | "community" | "status" | "unknown";
    sources: Array<"root_domain" | "sitemap" | "user_input">;
    root_observation: {
      url: string;
      status_code: number | null;
      final_url: string | null;
      redirected_to: string | null;
      content_type: string | null;
      server: string | null;
      x_powered_by: string | null;
      title: string | null;
      canonical_url: string | null;
      error: string | null;
    };
    marker_checks: Array<{
      marker: "wp-json";
      path: string;
      url: string;
      status_code: number | null;
      content_type: string | null;
      matched: boolean;
      error: string | null;
    }>;
    app_markers: Array<{
      name: "Mintlify" | "WordPress" | "Discourse" | "wp-json" | "docs" | "api" | "blog" | "community" | "status";
      category: "docs" | "api" | "blog" | "community" | "status" | "cms" | "forum";
      confidence: "high" | "medium" | "low";
      evidence: Array<{
        type: "host_label" | "html" | "html_meta" | "html_link" | "header" | "marker_path" | "title";
        name: string;
        value: string;
      }>;
    }>;
    limitations: string[];
  }>;
  limits: {
    max_hosts: number;
    checked_hosts: number;
    max_requests_per_host: number;
    max_concurrency: number;
    timeout_ms: number;
    max_sitemap_bytes: number;
  };
  coverage: {
    collected: string[];
    missing: string[];
    limitations: string[];
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export type RdapWhoisLiteResult =
  | {
      status: "rdap_collected";
      source: "rdap";
      provider: string;
      query_domain: string;
      rdap_url: string;
      object_class_name: string | null;
      handle: string | null;
      ldh_name: string | null;
      unicode_name: string | null;
      registrar: string | null;
      nameservers: string[];
      status_values: string[];
      events: Array<{
        action: string;
        date: string | null;
      }>;
      notices: Array<{
        title: string | null;
        description: string[];
      }>;
      links: Array<{
        rel: string | null;
        href: string | null;
      }>;
    }
  | {
      status: "not_available" | "error";
      source: "rdap";
      provider: string;
      query_domain: string;
      rdap_url: string;
      reason: string;
      error: string | null;
    };

export type WaybackSnapshotSummary = {
  timestamp: string;
  date: string | null;
  original_url: string;
  archive_url: string;
  status_code: number | null;
  mimetype: string | null;
};

export type WaybackHistoryResult =
  | {
      status: "wayback_collected";
      source: "internet_archive";
      provider: string;
      query_url: string;
      cdx_url: string;
      snapshot_count_estimate: number | null;
      count_mode: "cdx_show_num_pages_page_size_1" | "not_collected";
      first_snapshot: WaybackSnapshotSummary | null;
      last_snapshot: WaybackSnapshotSummary | null;
      sample_snapshots: WaybackSnapshotSummary[];
    }
  | {
      status: "not_available" | "error";
      source: "internet_archive";
      provider: string;
      query_url: string;
      cdx_url: string;
      reason: string;
      error: string | null;
    };

export type RelatedDomainCandidate = {
  host: string;
  url: string;
  signal:
    | "homepage_anchor_host"
    | "homepage_resource_host"
    | "homepage_form_action_host"
    | "analytics_tracker_endpoint"
    | "analytics_script_host";
  role: "navigation" | "documentation" | "resource" | "cdn_asset" | "form_endpoint" | "analytics" | "unknown";
  source: "homepage_html";
  evidence: Array<{
    type: string;
    name: string;
    value: string;
  }>;
};

export type OrganizationIntelligenceResult = {
  requested_url: string;
  host: string;
  dns: {
    mx: DnsQueryResult;
    ns: DnsQueryResult;
    txt: DnsQueryResult;
    caa: DnsQueryResult;
  };
  mail_providers: Array<{
    provider: string;
    evidence: string;
  }>;
  social_links: Array<{
    platform: string;
    url: string;
  }>;
  related_domain_candidates: RelatedDomainCandidate[];
  external_intelligence: {
    whois: RdapWhoisLiteResult | { status: "not_collected"; reason: string };
    icp: { status: "not_collected"; reason: string };
    wayback: WaybackHistoryResult | { status: "not_collected"; reason: string };
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

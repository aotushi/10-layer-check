export type ScanPolicyProfile = "public_default";

export type ScanPolicyCheckClass =
  | "public_bounded"
  | "public_async_observation"
  | "bounded_security_observation"
  | "intrusive_or_enumeration";

export type ScanPolicyCheck = {
  id: string;
  check_class: ScanPolicyCheckClass;
  reason: string;
};

export type ScanPolicyDeniedCheck = ScanPolicyCheck & {
  required_authorization: string;
};

export type ScanPolicy = {
  schema_version: "site-10-layer-scan-policy/v0.1";
  profile: ScanPolicyProfile;
  authorization_basis: {
    basis: "user_submitted_target";
    statement: string;
    permissioned_checks_require_explicit_policy: false;
  };
  scope_policy: {
    target: string;
    normalized_target: string;
    root_target_allowed: true;
    public_subdomains: "bounded_public_evidence_only";
    authenticated_routes: "not_used_by_default";
    credentialed_requests: "not_used_by_default";
  };
  allowed_checks: ScanPolicyCheck[];
  denied_checks: ScanPolicyDeniedCheck[];
  limits: {
    max_redirects: number;
    max_public_host_candidates: number;
    max_requests_per_public_host: number;
    max_public_host_concurrency: number;
    request_timeout_ms: number;
    max_async_provider_timeout_ms: number;
    max_stored_object_bytes: number;
  };
  audit_metadata: {
    created_at: string;
    generated_by: "cloudflare_worker_site_scan";
    policy_source: "backend_default";
    requested_sync_probes: string[];
    requested_async_providers: string[];
  };
};

export type CreateScanPolicyInput = {
  target: string;
  normalizedTarget: string;
  requestedSyncProbes?: string[];
  requestedAsyncProviders?: string[];
  createdAt?: string;
  maxRedirects?: number;
  maxStoredObjectBytes?: number;
};

const DEFAULT_MAX_REDIRECTS = 10;
const DEFAULT_MAX_STORED_OBJECT_BYTES = 2_000_000;

const SYNC_PROBE_REASONS: Record<string, string> = {
  dns_infrastructure: "Collect bounded DNS and CDN public infrastructure facts.",
  tls_certificate: "Collect public certificate transparency and certificate metadata.",
  subdomain_attack_surface: "Collect bounded CT and public reachability hints without scanning ports.",
  service_fingerprint: "Collect bounded public HTTP(S) service hints for the submitted target.",
  public_host_fingerprint: "Collect bounded public host role and app marker hints.",
  public_security_details: "Collect bounded public CORS, cookie, API error, and CMS metadata observations.",
  public_content_surface: "Collect bounded public content surface snippets and open classification hints.",
  public_content_detail: "Collect bounded public docs, blog, community, and content detail snippets.",
  public_spa_metadata: "Collect bounded public SPA asset, route-candidate, bundle, chunk, and CSR metadata.",
  organization_intelligence: "Collect public RDAP, DNS, homepage, and archive signals.",
  api_reachability: "Collect bounded public API/header reachability hints.",
  remote_fetch: "Fetch the public target document and crawl metadata.",
  performance_basic: "Collect bounded public response timing and page-weight hints.",
};

const ASYNC_PROVIDER_REASONS: Record<string, string> = {
  browser_runtime: "Collect public browser runtime evidence without credentials.",
  live_tls: "Collect public live TLS chain evidence.",
  lighthouse: "Collect public Lighthouse lab evidence.",
  pagespeed: "Collect public PageSpeed/Lighthouse API evidence.",
  webpagetest: "Collect public WebPageTest performance evidence when configured.",
};

export function createDefaultScanPolicy(input: CreateScanPolicyInput): ScanPolicy {
  const requestedSyncProbes = uniqueStrings(input.requestedSyncProbes ?? []);
  const requestedAsyncProviders = uniqueStrings(input.requestedAsyncProviders ?? []);
  const createdAt = input.createdAt ?? new Date().toISOString();

  return {
    schema_version: "site-10-layer-scan-policy/v0.1",
    profile: "public_default",
    authorization_basis: {
      basis: "user_submitted_target",
      statement:
        "The user submitted the target URL for the backend default full public scan. Bounded public subrequests are allowed by default; credential use, brute force, exploit testing, user enumeration, login rate-limit validation, and port scanning remain denied.",
      permissioned_checks_require_explicit_policy: false,
    },
    scope_policy: {
      target: input.target,
      normalized_target: input.normalizedTarget,
      root_target_allowed: true,
      public_subdomains: "bounded_public_evidence_only",
      authenticated_routes: "not_used_by_default",
      credentialed_requests: "not_used_by_default",
    },
    allowed_checks: [
      ...requestedSyncProbes.map((probe) => createAllowedCheck(probe, "public_bounded", SYNC_PROBE_REASONS)),
      ...requestedAsyncProviders.map((provider) =>
        createAllowedCheck(provider, "public_async_observation", ASYNC_PROVIDER_REASONS),
      ),
      ...createDefaultAllowedSecurityChecks(),
    ],
    denied_checks: createDefaultDeniedChecks(),
    limits: {
      max_redirects: input.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
      max_public_host_candidates: 8,
      max_requests_per_public_host: 2,
      max_public_host_concurrency: 3,
      request_timeout_ms: 10_000,
      max_async_provider_timeout_ms: 30 * 60 * 1000,
      max_stored_object_bytes: input.maxStoredObjectBytes ?? DEFAULT_MAX_STORED_OBJECT_BYTES,
    },
    audit_metadata: {
      created_at: createdAt,
      generated_by: "cloudflare_worker_site_scan",
      policy_source: "backend_default",
      requested_sync_probes: requestedSyncProbes,
      requested_async_providers: requestedAsyncProviders,
    },
  };
}

function createAllowedCheck(
  id: string,
  checkClass: ScanPolicyCheckClass,
  reasonMap: Record<string, string>,
): ScanPolicyCheck {
  return {
    id,
    check_class: checkClass,
    reason: reasonMap[id] ?? "Requested bounded public evidence collection.",
  };
}

function createDefaultDeniedChecks(): ScanPolicyDeniedCheck[] {
  return [
    {
      id: "wordpress_user_enumeration",
      check_class: "intrusive_or_enumeration",
      reason: "User enumeration is not part of the default backend full scan.",
      required_authorization: "not_supported_by_default_scan",
    },
    {
      id: "login_rate_limit_validation",
      check_class: "intrusive_or_enumeration",
      reason: "Rate-limit validation can create load or account-facing effects and is denied by default.",
      required_authorization: "not_supported_by_default_scan",
    },
    {
      id: "deep_port_service_inventory",
      check_class: "intrusive_or_enumeration",
      reason: "Port/service scanning is outside the default public evidence policy.",
      required_authorization: "not_supported_by_default_scan",
    },
  ];
}

function createDefaultAllowedSecurityChecks(): ScanPolicyCheck[] {
  return [
    {
      id: "bounded_cors_header_validation",
      check_class: "bounded_security_observation",
      reason: "Observe CORS response headers on a small set of public endpoints with a synthetic Origin header.",
    },
    {
      id: "bounded_cookie_attribute_observation",
      check_class: "bounded_security_observation",
      reason: "Observe Set-Cookie attributes on public responses without credentials.",
    },
    {
      id: "bounded_public_api_error_surface",
      check_class: "bounded_security_observation",
      reason: "Observe public unauthenticated API endpoint status, selected headers, and short error previews.",
    },
    {
      id: "bounded_public_cms_metadata",
      check_class: "bounded_security_observation",
      reason: "Observe public CMS/forum metadata paths without user enumeration.",
    },
  ];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

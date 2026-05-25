export type PublicSecurityHostRole = "root" | "api" | "blog" | "community" | "docs" | "status";

export type PublicSecurityHeaderMap = {
  server: string | null;
  "content-type": string | null;
  "access-control-allow-origin": string | null;
  "access-control-allow-credentials": string | null;
  "access-control-allow-methods": string | null;
  "access-control-allow-headers": string | null;
  "set-cookie": string | null;
  "x-request-id": string | null;
  "cf-ray": string | null;
  "x-discourse-route": string | null;
  "x-discourse-cached": string | null;
  "x-mint-proxy-version": string | null;
  "x-mintlify-client-version": string | null;
  "x-vercel-cache": string | null;
  "x-vercel-id": string | null;
  "x-served-version": string | null;
  "x-vercel-project-id": string | null;
  "x-runtime": string | null;
  "content-security-policy": string | null;
  vary: string | null;
  link: string | null;
};

export type PublicSecurityCheck = {
  host: string;
  role_hint: PublicSecurityHostRole;
  kind: "cors" | "cookie" | "api_endpoint" | "cms_metadata" | "forum_metadata" | "route_presence" | "app_header_metadata";
  method: "GET" | "HEAD" | "OPTIONS";
  path: string;
  url: string;
  status_code: number | null;
  redirected_to: string | null;
  content_type: string | null;
  headers: PublicSecurityHeaderMap;
  body_preview: string | null;
  body_preview_bytes: number | null;
  body_preview_truncated: boolean;
  parsed: Record<string, unknown>;
  signals: string[];
  error: string | null;
};

export type PublicSecurityDetailsResult = {
  requested_url: string;
  host: string;
  checks: PublicSecurityCheck[];
  limits: {
    max_hosts: number;
    checked_hosts: number;
    max_requests_per_host: number;
    max_concurrency: number;
    timeout_ms: number;
    preview_bytes: number;
    model_list_preview_bytes: number;
  };
  coverage: {
    collected: string[];
    missing: string[];
    limitations: string[];
  };
  duration_ms: number;
  provider_id: "cloudflare_worker_public_security_details";
  source: "cloudflare_worker_public_security_details";
};

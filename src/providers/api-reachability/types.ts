export type ApiReachabilityCandidate = {
  url: string;
  source: string;
  reason: string;
};

export type ApiReachabilityCheck = {
  url: string;
  method: "HEAD" | "GET";
  status_code: number | null;
  ok: boolean;
  redirected_to: string | null;
  content_type: string | null;
  cache_control: string | null;
  cors: {
    allow_origin: string | null;
    allow_methods: string | null;
    allow_headers: string | null;
    allow_credentials: string | null;
  };
  response_preview: string | null;
  error_surface_signals: string[];
  duration_ms: number | null;
  error: string | null;
};

export type ApiReachabilitySkipped = {
  url: string;
  reason: string;
};

export type ApiReachabilityResult = {
  requested_url: string;
  final_url: string;
  host: string;
  candidates: ApiReachabilityCandidate[];
  checks: ApiReachabilityCheck[];
  skipped: ApiReachabilitySkipped[];
  limits: {
    max_candidates: number;
    checked_count: number;
    same_origin_only: true;
    methods: ["HEAD", "GET"];
    preview_bytes: number;
  };
  coverage: {
    collected: string[];
    missing: string[];
    limitations: string[];
  };
  duration_ms: number;
  provider_id: "cloudflare_worker_api_reachability";
  source: "cloudflare_worker_api_reachability";
};

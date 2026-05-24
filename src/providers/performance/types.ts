export type PerformanceMetric = {
  id: string;
  label: string;
  value: number | null;
  unit: "score" | "ms" | "bytes" | "count" | "unknown";
  rating: "good" | "needs_improvement" | "poor" | "unknown";
};

export type PerformanceProviderResult = {
  requested_url: string;
  final_url: string | null;
  strategy: "mobile" | "desktop" | "unknown";
  provider: "pagespeed" | "lighthouse" | "webpagetest" | "manual";
  metrics: PerformanceMetric[];
  opportunities: Array<{
    id: string;
    title: string;
    score: number | null;
    estimated_savings_ms: number | null;
    estimated_savings_bytes: number | null;
  }>;
  raw_summary: {
    performance_score: number | null;
    accessibility_score?: number | null;
    best_practices_score?: number | null;
    seo_score?: number | null;
    field_data?: PageSpeedFieldDataSummary;
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export type PageSpeedFieldDataSummary = {
  available: boolean;
  page: PageSpeedFieldDataScope | null;
  origin: PageSpeedFieldDataScope | null;
};

export type PageSpeedFieldDataScope = {
  url: string | null;
  overall_category: string | null;
  metrics: Array<{
    id: string;
    percentile: number | null;
    category: string | null;
    distributions: Array<{
      min: number | null;
      max: number | null;
      proportion: number | null;
    }>;
  }>;
};

export type BasicPerformanceResource = {
  url: string;
  kind: "script" | "stylesheet" | "image" | "preload" | "other";
  same_origin: boolean;
  status_code: number | null;
  content_length: number | null;
  content_type: string | null;
  cache_control: string | null;
  cdn_cache_status: string | null;
  duration_ms: number | null;
  error: string | null;
};

export type BasicPerformanceResult = {
  requested_url: string;
  final_url: string;
  status_code: number;
  ok: boolean;
  timings: {
    ttfb_ms: number;
    total_ms: number;
    body_read_ms: number;
    redirect_count: number;
  };
  document: {
    html_bytes: number;
    encoded_content_length: number | null;
    content_type: string | null;
    content_encoding: string | null;
    cache_control: string | null;
    cdn_cache_status: string | null;
  };
  declared_resources: {
    scripts: number;
    stylesheets: number;
    images: number;
    preloads: number;
    total: number;
  };
  sampled_resources: BasicPerformanceResource[];
  page_weight_estimate: {
    known_bytes: number;
    html_bytes: number;
    sampled_resource_bytes: number;
    unknown_sampled_resources: number;
    sampled_resource_count: number;
    declared_resource_count: number;
    note: string;
  };
  coverage: {
    collected: string[];
    missing: string[];
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

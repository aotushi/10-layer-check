export type PublicContentDiscoverySource =
  | "root_document"
  | "html_link"
  | "canonical"
  | "alternate"
  | "host_candidate"
  | "robots_sitemap"
  | "sitemap"
  | "llms_txt"
  | "wordpress_rest";

export type PublicContentControlledHint =
  | "business_overview"
  | "technical_documentation"
  | "commercial"
  | "support"
  | "legal"
  | "community"
  | "news"
  | "product"
  | "unknown";

export type PublicContentClassification = {
  label: string;
  controlled_hint: PublicContentControlledHint;
  confidence: "high" | "medium" | "low";
  basis: string[];
};

export type PublicContentSurface = {
  url: string;
  final_url: string | null;
  host: string;
  path: string;
  status_code: number | null;
  content_type: string | null;
  title: string | null;
  meta_description: string | null;
  headings: string[];
  schema_types: string[];
  visible_text_excerpt: string | null;
  discovered_from: Array<{
    source: PublicContentDiscoverySource;
    url: string | null;
    label: string | null;
  }>;
  classification: PublicContentClassification;
  error: string | null;
  limitations: string[];
};

export type PublicContentSurfaceResult = {
  requested_url: string;
  host: string;
  candidate_urls: Array<{
    url: string;
    sources: PublicContentSurface["discovered_from"];
  }>;
  surfaces: PublicContentSurface[];
  limits: {
    max_candidate_urls: number;
    max_pages: number;
    max_concurrency: number;
    timeout_ms: number;
    max_page_bytes: number;
    max_index_bytes: number;
  };
  coverage: {
    collected: string[];
    missing: string[];
    limitations: string[];
  };
  duration_ms: number;
  provider_id: "cloudflare_worker_public_content_surface";
  source: "cloudflare_worker_public_content_surface";
};

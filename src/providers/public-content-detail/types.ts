import type {
  PublicContentClassification,
  PublicContentDiscoverySource,
} from "../public-content-surface/types";

export type PublicContentDetailKind =
  | "documentation"
  | "article"
  | "community"
  | "support"
  | "product"
  | "commercial"
  | "legal"
  | "unknown";

export type PublicContentDetailCandidate = {
  url: string;
  sources: Array<{
    source: PublicContentDiscoverySource;
    from_url: string | null;
    label: string | null;
  }>;
};

export type PublicContentDetailPage = {
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
  published_time: string | null;
  modified_time: string | null;
  detail_kind: PublicContentDetailKind;
  classification: PublicContentClassification;
  link_context: Array<{
    source: PublicContentDiscoverySource;
    from_url: string | null;
    label: string | null;
  }>;
  excerpt: string | null;
  evidence_snippets: string[];
  error: string | null;
  limitations: string[];
};

export type PublicContentDetailResult = {
  requested_url: string;
  host: string;
  candidate_urls: PublicContentDetailCandidate[];
  detail_pages: PublicContentDetailPage[];
  limits: {
    max_seed_pages: number;
    max_candidate_urls: number;
    max_detail_pages: number;
    max_concurrency: number;
    timeout_ms: number;
    max_seed_page_bytes: number;
    max_detail_page_bytes: number;
    max_index_bytes: number;
  };
  coverage: {
    collected: string[];
    missing: string[];
    limitations: string[];
  };
  duration_ms: number;
  provider_id: "cloudflare_worker_public_content_detail";
  source: "cloudflare_worker_public_content_detail";
};

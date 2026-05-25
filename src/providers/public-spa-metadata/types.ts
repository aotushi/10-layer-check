export type PublicSpaAssetKind = "script" | "modulepreload" | "stylesheet" | "manifest" | "other";

export type PublicSpaAssetRole = "entry_bundle" | "lazy_chunk" | "style_bundle" | "manifest" | "preload" | "unknown";

export type PublicSpaSignalCategory =
  | "frontend_framework"
  | "build_tool"
  | "router"
  | "rendering_mode"
  | "code_splitting"
  | "asset_pipeline"
  | "unknown";

export type PublicSpaSignal = {
  id: string;
  label: string;
  category: PublicSpaSignalCategory;
  confidence: "confirmed" | "likely" | "possible";
  evidence: string[];
};

export type PublicSpaDeclaredAsset = {
  url: string;
  host: string;
  path: string;
  kind: PublicSpaAssetKind;
  role: PublicSpaAssetRole;
  rel: string | null;
  as: string | null;
  same_origin: boolean;
};

export type PublicSpaAssetPreview = PublicSpaDeclaredAsset & {
  final_url: string | null;
  status_code: number | null;
  content_type: string | null;
  bytes_read: number;
  signals: string[];
  referenced_assets: string[];
  route_candidates: string[];
  component_candidates: string[];
  error: string | null;
};

export type PublicSpaHtmlShell = {
  final_url: string | null;
  status_code: number | null;
  content_type: string | null;
  title: string | null;
  root_containers: string[];
  module_script_count: number;
  declared_script_count: number;
  declared_stylesheet_count: number;
  has_next_data: boolean;
  has_nuxt_data: boolean;
  has_ssr_data_marker: boolean;
  visible_text_length: number;
  rendering_assessment: {
    mode: "csr_candidate" | "ssr_or_hybrid_candidate" | "unknown";
    confidence: "high" | "medium" | "low";
    basis: string[];
  };
};

export type PublicSpaRouteCandidate = {
  value: string;
  source_asset: string;
  confidence: "medium" | "low";
};

export type PublicSpaComponentCandidate = {
  value: string;
  source_asset: string;
  confidence: "medium" | "low";
};

export type PublicSpaMetadataResult = {
  requested_url: string;
  final_url: string | null;
  host: string;
  html_shell: PublicSpaHtmlShell;
  declared_assets: PublicSpaDeclaredAsset[];
  fetched_asset_previews: PublicSpaAssetPreview[];
  route_candidates: PublicSpaRouteCandidate[];
  component_candidates: PublicSpaComponentCandidate[];
  detected_signals: PublicSpaSignal[];
  limits: {
    max_declared_assets: number;
    max_asset_previews: number;
    max_asset_preview_bytes: number;
    max_entry_asset_preview_bytes: number;
    max_referenced_asset_previews: number;
    max_referenced_asset_preview_bytes: number;
    max_route_candidates: number;
    max_component_candidates: number;
    timeout_ms: number;
  };
  coverage: {
    collected: string[];
    missing: string[];
    limitations: string[];
  };
  duration_ms: number;
  provider_id: "cloudflare_worker_public_spa_metadata";
  source: "cloudflare_worker_public_spa_metadata";
};

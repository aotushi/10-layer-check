import type { LayerProbeContext } from "../core/probe-contract";
import type { SnapshotRecord } from "../core/types";
import type {
  PublicSpaAssetPreview,
  PublicSpaDeclaredAsset,
  PublicSpaMetadataResult,
  PublicSpaRouteCandidate,
} from "../providers/public-spa-metadata/types";

export function createPublicSpaMetadataLayerRecords(
  context: LayerProbeContext,
  result: PublicSpaMetadataResult,
): SnapshotRecord[] {
  const usablePreviews = result.fetched_asset_previews.filter((preview) => preview.status_code !== null && !preview.error);
  const frameworkSignals = result.detected_signals.filter((signal) =>
    ["frontend_framework", "build_tool", "router", "rendering_mode", "code_splitting"].includes(signal.category),
  );

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "public_spa_asset_metadata_probe",
      layer: 4,
      item: "public_spa_asset_metadata",
      probe_type: "active_request",
      source: result.source,
      status: usablePreviews.length > 0 ? "ok" : result.declared_assets.length > 0 ? "warning" : "skipped",
      value: {
        host: result.host,
        final_url: result.final_url,
        html_shell: result.html_shell,
        declared_asset_count: result.declared_assets.length,
        fetched_asset_preview_count: usablePreviews.length,
        declared_assets: summarizeDeclaredAssets(result.declared_assets),
        asset_previews: summarizeAssetPreviews(result.fetched_asset_previews),
        detected_signals: result.detected_signals,
        limits: result.limits,
        coverage: result.coverage,
      },
      risk: {
        level: "info",
        summary:
          frameworkSignals.length > 0
            ? `Collected bounded SPA asset metadata: ${summarizeSignals(frameworkSignals)}.`
            : "No strong SPA framework/build metadata was collected from bounded public asset previews.",
      },
      evidence: [
        { type: "spa_html_shell", name: "html_shell", value: result.html_shell },
        { type: "spa_declared_assets", name: "declared_assets", value: summarizeDeclaredAssets(result.declared_assets) },
        { type: "spa_asset_preview", name: "asset_previews", value: summarizeAssetPreviews(result.fetched_asset_previews) },
        { type: "spa_signal", name: "detected_signals", value: result.detected_signals },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "static_parse",
        limitations: result.coverage.limitations,
      },
      duration_ms: result.duration_ms,
    },
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "public_spa_route_metadata_probe",
      layer: 4,
      item: "public_spa_route_metadata",
      probe_type: "active_request",
      source: result.source,
      status: result.route_candidates.length > 0 || result.component_candidates.length > 0 ? "ok" : "skipped",
      value: {
        host: result.host,
        final_url: result.final_url,
        route_candidate_count: result.route_candidates.length,
        component_candidate_count: result.component_candidates.length,
        route_candidates: result.route_candidates,
        component_candidates: result.component_candidates,
        limits: result.limits,
        coverage: {
          collected: ["route_like_string_candidates", "component_like_symbol_candidates"],
          missing: result.coverage.missing,
          limitations: result.coverage.limitations,
        },
      },
      risk: {
        level: "info",
        summary:
          result.route_candidates.length > 0 || result.component_candidates.length > 0
            ? `Extracted ${result.route_candidates.length} route-like string candidate(s) and ${result.component_candidates.length} component/page-like symbol candidate(s) from bounded public asset previews.`
            : "No route-like strings or component/page-like symbols were extracted from bounded public asset previews.",
      },
      evidence: [
        { type: "spa_route_candidate", name: "route_candidates", value: summarizeRouteCandidates(result.route_candidates) },
        { type: "spa_component_candidate", name: "component_candidates", value: summarizeComponentCandidates(result.component_candidates) },
      ],
      evidence_metadata: {
        origin: "static_heuristic",
        role: "derived",
        method: "static_parse",
        limitations: [
          ...result.coverage.limitations,
          "Route-like strings are not proof that a route is reachable, public, authenticated, or security-relevant.",
        ],
      },
      duration_ms: result.duration_ms,
    },
  ];
}

function summarizeDeclaredAssets(assets: PublicSpaDeclaredAsset[]) {
  return assets.slice(0, 40).map((asset) => ({
    url: asset.url,
    host: asset.host,
    path: asset.path,
    kind: asset.kind,
    role: asset.role,
    rel: asset.rel,
    as: asset.as,
    same_origin: asset.same_origin,
  }));
}

function summarizeAssetPreviews(previews: PublicSpaAssetPreview[]) {
  return previews.map((preview) => ({
    url: preview.url,
    final_url: preview.final_url,
    host: preview.host,
    path: preview.path,
    kind: preview.kind,
    role: preview.role,
    status_code: preview.status_code,
    content_type: preview.content_type,
    bytes_read: preview.bytes_read,
    signals: preview.signals,
    referenced_assets: preview.referenced_assets.slice(0, 20),
    route_candidates: preview.route_candidates.slice(0, 20),
    component_candidates: preview.component_candidates.slice(0, 20),
    error: preview.error,
  }));
}

function summarizeRouteCandidates(candidates: PublicSpaRouteCandidate[]) {
  return candidates.slice(0, 40).map((candidate) => ({
    route_candidate: candidate.value,
    source_asset: candidate.source_asset,
    confidence: candidate.confidence,
  }));
}

function summarizeComponentCandidates(candidates: PublicSpaMetadataResult["component_candidates"]) {
  return candidates.slice(0, 40).map((candidate) => ({
    component_candidate: candidate.value,
    source_asset: candidate.source_asset,
    confidence: candidate.confidence,
  }));
}

function summarizeSignals(signals: PublicSpaMetadataResult["detected_signals"]): string {
  return signals
    .slice(0, 6)
    .map((signal) => `${signal.label} (${signal.category}, ${signal.confidence})`)
    .join("; ");
}

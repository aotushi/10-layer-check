import type { LayerProbeContext } from "../core/probe-contract";
import type { SnapshotRecord } from "../core/types";
import type { PublicContentSurface, PublicContentSurfaceResult } from "../providers/public-content-surface/types";

export function createPublicContentSurfaceLayerRecords(
  context: LayerProbeContext,
  result: PublicContentSurfaceResult,
): SnapshotRecord[] {
  const usableSurfaces = result.surfaces.filter((surface) => surface.status_code !== null && !surface.error);
  const businessSurfaces = usableSurfaces.filter((surface) =>
    surface.visible_text_excerpt || surface.title || surface.meta_description || surface.headings.length > 0,
  );
  const classificationLabels = uniqueStrings(usableSurfaces.map((surface) => surface.classification.label));
  const controlledHints = uniqueStrings(usableSurfaces.map((surface) => surface.classification.controlled_hint).filter((hint) => hint !== "unknown"));

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "public_content_surface_probe",
      layer: 4,
      item: "public_content_surfaces",
      probe_type: "active_request",
      source: result.source,
      status: usableSurfaces.length > 0 ? "ok" : result.surfaces.length > 0 ? "warning" : "skipped",
      value: {
        host: result.host,
        candidate_url_count: result.candidate_urls.length,
        collected_surface_count: usableSurfaces.length,
        surfaces: summarizeSurfaces(result.surfaces),
        classification_labels: classificationLabels,
        controlled_hints: controlledHints,
        limits: result.limits,
        coverage: result.coverage,
      },
      risk: {
        level: "info",
        summary:
          usableSurfaces.length > 0
            ? `Collected ${usableSurfaces.length} bounded public content surface(s): ${summarizeSurfaceTitles(usableSurfaces)}.`
            : "No usable bounded public content surface was collected.",
      },
      evidence: [
        { type: "public_content_surface", name: "public_content_surfaces", value: summarizeSurfaces(result.surfaces) },
        { type: "limit", name: "public_content_surface_limits", value: result.limits },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: result.coverage.limitations,
      },
      duration_ms: result.duration_ms,
    },
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "public_business_content_probe",
      layer: 9,
      item: "public_business_content",
      probe_type: "active_request",
      source: result.source,
      status: businessSurfaces.length > 0 ? "ok" : "skipped",
      value: {
        host: result.host,
        snippets: summarizeBusinessSnippets(businessSurfaces),
        snippet_count: businessSurfaces.length,
        classification_labels: classificationLabels,
        controlled_hints: controlledHints,
        limits: result.limits,
        coverage: {
          collected: ["public_business_product_text_snippets", "open_content_classification_hints"],
          missing: result.coverage.missing,
          limitations: result.coverage.limitations,
        },
      },
      risk: {
        level: "info",
        summary:
          businessSurfaces.length > 0
            ? `Collected public business/product text snippets from ${businessSurfaces.length} bounded page(s): ${summarizeBusinessHints(businessSurfaces)}.`
            : "No public business/product text snippets were collected.",
      },
      evidence: [
        { type: "public_content_excerpt", name: "business_product_snippets", value: summarizeBusinessSnippets(businessSurfaces) },
        { type: "limit", name: "public_content_surface_limits", value: result.limits },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: [
          ...result.coverage.limitations,
          "AI may summarize product or business model only from these collected public snippets and must preserve uncertainty.",
        ],
      },
      duration_ms: result.duration_ms,
    },
  ];
}

function summarizeSurfaces(surfaces: PublicContentSurface[]) {
  return surfaces.map((surface) => ({
    url: surface.url,
    final_url: surface.final_url,
    host: surface.host,
    path: surface.path,
    status_code: surface.status_code,
    content_type: surface.content_type,
    title: surface.title,
    meta_description: surface.meta_description,
    headings: surface.headings.slice(0, 6),
    schema_types: surface.schema_types,
    excerpt: surface.visible_text_excerpt,
    discovered_from: surface.discovered_from,
    classification: surface.classification,
    error: surface.error,
  }));
}

function summarizeBusinessSnippets(surfaces: PublicContentSurface[]) {
  return surfaces.map((surface) => ({
    url: surface.final_url ?? surface.url,
    host: surface.host,
    path: surface.path,
    title: surface.title,
    label: surface.classification.label,
    controlled_hint: surface.classification.controlled_hint,
    confidence: surface.classification.confidence,
    basis: surface.classification.basis,
    headings: surface.headings.slice(0, 4),
    meta_description: surface.meta_description,
    excerpt: surface.visible_text_excerpt,
  }));
}

function summarizeSurfaceTitles(surfaces: PublicContentSurface[]): string {
  return surfaces
    .slice(0, 5)
    .map((surface) => surface.title || `${surface.host}${surface.path}`)
    .join("; ");
}

function summarizeBusinessHints(surfaces: PublicContentSurface[]): string {
  const hints = surfaces
    .map((surface) =>
      [surface.classification.label, surface.classification.controlled_hint, surface.title].filter(Boolean).join(" / "),
    );
  return uniqueStrings(hints).slice(0, 5).join("; ");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

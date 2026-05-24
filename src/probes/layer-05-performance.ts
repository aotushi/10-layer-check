import type { LayerProbeContext } from "../core/probe-contract";
import type { SnapshotRecord } from "../core/types";
import type { BasicPerformanceResult, PerformanceProviderResult } from "../providers/performance/types";

export function createBasicPerformanceLayerRecords(
  context: LayerProbeContext,
  result: BasicPerformanceResult,
): SnapshotRecord[] {
  const ttfbRating = rateTtfb(result.timings.ttfb_ms);
  const weightRating = rateKnownWeight(result.page_weight_estimate.known_bytes);
  const warningCount = [ttfbRating, weightRating].filter((rating) => rating !== "good").length;

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "basic_performance_probe",
      layer: 5,
      item: "performance_baseline",
      probe_type: "active_request",
      source: result.source,
      status: warningCount > 0 ? "warning" : "ok",
      value: {
        requested_url: result.requested_url,
        final_url: result.final_url,
        status_code: result.status_code,
        timings: result.timings,
        document: result.document,
        declared_resources: result.declared_resources,
        sampled_resources: result.sampled_resources,
        page_weight_estimate: result.page_weight_estimate,
        ratings: {
          ttfb: ttfbRating,
          known_weight: weightRating,
        },
        coverage: result.coverage,
      },
      risk: {
        level: warningCount > 0 ? "low" : "info",
        summary: `TTFB ${Math.round(result.timings.ttfb_ms)}ms; known sampled page weight ${formatBytes(result.page_weight_estimate.known_bytes)}.`,
      },
      evidence: [
        { type: "timing", name: "ttfb_ms", value: result.timings.ttfb_ms },
        { type: "timing", name: "total_ms", value: result.timings.total_ms },
        { type: "page_weight", name: "known_bytes", value: result.page_weight_estimate.known_bytes },
        { type: "resource_sample", name: "sampled_resources", value: result.sampled_resources },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: [
          "Worker fetch timing is lab-like backend timing from the Worker location, not a real user browser metric.",
          "TTFB is measured as elapsed time until response headers are available to the Worker fetch call.",
          "Page weight is an estimate from the HTML response plus sampled declared resources with known content-length.",
          "JavaScript-rendered resources and browser-only timings require browser_runtime or Lighthouse provider data.",
        ],
      },
      duration_ms: result.duration_ms,
    },
  ];
}

export function createPerformanceLayerRecords(
  context: LayerProbeContext,
  result: PerformanceProviderResult,
): SnapshotRecord[] {
  const poorMetrics = result.metrics.filter((metric) => metric.rating === "poor");
  const needsImprovementMetrics = result.metrics.filter((metric) => metric.rating === "needs_improvement");
  const performanceScore = result.raw_summary.performance_score;

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "performance_probe",
      layer: 5,
      item: "performance",
      probe_type: "performance",
      source: result.source,
      status: poorMetrics.length > 0 || needsImprovementMetrics.length > 0 ? "warning" : "ok",
      value: {
        requested_url: result.requested_url,
        final_url: result.final_url,
        strategy: result.strategy,
        provider: result.provider,
        performance_score: performanceScore,
        metrics: result.metrics,
        opportunities: result.opportunities,
        raw_summary: result.raw_summary,
      },
      risk: {
        level: poorMetrics.length > 0 ? "medium" : needsImprovementMetrics.length > 0 ? "low" : "info",
        summary: summarizePerformance(performanceScore, poorMetrics.length, needsImprovementMetrics.length),
      },
      evidence: [
        { type: "performance_metrics", name: result.provider, value: result.metrics },
        { type: "performance_opportunities", name: result.provider, value: result.opportunities },
      ],
      evidence_metadata: {
        origin: "external_provider",
        role: "derived",
        method: "external_api",
        limitations: [
          "Performance results depend on the selected provider, strategy, location, device profile, and run timing.",
          "Lab metrics should not be treated as field Core Web Vitals unless the provider explicitly supplies field data.",
        ],
      },
      duration_ms: result.duration_ms,
    },
  ];
}

function summarizePerformance(score: number | null, poorCount: number, needsImprovementCount: number): string {
  const scoreText = score === null ? "unknown score" : `score ${Math.round(score * 100)}`;
  if (poorCount > 0) return `Performance ${scoreText}; ${poorCount} metric(s) are poor.`;
  if (needsImprovementCount > 0) {
    return `Performance ${scoreText}; ${needsImprovementCount} metric(s) need improvement.`;
  }
  return `Performance ${scoreText}; no poor metrics were reported.`;
}

function rateTtfb(value: number): "good" | "needs_improvement" | "poor" {
  if (value <= 800) return "good";
  if (value <= 1800) return "needs_improvement";
  return "poor";
}

function rateKnownWeight(value: number): "good" | "needs_improvement" | "poor" {
  if (value <= 1_000_000) return "good";
  if (value <= 3_000_000) return "needs_improvement";
  return "poor";
}

function formatBytes(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}MB`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}KB`;
  return `${value}B`;
}

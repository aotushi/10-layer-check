import type { LayerProbeContext } from "../core/probe-contract";
import type { EvidenceAssessment, SnapshotRecord } from "../core/types";
import type { PublicHostFingerprintResult, ServiceFingerprintResult, SubdomainAttackSurfaceResult } from "../providers/dns-tls/types";

export function createSubdomainLayerRecords(
  context: LayerProbeContext,
  result: SubdomainAttackSurfaceResult,
): SnapshotRecord[] {
  const reachable = result.reachability.filter((item) => item.https.reachable);
  const riskyHints = result.exposed_surface_hints.filter((hint) => /admin|staging|dev|test|grafana|kibana|jenkins/i.test(hint.hint));
  const ctFailed = result.ct_log.status === "error";
  const status = ctFailed ? "warning" : riskyHints.length > 0 ? "warning" : result.discovered_subdomains.length > 0 ? "ok" : "skipped";
  const level = ctFailed ? "low" : riskyHints.length > 0 ? "medium" : result.discovered_subdomains.length > 0 ? "low" : "info";
  const summary = ctFailed
    ? `CT subdomain provider lookup failed: ${result.ct_log.error ?? "unknown error"}.`
    : riskyHints.length > 0
      ? `Found ${riskyHints.length} subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces.`
      : result.discovered_subdomains.length > 0
        ? `Found ${result.discovered_subdomains.length} CT-discovered subdomain candidate(s).`
        : "No CT-discovered subdomain candidates were found.";

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "subdomain_attack_surface_probe",
      layer: 7,
      item: "subdomain_attack_surface",
      probe_type: "dns_tls",
      source: result.source,
      status,
      value: {
        host: result.host,
        ct_log: result.ct_log,
        discovered_count: result.discovered_subdomains.length,
        discovered_subdomains: result.discovered_subdomains,
        reachable_https: reachable,
        reachability_details: result.reachability.map((item) => ({
          host: item.host,
          status_code: item.https.status_code,
          final_url: item.https.final_url ?? item.https.url,
          redirected_to: item.https.redirected_to,
          content_type: item.https.content_type ?? null,
          server: item.https.server ?? null,
          x_powered_by: item.https.x_powered_by ?? null,
          title: item.https.title ?? null,
          body_sample_bytes: item.https.body_sample_bytes ?? null,
          error: item.https.error,
        })),
        exposed_surface_hints: result.exposed_surface_hints,
        exposure_assessment: buildExposureAssessment(result, reachable.length, riskyHints.length),
        limits: result.limits,
      },
      risk: {
        level,
        summary,
      },
      evidence: [
        { type: "ct_log", name: "provider_status", value: result.ct_log },
        { type: "ct_log", name: "provider_attempts", value: result.ct_log.providers ?? [{ ...result.ct_log, provider: result.ct_log.provider }] },
        { type: "ct_log", name: "subdomains", value: result.discovered_subdomains },
        { type: "protocol", name: "https_reachability", value: result.reachability },
      ],
      evidence_metadata: {
        origin: "external_provider",
        role: "derived",
        method: "external_api",
        limitations: [
          "CT-discovered subdomains are historical certificate evidence and may include retired or non-public services.",
          "Reachability checks are intentionally bounded and do not constitute a full port or service scan.",
          "Naming-based exposed-surface hints are candidates for review, not proof of sensitive exposure.",
        ],
      },
      error: result.ct_log.error ?? undefined,
      duration_ms: result.duration_ms,
    },
  ];
}

export function createServiceFingerprintLayerRecords(
  context: LayerProbeContext,
  result: ServiceFingerprintResult,
): SnapshotRecord[] {
  const hintCount = result.checked_hosts.reduce((count, host) => count + host.service_hints.length, 0);
  const failedCount = result.checked_hosts.filter((host) => host.error).length;
  const status = failedCount === result.checked_hosts.length ? "warning" : hintCount > 0 ? "ok" : "skipped";
  const level = result.checked_hosts.some((host) =>
    host.service_hints.some((hint) => hint.category === "admin_surface" || hint.category === "monitoring_surface"),
  )
    ? "medium"
    : hintCount > 0
      ? "low"
      : "info";

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "service_fingerprint_probe",
      layer: 7,
      item: "service_fingerprint",
      probe_type: "dns_tls",
      source: result.source,
      status,
      value: {
        host: result.host,
        checked_hosts: result.checked_hosts,
        observed_hint_count: hintCount,
        limits: result.limits,
        coverage: result.coverage,
        assessment: buildServiceFingerprintAssessment(result, hintCount),
      },
      risk: {
        level,
        summary:
          hintCount > 0
            ? `Collected ${hintCount} bounded HTTP(S) service fingerprint hint(s) from ${result.checked_hosts.length} host(s).`
            : "No bounded HTTP(S) service fingerprint hints were collected.",
      },
      evidence: [
        { type: "http_observation", name: "checked_hosts", value: result.checked_hosts },
        { type: "limit", name: "service_fingerprint_limits", value: result.limits },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: result.coverage.limitations,
      },
      duration_ms: result.duration_ms,
    },
  ];
}

export function createPublicHostFingerprintLayerRecords(
  context: LayerProbeContext,
  result: PublicHostFingerprintResult,
): SnapshotRecord[] {
  const reachableHosts = result.checked_hosts.filter((host) => host.root_observation.status_code !== null && !host.root_observation.error);
  const failedHosts = result.checked_hosts.filter((host) => host.root_observation.error);
  const appMarkers = result.checked_hosts.flatMap((host) =>
    host.app_markers.map((marker) => ({
      host: host.host,
      role_hint: host.role_hint,
      name: marker.name,
      category: marker.category,
      confidence: marker.confidence,
      evidence: marker.evidence,
    })),
  ).sort((left, right) => scoreAppMarker(right.name) - scoreAppMarker(left.name) || left.host.localeCompare(right.host));
  const markerChecks = result.checked_hosts.flatMap((host) =>
    host.marker_checks.map((check) => ({
      host: host.host,
      marker: check.marker,
      path: check.path,
      status_code: check.status_code,
      content_type: check.content_type,
      matched: check.matched,
      error: check.error,
    })),
  );
  const roleHints = uniqueStrings(result.checked_hosts.map((host) => host.role_hint).filter((role) => role !== "unknown"));
  const compactPublicHosts = result.checked_hosts.map((host) => ({
    host: host.host,
    role_hint: host.role_hint,
    status_code: host.root_observation.status_code,
    title: host.root_observation.title,
    server: host.root_observation.server,
    error: host.root_observation.error,
  }));
  const publicHostStatus = failedHosts.length === result.checked_hosts.length ? "warning" : "ok";

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "public_host_fingerprint_probe",
      layer: 7,
      item: "public_host_fingerprint",
      probe_type: "dns_tls",
      source: result.source,
      status: publicHostStatus,
      value: {
        host: result.host,
        candidate_hosts: result.candidate_hosts,
        checked_hosts: result.checked_hosts.map((host) => ({
          host: host.host,
          role_hint: host.role_hint,
          sources: host.sources,
          status_code: host.root_observation.status_code,
          final_url: host.root_observation.final_url,
          redirected_to: host.root_observation.redirected_to,
          title: host.root_observation.title,
          server: host.root_observation.server,
          x_powered_by: host.root_observation.x_powered_by,
          canonical_url: host.root_observation.canonical_url,
          error: host.root_observation.error,
        })),
        reachable_host_count: reachableHosts.length,
        failed_host_count: failedHosts.length,
        role_hints: roleHints,
        limits: result.limits,
        coverage: result.coverage,
      },
      risk: {
        level: failedHosts.length === result.checked_hosts.length ? "low" : "info",
        summary:
          roleHints.length > 0
            ? `Checked ${result.checked_hosts.length} bounded public host candidate(s); observed role hint(s): ${roleHints.join(", ")}.`
            : `Checked ${result.checked_hosts.length} bounded public host candidate(s); no docs/api/blog/community/status role marker was observed.`,
      },
      evidence: [
        {
          type: "http_observation",
          name: "public_host_roles",
          value: compactPublicHosts.map((host) => ({
            host: host.host,
            role_hint: host.role_hint,
            status_code: host.status_code,
          })),
        },
        { type: "http_observation", name: "public_hosts", value: compactPublicHosts },
        { type: "http_observation", name: "reachable_public_hosts", value: reachableHosts },
        { type: "limit", name: "public_host_fingerprint_limits", value: result.limits },
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
      probe: "public_app_marker_probe",
      layer: 8,
      item: "public_app_markers",
      probe_type: "dns_tls",
      source: result.source,
      status: "ok",
      value: {
        host: result.host,
        app_markers: appMarkers,
        marker_checks: markerChecks,
        limits: result.limits,
        coverage: {
          collected: ["public_app_markers", "public_marker_paths"],
          missing: appMarkers.length > 0 ? [] : ["public_mintlify_wordpress_discourse_wp_json_markers"],
          limitations: result.coverage.limitations,
        },
      },
      risk: {
        level: "info",
        summary:
          appMarkers.length > 0
            ? `Observed public app marker(s): ${uniqueStrings(appMarkers.map((marker) => marker.name)).join(", ")}.`
            : "No Mintlify, WordPress, Discourse, or wp-json markers were observed in bounded public host checks.",
      },
      evidence: [
        {
          type: "app_marker",
          name: "public_app_marker_names",
          value: appMarkers.map((marker) => ({
            host: marker.host,
            name: marker.name,
            category: marker.category,
            confidence: marker.confidence,
          })),
        },
        { type: "app_marker", name: "public_app_markers", value: appMarkers },
        { type: "http_observation", name: "public_marker_checks", value: markerChecks },
        { type: "limit", name: "public_host_fingerprint_limits", value: result.limits },
      ],
      evidence_metadata: {
        origin: "direct_observation",
        role: "derived",
        method: "fetch",
        limitations: [
          ...result.coverage.limitations,
          "Only directly observed public markers are reported; missing markers do not prove absence.",
        ],
      },
      duration_ms: result.duration_ms,
    },
  ];
}

function buildExposureAssessment(
  result: SubdomainAttackSurfaceResult,
  reachableCount: number,
  riskyHintCount: number,
): EvidenceAssessment {
  const signals = [
    ...result.discovered_subdomains.map((item) => ({
      type: "ct_subdomain_candidate",
      name: item.host,
      value: item,
      source: result.ct_log.provider,
    })),
    ...result.exposed_surface_hints.map((hint) => ({
      type: "exposed_surface_hint",
      name: hint.hint,
      value: hint,
      source: "hostname_pattern",
    })),
  ];

  return {
    label: "Subdomain attack-surface check",
    conclusion: riskyHintCount > 0 ? "possible" : result.discovered_subdomains.length > 0 || reachableCount > 0 ? "likely" : "not_detected",
    confidence: riskyHintCount > 0 ? "possible" : result.discovered_subdomains.length > 0 || reachableCount > 0 ? "low" : "none",
    signals,
    limitations: [
      "CT subdomains are candidates derived from historical certificate transparency data.",
      "Bounded HTTPS reachability does not prove the full attack surface or service inventory.",
      "Hostname patterns such as admin, dev, staging, and tool names indicate review candidates, not confirmed sensitive exposure.",
    ],
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function scoreAppMarker(name: string): number {
  if (name === "Mintlify") return 40;
  if (name === "WordPress") return 30;
  if (name === "Discourse") return 20;
  if (name === "wp-json") return 10;
  return 1;
}

function buildServiceFingerprintAssessment(result: ServiceFingerprintResult, hintCount: number): EvidenceAssessment {
  return {
    label: "Bounded service fingerprint check",
    conclusion: hintCount > 0 ? "possible" : "not_detected",
    confidence: hintCount > 0 ? "possible" : "none",
    signals: result.checked_hosts.flatMap((host) =>
      host.service_hints.map((hint) => ({
        type: "service_fingerprint_hint",
        name: hint.label,
        value: {
          host: host.host,
          url: host.url,
          category: hint.category,
          evidence: hint.evidence,
        },
        source: result.source,
      })),
    ),
    limitations: [
      ...result.coverage.limitations,
      "This is not a complete service inventory and does not assert open ports beyond the observed HTTP(S) URL.",
    ],
  };
}

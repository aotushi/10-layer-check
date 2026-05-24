import type { LayerProbeContext } from "../core/probe-contract";
import type { EvidenceAssessment, SnapshotRecord } from "../core/types";
import type { OrganizationIntelligenceResult, RdapWhoisLiteResult, WaybackHistoryResult } from "../providers/dns-tls/types";

export function createOrganizationLayerRecords(
  context: LayerProbeContext,
  result: OrganizationIntelligenceResult,
): SnapshotRecord[] {
  const dnsRecordCount =
    result.dns.mx.answers.length + result.dns.ns.answers.length + result.dns.txt.answers.length + result.dns.caa.answers.length;
  const rdap = normalizeRdapWhoisLite(result.external_intelligence.whois);
  const wayback = normalizeWaybackHistory(result.external_intelligence.wayback);
  const relatedDomainCandidates = result.related_domain_candidates ?? [];
  const collected =
    dnsRecordCount +
    result.social_links.length +
    result.mail_providers.length +
    relatedDomainCandidates.length +
    (rdap.status === "rdap_collected" ? 1 : 0) +
    (wayback.status === "wayback_collected" ? 1 : 0);
  const coverageCollected = ["mx", "ns", "txt", "caa", "homepage_social_links", "mail_provider_hints"];
  const coverageMissing = ["icp", "related_domain_confirmation"];

  if (relatedDomainCandidates.length > 0) {
    coverageCollected.push("related_domain_candidates");
  } else {
    coverageMissing.push("related_domain_candidates");
  }

  if (rdap.status === "rdap_collected") {
    coverageCollected.push("rdap_whois_lite");
  } else {
    coverageMissing.push("rdap_whois_lite");
  }

  if (wayback.status === "wayback_collected") {
    coverageCollected.push("wayback_history");
  } else {
    coverageMissing.push("wayback_history");
  }

  const records: SnapshotRecord[] = [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "organization_intelligence_probe",
      layer: 9,
      item: "organization_intelligence",
      probe_type: "dns_tls",
      source: result.source,
      status: collected > 0 ? "ok" : "skipped",
      value: {
        host: result.host,
        dns: result.dns,
        mail_providers: result.mail_providers,
        social_links: result.social_links,
        related_domain_candidates: relatedDomainCandidates,
        organization_hints: {
          mail_providers: result.mail_providers,
          social_links: result.social_links,
          related_domain_candidates: relatedDomainCandidates,
        },
        organization_assessment: buildOrganizationAssessment(result, collected),
        external_intelligence: result.external_intelligence,
        coverage: {
          collected: coverageCollected,
          missing: coverageMissing,
        },
      },
      risk: {
        level: "info",
        summary:
          collected > 0
            ? "Collected organization-facing DNS, homepage, registration, or archive evidence."
            : "No organization intelligence evidence was collected from DNS, homepage HTML, RDAP, or Wayback.",
      },
      evidence: [
        { type: "dns", name: "mx", value: result.dns.mx.answers },
        { type: "dns", name: "txt", value: result.dns.txt.answers },
        { type: "html", name: "social_links", value: result.social_links },
        { type: "html", name: "related_domain_candidates", value: relatedDomainCandidates },
      ],
      evidence_metadata: {
        origin: "external_provider",
        role: "derived",
        method: "doh",
        limitations: [
          "Organization intelligence is limited to DNS records, homepage social-link hints, and RDAP registration evidence where available.",
          "Social links and mail provider hints are candidates for analysis, not proof of operating entity ownership.",
          "RDAP registration evidence is not proof of current operating entity ownership.",
          "Wayback archive evidence is historical evidence, not proof of current operation or ownership.",
          "Related-domain candidates are homepage-visible external host signals, not confirmed related-domain relationships.",
          "ICP and related-domain confirmation require dedicated external providers, AI review, or manual review.",
        ],
      },
      duration_ms: result.duration_ms,
    },
  ];

  records.push(createRdapWhoisLiteRecord(context, result, rdap));
  records.push(createWaybackHistoryRecord(context, result, wayback));

  return records;
}

function buildOrganizationAssessment(result: OrganizationIntelligenceResult, collected: number): EvidenceAssessment {
  const relatedDomainCandidates = result.related_domain_candidates ?? [];

  return {
    label: "Organization intelligence check",
    conclusion: collected > 0 ? "possible" : "not_detected",
    confidence: collected > 0 ? "possible" : "none",
    signals: [
      ...result.mail_providers.map((provider) => ({
        type: "mail_provider_hint",
        name: provider.provider,
        value: provider.evidence,
        source: "dns_mx_txt",
      })),
      ...result.social_links.map((link) => ({
        type: "homepage_social_link",
        name: link.platform,
        value: link.url,
        source: "homepage_html",
      })),
      ...relatedDomainCandidates.map((candidate) => ({
        type: "related_domain_candidate",
        name: candidate.host,
        value: {
          url: candidate.url,
          signal: candidate.signal,
          role: candidate.role,
          evidence: candidate.evidence,
        },
        source: candidate.source,
      })),
    ],
    limitations: [
      "DNS and homepage links provide organization hints, not legal ownership proof.",
      "RDAP registration evidence is not proof of current operating entity ownership.",
      "Wayback archive evidence is historical evidence, not proof of current operation or ownership.",
      "Related-domain candidates are collected from homepage-visible links and resources only; relationships are not confirmed.",
      "ICP and related-domain confirmation are not collected by the current provider.",
      "Final entity or relationship claims should be generated by the report layer with cited evidence and confidence.",
    ],
  };
}

function createRdapWhoisLiteRecord(
  context: LayerProbeContext,
  result: OrganizationIntelligenceResult,
  rdap: RdapWhoisLiteResult,
): SnapshotRecord {
  const collected = rdap.status === "rdap_collected";

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "rdap_whois_lite_probe",
    layer: 9,
    item: "rdap_whois_lite",
    probe_type: "dns_tls",
    source: result.source,
    status: collected ? "ok" : rdap.status === "not_available" ? "warning" : "error",
    value: {
      host: result.host,
      provider: rdap.provider,
      source: rdap.source,
      query_domain: rdap.query_domain,
      rdap_url: rdap.rdap_url,
      status: rdap.status,
      registrar: collected ? rdap.registrar : null,
      handle: collected ? rdap.handle : null,
      ldh_name: collected ? rdap.ldh_name : null,
      unicode_name: collected ? rdap.unicode_name : null,
      object_class_name: collected ? rdap.object_class_name : null,
      nameservers: collected ? rdap.nameservers : [],
      status_values: collected ? rdap.status_values : [],
      events: collected ? rdap.events : [],
      notices: collected ? rdap.notices : [],
      links: collected ? rdap.links : [],
      reason: collected ? null : rdap.reason,
      error: collected ? null : rdap.error,
      rdap_assessment: {
        label: "RDAP / WHOIS-lite registration evidence",
        conclusion: collected ? "confirmed" : "not_detected",
        confidence: collected ? "high" : "none",
        signals: collected
          ? [
              { type: "rdap_registrar", name: "registrar", value: rdap.registrar, source: rdap.provider },
              { type: "rdap_domain_status", name: "status_values", value: rdap.status_values, source: rdap.provider },
              { type: "rdap_nameservers", name: "nameservers", value: rdap.nameservers, source: rdap.provider },
              { type: "rdap_events", name: "events", value: rdap.events, source: rdap.provider },
            ]
          : [{ type: "rdap_lookup_state", name: rdap.status, value: rdap.reason, source: rdap.provider }],
        limitations: [
          "RDAP is registration evidence, not proof of current operating entity ownership.",
          "Registrar, nameserver, and date fields can be privacy-protected, redacted, stale, delegated, or unavailable by registry policy.",
          "Operating entity conclusions require cited report-layer analysis and may require manual confirmation.",
        ],
      } satisfies EvidenceAssessment,
    },
    risk: {
      level: "info",
      summary: collected
        ? "Collected RDAP / WHOIS-lite registration evidence."
        : "RDAP / WHOIS-lite registration evidence was not available from the provider.",
    },
    evidence: collected
      ? [
          { type: "external_api", name: "rdap_registrar", value: rdap.registrar },
          { type: "external_api", name: "rdap_events", value: rdap.events },
          { type: "external_api", name: "rdap_nameservers", value: rdap.nameservers },
        ]
      : [{ type: "external_api", name: "rdap_lookup_state", value: rdap }],
    evidence_metadata: {
      origin: "external_provider",
      role: "derived",
      method: "external_api",
      limitations: [
        "RDAP is registration evidence and not proof of current operating entity ownership.",
        "This probe does not collect paid WHOIS, ICP, Wayback, or related-domain inference.",
        "RDAP availability and field completeness vary by registry and registrar.",
      ],
    },
    duration_ms: result.duration_ms,
  };
}

function normalizeRdapWhoisLite(value: OrganizationIntelligenceResult["external_intelligence"]["whois"]): RdapWhoisLiteResult {
  if (value.status === "rdap_collected" || value.status === "not_available" || value.status === "error") {
    return value;
  }

  return {
    status: "not_available",
    source: "rdap",
    provider: "not_configured",
    query_domain: "",
    rdap_url: "",
    reason: value.reason,
    error: null,
  };
}

function createWaybackHistoryRecord(
  context: LayerProbeContext,
  result: OrganizationIntelligenceResult,
  wayback: WaybackHistoryResult,
): SnapshotRecord {
  const collected = wayback.status === "wayback_collected";

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "wayback_history_probe",
    layer: 9,
    item: "wayback_history",
    probe_type: "dns_tls",
    source: result.source,
    status: collected ? "ok" : wayback.status === "not_available" ? "warning" : "error",
    value: {
      host: result.host,
      provider: wayback.provider,
      source: wayback.source,
      query_url: wayback.query_url,
      cdx_url: wayback.cdx_url,
      status: wayback.status,
      snapshot_count_estimate: collected ? wayback.snapshot_count_estimate : null,
      count_mode: collected ? wayback.count_mode : "not_collected",
      first_snapshot: collected ? wayback.first_snapshot : null,
      last_snapshot: collected ? wayback.last_snapshot : null,
      sample_snapshots: collected ? wayback.sample_snapshots : [],
      reason: collected ? null : wayback.reason,
      error: collected ? null : wayback.error,
      wayback_assessment: {
        label: "Wayback historical archive evidence",
        conclusion: collected ? "confirmed" : "not_detected",
        confidence: collected ? "high" : "none",
        signals: collected
          ? [
              {
                type: "wayback_snapshot_count_estimate",
                name: "snapshot_count_estimate",
                value: wayback.snapshot_count_estimate,
                source: wayback.provider,
              },
              { type: "wayback_first_snapshot", name: "first_snapshot", value: wayback.first_snapshot, source: wayback.provider },
              { type: "wayback_last_snapshot", name: "last_snapshot", value: wayback.last_snapshot, source: wayback.provider },
            ]
          : [{ type: "wayback_lookup_state", name: wayback.status, value: wayback.reason, source: wayback.provider }],
        limitations: [
          "Wayback archive presence is historical evidence, not proof of current operation or ownership.",
          "Internet Archive coverage can be incomplete, blocked, delayed, duplicated, or URL-specific.",
          "Snapshot counts are estimates from the provider query and should not be read as full site history.",
        ],
      } satisfies EvidenceAssessment,
    },
    risk: {
      level: "info",
      summary: collected
        ? "Collected Wayback historical archive evidence."
        : "Wayback historical archive evidence was not available from the provider.",
    },
    evidence: collected
      ? [
          { type: "external_api", name: "wayback_snapshot_count_estimate", value: wayback.snapshot_count_estimate },
          { type: "external_api", name: "wayback_first_snapshot", value: wayback.first_snapshot },
          { type: "external_api", name: "wayback_last_snapshot", value: wayback.last_snapshot },
        ]
      : [{ type: "external_api", name: "wayback_lookup_state", value: wayback }],
    evidence_metadata: {
      origin: "external_provider",
      role: "derived",
      method: "external_api",
      limitations: [
        "Wayback archive presence is historical evidence and not proof of current operation or ownership.",
        "This probe does not infer related domains, operating entity, or historical business continuity.",
        "Internet Archive availability and snapshot counts vary by URL, crawl policy, and provider behavior.",
      ],
    },
    duration_ms: result.duration_ms,
  };
}

function normalizeWaybackHistory(value: OrganizationIntelligenceResult["external_intelligence"]["wayback"]): WaybackHistoryResult {
  if (value.status === "wayback_collected" || value.status === "not_available" || value.status === "error") {
    return value;
  }

  return {
    status: "not_available",
    source: "internet_archive",
    provider: "not_configured",
    query_url: "",
    cdx_url: "",
    reason: value.reason,
    error: null,
  };
}

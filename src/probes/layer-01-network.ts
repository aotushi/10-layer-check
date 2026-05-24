import type { LayerProbeContext } from "../core/probe-contract";
import type { Evidence, EvidenceAssessment, SnapshotRecord } from "../core/types";
import type { DnsInfrastructureResult } from "../providers/dns-tls/types";

export type CdnHeaderEvidenceInput = {
  url: string;
  scope: "main_response" | "runtime_resource";
  resource_type?: string;
  headers: Record<string, string | null | undefined>;
  source: string;
};

export function createNetworkLayerRecords(
  context: LayerProbeContext,
  result: DnsInfrastructureResult,
): SnapshotRecord[] {
  const hasIpv4 = result.ip_addresses.ipv4.length > 0;
  const hasIpv6 = result.ip_addresses.ipv6.length > 0;
  const protocolSupport = {
    http: summarizeProtocol(result.protocol_reachability.http),
    https: summarizeProtocol(result.protocol_reachability.https),
  };
  const hasAsn = result.asn.records.length > 0;
  const missingSignals = hasAsn ? [] : ["asn"];
  const collectedSignals = [
    "dns_a",
    "dns_aaaa",
    "dns_cname",
    "dns_https",
    "cdn_dns_hint",
    "protocol_reachability",
    ...(hasAsn ? ["asn"] : []),
  ];
  const risk = buildNetworkRisk(result, hasIpv4, hasIpv6);

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "network_infrastructure_probe",
      layer: 1,
      item: "network_infrastructure",
      probe_type: "dns_tls",
      source: result.source,
      status: risk.status,
      value: {
        host: result.host,
        dns_records: {
          a: result.dns.a.answers,
          aaaa: result.dns.aaaa.answers,
          cname: result.dns.cname.answers,
          https: result.dns.https.answers,
        },
        ip_addresses: result.ip_addresses,
        ipv4_supported: hasIpv4,
        ipv6_supported: hasIpv6,
        protocol_reachability: protocolSupport,
        cdn: result.cdn,
        cdn_assessment: buildCdnAssessment(result),
        asn: result.asn,
        coverage: {
          collected: collectedSignals,
          missing: missingSignals,
        },
        duration_ms: result.duration_ms,
      },
      risk: {
        level: risk.level,
        summary: risk.summary,
      },
      evidence: [
        { type: "dns", name: "A", value: result.dns.a.answers },
        { type: "dns", name: "AAAA", value: result.dns.aaaa.answers },
        { type: "dns", name: "CNAME", value: result.dns.cname.answers },
        { type: "dns", name: "HTTPS", value: result.dns.https.answers },
        { type: "asn", name: result.asn.provider, value: result.asn },
        { type: "protocol", name: "http", value: result.protocol_reachability.http },
        { type: "protocol", name: "https", value: result.protocol_reachability.https },
      ],
      evidence_metadata: {
        origin: "external_provider",
        role: "derived",
        method: "doh",
        limitations: [
          "DNS records and ASN enrichment are collected through external DNS intelligence providers.",
          "CDN provider detection is a DNS/response-hint inference and does not prove full edge routing or origin topology.",
          "Protocol reachability confirms the probed HTTP/HTTPS URLs only, not every endpoint on the site.",
        ],
      },
      duration_ms: result.duration_ms,
    },
  ];
}

export function createCdnHeaderEvidenceRecord(
  context: LayerProbeContext,
  inputs: CdnHeaderEvidenceInput[],
): SnapshotRecord | null {
  const headerSignals = inputs.flatMap(extractCdnHeaderSignals);

  if (inputs.length === 0) {
    return null;
  }

  const providers = Array.from(new Set(headerSignals.map((signal) => signal.provider).filter(Boolean)));
  const riskLevel: SnapshotRecord["risk"]["level"] = headerSignals.length > 0 ? "info" : "low";
  const status: SnapshotRecord["status"] = headerSignals.length > 0 ? "ok" : "warning";
  const assessment: EvidenceAssessment = {
    label: "CDN header evidence",
    conclusion: headerSignals.length > 0 ? "likely" : "not_detected",
    confidence: headerSignals.length > 0 ? "possible" : "none",
    signals: headerSignals.map((signal) => ({
      type: "cdn_header_signal",
      name: signal.header,
      value: signal.value,
      source: signal.source,
    })),
    limitations: [
      "Header signals can indicate CDN or edge infrastructure, but do not prove complete CDN topology.",
      "Absence of these headers does not prove the site is not behind a CDN.",
      "DNS hints, multi-region checks, traceroute, POP validation, and cache-hit validation are outside this record.",
    ],
  };

  return {
    target: context.target,
    normalized_target: context.normalizedTarget,
    snapshot_at: context.snapshotAt,
    probe: "cdn_header_evidence_probe",
    layer: 1,
    item: "cdn_header_evidence",
    probe_type: "active_request",
    source: `${inputs.map((input) => input.source).join(", ")} + cdn_header_rules`,
    status,
    value: {
      checked_scope_count: inputs.length,
      signal_count: headerSignals.length,
      providers,
      source_coverage: {
        dns: "not_collected",
        headers: "collected",
      },
      header_signals: headerSignals,
      cdn_assessment: assessment,
    },
    risk: {
      level: riskLevel,
      summary:
        headerSignals.length > 0
          ? `CDN header signal(s) found: ${providers.length > 0 ? providers.join(", ") : `${headerSignals.length} header(s)`}.`
          : "No CDN header signal was found in the collected response/resource headers.",
    },
    evidence: buildCdnHeaderEvidence(headerSignals),
    evidence_metadata: {
      origin: "direct_observation",
      role: "derived",
      method: "fetch",
      limitations: [
        "This record is derived from response/resource headers only.",
        "It complements, but does not replace, DNS-based CDN hints in network_infrastructure_probe.",
        "It does not prove full edge routing, origin shielding, cache behavior, or CDN provider coverage.",
      ],
    },
  };
}

function summarizeProtocol(value: DnsInfrastructureResult["protocol_reachability"]["http"]) {
  return {
    url: value.url,
    reachable: value.reachable,
    status_code: value.status_code,
    redirected_to: value.redirected_to,
    error: value.error,
  };
}

function buildNetworkRisk(
  result: DnsInfrastructureResult,
  hasIpv4: boolean,
  hasIpv6: boolean,
): { status: SnapshotRecord["status"]; level: SnapshotRecord["risk"]["level"]; summary: string } {
  const httpsReachable = result.protocol_reachability.https.reachable;
  const httpReachable = result.protocol_reachability.http.reachable;

  if (!hasIpv4 && !hasIpv6) {
    return {
      status: "error",
      level: "high",
      summary: "No A or AAAA records were found for the target host.",
    };
  }

  if (!httpsReachable && httpReachable) {
    return {
      status: "warning",
      level: "medium",
      summary: "DNS resolves, but HTTPS reachability was not confirmed.",
    };
  }

  if (!hasIpv6) {
    return {
      status: "warning",
      level: "low",
      summary: "Network layer resolved over IPv4, but no IPv6 address was found.",
    };
  }

  return {
    status: "ok",
    level: result.cdn.detected ? "info" : "low",
    summary: result.cdn.detected
      ? `DNS and protocol checks completed; CDN signal(s) found: ${result.cdn.providers.join(", ")}.`
      : "DNS and protocol checks completed; no CDN signal was found from DNS records.",
  };
}

function buildCdnAssessment(result: DnsInfrastructureResult): EvidenceAssessment {
  const signals = result.cdn.evidence.map((value) => ({
    type: "cdn_dns_or_header_signal",
    name: result.cdn.providers.join(", ") || "unknown",
    value,
    source: result.source,
  }));

  return {
    label: "CDN check",
    conclusion: result.cdn.detected ? "likely" : "not_detected",
    confidence: result.cdn.confidence === "none" ? "none" : result.cdn.confidence,
    signals,
    limitations: [
      "This is a CDN signal assessment, not full CDN topology verification.",
      "DNS and response-header signals can indicate CDN usage but cannot prove edge routing, cache behavior, or origin shielding.",
      "Multi-region DNS, traceroute, POP, and cache-hit validation are outside the current MVP.",
    ],
  };
}

function extractCdnHeaderSignals(input: CdnHeaderEvidenceInput) {
  return Object.entries(input.headers).flatMap(([rawName, rawValue]) => {
    const header = rawName.toLowerCase();
    const value = typeof rawValue === "string" ? rawValue : null;
    if (!value) return [];

    const provider = inferCdnProvider(header, value);
    if (!provider) return [];

    return [
      {
        url: input.url,
        scope: input.scope,
        resource_type: input.resource_type ?? null,
        header,
        value,
        provider,
        source: input.source,
      },
    ];
  });
}

function inferCdnProvider(header: string, value: string): string | null {
  const lowerValue = value.toLowerCase();

  if (header === "cf-ray" || header === "cf-cache-status" || lowerValue.includes("cloudflare")) return "cloudflare";
  if (header === "x-vercel-id" || lowerValue.includes("vercel")) return "vercel";
  if (header === "x-fastly-request-id" || header === "x-served-by" || lowerValue.includes("fastly")) return "fastly";
  if (header === "x-amz-cf-pop" || header === "x-amz-cf-id" || lowerValue.includes("cloudfront")) return "cloudfront";
  if (header === "x-akamai-transformed" || lowerValue.includes("akamai")) return "akamai";
  if (header === "x-cache" || header === "x-cache-hits" || header === "x-cache-status") return "cache_header";
  if (header === "via") return "proxy_or_cdn";
  if (header === "server" && /(cloudflare|akamai|cloudfront|fastly|vercel|netlify|cloudflare-nginx)/i.test(value)) {
    return lowerValue.includes("cloudflare")
      ? "cloudflare"
      : lowerValue.includes("akamai")
        ? "akamai"
        : lowerValue.includes("cloudfront")
          ? "cloudfront"
          : lowerValue.includes("fastly")
            ? "fastly"
            : lowerValue.includes("vercel")
              ? "vercel"
              : "cdn_server_header";
  }

  return null;
}

function buildCdnHeaderEvidence(signals: ReturnType<typeof extractCdnHeaderSignals>): Evidence[] {
  return signals.slice(0, 50).map((signal) => ({
    type: "cdn_header_signal",
    name: signal.header,
    value: {
      provider: signal.provider,
      header: signal.header,
      header_value: signal.value,
      url: signal.url,
      scope: signal.scope,
      resource_type: signal.resource_type,
    },
  }));
}

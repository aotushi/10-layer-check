import type { LayerProbeContext } from "../core/probe-contract";
import type { SnapshotRecord } from "../core/types";
import type { TlsCertificateResult } from "../providers/dns-tls/types";

export function createTlsLayerRecords(context: LayerProbeContext, result: TlsCertificateResult): SnapshotRecord[] {
  const latestCtEntry = getLatestCtEntry(result);
  const hstsRisk = assessHsts(result);
  const certificateRisk = assessCertificate(result, latestCtEntry);
  const risk = chooseRisk(hstsRisk, certificateRisk);

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "tls_certificate_probe",
      layer: 2,
      item: "tls_certificate",
      probe_type: "dns_tls",
      source: result.source,
      status: risk.status,
      value: {
        host: result.host,
        https_reachability: result.https_reachability,
        hsts: result.hsts,
        ct_log: {
          provider: result.ct_log.provider,
          status: result.ct_log.status,
          certificate_count: result.ct_log.certificates.length,
          certificates: result.ct_log.certificates,
          error: result.ct_log.error,
        },
        latest_ct_entry: latestCtEntry,
        current_certificate: result.current_certificate,
        coverage: result.coverage,
        duration_ms: result.duration_ms,
      },
      risk: {
        level: risk.level,
        summary: risk.summary,
      },
      evidence: [
        { type: "protocol", name: "https", value: result.https_reachability },
        { type: "http_header", name: "strict-transport-security", value: result.hsts.raw },
        { type: "ct_log", name: result.ct_log.provider, value: result.ct_log.certificates },
      ],
      evidence_metadata: {
        origin: "external_provider",
        role: "derived",
        method: "external_api",
        limitations: [
          "CT log entries are historical certificate records and may include expired, revoked, or no-longer-used certificates.",
          "CT metadata must not be treated as the current live certificate chain or current certificate expiry.",
          "Worker fetch does not expose negotiated TLS version, cipher, SAN list, issuer, or full certificate chain.",
        ],
      },
      duration_ms: result.duration_ms,
    },
  ];
}

function getLatestCtEntry(result: TlsCertificateResult): TlsCertificateResult["ct_log"]["certificates"][number] | null {
  return [...result.ct_log.certificates].sort((a, b) => {
    const left = a.not_before ? Date.parse(a.not_before) : 0;
    const right = b.not_before ? Date.parse(b.not_before) : 0;
    return right - left;
  })[0] ?? null;
}

function assessHsts(result: TlsCertificateResult): RiskAssessment {
  if (!result.hsts.present) {
    return {
      status: "warning",
      level: "medium",
      summary: "HTTPS is reachable, but HSTS was not found on the probed response.",
    };
  }

  if ((result.hsts.max_age_seconds ?? 0) < 15_552_000) {
    return {
      status: "warning",
      level: "low",
      summary: "HSTS is present, but max-age is shorter than 180 days.",
    };
  }

  return {
    status: "ok",
    level: "info",
    summary: "HSTS is present with a long max-age.",
  };
}

function assessCertificate(
  result: TlsCertificateResult,
  latestCtEntry: TlsCertificateResult["ct_log"]["certificates"][number] | null,
): RiskAssessment {
  if (!result.https_reachability.reachable) {
    return {
      status: "error",
      level: "high",
      summary: "HTTPS reachability failed, so TLS posture could not be confirmed.",
    };
  }

  if (result.ct_log.status === "error") {
    return {
      status: "warning",
      level: "low",
      summary: "HTTPS is reachable, but CT log lookup failed.",
    };
  }

  if (!latestCtEntry) {
    return {
      status: "warning",
      level: "medium",
      summary: "HTTPS is reachable, but no CT certificate entries were found for the host.",
    };
  }

  return {
    status: "ok",
    level: "info",
    summary: "HTTPS and CT log metadata lookup completed; live certificate chain and expiry still require a full TLS provider.",
  };
}

function chooseRisk(...items: RiskAssessment[]): RiskAssessment {
  const order: Record<RiskAssessment["level"], number> = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
  };
  return [...items].sort((a, b) => order[b.level] - order[a.level])[0] ?? {
    status: "skipped",
    level: "info",
    summary: "TLS probe did not return analyzable data.",
  };
}

type RiskAssessment = {
  status: SnapshotRecord["status"];
  level: SnapshotRecord["risk"]["level"];
  summary: string;
};

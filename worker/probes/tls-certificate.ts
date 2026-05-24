type ProtocolReachabilityResult = {
  url: string;
  reachable: boolean;
  status_code: number | null;
  redirected_to: string | null;
  error: string | null;
};

type HstsPolicy = {
  present: boolean;
  raw: string | null;
  max_age_seconds: number | null;
  include_subdomains: boolean;
  preload: boolean;
};

type CtCertificateSummary = {
  id: string;
  dns_names: string[];
  issuer_name: string | null;
  issuer_friendly_name: string | null;
  not_before: string | null;
  not_after: string | null;
  revoked: boolean;
  cert_sha256: string | null;
};

export type TlsCertificateResult = {
  requested_url: string;
  host: string;
  https_reachability: ProtocolReachabilityResult;
  hsts: HstsPolicy;
  ct_log: {
    provider: string;
    status: "ok" | "error";
    certificates: CtCertificateSummary[];
    error: string | null;
  };
  current_certificate: {
    status: "not_collected";
    reason: string;
  };
  coverage: {
    collected: string[];
    missing: string[];
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export async function tlsCertificateProbe(target: string): Promise<TlsCertificateResult> {
  const startedAt = Date.now();
  const normalizedUrl = normalizeTargetUrl(target);
  const host = new URL(normalizedUrl).hostname;
  const httpsUrl = `https://${host}/`;
  const [httpsReachability, hsts, ctLog] = await Promise.all([
    checkProtocolReachability(httpsUrl),
    fetchHstsPolicy(httpsUrl),
    fetchCtLog(host),
  ]);

  return {
    requested_url: target,
    host,
    https_reachability: httpsReachability,
    hsts,
    ct_log: ctLog,
    current_certificate: {
      status: "not_collected",
      reason: "Cloudflare Worker fetch does not expose the live TLS certificate chain. Use a dedicated TLS provider or Node-based probe for current chain, issuer, SAN, and negotiated protocol details.",
    },
    coverage: {
      collected: ["https_reachability", "hsts_header", "ct_log_summary"],
      missing: ["live_certificate_chain", "live_certificate_san", "live_certificate_issuer", "live_certificate_expiry"],
    },
    duration_ms: Date.now() - startedAt,
    provider_id: "worker-tls-certificate",
    source: "cloudflare_worker_tls",
  };
}

async function fetchHstsPolicy(url: string): Promise<HstsPolicy> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,*/*;q=0.8",
      },
    });
    return parseHsts(response.headers.get("strict-transport-security"));
  } catch {
    return parseHsts(null);
  }
}

function parseHsts(raw: string | null): HstsPolicy {
  const directives = (raw ?? "")
    .split(";")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const maxAgeDirective = directives.find((part) => part.startsWith("max-age="));
  const maxAgeSeconds = maxAgeDirective ? Number(maxAgeDirective.split("=")[1]) : null;

  return {
    present: Boolean(raw),
    raw,
    max_age_seconds: Number.isFinite(maxAgeSeconds) ? maxAgeSeconds : null,
    include_subdomains: directives.includes("includesubdomains"),
    preload: directives.includes("preload"),
  };
}

async function fetchCtLog(host: string): Promise<TlsCertificateResult["ct_log"]> {
  try {
    const url = new URL("https://api.certspotter.com/v1/issuances");
    url.searchParams.set("domain", host);
    url.searchParams.set("include_subdomains", "false");
    url.searchParams.append("expand", "dns_names");
    url.searchParams.append("expand", "issuer");

    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      return {
        provider: "certspotter",
        status: "error",
        certificates: [],
        error: `Cert Spotter returned ${response.status}.`,
      };
    }

    const body = (await response.json()) as unknown;
    const certificates = Array.isArray(body) ? body.map(normalizeCtCertificate).filter(isCtCertificateSummary).slice(0, 20) : [];

    return {
      provider: "certspotter",
      status: "ok",
      certificates,
      error: null,
    };
  } catch (error) {
    return {
      provider: "certspotter",
      status: "error",
      certificates: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkProtocolReachability(url: string): Promise<ProtocolReachabilityResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,*/*;q=0.8",
      },
    });
    return {
      url,
      reachable: response.status < 500,
      status_code: response.status,
      redirected_to: response.headers.get("location"),
      error: null,
    };
  } catch (error) {
    return {
      url,
      reachable: false,
      status_code: null,
      redirected_to: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeCtCertificate(value: unknown): CtCertificateSummary | null {
  if (!isPlainObject(value)) return null;
  const issuer = isPlainObject(value.issuer) ? value.issuer : {};
  return {
    id: typeof value.id === "string" ? value.id : "",
    dns_names: Array.isArray(value.dns_names)
      ? value.dns_names.filter((name): name is string => typeof name === "string")
      : [],
    issuer_name: typeof issuer.name === "string" ? issuer.name : null,
    issuer_friendly_name: typeof issuer.friendly_name === "string" ? issuer.friendly_name : null,
    not_before: typeof value.not_before === "string" ? value.not_before : null,
    not_after: typeof value.not_after === "string" ? value.not_after : null,
    revoked: value.revoked === true,
    cert_sha256: typeof value.cert_sha256 === "string" ? value.cert_sha256 : null,
  };
}

function isCtCertificateSummary(value: CtCertificateSummary | null): value is CtCertificateSummary {
  return value !== null && value.id.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTargetUrl(value: string): string {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https targets are supported. Received: ${url.protocol}`);
  }

  return url.toString();
}

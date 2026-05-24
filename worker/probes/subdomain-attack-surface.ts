type ProtocolReachabilityResult = {
  url: string;
  reachable: boolean;
  status_code: number | null;
  redirected_to: string | null;
  final_url: string | null;
  content_type: string | null;
  server: string | null;
  x_powered_by: string | null;
  title: string | null;
  body_sample_bytes: number | null;
  error: string | null;
};

type CtProviderAttempt = {
  provider: "certspotter" | "crtsh";
  status: "ok" | "error";
  certificate_count: number;
  error: string | null;
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

export type SubdomainAttackSurfaceResult = {
  requested_url: string;
  host: string;
  ct_log: {
    provider: string;
    status: "ok" | "error";
    certificate_count: number;
    error: string | null;
    providers: CtProviderAttempt[];
  };
  discovered_subdomains: Array<{
    host: string;
    source: "ct_log";
    sources: string[];
    indicators: string[];
  }>;
  reachability: Array<{
    host: string;
    https: ProtocolReachabilityResult;
  }>;
  exposed_surface_hints: Array<{
    host: string;
    hint: string;
    reason: string;
  }>;
  limits: {
    max_reachability_checks: number;
    checked_count: number;
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export async function subdomainAttackSurfaceProbe(target: string): Promise<SubdomainAttackSurfaceResult> {
  const startedAt = Date.now();
  const normalizedUrl = normalizeTargetUrl(target);
  const host = new URL(normalizedUrl).hostname;
  const ctLog = await fetchCtLogForDomain(host);
  const discoveredSubdomains = extractSubdomainsFromCertificates(host, ctLog.certificates);
  const maxReachabilityChecks = 10;
  const reachableCandidates = discoveredSubdomains.slice(0, maxReachabilityChecks);
  const reachability = await Promise.all(
    reachableCandidates.map(async (candidate) => ({
      host: candidate.host,
      https: await checkProtocolReachability(`https://${candidate.host}/`),
    })),
  );

  return {
    requested_url: target,
    host,
    ct_log: {
      provider: ctLog.provider,
      status: ctLog.status,
      certificate_count: ctLog.certificates.length,
      error: ctLog.error,
      providers: ctLog.providers,
    },
    discovered_subdomains: discoveredSubdomains,
    reachability,
    exposed_surface_hints: detectSubdomainSurfaceHints(discoveredSubdomains.map((item) => item.host)),
    limits: {
      max_reachability_checks: maxReachabilityChecks,
      checked_count: reachability.length,
    },
    duration_ms: Date.now() - startedAt,
    provider_id: "worker-subdomain-attack-surface",
    source: "cloudflare_worker_subdomains",
  };
}

async function fetchCtLogForDomain(
  host: string,
): Promise<{
  provider: string;
  status: "ok" | "error";
  certificates: CtCertificateSummary[];
  error: string | null;
  providers: CtProviderAttempt[];
}> {
  const attempts: CtProviderAttempt[] = [];
  const certSpotter = await fetchCertSpotterCertificates(host, true);
  attempts.push({
    provider: "certspotter",
    status: certSpotter.status,
    certificate_count: certSpotter.certificates.length,
    error: certSpotter.error,
  });

  if (certSpotter.status === "ok" && certSpotter.certificates.length > 0) {
    return {
      provider: "certspotter",
      status: "ok",
      certificates: certSpotter.certificates,
      error: null,
      providers: attempts,
    };
  }

  const crtSh = await fetchCrtShCertificates(host);
  attempts.push({
    provider: "crtsh",
    status: crtSh.status,
    certificate_count: crtSh.certificates.length,
    error: crtSh.error,
  });

  if (crtSh.status === "ok") {
    return {
      provider: "crtsh",
      status: "ok",
      certificates: mergeCertificates(certSpotter.certificates, crtSh.certificates),
      error: null,
      providers: attempts,
    };
  }

  return {
    provider: attempts.map((attempt) => attempt.provider).join("+"),
    status: "error",
    certificates: [],
    error: attempts
      .map((attempt) => `${attempt.provider}: ${attempt.error ?? "no certificates returned"}`)
      .join("; "),
    providers: attempts,
  };
}

async function fetchCertSpotterCertificates(
  host: string,
  includeSubdomains: boolean,
): Promise<{ status: "ok" | "error"; certificates: CtCertificateSummary[]; error: string | null }> {
  try {
    const url = new URL("https://api.certspotter.com/v1/issuances");
    url.searchParams.set("domain", host);
    url.searchParams.set("include_subdomains", includeSubdomains ? "true" : "false");
    url.searchParams.append("expand", "dns_names");
    url.searchParams.append("expand", "issuer");

    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      return { status: "error", certificates: [], error: `Cert Spotter returned ${response.status}.` };
    }

    const body = (await response.json()) as unknown;
    const certificates = Array.isArray(body)
      ? body.map((item) => normalizeCertSpotterCertificate(item)).filter(isCtCertificateSummary).slice(0, 100)
      : [];
    return { status: "ok", certificates, error: null };
  } catch (error) {
    return {
      status: "error",
      certificates: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchCrtShCertificates(host: string): Promise<{ status: "ok" | "error"; certificates: CtCertificateSummary[]; error: string | null }> {
  try {
    const url = new URL("https://crt.sh/");
    url.searchParams.set("q", `%.${host}`);
    url.searchParams.set("output", "json");

    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      return { status: "error", certificates: [], error: `crt.sh returned ${response.status}.` };
    }

    const body = (await response.json()) as unknown;
    const certificates = Array.isArray(body)
      ? body.map((item) => normalizeCrtShCertificate(item)).filter(isCtCertificateSummary).slice(0, 100)
      : [];
    return { status: "ok", certificates, error: null };
  } catch (error) {
    return {
      status: "error",
      certificates: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractSubdomainsFromCertificates(host: string, certificates: CtCertificateSummary[]) {
  const subdomains = new Map<string, { host: string; source: "ct_log"; sources: string[]; indicators: string[] }>();
  const suffix = `.${host}`;

  for (const certificate of certificates) {
    for (const name of certificate.dns_names) {
      const normalized = name.toLowerCase().replace(/^\*\./, "");
      if (normalized === host || !normalized.endsWith(suffix)) continue;
      const current = subdomains.get(normalized) ?? { host: normalized, source: "ct_log" as const, sources: [], indicators: [] };
      if (certificate.id.startsWith("certspotter:")) current.sources.push("certspotter");
      if (certificate.id.startsWith("crtsh:")) current.sources.push("crtsh");
      if (certificate.issuer_friendly_name) current.indicators.push(`issuer:${certificate.issuer_friendly_name}`);
      subdomains.set(normalized, current);
    }
  }

  return Array.from(subdomains.values())
    .map((item) => ({
      ...item,
      sources: Array.from(new Set(item.sources)).sort(),
      indicators: Array.from(new Set(item.indicators)).slice(0, 5),
    }))
    .sort((a, b) => a.host.localeCompare(b.host))
    .slice(0, 80);
}

function detectSubdomainSurfaceHints(hosts: string[]): SubdomainAttackSurfaceResult["exposed_surface_hints"] {
  const rules: Array<{ hint: string; pattern: RegExp; reason: string }> = [
    { hint: "admin", pattern: /(^|[.-])admin[.-]/i, reason: "Administrative surface naming pattern." },
    { hint: "staging", pattern: /(^|[.-])(stage|staging|preprod|uat)[.-]/i, reason: "Pre-production environment naming pattern." },
    { hint: "dev", pattern: /(^|[.-])(dev|test|qa)[.-]/i, reason: "Development or testing environment naming pattern." },
    { hint: "grafana", pattern: /grafana/i, reason: "Monitoring tool naming pattern." },
    { hint: "kibana", pattern: /kibana/i, reason: "Log tooling naming pattern." },
    { hint: "jenkins", pattern: /jenkins/i, reason: "CI tooling naming pattern." },
  ];

  return hosts.flatMap((host) =>
    rules
      .filter((rule) => rule.pattern.test(host))
      .map((rule) => ({
        host,
        hint: rule.hint,
        reason: rule.reason,
      })),
  );
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
    const bodySample = await readLimitedText(response, 32_000);
    return {
      url,
      reachable: response.status < 500,
      status_code: response.status,
      redirected_to: response.headers.get("location"),
      final_url: response.url || url,
      content_type: response.headers.get("content-type"),
      server: response.headers.get("server"),
      x_powered_by: response.headers.get("x-powered-by"),
      title: extractTitle(bodySample),
      body_sample_bytes: bodySample.length,
      error: null,
    };
  } catch (error) {
    return {
      url,
      reachable: false,
      status_code: null,
      redirected_to: null,
      final_url: null,
      content_type: null,
      server: null,
      x_powered_by: null,
      title: null,
      body_sample_bytes: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;

      const remaining = maxBytes - total;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;

      if (value.byteLength > remaining) break;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  return decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim()).slice(0, 200) || null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function normalizeCertSpotterCertificate(value: unknown): CtCertificateSummary | null {
  if (!isPlainObject(value)) return null;
  const issuer = isPlainObject(value.issuer) ? value.issuer : {};
  return {
    id: typeof value.id === "string" ? `certspotter:${value.id}` : "",
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

function normalizeCrtShCertificate(value: unknown): CtCertificateSummary | null {
  if (!isPlainObject(value)) return null;
  const id = typeof value.id === "string" || typeof value.id === "number" ? String(value.id) : "";
  const nameValue = typeof value.name_value === "string" ? value.name_value : "";
  const issuerName = typeof value.issuer_name === "string" ? value.issuer_name : null;
  return {
    id: id ? `crtsh:${id}` : "",
    dns_names: nameValue
      .split(/\s+/)
      .map((name) => name.trim())
      .filter(Boolean),
    issuer_name: issuerName,
    issuer_friendly_name: issuerName,
    not_before: typeof value.not_before === "string" ? value.not_before : null,
    not_after: typeof value.not_after === "string" ? value.not_after : null,
    revoked: false,
    cert_sha256: typeof value.cert_sha256 === "string" ? value.cert_sha256 : null,
  };
}

function mergeCertificates(...groups: CtCertificateSummary[][]): CtCertificateSummary[] {
  const certificates = new Map<string, CtCertificateSummary>();
  for (const group of groups) {
    for (const certificate of group) {
      certificates.set(certificate.id, certificate);
    }
  }
  return Array.from(certificates.values()).slice(0, 100);
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

type DnsAnswer = {
  name: string;
  type: number;
  ttl: number;
  data: string;
};

type DnsQueryResult = {
  type: "A" | "AAAA" | "CNAME" | "HTTPS" | "MX" | "NS" | "TXT" | "CAA";
  status: number;
  answers: DnsAnswer[];
};

type ProtocolReachabilityResult = {
  url: string;
  reachable: boolean;
  status_code: number | null;
  redirected_to: string | null;
  error: string | null;
};

type AsnRecord = {
  ip: string;
  asn: string;
  prefix: string | null;
  country_code: string | null;
  registry: string | null;
  allocated: string | null;
  name: string | null;
};

type AsnEnrichmentResult = {
  status: "ok" | "partial" | "not_collected" | "error";
  provider: string;
  records: AsnRecord[];
  queried_ip_count: number;
  error: string | null;
  reason?: string;
};

export type DnsInfrastructureResult = {
  requested_url: string;
  host: string;
  dns: {
    a: DnsQueryResult;
    aaaa: DnsQueryResult;
    cname: DnsQueryResult;
    https: DnsQueryResult;
  };
  ip_addresses: {
    ipv4: string[];
    ipv6: string[];
  };
  cdn: {
    detected: boolean;
    providers: string[];
    evidence: string[];
    confidence: "none" | "low" | "medium" | "high";
  };
  asn: AsnEnrichmentResult;
  protocol_reachability: {
    http: ProtocolReachabilityResult;
    https: ProtocolReachabilityResult;
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export async function dnsInfrastructureProbe(target: string): Promise<DnsInfrastructureResult> {
  const startedAt = Date.now();
  const normalizedUrl = normalizeTargetUrl(target);
  const host = new URL(normalizedUrl).hostname;
  const [a, aaaa, cname, https, httpReachability, httpsReachability] = await Promise.all([
    queryDns(host, "A"),
    queryDns(host, "AAAA"),
    queryDns(host, "CNAME"),
    queryDns(host, "HTTPS"),
    checkProtocolReachability(`http://${host}/`),
    checkProtocolReachability(`https://${host}/`),
  ]);
  const dnsEvidence = [...a.answers, ...aaaa.answers, ...cname.answers, ...https.answers].map((answer) => answer.data);
  const ipv4 = a.answers.map((answer) => answer.data);
  const ipv6 = aaaa.answers.map((answer) => answer.data);
  const asn = await fetchAsnEnrichment([...ipv4, ...ipv6]);

  return {
    requested_url: target,
    host,
    dns: {
      a,
      aaaa,
      cname,
      https,
    },
    ip_addresses: {
      ipv4,
      ipv6,
    },
    cdn: detectCdn(dnsEvidence),
    asn,
    protocol_reachability: {
      http: httpReachability,
      https: httpsReachability,
    },
    duration_ms: Date.now() - startedAt,
    provider_id: "worker-dns-infrastructure",
    source: "cloudflare_worker_dns",
  };
}

async function fetchAsnEnrichment(ipAddresses: string[]): Promise<AsnEnrichmentResult> {
  const uniqueIps = Array.from(new Set(ipAddresses)).filter((ip) => isIpv4Address(ip) || isIpv6Address(ip)).slice(0, 10);

  if (uniqueIps.length === 0) {
    return {
      status: "not_collected",
      provider: "team_cymru_dns",
      records: [],
      queried_ip_count: 0,
      error: null,
      reason: "No A or AAAA records were available for ASN enrichment.",
    };
  }

  const lookups = await Promise.all(
    uniqueIps.map(async (ip) => {
      try {
        const queryName = buildCymruAsnQueryName(ip);
        if (!queryName) return { ip, record: null, error: "Unsupported IP address format." };
        const result = await queryDns(queryName, "TXT");
        const record = result.answers
          .map((answer) => parseCymruAsnRecord(ip, answer.data))
          .find((entry): entry is AsnRecord => entry !== null);
        return { ip, record, error: record ? null : "No ASN TXT answer was returned." };
      } catch (error) {
        return { ip, record: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  const records = lookups.map((lookup) => lookup.record).filter((record): record is AsnRecord => record !== null);
  const errors = lookups.filter((lookup) => lookup.error).map((lookup) => `${lookup.ip}: ${lookup.error}`);

  return {
    status: records.length === 0 ? "error" : errors.length > 0 ? "partial" : "ok",
    provider: "team_cymru_dns",
    records,
    queried_ip_count: uniqueIps.length,
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}

function buildCymruAsnQueryName(ip: string): string | null {
  if (isIpv4Address(ip)) {
    return `${ip.split(".").reverse().join(".")}.origin.asn.cymru.com`;
  }

  if (isIpv6Address(ip)) {
    const expanded = expandIpv6Address(ip);
    if (!expanded) return null;
    return `${expanded.replace(/:/g, "").split("").reverse().join(".")}.origin6.asn.cymru.com`;
  }

  return null;
}

function parseCymruAsnRecord(ip: string, rawValue: string): AsnRecord | null {
  const value = rawValue.replace(/^"+|"+$/g, "").replace(/\\"/g, "\"");
  const parts = value.split("|").map((part) => part.trim());
  const [asn, prefix, countryCode, registry, allocated, name] = parts;

  if (!asn || !/^\d+$/.test(asn)) return null;

  return {
    ip,
    asn,
    prefix: prefix || null,
    country_code: countryCode || null,
    registry: registry || null,
    allocated: allocated || null,
    name: name || null,
  };
}

function isIpv4Address(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isIpv6Address(value: string): boolean {
  return value.includes(":") && /^[0-9a-f:]+$/i.test(value);
}

function expandIpv6Address(value: string): string | null {
  const [leftRaw, rightRaw] = value.toLowerCase().split("::");
  const left = leftRaw ? leftRaw.split(":").filter(Boolean) : [];
  const right = rightRaw ? rightRaw.split(":").filter(Boolean) : [];

  if (value.includes("::")) {
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    return [...left, ...Array.from({ length: missing }, () => "0"), ...right]
      .map((part) => part.padStart(4, "0"))
      .join(":");
  }

  const parts = value.split(":");
  if (parts.length !== 8) return null;
  return parts.map((part) => part.padStart(4, "0")).join(":");
}

async function queryDns(host: string, type: DnsQueryResult["type"]): Promise<DnsQueryResult> {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", host);
  url.searchParams.set("type", type);

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/dns-json",
    },
  });
  const body = (await response.json()) as { Status?: unknown; Answer?: unknown };
  const answers = Array.isArray(body.Answer) ? body.Answer.map(normalizeDnsAnswer).filter(isDnsAnswer) : [];

  return {
    type,
    status: typeof body.Status === "number" ? body.Status : response.status,
    answers,
  };
}

function normalizeDnsAnswer(value: unknown): DnsAnswer | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  if (
    typeof record.name !== "string" ||
    typeof record.type !== "number" ||
    typeof record.TTL !== "number" ||
    typeof record.data !== "string"
  ) {
    return null;
  }

  return {
    name: record.name,
    type: record.type,
    ttl: record.TTL,
    data: record.data,
  };
}

function isDnsAnswer(value: DnsAnswer | null): value is DnsAnswer {
  return value !== null;
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

function detectCdn(values: string[]): DnsInfrastructureResult["cdn"] {
  const providers = new Set<string>();
  const evidence: string[] = [];
  const rules: Array<{ provider: string; pattern: RegExp }> = [
    { provider: "Cloudflare", pattern: /cloudflare|cdn\.cloudflare|workers\.dev/i },
    { provider: "Vercel", pattern: /vercel-dns|vercel\.app|vercel/i },
    { provider: "Netlify", pattern: /netlify/i },
    { provider: "Fastly", pattern: /fastly|fastlylb/i },
    { provider: "Akamai", pattern: /akamai|edgesuite|edgekey/i },
    { provider: "CloudFront", pattern: /cloudfront/i },
    { provider: "Azure Front Door", pattern: /azurefd|trafficmanager/i },
    { provider: "Google Cloud", pattern: /googlehosted|googleusercontent|ghs\.google/i },
  ];

  for (const value of values) {
    for (const rule of rules) {
      if (rule.pattern.test(value)) {
        providers.add(rule.provider);
        evidence.push(value);
      }
    }
  }

  return {
    detected: providers.size > 0,
    providers: Array.from(providers),
    evidence,
    confidence: providers.size > 0 ? "medium" : "none",
  };
}

function normalizeTargetUrl(value: string): string {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https targets are supported. Received: ${url.protocol}`);
  }

  return url.toString();
}

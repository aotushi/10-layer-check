type DnsAnswer = {
  name: string;
  type: number;
  ttl: number;
  data: string;
};

type DnsQueryResult = {
  type: "MX" | "NS" | "TXT" | "CAA";
  status: number;
  answers: DnsAnswer[];
};

type RdapWhoisLiteResult =
  | {
      status: "rdap_collected";
      source: "rdap";
      provider: string;
      query_domain: string;
      rdap_url: string;
      object_class_name: string | null;
      handle: string | null;
      ldh_name: string | null;
      unicode_name: string | null;
      registrar: string | null;
      nameservers: string[];
      status_values: string[];
      events: Array<{
        action: string;
        date: string | null;
      }>;
      notices: Array<{
        title: string | null;
        description: string[];
      }>;
      links: Array<{
        rel: string | null;
        href: string | null;
      }>;
    }
  | {
      status: "not_available" | "error";
      source: "rdap";
      provider: string;
      query_domain: string;
      rdap_url: string;
      reason: string;
      error: string | null;
    };

type WaybackSnapshotSummary = {
  timestamp: string;
  date: string | null;
  original_url: string;
  archive_url: string;
  status_code: number | null;
  mimetype: string | null;
};

type WaybackHistoryResult =
  | {
      status: "wayback_collected";
      source: "internet_archive";
      provider: string;
      query_url: string;
      cdx_url: string;
      snapshot_count_estimate: number | null;
      count_mode: "cdx_show_num_pages_page_size_1" | "not_collected";
      first_snapshot: WaybackSnapshotSummary | null;
      last_snapshot: WaybackSnapshotSummary | null;
      sample_snapshots: WaybackSnapshotSummary[];
    }
  | {
      status: "not_available" | "error";
      source: "internet_archive";
      provider: string;
      query_url: string;
      cdx_url: string;
      reason: string;
      error: string | null;
    };

type RelatedDomainCandidateSignal =
  | "homepage_anchor_host"
  | "homepage_resource_host"
  | "homepage_form_action_host"
  | "analytics_tracker_endpoint"
  | "analytics_script_host";

type RelatedDomainCandidateRole =
  | "navigation"
  | "documentation"
  | "resource"
  | "cdn_asset"
  | "form_endpoint"
  | "analytics"
  | "unknown";

type RelatedDomainCandidateEvidence = {
  type: string;
  name: string;
  value: string;
};

export type OrganizationIntelligenceResult = {
  requested_url: string;
  host: string;
  dns: {
    mx: DnsQueryResult;
    ns: DnsQueryResult;
    txt: DnsQueryResult;
    caa: DnsQueryResult;
  };
  mail_providers: Array<{
    provider: string;
    evidence: string;
  }>;
  social_links: Array<{
    platform: string;
    url: string;
  }>;
  related_domain_candidates: Array<{
    host: string;
    url: string;
    signal: RelatedDomainCandidateSignal;
    role: RelatedDomainCandidateRole;
    source: "homepage_html";
    evidence: RelatedDomainCandidateEvidence[];
  }>;
  external_intelligence: {
    whois: RdapWhoisLiteResult;
    icp: { status: "not_collected"; reason: string };
    wayback: WaybackHistoryResult;
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export async function organizationIntelligenceProbe(target: string): Promise<OrganizationIntelligenceResult> {
  const startedAt = Date.now();
  const normalizedUrl = normalizeTargetUrl(target);
  const host = new URL(normalizedUrl).hostname;
  const [mx, ns, txt, caa, homepage, rdap, wayback] = await Promise.all([
    queryDns(host, "MX"),
    queryDns(host, "NS"),
    queryDns(host, "TXT"),
    queryDns(host, "CAA"),
    fetchHomepageHtml(normalizedUrl),
    fetchRdapWhoisLite(host),
    fetchWaybackHistory(normalizedUrl),
  ]);

  return {
    requested_url: target,
    host,
    dns: {
      mx,
      ns,
      txt,
      caa,
    },
    mail_providers: detectMailProviders([...mx.answers, ...txt.answers].map((answer) => answer.data)),
    social_links: extractSocialLinks(homepage.html, normalizedUrl),
    related_domain_candidates: extractRelatedDomainCandidates(homepage.html, normalizedUrl, host),
    external_intelligence: {
      whois: rdap,
      icp: {
        status: "not_collected",
        reason: "ICP lookup is jurisdiction-specific and requires a dedicated source.",
      },
      wayback,
    },
    duration_ms: Date.now() - startedAt,
    provider_id: "worker-organization-intelligence",
    source: "cloudflare_worker_org_intel",
  };
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

async function fetchRdapWhoisLite(host: string): Promise<RdapWhoisLiteResult> {
  const queryDomain = getRdapQueryDomain(host);
  const candidates = buildRdapProviderCandidates(queryDomain);
  let lastError: RdapWhoisLiteResult | null = null;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        headers: {
          accept: "application/rdap+json, application/json;q=0.9, */*;q=0.1",
        },
      });

      if (response.status === 404) {
        lastError = {
          status: "not_available",
          source: "rdap",
          provider: candidate.provider,
          query_domain: queryDomain,
          rdap_url: candidate.url,
          reason: "RDAP provider returned 404 for the queried registered domain.",
          error: null,
        };
        continue;
      }

      if (!response.ok) {
        lastError = {
          status: "error",
          source: "rdap",
          provider: candidate.provider,
          query_domain: queryDomain,
          rdap_url: candidate.url,
          reason: `RDAP provider returned HTTP ${response.status}.`,
          error: response.statusText || null,
        };
        continue;
      }

      const body = await response.json();
      return normalizeRdapResponse(body, queryDomain, candidate.url, candidate.provider);
    } catch (error) {
      lastError = {
        status: "error",
        source: "rdap",
        provider: candidate.provider,
        query_domain: queryDomain,
        rdap_url: candidate.url,
        reason: "RDAP provider request failed.",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return (
    lastError ?? {
        status: "not_available",
        source: "rdap",
        provider: "rdap.org",
        query_domain: queryDomain,
        rdap_url: `https://rdap.org/domain/${encodeURIComponent(queryDomain)}`,
        reason: "No RDAP provider candidate was available for the queried registered domain.",
        error: null,
      }
  );
}

function buildRdapProviderCandidates(queryDomain: string): Array<{ provider: string; url: string }> {
  const encodedDomain = encodeURIComponent(queryDomain);
  const labels = queryDomain.toLowerCase().split(".").filter(Boolean);
  const tld = labels[labels.length - 1] ?? "";
  const candidates = [
    {
      provider: "rdap.org",
      url: `https://rdap.org/domain/${encodedDomain}`,
    },
  ];

  if (tld === "com" || tld === "net") {
    candidates.push({
      provider: `rdap.verisign.com/${tld}/v1`,
      url: `https://rdap.verisign.com/${tld}/v1/domain/${encodedDomain}`,
    });
  }

  return candidates;
}

function normalizeRdapResponse(
  body: unknown,
  queryDomain: string,
  rdapUrl: string,
  provider: string,
): RdapWhoisLiteResult {
  if (!isPlainObject(body)) {
    return {
      status: "error",
      source: "rdap",
      provider,
      query_domain: queryDomain,
      rdap_url: rdapUrl,
      reason: "RDAP provider returned a non-object response.",
      error: null,
    };
  }

  return {
    status: "rdap_collected",
    source: "rdap",
    provider,
    query_domain: queryDomain,
    rdap_url: rdapUrl,
    object_class_name: asString(body.objectClassName),
    handle: asString(body.handle),
    ldh_name: asString(body.ldhName),
    unicode_name: asString(body.unicodeName),
    registrar: extractRdapRegistrar(body),
    nameservers: asObjectArray(body.nameservers)
      .map((item) => asString(item.ldhName) ?? asString(item.unicodeName))
      .filter(isString)
      .slice(0, 20),
    status_values: asStringArray(body.status).slice(0, 20),
    events: asObjectArray(body.events)
      .map((item) => ({
        action: asString(item.eventAction) ?? "unknown",
        date: asString(item.eventDate),
      }))
      .slice(0, 20),
    notices: asObjectArray(body.notices)
      .map((item) => ({
        title: asString(item.title),
        description: asStringArray(item.description).slice(0, 5),
      }))
      .slice(0, 10),
    links: asObjectArray(body.links)
      .map((item) => ({
        rel: asString(item.rel),
        href: asString(item.href),
      }))
      .slice(0, 20),
  };
}

function extractRdapRegistrar(body: Record<string, unknown>): string | null {
  const registrarEntity = asObjectArray(body.entities).find((entity) =>
    asStringArray(entity.roles).some((role) => role.toLowerCase() === "registrar"),
  );

  if (!registrarEntity) return null;

  return extractVcardName(registrarEntity.vcardArray) ?? asString(registrarEntity.handle);
}

function extractVcardName(value: unknown): string | null {
  if (!Array.isArray(value) || !Array.isArray(value[1])) return null;

  for (const entry of value[1]) {
    if (!Array.isArray(entry) || entry.length < 4) continue;
    const key = typeof entry[0] === "string" ? entry[0].toLowerCase() : "";
    if (key !== "fn" && key !== "org") continue;
    const content = entry[3];
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const joined = content.filter(isString).join(" ").trim();
      if (joined) return joined;
    }
  }

  return null;
}

function getRdapQueryDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");

  const suffix = labels.slice(-2).join(".");
  const secondLevelSuffixes = new Set([
    "co.uk",
    "org.uk",
    "ac.uk",
    "com.au",
    "net.au",
    "org.au",
    "com.cn",
    "net.cn",
    "org.cn",
    "com.br",
    "com.mx",
    "co.jp",
    "co.kr",
    "co.nz",
    "com.sg",
  ]);

  return labels.slice(secondLevelSuffixes.has(suffix) ? -3 : -2).join(".");
}

async function fetchWaybackHistory(url: string): Promise<WaybackHistoryResult> {
  let lastError: WaybackHistoryResult | null = null;

  for (const queryUrl of buildWaybackQueryUrls(url)) {
    const cdxUrl = buildWaybackCdxUrl(queryUrl, { limit: 5 });

    try {
      const [firstRows, lastRows, countEstimate] = await Promise.all([
        fetchWaybackCdxSnapshotsSafe(queryUrl, 5),
        fetchWaybackCdxSnapshotsSafe(queryUrl, -5),
        fetchWaybackSnapshotCountEstimate(queryUrl),
      ]);
      const combined = uniqueWaybackSnapshots([...firstRows.rows, ...lastRows.rows]);

      if (combined.length === 0) {
        const error = firstRows.error ?? lastRows.error;
        lastError = {
          status: error ? "error" : "not_available",
          source: "internet_archive",
          provider: "web.archive.org_cdx",
          query_url: queryUrl,
          cdx_url: cdxUrl,
          reason: error
            ? "Internet Archive CDX request failed."
            : "Internet Archive CDX returned no successful homepage snapshots for the queried URL.",
          error,
        };
        continue;
      }

      const sorted = combined.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      return {
        status: "wayback_collected",
        source: "internet_archive",
        provider: "web.archive.org_cdx",
        query_url: queryUrl,
        cdx_url: cdxUrl,
        snapshot_count_estimate: countEstimate,
        count_mode: countEstimate === null ? "not_collected" : "cdx_show_num_pages_page_size_1",
        first_snapshot: sorted[0] ?? null,
        last_snapshot: sorted[sorted.length - 1] ?? null,
        sample_snapshots: sorted.slice(0, 10),
      };
    } catch (error) {
      lastError = {
        status: "error",
        source: "internet_archive",
        provider: "web.archive.org_cdx",
        query_url: queryUrl,
        cdx_url: cdxUrl,
        reason: "Internet Archive CDX request failed.",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const availability = await fetchWaybackAvailability(url);
  if (availability) return availability;

  return (
    lastError ?? {
      status: "not_available",
      source: "internet_archive",
      provider: "web.archive.org_cdx",
      query_url: url,
      cdx_url: buildWaybackCdxUrl(url, { limit: 5 }),
      reason: "Internet Archive CDX returned no successful homepage snapshots for the queried URL.",
      error: null,
    }
  );
}

async function fetchWaybackAvailability(url: string): Promise<WaybackHistoryResult | null> {
  for (const queryUrl of buildWaybackQueryUrls(url)) {
    const availabilityUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(queryUrl)}`;

    try {
      const response = await fetch(availabilityUrl, {
        headers: {
          accept: "application/json, */*;q=0.1",
        },
      });
      if (!response.ok) continue;

      const snapshot = parseWaybackAvailableSnapshot(await response.json());
      if (!snapshot) continue;

      return {
        status: "wayback_collected",
        source: "internet_archive",
        provider: "archive.org_wayback_available",
        query_url: queryUrl,
        cdx_url: availabilityUrl,
        snapshot_count_estimate: null,
        count_mode: "not_collected",
        first_snapshot: snapshot,
        last_snapshot: snapshot,
        sample_snapshots: [snapshot],
      };
    } catch {
      // Continue to the next query form; the caller will return the CDX error if all fallbacks fail.
    }
  }

  return null;
}

function parseWaybackAvailableSnapshot(value: unknown): WaybackSnapshotSummary | null {
  if (!isPlainObject(value)) return null;
  const archivedSnapshots = value.archived_snapshots;
  if (!isPlainObject(archivedSnapshots)) return null;
  const closest = archivedSnapshots.closest;
  if (!isPlainObject(closest)) return null;
  if (closest.available !== true) return null;

  const timestamp = asString(closest.timestamp);
  const archiveUrl = asString(closest.url);
  if (!timestamp || !archiveUrl) return null;

  return {
    timestamp,
    date: waybackTimestampToIso(timestamp),
    original_url: extractOriginalUrlFromWaybackUrl(archiveUrl) ?? archiveUrl,
    archive_url: archiveUrl,
    status_code: Number(asString(closest.status)) || null,
    mimetype: null,
  };
}

function extractOriginalUrlFromWaybackUrl(value: string): string | null {
  const match = value.match(/^https?:\/\/web\.archive\.org\/web\/\d+(?:[a-z_]+)?\/(.+)$/i);
  return match?.[1] ?? null;
}

async function fetchWaybackCdxSnapshotsSafe(
  url: string,
  limit: number,
): Promise<{ rows: WaybackSnapshotSummary[]; error: string | null }> {
  try {
    return { rows: await fetchWaybackCdxSnapshots(url, limit), error: null };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildWaybackQueryUrls(url: string): string[] {
  const values = [url];

  try {
    const parsed = new URL(url);
    values.push(`${parsed.hostname}${parsed.pathname || "/"}`);
  } catch {
    // Keep the original URL as the only candidate if it cannot be parsed.
  }

  return Array.from(new Set(values));
}

async function fetchWaybackCdxSnapshots(url: string, limit: number): Promise<WaybackSnapshotSummary[]> {
  const response = await fetch(buildWaybackCdxUrl(url, { limit }), {
    headers: {
      accept: "application/json, */*;q=0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`CDX returned HTTP ${response.status}.`);
  }

  return parseWaybackCdxRows(await response.json());
}

async function fetchWaybackSnapshotCountEstimate(url: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&filter=statuscode:200&showNumPages=true&pageSize=1`,
      {
        headers: {
          accept: "text/plain,*/*;q=0.1",
        },
      },
    );

    if (!response.ok) return null;
    const value = Number((await response.text()).trim());
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function buildWaybackCdxUrl(url: string, options: { limit: number }): string {
  const params = new URLSearchParams({
    url,
    output: "json",
    fl: "timestamp,original,statuscode,mimetype",
    filter: "statuscode:200",
    limit: String(options.limit),
  });

  return `https://web.archive.org/cdx/search/cdx?${params.toString()}`;
}

function parseWaybackCdxRows(value: unknown): WaybackSnapshotSummary[] {
  if (!Array.isArray(value) || value.length < 2) return [];

  return value
    .slice(1)
    .filter(Array.isArray)
    .map((row) => {
      const [timestamp, originalUrl, statusCode, mimetype] = row;
      if (typeof timestamp !== "string" || typeof originalUrl !== "string") return null;

      return {
        timestamp,
        date: waybackTimestampToIso(timestamp),
        original_url: originalUrl,
        archive_url: `https://web.archive.org/web/${timestamp}/${originalUrl}`,
        status_code: typeof statusCode === "string" ? Number(statusCode) : null,
        mimetype: typeof mimetype === "string" ? mimetype : null,
      };
    })
    .filter(isWaybackSnapshotSummary);
}

function uniqueWaybackSnapshots(snapshots: WaybackSnapshotSummary[]): WaybackSnapshotSummary[] {
  const byKey = new Map<string, WaybackSnapshotSummary>();

  for (const snapshot of snapshots) {
    byKey.set(`${snapshot.timestamp}:${snapshot.original_url}`, snapshot);
  }

  return Array.from(byKey.values());
}

function waybackTimestampToIso(value: string): string | null {
  if (!/^\d{14}$/.test(value)) return null;

  const date = new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8)),
      Number(value.slice(8, 10)),
      Number(value.slice(10, 12)),
      Number(value.slice(12, 14)),
    ),
  );

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isWaybackSnapshotSummary(value: WaybackSnapshotSummary | null): value is WaybackSnapshotSummary {
  return value !== null;
}

async function fetchHomepageHtml(url: string): Promise<{ html: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,*/*;q=0.8",
      },
    });
    return { html: await readLimitedText(response, 256_000) };
  } catch {
    return { html: "" };
  }
}

function detectMailProviders(values: string[]): OrganizationIntelligenceResult["mail_providers"] {
  const rules: Array<{ provider: string; pattern: RegExp }> = [
    { provider: "Google Workspace", pattern: /google\.com|googlemail|_spf\.google/i },
    { provider: "Microsoft 365", pattern: /outlook\.com|protection\.outlook|spf\.protection\.outlook/i },
    { provider: "Proton Mail", pattern: /protonmail|proton\.ch/i },
    { provider: "Zoho Mail", pattern: /zoho/i },
    { provider: "Mailgun", pattern: /mailgun/i },
    { provider: "SendGrid", pattern: /sendgrid/i },
    { provider: "Amazon SES", pattern: /amazonses|_amazonses/i },
  ];
  const matches = new Map<string, string>();

  for (const value of values) {
    for (const rule of rules) {
      if (rule.pattern.test(value) && !matches.has(rule.provider)) {
        matches.set(rule.provider, value);
      }
    }
  }

  return Array.from(matches.entries()).map(([provider, evidence]) => ({ provider, evidence }));
}

function extractSocialLinks(html: string, baseUrl: string): OrganizationIntelligenceResult["social_links"] {
  const platforms: Array<{ platform: string; pattern: RegExp }> = [
    { platform: "GitHub", pattern: /https?:\/\/(?:www\.)?github\.com\/[^"'\s<>)]+/gi },
    { platform: "LinkedIn", pattern: /https?:\/\/(?:www\.)?linkedin\.com\/[^"'\s<>)]+/gi },
    { platform: "X", pattern: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"'\s<>)]+/gi },
    { platform: "Facebook", pattern: /https?:\/\/(?:www\.)?facebook\.com\/[^"'\s<>)]+/gi },
    { platform: "YouTube", pattern: /https?:\/\/(?:www\.)?youtube\.com\/[^"'\s<>)]+/gi },
  ];
  const links = new Map<string, { platform: string; url: string }>();

  for (const { platform, pattern } of platforms) {
    for (const match of html.matchAll(pattern)) {
      try {
        const url = new URL(match[0], baseUrl).toString();
        links.set(`${platform}:${url}`, { platform, url });
      } catch {
        // Ignore malformed social links.
      }
    }
  }

  return Array.from(links.values()).slice(0, 40);
}

function extractRelatedDomainCandidates(
  html: string,
  baseUrl: string,
  targetHost: string,
): OrganizationIntelligenceResult["related_domain_candidates"] {
  const candidates = new Map<string, OrganizationIntelligenceResult["related_domain_candidates"][number]>();
  const attributePattern = /\b(href|src|action)=["']([^"']+)["']/gi;

  for (const match of html.matchAll(attributePattern)) {
    const attribute = match[1].toLowerCase();
    const rawUrl = match[2].trim();
    if (!rawUrl || rawUrl.startsWith("#") || rawUrl.startsWith("mailto:") || rawUrl.startsWith("tel:")) continue;

    try {
      const url = new URL(rawUrl, baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;

      const host = url.hostname.toLowerCase();
      if (!host || isSameOrSubdomain(host, targetHost) || isSocialProfileHost(host)) continue;

      const signal =
        attribute === "href"
          ? "homepage_anchor_host"
          : attribute === "action"
            ? "homepage_form_action_host"
            : "homepage_resource_host";
      const role = classifyCandidateRole(attribute, url);

      const key = `${host}:${signal}`;
      if (!candidates.has(key)) {
        candidates.set(key, {
          host,
          url: url.toString(),
          signal,
          role,
          source: "homepage_html",
          evidence: createCandidateEvidence(attribute, url, role),
        });
      }
    } catch {
      // Ignore malformed or unsupported homepage URLs.
    }
  }

  for (const candidate of extractAnalyticsRelatedDomainCandidates(html, baseUrl, targetHost)) {
    const key = `${candidate.host}:${candidate.signal}`;
    if (!candidates.has(key)) candidates.set(key, candidate);
  }

  return Array.from(candidates.values()).slice(0, 40);
}

function extractAnalyticsRelatedDomainCandidates(
  html: string,
  baseUrl: string,
  targetHost: string,
): OrganizationIntelligenceResult["related_domain_candidates"] {
  const candidates = new Map<string, OrganizationIntelligenceResult["related_domain_candidates"][number]>();
  const urlPattern = /https?:\/\/[^"'`\s<>()]+/gi;
  const matomoSiteId = extractMatomoSiteId(html);

  for (const match of html.matchAll(urlPattern)) {
    const rawUrl = match[0];

    try {
      const url = new URL(rawUrl, baseUrl);
      if (!isAnalyticsUrl(url)) continue;
      if (!["http:", "https:"].includes(url.protocol)) continue;

      const host = url.hostname.toLowerCase();
      if (!host || isSameOrSubdomain(host, targetHost) || isSocialProfileHost(host)) continue;

      const signal = isAnalyticsTrackerEndpoint(url) ? "analytics_tracker_endpoint" : "analytics_script_host";
      const evidence = createCandidateEvidence("inline_script_url", url, "analytics");
      evidence.push({
        type: "url_pattern",
        name: "analytics_hint",
        value: getAnalyticsProviderHint(url),
      });
      if (matomoSiteId) {
        evidence.push({
          type: "script_marker",
          name: "matomo_site_id",
          value: matomoSiteId,
        });
      }

      candidates.set(`${host}:${signal}`, {
        host,
        url: url.toString(),
        signal,
        role: "analytics",
        source: "homepage_html",
        evidence,
      });
    } catch {
      // Ignore malformed inline URLs.
    }
  }

  return Array.from(candidates.values());
}

function classifyCandidateRole(attribute: string, url: URL): RelatedDomainCandidateRole {
  if (isAnalyticsUrl(url)) return "analytics";
  if (attribute === "action") return "form_endpoint";
  if (isDocumentationUrl(url)) return "documentation";
  if (attribute === "src" && isCdnLikeUrl(url)) return "cdn_asset";
  if (attribute === "src") return "resource";
  if (attribute === "href") return "navigation";
  return "unknown";
}

function createCandidateEvidence(
  attribute: string,
  url: URL,
  role: RelatedDomainCandidateRole,
): RelatedDomainCandidateEvidence[] {
  const evidence: RelatedDomainCandidateEvidence[] = [
    { type: "html_attribute", name: "attribute", value: attribute },
    { type: "candidate_url", name: "url", value: url.toString() },
  ];

  if (role === "documentation") {
    evidence.push({ type: "url_pattern", name: "path_hint", value: url.pathname || "/" });
  }
  if (role === "cdn_asset") {
    evidence.push({ type: "hostname_pattern", name: "cdn_hint", value: url.hostname.toLowerCase() });
  }

  return evidence;
}

function isDocumentationUrl(url: URL): boolean {
  return /(?:^|\.)docs?\./i.test(url.hostname) || /\/(?:docs?|documentation|developer|developers|help|support)(?:\/|$)/i.test(url.pathname);
}

function isCdnLikeUrl(url: URL): boolean {
  return /(?:cdn|assets?|static|media|img|images)\./i.test(url.hostname) || /\/(?:assets?|static|dist|build)\//i.test(url.pathname);
}

function isAnalyticsUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();

  if (isMatomoUrl(host, pathname)) return true;
  if (isPlausibleUrl(host, pathname)) return true;
  if (isUmamiUrl(host, pathname)) return true;
  if (isGoogleAnalyticsUrl(host, pathname)) return true;
  if (isSentryUrl(host, pathname)) return true;

  return false;
}

function isAnalyticsTrackerEndpoint(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  return /\/(?:matomo|piwik)\.php$/i.test(pathname) || isPlausibleEventEndpoint(host, pathname);
}

function getAnalyticsProviderHint(url: URL): string {
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  if (isMatomoUrl(host, pathname)) return "matomo";
  if (isPlausibleUrl(host, pathname)) return "plausible";
  if (isUmamiUrl(host, pathname)) return "umami";
  if (host === "www.googletagmanager.com" || host === "googletagmanager.com") return "google_tag_manager";
  if (isGoogleAnalyticsUrl(host, pathname)) return "google_analytics";
  if (isSentryUrl(host, pathname)) return "sentry";
  return "analytics";
}

function isMatomoUrl(host: string, pathname: string): boolean {
  return (
    /\/(?:matomo|piwik)\.(?:php|js)$/i.test(pathname) ||
    ((host === "matomo.cloud" || host.startsWith("matomo.") || host.startsWith("piwik.")) &&
      /\.(?:php|js)$/i.test(pathname))
  );
}

function isPlausibleUrl(host: string, pathname: string): boolean {
  return (
    (host === "plausible.io" || host.startsWith("plausible.")) &&
    (/\/js\/[^/?#]*\.js$/i.test(pathname) || isPlausibleEventEndpoint(host, pathname))
  );
}

function isPlausibleEventEndpoint(host: string, pathname: string): boolean {
  return (host === "plausible.io" || host.startsWith("plausible.")) && pathname === "/api/event";
}

function isUmamiUrl(host: string, pathname: string): boolean {
  return (host.startsWith("umami.") || pathname.includes("/umami")) && /\/(?:script|umami)\.js$/i.test(pathname);
}

function isGoogleAnalyticsUrl(host: string, pathname: string): boolean {
  if (host === "www.googletagmanager.com" || host === "googletagmanager.com") {
    return /\/(?:gtag\/js|gtm\.js)$/i.test(pathname);
  }

  if (host !== "www.google-analytics.com" && host !== "google-analytics.com" && host !== "ssl.google-analytics.com") {
    return false;
  }

  return /\/(?:analytics\.js|ga\.js|collect|g\/collect|j\/collect|mp\/collect|debug\/collect)$/i.test(pathname);
}

function isSentryUrl(host: string, pathname: string): boolean {
  return (
    host === "browser.sentry-cdn.com" ||
    host.endsWith(".ingest.sentry.io") ||
    (host.includes("sentry") && /\/(?:api\/\d+\/envelope|api\/\d+\/store|bundle\.js)$/i.test(pathname))
  );
}

function extractMatomoSiteId(html: string): string | null {
  const match = html.match(/setSiteId['"]?\s*,\s*['"]?([A-Za-z0-9_-]{1,64})['"]?/i);
  return match?.[1] ?? null;
}

function isSameOrSubdomain(host: string, parentHost: string): boolean {
  const normalizedHost = host.toLowerCase();
  const normalizedParent = parentHost.toLowerCase();
  return normalizedHost === normalizedParent || normalizedHost.endsWith(`.${normalizedParent}`);
}

function isSocialProfileHost(host: string): boolean {
  const socialHosts = [
    "github.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "facebook.com",
    "youtube.com",
    "instagram.com",
    "tiktok.com",
  ];
  return socialHosts.some((socialHost) => host === socialHost || host.endsWith(`.${socialHost}`));
}

function normalizeTargetUrl(value: string): string {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https targets are supported. Received: ${url.protocol}`);
  }

  url.hash = "";
  return url.toString();
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!/text|html|json|xml|javascript|css/i.test(contentType)) {
    return "";
  }

  const text = await response.text();
  return text.length > maxBytes ? text.slice(0, maxBytes) : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

type ServiceFingerprintHint = {
  category: "cdn" | "server" | "framework" | "admin_surface" | "monitoring_surface" | "mail" | "unknown";
  label: string;
  evidence: Array<{
    type: string;
    name: string;
    value: string;
  }>;
};

type CheckedServiceHost = {
  host: string;
  url: string;
  observed_status: number | null;
  redirected_to: string | null;
  title: string | null;
  service_hints: ServiceFingerprintHint[];
  error: string | null;
  limitations: string[];
};

export type ServiceFingerprintResult = {
  requested_url: string;
  host: string;
  checked_hosts: CheckedServiceHost[];
  limits: {
    max_hosts: number;
    checked_hosts: number;
    max_requests_per_host: number;
    max_concurrency: number;
    timeout_ms: number;
  };
  coverage: {
    collected: string[];
    missing: string[];
    limitations: string[];
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export type ServiceFingerprintOptions = {
  hosts?: unknown;
  maxHosts?: unknown;
};

const DEFAULT_MAX_HOSTS = 1;
const MAX_ALLOWED_HOSTS = 10;
const MAX_CONCURRENCY = 3;
const TIMEOUT_MS = 10000;

export async function serviceFingerprintProbe(
  target: string,
  options: ServiceFingerprintOptions = {},
): Promise<ServiceFingerprintResult> {
  const startedAt = Date.now();
  const normalizedUrl = normalizeTargetUrl(target);
  const targetHost = new URL(normalizedUrl).hostname.toLowerCase();
  const maxHosts = parseMaxHosts(options.maxHosts);
  const hosts = parseAllowedHosts(options.hosts, targetHost).slice(0, maxHosts);
  const checkedHosts = await runWithConcurrency(hosts, MAX_CONCURRENCY, (host) => inspectHost(host, normalizedUrl));

  return {
    requested_url: target,
    host: targetHost,
    checked_hosts: checkedHosts,
    limits: {
      max_hosts: maxHosts,
      checked_hosts: checkedHosts.length,
      max_requests_per_host: 1,
      max_concurrency: MAX_CONCURRENCY,
      timeout_ms: TIMEOUT_MS,
    },
    coverage: {
      collected: ["bounded_https_root_observation", "response_headers", "html_title"],
      missing: [
        "l7_permissioned_deep_port_service_inventory",
        "l7_permissioned_authenticated_surface_check",
        "l7_permissioned_external_service_intelligence",
      ],
      limitations: [
        "This probe only performs bounded HTTP(S) root-document observation.",
        "It does not perform TCP/UDP port scanning, directory brute forcing, authentication workflows, or vulnerability probing.",
        "Service hints are candidates derived from headers and first-page HTML, not a complete service inventory.",
      ],
    },
    duration_ms: Date.now() - startedAt,
    provider_id: "cloudflare_worker_service_fingerprint",
    source: "cloudflare_worker_l7_service_fingerprint",
  };
}

async function inspectHost(host: string, normalizedTargetUrl: string): Promise<CheckedServiceHost> {
  const targetUrl = createRootUrl(host, normalizedTargetUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,*/*;q=0.8",
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const html = contentType.toLowerCase().includes("text/html") ? await response.text() : "";
    const title = extractTitle(html);
    return {
      host,
      url: targetUrl,
      observed_status: response.status,
      redirected_to: response.headers.get("location"),
      title,
      service_hints: detectServiceHints(response.headers, html, title),
      error: null,
      limitations: [
        "One bounded GET request to the root document only.",
        "Redirects are observed but not recursively followed for fingerprinting.",
      ],
    };
  } catch (error) {
    return {
      host,
      url: targetUrl,
      observed_status: null,
      redirected_to: null,
      title: null,
      service_hints: [],
      error: error instanceof Error ? error.message : String(error),
      limitations: ["Host could not be observed through the bounded root-document request."],
    };
  } finally {
    clearTimeout(timeout);
  }
}

function detectServiceHints(headers: Headers, html: string, title: string | null): ServiceFingerprintHint[] {
  const hints: ServiceFingerprintHint[] = [];
  const headerEntries = ["server", "via", "x-powered-by", "x-generator", "cf-ray", "x-cache", "x-vercel-id", "x-served-by"]
    .map((name) => [name, headers.get(name)] as const)
    .filter(([, value]) => Boolean(value));

  for (const [name, value] of headerEntries) {
    if (!value) continue;
    hints.push({
      category: classifyHeaderHint(name, value),
      label: `${name}: ${value}`.slice(0, 160),
      evidence: [{ type: "header", name, value: value.slice(0, 240) }],
    });
  }

  const generator = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (generator) {
    hints.push({
      category: "framework",
      label: `generator: ${generator}`.slice(0, 160),
      evidence: [{ type: "html_meta", name: "generator", value: generator.slice(0, 240) }],
    });
  }

  const toolHints = [
    { category: "admin_surface" as const, label: "admin title", pattern: /\b(admin|dashboard|login|console)\b/i },
    { category: "monitoring_surface" as const, label: "monitoring title", pattern: /\b(grafana|kibana|prometheus|jenkins)\b/i },
  ];
  for (const hint of toolHints) {
    if (title && hint.pattern.test(title)) {
      hints.push({
        category: hint.category,
        label: hint.label,
        evidence: [{ type: "html_title", name: "title", value: title.slice(0, 240) }],
      });
    }
  }

  return hints.slice(0, 20);
}

function classifyHeaderHint(name: string, value: string): ServiceFingerprintHint["category"] {
  const text = `${name} ${value}`.toLowerCase();
  if (text.includes("cloudflare") || text.includes("cf-ray") || text.includes("vercel") || text.includes("fastly")) return "cdn";
  if (name === "server") return "server";
  if (name === "x-powered-by" || name === "x-generator") return "framework";
  return "unknown";
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]{0,240})<\/title>/i);
  if (!match) return null;
  return decodeHtmlText(match[1].replace(/\s+/g, " ").trim()).slice(0, 160) || null;
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function runNext() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
  return results;
}

function parseAllowedHosts(value: unknown, targetHost: string): string[] {
  if (value === undefined) return [targetHost];
  if (!Array.isArray(value)) {
    throw new Error("hosts must be an array when provided.");
  }
  const hosts = value.map((item) => {
    if (typeof item !== "string") {
      throw new Error("hosts values must be hostnames.");
    }
    return item.trim().toLowerCase();
  }).filter(Boolean);

  const allowedHosts = hosts.filter((host) => host === targetHost || host.endsWith(`.${targetHost}`));
  return Array.from(new Set([targetHost, ...allowedHosts]));
}

function parseMaxHosts(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_HOSTS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ALLOWED_HOSTS) {
    throw new Error(`max_hosts must be an integer between 1 and ${MAX_ALLOWED_HOSTS}.`);
  }
  return parsed;
}

function createRootUrl(host: string, normalizedTargetUrl: string): string {
  const target = new URL(normalizedTargetUrl);
  target.hostname = host;
  target.pathname = "/";
  target.search = "";
  target.hash = "";
  return target.toString();
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

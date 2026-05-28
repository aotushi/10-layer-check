import { createRouteUrl } from "../http/request";

export type PerformanceProviderEnv = {
  PAGESPEED_API_KEY?: string;
  PAGESPEED_API_URL?: string;
  PAGESPEED_CACHE_TTL_SECONDS?: string;
  SCAN_JOB_KV?: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  };
  WEBPAGETEST_API_KEY?: string;
  WEBPAGETEST_BASE_URL?: string;
};

export type LighthouseStrategy = "mobile" | "desktop";

export async function pageSpeedRun(env: PerformanceProviderEnv, target: string, strategy: LighthouseStrategy) {
  if (!env.PAGESPEED_API_KEY) {
    return missingPerformanceProviderConfig("pagespeed", ["PAGESPEED_API_KEY"]);
  }

  const startedAt = Date.now();
  const normalizedTarget = normalizeTargetUrl(target);
  const cacheTtlSeconds = parsePositiveInteger(env.PAGESPEED_CACHE_TTL_SECONDS, 6 * 60 * 60);
  const cacheKey = await createPageSpeedCacheKey(normalizedTarget, strategy, env.PAGESPEED_API_URL);
  const cached = await readPageSpeedCache(env, cacheKey);
  if (cached) {
    return {
      ...cached,
      cache: {
        status: "hit",
        key: cacheKey,
        ttl_seconds: cacheTtlSeconds,
      },
    };
  }

  const endpoint = new URL(env.PAGESPEED_API_URL ?? "https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", normalizedTarget);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("category", "PERFORMANCE");
  endpoint.searchParams.set("key", env.PAGESPEED_API_KEY);

  const response = await fetch(endpoint.toString(), {
    headers: {
      accept: "application/json",
    },
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
      return {
        ok: false,
        schema_version: "site-10-layer-performance-provider-result/v0.1",
        provider: "pagespeed",
        error_code: "performance_provider_rate_limited",
        error: extractProviderError(payload) ?? "PageSpeed provider rate limit was reached.",
        status: 429,
        retryable: true,
        retry_after_seconds: retryAfterSeconds,
        coverage: {
          collected: [],
          missing: ["pagespeed_rate_limit"],
        },
        next_step:
          "Use cached PageSpeed evidence when available, retry after the provider limit resets, or rely on Worker baseline / browser runtime / GitHub Actions Lighthouse for the current report.",
      };
    }

    return {
      ok: false,
      schema_version: "site-10-layer-performance-provider-result/v0.1",
      provider: "pagespeed",
      error_code: "provider_request_failed",
      error: extractProviderError(payload) ?? `PageSpeed request failed with HTTP ${response.status}.`,
      status: response.status,
      retryable: response.status >= 500,
    };
  }

  const result = mapPageSpeedResult(target, strategy, payload, Date.now() - startedAt);
  const hasFieldData = result.raw_summary.field_data?.available === true;

  const envelope = {
    ok: true,
    schema_version: "site-10-layer-performance-provider-result/v0.1",
    provider: "pagespeed",
    result,
    coverage: {
      collected: [
        "lighthouse_lab_metrics",
        "performance_opportunities",
        ...(hasFieldData ? ["crux_field_data"] : []),
      ],
      missing: [
        "webpagetest_waterfall",
        "multi_location_performance",
        ...(hasFieldData ? [] : ["field_data_when_unavailable"]),
      ],
    },
  };
  await writePageSpeedCache(env, cacheKey, envelope, cacheTtlSeconds);
  return {
    ...envelope,
    cache: {
      status: env.SCAN_JOB_KV ? "stored" : "disabled",
      key: cacheKey,
      ttl_seconds: cacheTtlSeconds,
    },
  };
}

export async function webPageTestStart(
  env: PerformanceProviderEnv,
  target: string,
  requestUrl: URL,
  location: string | null,
) {
  if (!env.WEBPAGETEST_API_KEY) {
    return missingPerformanceProviderConfig("webpagetest", ["WEBPAGETEST_API_KEY"]);
  }

  const baseUrl = env.WEBPAGETEST_BASE_URL ?? "https://www.webpagetest.org";
  const endpoint = new URL("/runtest.php", baseUrl);
  endpoint.searchParams.set("f", "json");
  endpoint.searchParams.set("k", env.WEBPAGETEST_API_KEY);
  endpoint.searchParams.set("url", normalizeTargetUrl(target));
  if (location) endpoint.searchParams.set("location", location);

  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      accept: "application/json",
    },
  });
  const payload = await readJsonResponse(response);
  const statusCode = getNumber(payload, "statusCode") ?? response.status;

  if (!response.ok || statusCode >= 400) {
    return {
      ok: false,
      schema_version: "site-10-layer-webpagetest-start/v0.1",
      provider: "webpagetest",
      error_code: "provider_request_failed",
      error: extractProviderError(payload) ?? `WebPageTest start failed with HTTP ${response.status}.`,
      status: response.ok ? 400 : response.status,
    };
  }

  const testId = getNestedString(payload, ["data", "testId"]) ?? getNestedString(payload, ["data", "id"]);
  if (!testId) {
    return {
      ok: false,
      schema_version: "site-10-layer-webpagetest-start/v0.1",
      provider: "webpagetest",
      error_code: "invalid_provider_output",
      error: "WebPageTest start response did not include data.testId.",
      status: 502,
    };
  }

  const statusUrl = createRouteUrl(requestUrl, "/provider/performance/webpagetest/status");
  statusUrl.search = "";
  statusUrl.searchParams.set("id", testId);

  const resultUrl = createRouteUrl(requestUrl, "/provider/performance/webpagetest/result");
  resultUrl.search = "";
  resultUrl.searchParams.set("id", testId);

  return {
    ok: true,
    schema_version: "site-10-layer-webpagetest-start/v0.1",
    provider: "webpagetest",
    request_id: testId,
    status: "queued",
    status_code: statusCode,
    html_url: getNestedString(payload, ["data", "userUrl"]),
    json_url: getNestedString(payload, ["data", "jsonUrl"]),
    location,
    endpoints: {
      status: statusUrl.toString(),
      result: resultUrl.toString(),
    },
    next_step:
      `Poll ${statusUrl.pathname}?id=<testId>, then ${resultUrl.pathname}?id=<testId> when completed.`,
  };
}

export async function webPageTestStatus(env: PerformanceProviderEnv, url: URL) {
  const testId = parseRequestId(url);
  if (!env.WEBPAGETEST_API_KEY) {
    return missingPerformanceProviderConfig("webpagetest", ["WEBPAGETEST_API_KEY"], "site-10-layer-webpagetest-status/v0.1");
  }

  const endpoint = new URL("/testStatus.php", env.WEBPAGETEST_BASE_URL ?? "https://www.webpagetest.org");
  endpoint.searchParams.set("f", "json");
  endpoint.searchParams.set("k", env.WEBPAGETEST_API_KEY);
  endpoint.searchParams.set("test", testId);

  const response = await fetch(endpoint.toString(), { headers: { accept: "application/json" } });
  const payload = await readJsonResponse(response);

  return {
    ok: response.ok,
    schema_version: "site-10-layer-webpagetest-status/v0.1",
    provider: "webpagetest",
    request_id: testId,
    status_code: getNumber(payload, "statusCode") ?? response.status,
    status_text: getString(payload, "statusText") ?? getString(payload, "status") ?? null,
    complete: getNumber(payload, "statusCode") === 200 || getString(payload, "statusCode") === "200",
    raw_summary: payload,
  };
}

export async function webPageTestResult(env: PerformanceProviderEnv, url: URL) {
  const testId = parseRequestId(url);
  if (!env.WEBPAGETEST_API_KEY) {
    return missingPerformanceProviderConfig("webpagetest", ["WEBPAGETEST_API_KEY"], "site-10-layer-webpagetest-result/v0.1");
  }

  const endpoint = new URL("/jsonResult.php", env.WEBPAGETEST_BASE_URL ?? "https://www.webpagetest.org");
  endpoint.searchParams.set("f", "json");
  endpoint.searchParams.set("k", env.WEBPAGETEST_API_KEY);
  endpoint.searchParams.set("test", testId);

  const response = await fetch(endpoint.toString(), { headers: { accept: "application/json" } });
  const payload = await readJsonResponse(response);

  return {
    ok: response.ok,
    schema_version: "site-10-layer-webpagetest-result/v0.1",
    provider: "webpagetest",
    request_id: testId,
    status_code: getNumber(payload, "statusCode") ?? response.status,
    result: mapWebPageTestResult(testId, payload),
    raw_summary: payload,
  };
}

function missingPerformanceProviderConfig(provider: "pagespeed" | "webpagetest", missing: string[], schemaVersion?: string) {
  return {
    ok: false,
    schema_version:
      schemaVersion ??
      (provider === "pagespeed"
        ? "site-10-layer-performance-provider-result/v0.1"
        : "site-10-layer-webpagetest-start/v0.1"),
    provider,
    error_code: "missing_performance_provider_config",
    error: `Missing required ${provider} configuration: ${missing.join(", ")}.`,
    missing_config: missing,
    status: 503,
    coverage: {
      collected: [],
      missing: [`${provider}_provider_config`],
    },
  };
}

async function readPageSpeedCache(
  env: PerformanceProviderEnv,
  key: string,
): Promise<Record<string, unknown> | null> {
  if (!env.SCAN_JOB_KV) return null;

  const text = await env.SCAN_JOB_KV.get(key);
  if (!text) return null;

  try {
    const value = JSON.parse(text) as unknown;
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

async function writePageSpeedCache(
  env: PerformanceProviderEnv,
  key: string,
  value: Record<string, unknown>,
  ttlSeconds: number,
): Promise<void> {
  if (!env.SCAN_JOB_KV) return;
  await env.SCAN_JOB_KV.put(key, JSON.stringify(value), {
    expirationTtl: ttlSeconds,
  });
}

async function createPageSpeedCacheKey(target: string, strategy: LighthouseStrategy, apiUrl: string | undefined): Promise<string> {
  const raw = JSON.stringify({
    target,
    strategy,
    api_url: apiUrl ?? "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
    category: "PERFORMANCE",
  });
  return `provider-cache/pagespeed/${await sha256Hex(raw)}.json`;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.floor(numeric);
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) {
    return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
  }
  return null;
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function mapPageSpeedResult(target: string, strategy: LighthouseStrategy, payload: unknown, durationMs: number) {
  const lighthouse = getRecord(payload, "lighthouseResult");
  const categories = getRecord(lighthouse, "categories");
  const performanceCategory = getRecord(categories, "performance");
  const audits = getRecord(lighthouse, "audits");
  const requestedUrl = getString(payload, "id") ?? normalizeTargetUrl(target);
  const finalUrl = getString(lighthouse, "finalDisplayedUrl") ?? getString(lighthouse, "finalUrl");
  const performanceScore = getNumber(performanceCategory, "score");
  const fieldData = mapPageSpeedFieldData(payload);
  const metricIds = [
    "first-contentful-paint",
    "largest-contentful-paint",
    "total-blocking-time",
    "cumulative-layout-shift",
    "speed-index",
    "interactive",
  ];

  return {
    requested_url: requestedUrl,
    final_url: finalUrl,
    strategy,
    provider: "pagespeed",
    metrics: metricIds.map((id) => mapLighthouseMetric(id, getRecord(audits, id))),
    opportunities: Object.entries(audits)
      .map(([id, value]) => mapLighthouseOpportunity(id, value))
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .slice(0, 20),
    raw_summary: {
      performance_score: performanceScore,
      accessibility_score: getNumber(getRecord(categories, "accessibility"), "score"),
      best_practices_score: getNumber(getRecord(categories, "best-practices"), "score"),
      seo_score: getNumber(getRecord(categories, "seo"), "score"),
      field_data: fieldData,
    },
    duration_ms: durationMs,
    provider_id: "pagespeed",
    source: "pagespeed_api",
  };
}

function mapPageSpeedFieldData(payload: unknown) {
  const page = mapPageSpeedFieldDataScope(getRecord(payload, "loadingExperience"));
  const origin = mapPageSpeedFieldDataScope(getRecord(payload, "originLoadingExperience"));

  return {
    available: Boolean(page || origin),
    page,
    origin,
  };
}

function mapPageSpeedFieldDataScope(scope: Record<string, unknown>) {
  const metrics = getRecord(scope, "metrics");
  const metricEntries = Object.entries(metrics)
    .map(([id, value]) => mapPageSpeedFieldMetric(id, value))
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  if (metricEntries.length === 0) return null;

  return {
    url: getString(scope, "id"),
    overall_category: getString(scope, "overall_category"),
    metrics: metricEntries,
  };
}

function mapPageSpeedFieldMetric(id: string, value: unknown) {
  if (!isPlainObject(value)) return null;

  return {
    id,
    percentile: getNumber(value, "percentile"),
    category: getString(value, "category"),
    distributions: readDistributions(value.distributions),
  };
}

function readDistributions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject).map((distribution) => ({
    min: getNumber(distribution, "min"),
    max: getNumber(distribution, "max"),
    proportion: getNumber(distribution, "proportion"),
  }));
}

function mapLighthouseMetric(id: string, audit: Record<string, unknown>) {
  const numericValue = getNumber(audit, "numericValue");
  const score = getNumber(audit, "score");
  const unit = id === "cumulative-layout-shift" ? "count" : "ms";
  return {
    id,
    label: getString(audit, "title") ?? id,
    value: numericValue,
    unit,
    rating: rateAuditScore(score),
  };
}

function mapLighthouseOpportunity(id: string, value: unknown) {
  if (!isPlainObject(value)) return null;
  const details = getRecord(value, "details");
  const type = getString(details, "type");
  const score = getNumber(value, "score");
  const savingsMs = getNumber(details, "overallSavingsMs");
  const savingsBytes = getNumber(details, "overallSavingsBytes");

  if (type !== "opportunity" && savingsMs === null && savingsBytes === null) return null;

  return {
    id,
    title: getString(value, "title") ?? id,
    score,
    estimated_savings_ms: savingsMs,
    estimated_savings_bytes: savingsBytes,
  };
}

function mapWebPageTestResult(testId: string, payload: unknown) {
  const data = getRecord(payload, "data");
  const medianFirstView = getRecord(getRecord(data, "median"), "firstView");

  return {
    provider: "webpagetest",
    request_id: testId,
    url: getString(data, "url"),
    summary: getString(data, "summary"),
    location: getString(data, "location"),
    metrics: [
      { id: "loadTime", label: "Load Time", value: getNumber(medianFirstView, "loadTime"), unit: "ms" },
      { id: "TTFB", label: "TTFB", value: getNumber(medianFirstView, "TTFB"), unit: "ms" },
      { id: "render", label: "Start Render", value: getNumber(medianFirstView, "render"), unit: "ms" },
      { id: "SpeedIndex", label: "Speed Index", value: getNumber(medianFirstView, "SpeedIndex"), unit: "ms" },
      { id: "bytesIn", label: "Bytes In", value: getNumber(medianFirstView, "bytesIn"), unit: "bytes" },
      { id: "requests", label: "Requests", value: getNumber(medianFirstView, "requests"), unit: "count" },
    ],
    limitations: [
      "WebPageTest results depend on the selected location, browser, network profile, queue time, and run timing.",
      "This boundary returns provider summary data; downstream adapters decide which values become SnapshotRecord evidence.",
    ],
  };
}

function rateAuditScore(score: number | null): "good" | "needs_improvement" | "poor" | "unknown" {
  if (score === null) return "unknown";
  if (score >= 0.9) return "good";
  if (score >= 0.5) return "needs_improvement";
  return "poor";
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function extractProviderError(payload: unknown): string | null {
  if (!isPlainObject(payload)) return null;
  const directError = getString(payload, "error");
  if (directError) return directError;
  const statusText = getString(payload, "statusText");
  if (statusText) return statusText;
  const error = getRecord(payload, "error");
  return getString(error, "message");
}

function parseRequestId(url: URL): string {
  const id = url.searchParams.get("id");
  if (!id) throw new Error("Missing required id query parameter.");
  return id;
}

function getRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isPlainObject(value)) return {};
  const nested = value[key];
  return isPlainObject(nested) ? nested : {};
}

function getString(value: unknown, key: string): string | null {
  if (!isPlainObject(value)) return null;
  const nested = value[key];
  return typeof nested === "string" ? nested : null;
}

function getNumber(value: unknown, key: string): number | null {
  if (!isPlainObject(value)) return null;
  const nested = value[key];
  return typeof nested === "number" && Number.isFinite(nested) ? nested : null;
}

function getNestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!isPlainObject(current)) return null;
    current = current[key];
  }
  return typeof current === "string" ? current : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

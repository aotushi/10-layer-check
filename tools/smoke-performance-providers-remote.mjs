import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const env = { ...process.env, ...readDevVars(resolve(process.cwd(), ".dev.vars")) };

const endpoint = trimTrailingSlash(env.PERFORMANCE_SMOKE_ENDPOINT ?? "https://probe.9shi.cc");
const target = env.PERFORMANCE_SMOKE_TARGET ?? "https://example.com";
const selectedProviders = parseProviderList(env.PERFORMANCE_SMOKE_PROVIDERS ?? "pagespeed");
const apiKey = env.PROBE_API_KEY;

if (!apiKey) {
  console.log(
    JSON.stringify(
      {
        status: "blocked_missing_probe_api_key",
        endpoint,
        target,
        message: "Set PROBE_API_KEY in the environment or .dev.vars before running remote performance provider smoke.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const providerResponses = {};

if (selectedProviders.includes("pagespeed")) {
  providerResponses.pagespeed = await postJson(`${endpoint}/provider/performance/pagespeed/run`, {
    target,
    strategy: "mobile",
  });
}

if (selectedProviders.includes("webpagetest")) {
  providerResponses.webpagetest = await postJson(`${endpoint}/provider/performance/webpagetest/start`, {
    target,
  });
}

const summary = {
  endpoint,
  target,
  selected_providers: selectedProviders,
  skipped_providers: ["pagespeed", "webpagetest"].filter((provider) => !selectedProviders.includes(provider)),
  status: summarizeStatus(Object.values(providerResponses)),
  providers: Object.fromEntries(
    Object.entries(providerResponses).map(([provider, response]) => [provider, summarizeProviderResponse(response)]),
  ),
};

console.log(JSON.stringify(summary, null, 2));

if (summary.status === "failed") {
  process.exitCode = 1;
}

async function postJson(url, body) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await readJsonBody(response),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: {
        error_code: "request_failed",
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function readJsonBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return {
      error_code: "non_json_response",
      preview: text.slice(0, 240),
    };
  }
}

function summarizeProviderResponse(response) {
  const body = isRecord(response.body) ? response.body : {};
  return {
    http_status: response.status,
    ok: Boolean(response.ok && !body.error_code),
    schema_version: typeof body.schema_version === "string" ? body.schema_version : undefined,
    provider_status: typeof body.status === "string" ? body.status : undefined,
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
    error_summary: typeof body.error === "string" ? body.error.slice(0, 240) : undefined,
    retryable: typeof body.retryable === "boolean" ? body.retryable : undefined,
    retry_after_seconds: typeof body.retry_after_seconds === "number" ? body.retry_after_seconds : undefined,
    cache_status: isRecord(body.cache) && typeof body.cache.status === "string" ? body.cache.status : undefined,
    missing_config: Array.isArray(body.missing_config) ? body.missing_config : undefined,
    request_id: typeof body.request_id === "string" ? body.request_id : undefined,
    result_summary: summarizePerformanceResult(body.result),
  };
}

function summarizePerformanceResult(result) {
  if (!isRecord(result)) {
    return undefined;
  }

  const metrics = Array.isArray(result.metrics) ? result.metrics.filter(isRecord) : [];
  const opportunities = Array.isArray(result.opportunities) ? result.opportunities.filter(isRecord) : [];
  const rawSummary = isRecord(result.raw_summary) ? result.raw_summary : {};
  const fieldData = isRecord(rawSummary.field_data) ? rawSummary.field_data : {};
  const pageFieldData = isRecord(fieldData.page) ? fieldData.page : {};
  const originFieldData = isRecord(fieldData.origin) ? fieldData.origin : {};
  const pageFieldMetrics = Array.isArray(pageFieldData.metrics) ? pageFieldData.metrics.filter(isRecord) : [];
  const originFieldMetrics = Array.isArray(originFieldData.metrics) ? originFieldData.metrics.filter(isRecord) : [];

  return {
    provider: typeof result.provider === "string" ? result.provider : undefined,
    source: typeof result.source === "string" ? result.source : undefined,
    strategy: typeof result.strategy === "string" ? result.strategy : undefined,
    final_url: typeof result.final_url === "string" ? result.final_url : undefined,
    metrics_count: metrics.length,
    metrics: metrics.map((metric) => ({
      id: typeof metric.id === "string" ? metric.id : undefined,
      value: typeof metric.value === "number" ? metric.value : null,
      unit: typeof metric.unit === "string" ? metric.unit : undefined,
      rating: typeof metric.rating === "string" ? metric.rating : undefined,
    })),
    opportunities_count: opportunities.length,
    performance_score:
      typeof rawSummary.performance_score === "number" || rawSummary.performance_score === null
        ? rawSummary.performance_score
        : undefined,
    field_data_available: typeof fieldData.available === "boolean" ? fieldData.available : undefined,
    field_data_page_metric_count: pageFieldMetrics.length,
    field_data_origin_metric_count: originFieldMetrics.length,
  };
}

function summarizeStatus(responses) {
  if (responses.length === 0) {
    return "blocked_no_providers_selected";
  }
  const providerSummaries = responses.map(summarizeProviderResponse);
  if (providerSummaries.every((response) => response.ok)) {
    return "passed";
  }
  if (
    providerSummaries.some(
      (response) =>
        response.error_code === "missing_performance_provider_config" ||
        (Array.isArray(response.missing_config) && response.missing_config.length > 0),
    )
  ) {
    return "blocked_missing_provider_config";
  }
  if (providerSummaries.some((response) => response.error_code === "performance_provider_rate_limited")) {
    return "blocked_provider_rate_limited";
  }
  return "failed";
}

function parseProviderList(value) {
  const providers = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return providers.filter((provider, index) => {
    if (!["pagespeed", "webpagetest"].includes(provider)) {
      return false;
    }
    return providers.indexOf(provider) === index;
  });
}

function readDevVars(path) {
  if (!existsSync(path)) {
    return {};
  }
  const parsed = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    parsed[key] = value.replace(/^["']|["']$/g, "");
  }
  return parsed;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

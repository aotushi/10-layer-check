#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const env = { ...process.env, ...readDevVars(resolve(process.cwd(), ".dev.vars")) };

const endpoint = trimTrailingSlash(env.L9_ORG_SMOKE_ENDPOINT ?? "https://probe.9shi.cc");
const apiKey = env.PROBE_API_KEY;
const cases = parseCases(env.L9_ORG_SMOKE_CASES) ?? [
  { target: "https://poixe.com", kind: "baseline", requireRdap: true, requireWayback: true },
  { target: "https://www.poixe.com", kind: "baseline", requireRdap: true, requireWayback: true },
  { target: "https://matomo.org", kind: "false_positive", analyticsMax: 0 },
  { target: "https://plausible.io", kind: "false_positive", analyticsMax: 0 },
  { target: "https://web.dev", kind: "false_positive", analyticsMax: 0 },
  { target: "https://wordpress.org", kind: "positive", expectedAnalyticsHints: ["google_tag_manager"] },
  { target: "https://www.mozilla.org", kind: "positive", expectedAnalyticsHints: ["sentry"] },
];

if (!apiKey) {
  console.log(
    JSON.stringify(
      {
        status: "blocked_missing_probe_api_key",
        endpoint,
        message: "Set PROBE_API_KEY in the environment or .dev.vars before running remote L9 organization smoke.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const results = [];
for (const testCase of cases) {
  const response = await postJson(`${endpoint}/probe/organization-intelligence`, { target: testCase.target });
  results.push(summarizeCase(testCase, response));
}

const summary = {
  endpoint,
  status: results.every((result) => result.status === "passed") ? "passed" : "failed",
  cases: results,
};

writeSmokeResult(summary);
console.log(JSON.stringify(summary, null, 2));

if (summary.status !== "passed") {
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
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return {
      error_code: "non_json_response",
      preview: text.slice(0, 240),
    };
  }
}

function summarizeCase(testCase, response) {
  const body = isRecord(response.body) ? response.body : {};
  const candidates = Array.isArray(body.related_domain_candidates) ? body.related_domain_candidates.filter(isRecord) : [];
  const analyticsCandidates = candidates.filter((candidate) => candidate.role === "analytics");
  const analyticsHints = Array.from(
    new Set(
      analyticsCandidates
        .flatMap((candidate) => (Array.isArray(candidate.evidence) ? candidate.evidence : []))
        .filter(isRecord)
        .filter((item) => item.name === "analytics_hint" && typeof item.value === "string")
        .map((item) => item.value),
    ),
  ).sort();

  const checks = evaluateCase(testCase, { response, body, analyticsCandidates, analyticsHints });
  return {
    target: testCase.target,
    kind: testCase.kind,
    status: checks.every((check) => check.ok) ? "passed" : "failed",
    http_status: response.status,
    host: typeof body.host === "string" ? body.host : undefined,
    rdap_status: readStatus(body.external_intelligence?.whois),
    rdap_provider: typeof body.external_intelligence?.whois?.provider === "string" ? body.external_intelligence.whois.provider : undefined,
    wayback_status: readStatus(body.external_intelligence?.wayback),
    wayback_provider:
      typeof body.external_intelligence?.wayback?.provider === "string" ? body.external_intelligence.wayback.provider : undefined,
    candidate_count: candidates.length,
    analytics_candidate_count: analyticsCandidates.length,
    analytics_candidates: analyticsCandidates.map((candidate) => ({
      host: typeof candidate.host === "string" ? candidate.host : undefined,
      signal: typeof candidate.signal === "string" ? candidate.signal : undefined,
      url: typeof candidate.url === "string" ? truncate(candidate.url, 180) : undefined,
      hints: Array.isArray(candidate.evidence)
        ? candidate.evidence
            .filter(isRecord)
            .filter((item) => item.name === "analytics_hint" && typeof item.value === "string")
            .map((item) => item.value)
        : [],
    })),
    checks,
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
    error: typeof body.error === "string" ? truncate(body.error, 240) : undefined,
  };
}

function evaluateCase(testCase, context) {
  const checks = [
    {
      name: "http_200",
      ok: context.response.ok && context.response.status === 200,
    },
  ];

  if (testCase.requireRdap) {
    checks.push({
      name: "rdap_collected",
      ok: context.body.external_intelligence?.whois?.status === "rdap_collected",
    });
  }

  if (testCase.requireWayback) {
    checks.push({
      name: "wayback_collected",
      ok: context.body.external_intelligence?.wayback?.status === "wayback_collected",
    });
  }

  if (typeof testCase.analyticsMax === "number") {
    checks.push({
      name: "analytics_false_positive_guard",
      ok: context.analyticsCandidates.length <= testCase.analyticsMax,
    });
  }

  if (Array.isArray(testCase.expectedAnalyticsHints) && testCase.expectedAnalyticsHints.length > 0) {
    checks.push({
      name: "expected_analytics_endpoint",
      ok: testCase.expectedAnalyticsHints.every((hint) => context.analyticsHints.includes(hint)),
    });
  }

  return checks;
}

function readStatus(value) {
  return isRecord(value) && typeof value.status === "string" ? value.status : undefined;
}

function parseCases(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : null;
  } catch {
    return null;
  }
}

function writeSmokeResult(summary) {
  const dir = resolve(process.cwd(), "smoke-results");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(resolve(dir, `l9-organization-remote-${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`);
}

function readDevVars(path) {
  if (!existsSync(path)) return {};
  const parsed = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    parsed[key] = value.replace(/^["']|["']$/g, "");
  }
  return parsed;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

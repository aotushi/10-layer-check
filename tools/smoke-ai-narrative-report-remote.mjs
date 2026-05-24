#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const env = { ...process.env, ...readDevVars(resolve(process.cwd(), ".dev.vars")) };

const endpoint = trimTrailingSlash(env.AI_NARRATIVE_REPORT_SMOKE_ENDPOINT ?? "https://probe.9shi.cc");
const target = env.AI_NARRATIVE_REPORT_SMOKE_TARGET ?? "https://example.com";
const syncProbes = parseList(env.AI_NARRATIVE_REPORT_SMOKE_SYNC_PROBES ?? "remote_fetch");
const asyncProviders = parseList(env.AI_NARRATIVE_REPORT_SMOKE_ASYNC_PROVIDERS ?? "");
const apiKey = env.PROBE_API_KEY;

if (!apiKey) {
  console.log(
    JSON.stringify(
      {
        status: "blocked_missing_probe_api_key",
        endpoint,
        target,
        message: "Set PROBE_API_KEY in the environment or .dev.vars before running remote AI narrative report smoke.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const response = await postJson(`${endpoint}/scan/site/report`, {
  target,
  sync_probes: syncProbes,
  async_providers: asyncProviders,
});
const summary = summarizeResponse(response);

writeSmokeResult(summary);
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
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return {
      error_code: "non_json_response",
      preview: text.slice(0, 500),
    };
  }
}

function summarizeResponse(response) {
  const body = isRecord(response.body) ? response.body : {};
  const artifact = isRecord(body.artifact) ? body.artifact : {};
  const brief = isRecord(artifact.brief) ? artifact.brief : {};
  const aiReport = isRecord(body.ai_narrative_report) ? body.ai_narrative_report : {};
  const providerError = isRecord(body.provider_error) ? body.provider_error : {};
  const markdown = typeof aiReport.markdown === "string" ? aiReport.markdown : "";
  const sections = Array.isArray(aiReport.sections) ? aiReport.sections.filter(isRecord) : [];
  const evidenceIds = new Set(Array.isArray(brief.evidence_index) ? brief.evidence_index.map((item) => item.id).filter(Boolean) : []);
  const missingDataIds = new Set(Array.isArray(brief.missing_data) ? brief.missing_data.map((item) => item.id).filter(Boolean) : []);
  const markdownEvidenceRefs = extractBracketRefs(markdown, "E");
  const markdownMissingRefs = extractBracketRefs(markdown, "M");
  const unknownEvidenceRefs = markdownEvidenceRefs.filter((ref) => !evidenceIds.has(ref));
  const unknownMissingDataRefs = markdownMissingRefs.filter((ref) => !missingDataIds.has(ref));

  return {
    endpoint,
    target,
    sync_probes: syncProbes,
    async_providers: asyncProviders,
    status: summarizeStatus({ response, body, aiReport, artifact, sections, unknownEvidenceRefs, unknownMissingDataRefs }),
    http_status: response.status,
    schema_version: typeof body.schema_version === "string" ? body.schema_version : undefined,
    ok: typeof body.ok === "boolean" ? body.ok : undefined,
    artifact_schema_version: typeof artifact.schema_version === "string" ? artifact.schema_version : undefined,
    artifact_record_count: isRecord(artifact.run) ? artifact.run.record_count : undefined,
    artifact_has_brief: isRecord(brief),
    ai_report_schema_version: typeof aiReport.schema_version === "string" ? aiReport.schema_version : undefined,
    ai_report_section_count: sections.length,
    markdown_length: markdown.length,
    markdown_preview: markdown ? truncate(markdown, 600) : undefined,
    markdown_evidence_refs: markdownEvidenceRefs,
    markdown_missing_data_refs: markdownMissingRefs,
    unknown_evidence_refs: unknownEvidenceRefs,
    unknown_missing_data_refs: unknownMissingDataRefs,
    boundaries: isRecord(body.boundaries) ? body.boundaries : undefined,
    provider_error_code: typeof providerError.error_code === "string" ? providerError.error_code : undefined,
    provider_error: typeof providerError.error === "string" ? truncate(providerError.error, 300) : undefined,
    validation_errors: Array.isArray(providerError.validation_errors)
      ? providerError.validation_errors.map((value) => truncate(String(value), 500))
      : undefined,
  };
}

function summarizeStatus({ response, body, aiReport, artifact, sections, unknownEvidenceRefs, unknownMissingDataRefs }) {
  if (!response.ok || body.ok !== true) return "failed";
  if (body.schema_version !== "site-10-layer-scan-ai-report/v0.1") return "failed";
  if (artifact.schema_version !== "site-10-layer-scan-export-artifact/v0.1") return "failed";
  if (aiReport.schema_version !== "site-10-layer-ai-narrative-report-result/v0.1") return "failed";
  if (sections.length === 0) return "failed";
  if (typeof aiReport.markdown !== "string" || aiReport.markdown.length < 80) return "failed";
  if (unknownEvidenceRefs.length > 0 || unknownMissingDataRefs.length > 0) return "failed";
  return "passed";
}

function writeSmokeResult(summary) {
  const dir = resolve(process.cwd(), "smoke-results");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTarget = target.replace(/^[a-z]+:\/\//i, "").replace(/[^a-z0-9.-]+/gi, "_");
  writeFileSync(resolve(dir, `ai-narrative-report-${safeTarget}-${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`);
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

function extractBracketRefs(value, prefix) {
  return Array.from(new Set(Array.from(value.matchAll(new RegExp(`\\[(${prefix}\\d{3})\\]`, "g"))).map((match) => match[1]))).sort();
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function parseList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

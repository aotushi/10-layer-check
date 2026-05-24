#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const env = { ...process.env, ...readDevVars(resolve(process.cwd(), ".dev.vars")) };

const endpoint = trimTrailingSlash(env.PERSISTED_JOB_SMOKE_ENDPOINT ?? "https://probe.9shi.cc");
const target = env.PERSISTED_JOB_SMOKE_TARGET ?? "https://example.com";
const syncProbes = parseList(env.PERSISTED_JOB_SMOKE_SYNC_PROBES ?? "remote_fetch");
const asyncProviders = parseList(env.PERSISTED_JOB_SMOKE_ASYNC_PROVIDERS ?? "");
const strategy = env.PERSISTED_JOB_SMOKE_STRATEGY === "desktop" ? "desktop" : "mobile";
const apiKey = env.PROBE_API_KEY;

if (!apiKey) {
  console.log(
    JSON.stringify(
      {
        status: "blocked_missing_probe_api_key",
        endpoint,
        target,
        message: "Set PROBE_API_KEY in the environment or .dev.vars before running remote persisted job smoke.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const created = await postJson(`${endpoint}/scan/jobs`, {
  target,
  sync_probes: syncProbes,
  async_providers: asyncProviders,
  strategy,
});
const jobId = isRecord(created.body) && isRecord(created.body.job) && typeof created.body.job.id === "string"
  ? created.body.job.id
  : null;
const read = jobId ? await getJson(`${endpoint}/scan/jobs/${encodeURIComponent(jobId)}`) : null;
const artifact = jobId ? await getJson(`${endpoint}/scan/jobs/${encodeURIComponent(jobId)}/artifact`) : null;

const summary = {
  endpoint,
  target,
  sync_probes: syncProbes,
  async_providers: asyncProviders,
  strategy,
  status: summarize(created, read, artifact),
  job_id: jobId,
  created: summarizeCreated(created),
  read: summarizeRead(read),
  artifact: summarizeArtifact(artifact),
};

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
    return requestFailed(error);
  }
}

async function getJson(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
      },
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await readJsonBody(response),
    };
  } catch (error) {
    return requestFailed(error);
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

function requestFailed(error) {
  return {
    ok: false,
    status: 0,
    body: {
      error_code: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    },
  };
}

function summarize(createdResponse, readResponse, artifactResponse) {
  const createdOk = Boolean(
    createdResponse.ok &&
      isRecord(createdResponse.body) &&
      createdResponse.body.schema_version === "site-10-layer-scan-job/v0.1" &&
      isRecord(createdResponse.body.boundaries) &&
      createdResponse.body.boundaries.storage_persisted === true,
  );
  const readOk = Boolean(
    readResponse?.ok &&
      isRecord(readResponse.body) &&
      readResponse.body.schema_version === "site-10-layer-persisted-scan-job/v0.1" &&
      isRecord(readResponse.body.meta),
  );
  const artifactOk = Boolean(
    artifactResponse?.ok &&
      isRecord(artifactResponse.body) &&
      artifactResponse.body.schema_version === "site-10-layer-scan-export-artifact/v0.1" &&
      isRecord(artifactResponse.body.boundaries) &&
      artifactResponse.body.boundaries.storage_persisted === true,
  );
  return createdOk && readOk && artifactOk ? "passed" : "failed";
}

function summarizeCreated(response) {
  const body = isRecord(response.body) ? response.body : {};
  return {
    http_status: response.status,
    schema_version: typeof body.schema_version === "string" ? body.schema_version : undefined,
    storage_persisted: isRecord(body.boundaries) ? body.boundaries.storage_persisted : undefined,
    job_status: isRecord(body.job) ? body.job.status : undefined,
    record_count: isRecord(body.job) && Array.isArray(body.job.records) ? body.job.records.length : undefined,
    probes: summarizeRecords(isRecord(body.job) ? body.job.records : undefined),
    async_jobs: summarizeAsyncJobs(isRecord(body.job) ? body.job.provider_jobs : undefined),
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
    error: typeof body.error === "string" ? truncate(body.error, 240) : undefined,
  };
}

function summarizeRead(response) {
  const body = isRecord(response?.body) ? response.body : {};
  return {
    http_status: response?.status ?? null,
    schema_version: typeof body.schema_version === "string" ? body.schema_version : undefined,
    meta_status: isRecord(body.meta) ? body.meta.status : undefined,
    raw_ref: isRecord(body.meta) ? body.meta.raw_ref : undefined,
    artifact_ref: isRecord(body.meta) ? body.meta.artifact_ref : undefined,
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
  };
}

function summarizeArtifact(response) {
  const body = isRecord(response?.body) ? response.body : {};
  const records = Array.isArray(body.records) ? body.records : undefined;
  return {
    http_status: response?.status ?? null,
    schema_version: typeof body.schema_version === "string" ? body.schema_version : undefined,
    storage_persisted: isRecord(body.boundaries) ? body.boundaries.storage_persisted : undefined,
    record_count: isRecord(body.run) ? body.run.record_count : undefined,
    probes: summarizeRecords(records),
    has_analysis: isRecord(body.analysis),
    has_brief: isRecord(body.brief),
    has_markdown: isRecord(body.markdown),
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
  };
}

function summarizeRecords(value) {
  if (!Array.isArray(value)) return undefined;
  const layers = Array.from(new Set(value.map((record) => (isRecord(record) ? record.layer : null)).filter((layer) => typeof layer === "number"))).sort(
    (a, b) => a - b,
  );
  const probes = Array.from(new Set(value.map((record) => (isRecord(record) && typeof record.probe === "string" ? record.probe : null)).filter(Boolean))).sort();
  return {
    layers,
    probes,
  };
}

function summarizeAsyncJobs(value) {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(isRecord)
    .map((job) => ({
      capability: typeof job.capability === "string" ? job.capability : undefined,
      provider: typeof job.provider === "string" ? job.provider : undefined,
      status: typeof job.status === "string" ? job.status : undefined,
      has_result_envelope: isRecord(job.result_envelope),
      normalized_record_count:
        typeof job.normalized_record_count === "number" ? job.normalized_record_count : undefined,
      error_code: typeof job.error_code === "string" ? job.error_code : undefined,
    }));
}

function writeSmokeResult(summary) {
  const dir = resolve(process.cwd(), "smoke-results");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTarget = target.replace(/^[a-z]+:\/\//i, "").replace(/[^a-z0-9.-]+/gi, "_");
  writeFileSync(resolve(dir, `persisted-job-${safeTarget}-${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`);
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

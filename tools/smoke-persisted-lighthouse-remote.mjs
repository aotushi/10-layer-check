#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const env = { ...process.env, ...readDevVars(resolve(process.cwd(), ".dev.vars")) };

const endpoint = trimTrailingSlash(env.PERSISTED_LIGHTHOUSE_SMOKE_ENDPOINT ?? "https://probe.9shi.cc/api");
const target = env.PERSISTED_LIGHTHOUSE_SMOKE_TARGET ?? "https://example.com";
const syncProbes = parseList(env.PERSISTED_LIGHTHOUSE_SMOKE_SYNC_PROBES ?? "performance_basic");
const strategy = env.PERSISTED_LIGHTHOUSE_SMOKE_STRATEGY === "desktop" ? "desktop" : "mobile";
const timeoutMs = parsePositiveInteger(env.PERSISTED_LIGHTHOUSE_SMOKE_TIMEOUT_MS, 20 * 60 * 1000);
const initialDelayMs = parsePositiveInteger(env.PERSISTED_LIGHTHOUSE_SMOKE_INITIAL_DELAY_MS, 30 * 1000);
const pollIntervalMs = parsePositiveInteger(env.PERSISTED_LIGHTHOUSE_SMOKE_POLL_INTERVAL_MS, 15 * 1000);
const apiKey = env.PROBE_API_KEY;

if (!apiKey) {
  console.log(
    JSON.stringify(
      {
        status: "blocked_missing_probe_api_key",
        endpoint,
        target,
        message: "Set PROBE_API_KEY in the environment or .dev.vars before running remote persisted Lighthouse smoke.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const startedAt = Date.now();
const created = await postJson(`${endpoint}/scan/jobs`, {
  target,
  sync_probes: syncProbes,
  async_providers: ["lighthouse"],
  strategy,
});
const jobId = readJobId(created.body);
const polls = [];

if (jobId && initialDelayMs > 0) {
  await sleep(initialDelayMs);
}

let latestPoll = null;
while (jobId && Date.now() - startedAt < timeoutMs) {
  latestPoll = await postJson(`${endpoint}/scan/jobs/${encodeURIComponent(jobId)}/poll`, {});
  polls.push(summarizePoll(latestPoll));

  const lighthouseJob = readProviderJob(latestPoll.body, "lighthouse");
  if (isTerminalStatus(lighthouseJob?.status)) break;

  await sleep(pollIntervalMs);
}

const read = jobId ? await getJson(`${endpoint}/scan/jobs/${encodeURIComponent(jobId)}`) : null;
const artifact = jobId ? await getJson(`${endpoint}/scan/jobs/${encodeURIComponent(jobId)}/artifact`) : null;

const summary = {
  endpoint,
  target,
  sync_probes: syncProbes,
  async_providers: ["lighthouse"],
  strategy,
  status: summarizeStatus({ created, latestPoll, read, artifact, polls, startedAt, timeoutMs }),
  elapsed_ms: Date.now() - startedAt,
  job_id: jobId,
  created: summarizeJobEnvelope(created),
  polls,
  read: summarizePersistedMeta(read),
  artifact: summarizeArtifact(artifact),
};

writeSmokeResult(summary);
console.log(JSON.stringify(summary, null, 2));

if (summary.status === "failed" || summary.status === "timed_out") {
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

function summarizeStatus(input) {
  const createdOk = Boolean(
    input.created.ok &&
      isRecord(input.created.body) &&
      input.created.body.schema_version === "site-10-layer-scan-job/v0.1" &&
      isRecord(input.created.body.boundaries) &&
      input.created.body.boundaries.storage_persisted === true,
  );
  const readOk = Boolean(
    input.read?.ok &&
      isRecord(input.read.body) &&
      input.read.body.schema_version === "site-10-layer-persisted-scan-job/v0.1",
  );
  const artifactOk = Boolean(
    input.artifact?.ok &&
      isRecord(input.artifact.body) &&
      input.artifact.body.schema_version === "site-10-layer-scan-export-artifact/v0.1" &&
      artifactHasLighthouseEvidence(input.artifact.body),
  );
  const lighthouseJob = readProviderJob(input.latestPoll?.body, "lighthouse") ?? readProviderJob(input.read?.body, "lighthouse");

  if (!createdOk || !readOk) return "failed";
  if (lighthouseJob?.status === "failed") return "failed";
  if (createdOk && readOk && artifactOk && lighthouseJob?.status === "completed") return "passed";
  if (Date.now() - input.startedAt >= input.timeoutMs) return "timed_out";
  return "failed";
}

function summarizeJobEnvelope(response) {
  const body = isRecord(response.body) ? response.body : {};
  const job = isRecord(body.job) ? body.job : {};
  return {
    http_status: response.status,
    schema_version: typeof body.schema_version === "string" ? body.schema_version : undefined,
    storage_persisted: isRecord(body.boundaries) ? body.boundaries.storage_persisted : undefined,
    job_status: typeof job.status === "string" ? job.status : undefined,
    record_count: Array.isArray(job.records) ? job.records.length : undefined,
    async_jobs: summarizeProviderJobs(job.provider_jobs),
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
    error: typeof body.error === "string" ? truncate(body.error, 240) : undefined,
  };
}

function summarizePoll(response) {
  const body = isRecord(response.body) ? response.body : {};
  const job = isRecord(body.job) ? body.job : {};
  return {
    http_status: response.status,
    job_status: typeof job.status === "string" ? job.status : undefined,
    record_count: Array.isArray(job.records) ? job.records.length : undefined,
    async_jobs: summarizeProviderJobs(job.provider_jobs),
    poll: isRecord(body.poll) && Array.isArray(body.poll.checked_provider_jobs)
      ? body.poll.checked_provider_jobs.filter(isRecord).map((job) => ({
          capability: typeof job.capability === "string" ? job.capability : undefined,
          status: typeof job.status === "string" ? job.status : undefined,
          result_collected: typeof job.result_collected === "boolean" ? job.result_collected : undefined,
          error_code: isRecord(job.error) && typeof job.error.code === "string" ? job.error.code : undefined,
          error: isRecord(job.error) && typeof job.error.message === "string" ? truncate(job.error.message, 240) : undefined,
        }))
      : undefined,
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
  };
}

function summarizePersistedMeta(response) {
  const body = isRecord(response?.body) ? response.body : {};
  const meta = isRecord(body.meta) ? body.meta : {};
  return {
    http_status: response?.status ?? null,
    schema_version: typeof body.schema_version === "string" ? body.schema_version : undefined,
    meta_status: typeof meta.status === "string" ? meta.status : undefined,
    provider_jobs: summarizeProviderJobs(meta.provider_jobs),
    raw_ref: typeof meta.raw_ref === "string" ? meta.raw_ref : undefined,
    artifact_ref: typeof meta.artifact_ref === "string" ? meta.artifact_ref : undefined,
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
  };
}

function summarizeArtifact(response) {
  const body = isRecord(response?.body) ? response.body : {};
  const records = Array.isArray(body.records) ? body.records : [];
  return {
    http_status: response?.status ?? null,
    schema_version: typeof body.schema_version === "string" ? body.schema_version : undefined,
    storage_persisted: isRecord(body.boundaries) ? body.boundaries.storage_persisted : undefined,
    record_count: isRecord(body.run) ? body.run.record_count : undefined,
    lighthouse_record_count: records.filter(isLighthousePerformanceRecord).length,
    layers: Array.from(new Set(records.map((record) => (isRecord(record) ? record.layer : null)).filter((layer) => typeof layer === "number"))).sort(
      (a, b) => a - b,
    ),
    probes: Array.from(new Set(records.map((record) => (isRecord(record) && typeof record.probe === "string" ? record.probe : null)).filter(Boolean))).sort(),
    has_analysis: isRecord(body.analysis),
    has_brief: isRecord(body.brief),
    has_markdown: isRecord(body.markdown),
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
  };
}

function summarizeProviderJobs(value) {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((job) => ({
    capability: typeof job.capability === "string" ? job.capability : undefined,
    provider: typeof job.provider === "string" ? job.provider : undefined,
    status: typeof job.status === "string" ? job.status : undefined,
    run_id: typeof job.run_id === "number" ? job.run_id : undefined,
    request_id: typeof job.request_id === "string" ? job.request_id : undefined,
    has_result_envelope: isRecord(job.result_envelope),
    normalized_record_count: typeof job.normalized_record_count === "number" ? job.normalized_record_count : undefined,
    error_code: isRecord(job.error) && typeof job.error.code === "string" ? job.error.code : undefined,
    error: isRecord(job.error) && typeof job.error.message === "string" ? truncate(job.error.message, 240) : undefined,
  }));
}

function readProviderJob(body, capability) {
  const job = isRecord(body) && isRecord(body.job)
    ? body.job
    : isRecord(body) && isRecord(body.meta)
      ? body.meta
      : null;
  const providerJobs = Array.isArray(job?.provider_jobs) ? job.provider_jobs : [];
  return providerJobs.filter(isRecord).find((item) => item.capability === capability) ?? null;
}

function readJobId(body) {
  return isRecord(body) && isRecord(body.job) && typeof body.job.id === "string" ? body.job.id : null;
}

function artifactHasLighthouseEvidence(body) {
  const records = isRecord(body) && Array.isArray(body.records) ? body.records : [];
  return records.some(isLighthousePerformanceRecord);
}

function isLighthousePerformanceRecord(value) {
  return Boolean(
    isRecord(value) &&
      value.layer === 5 &&
      value.probe === "performance_probe" &&
      value.source === "github_actions_lighthouse" &&
      value.status !== "error",
  );
}

function isTerminalStatus(status) {
  return status === "completed" || status === "failed" || status === "skipped" || status === "cancelled";
}

function writeSmokeResult(summary) {
  const dir = resolve(process.cwd(), "smoke-results");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTarget = target.replace(/^[a-z]+:\/\//i, "").replace(/[^a-z0-9.-]+/gi, "_");
  writeFileSync(resolve(dir, `persisted-lighthouse-${safeTarget}-${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`);
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

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

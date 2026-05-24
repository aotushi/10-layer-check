#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const env = { ...process.env, ...readDevVars(resolve(process.cwd(), ".dev.vars")) };

const endpoint = trimTrailingSlash(env.PERSISTED_SELECTED_FULL_SMOKE_ENDPOINT ?? "https://probe.9shi.cc");
const target = env.PERSISTED_SELECTED_FULL_SMOKE_TARGET ?? "https://example.com";
const syncProbes = parseList(
  env.PERSISTED_SELECTED_FULL_SMOKE_SYNC_PROBES ??
    "dns_infrastructure,tls_certificate,subdomain_attack_surface,organization_intelligence,remote_fetch,performance_basic,api_reachability,service_fingerprint",
);
const asyncProviders = parseList(env.PERSISTED_SELECTED_FULL_SMOKE_ASYNC_PROVIDERS ?? "pagespeed,lighthouse,browser_runtime,live_tls");
const strategy = env.PERSISTED_SELECTED_FULL_SMOKE_STRATEGY === "desktop" ? "desktop" : "mobile";
const timeoutMs = parsePositiveInteger(env.PERSISTED_SELECTED_FULL_SMOKE_TIMEOUT_MS, 25 * 60 * 1000);
const initialDelayMs = parsePositiveInteger(env.PERSISTED_SELECTED_FULL_SMOKE_INITIAL_DELAY_MS, 30 * 1000);
const pollIntervalMs = parsePositiveInteger(env.PERSISTED_SELECTED_FULL_SMOKE_POLL_INTERVAL_MS, 15 * 1000);
const apiKey = env.PROBE_API_KEY;

if (!apiKey) {
  console.log(
    JSON.stringify(
      {
        status: "blocked_missing_probe_api_key",
        endpoint,
        target,
        message: "Set PROBE_API_KEY in the environment or .dev.vars before running the selected full-scan remote smoke.",
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
  async_providers: asyncProviders,
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

  const providerJobs = readProviderJobs(latestPoll.body);
  if (asyncProviders.every((capability) => isTerminalStatus(findProviderJob(providerJobs, capability)?.status))) {
    break;
  }

  await sleep(pollIntervalMs);
}

const read = jobId ? await getJson(`${endpoint}/scan/jobs/${encodeURIComponent(jobId)}`) : null;
const artifact = jobId ? await getJson(`${endpoint}/scan/jobs/${encodeURIComponent(jobId)}/artifact`) : null;
const summary = {
  endpoint,
  target,
  sync_probes: syncProbes,
  async_providers: asyncProviders,
  strategy,
  status: summarizeStatus({ created, latestPoll, read, artifact, startedAt, timeoutMs }),
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
  const providerJobs = [
    ...readProviderJobs(input.created.body),
    ...readProviderJobs(input.latestPoll?.body),
    ...readProviderJobs(input.read?.body),
  ];
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
      isRecord(input.artifact.body.boundaries) &&
      input.artifact.body.boundaries.storage_persisted === true,
  );
  const artifactCoverageOk = artifactHasSelectedFullEvidence(input.artifact?.body);
  const lighthouseJob = findProviderJob(providerJobs, "lighthouse");
  const browserRuntimeJob = findProviderJob(providerJobs, "browser_runtime");
  const pagespeedJob = findProviderJob(providerJobs, "pagespeed");

  if (!createdOk || !readOk) return "failed";
  if (lighthouseJob?.status === "failed" || browserRuntimeJob?.status === "failed") return "failed";
  if (Date.now() - input.startedAt >= input.timeoutMs && !isTerminalStatus(lighthouseJob?.status)) return "timed_out";
  if (Date.now() - input.startedAt >= input.timeoutMs && !isTerminalStatus(browserRuntimeJob?.status)) return "timed_out";
  if (createdOk && readOk && artifactOk && artifactCoverageOk) {
    if (pagespeedJob?.status === "failed") return "passed_with_pagespeed_provider_state";
    return "passed";
  }
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
    records: summarizeRecords(job.records),
    provider_jobs: summarizeProviderJobs(job.provider_jobs),
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
    provider_jobs: summarizeProviderJobs(job.provider_jobs),
    checked_provider_jobs: isRecord(body.poll) && Array.isArray(body.poll.checked_provider_jobs)
      ? summarizeProviderJobs(body.poll.checked_provider_jobs)
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
  const brief = isRecord(body.brief) ? body.brief : {};
  const missingData = Array.isArray(brief.missing_data) ? brief.missing_data.filter(isRecord) : [];
  return {
    http_status: response?.status ?? null,
    schema_version: typeof body.schema_version === "string" ? body.schema_version : undefined,
    storage_persisted: isRecord(body.boundaries) ? body.boundaries.storage_persisted : undefined,
    record_count: isRecord(body.run) ? body.run.record_count : undefined,
    records: summarizeRecords(records),
    evidence_checks: summarizeEvidenceChecks(records),
    layer_statuses: summarizeLayerStatuses(brief.layers),
    missing_data_count: missingData.length,
    missing_data_by_classification: countBy(missingData, "classification"),
    missing_data_by_layer: countBy(missingData, "layer"),
    missing_data: missingData.map((item) => ({
      id: typeof item.id === "string" ? item.id : undefined,
      layer: typeof item.layer === "number" ? item.layer : undefined,
      classification: typeof item.classification === "string" ? item.classification : undefined,
      description: typeof item.description === "string" ? truncate(item.description, 160) : undefined,
      evidence_refs: Array.isArray(item.evidence_refs) ? item.evidence_refs.slice(0, 5) : undefined,
    })),
    has_analysis: isRecord(body.analysis),
    has_brief: isRecord(body.brief),
    has_analysis_markdown: typeof body.markdown?.analysis === "string",
    has_narrative_markdown: typeof body.markdown?.narrative === "string",
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
  };
}

function summarizeRecords(value) {
  if (!Array.isArray(value)) return undefined;
  return {
    layers: Array.from(new Set(value.map((record) => (isRecord(record) ? record.layer : null)).filter((layer) => typeof layer === "number"))).sort(
      (a, b) => a - b,
    ),
    probes: Array.from(new Set(value.map((record) => (isRecord(record) && typeof record.probe === "string" ? record.probe : null)).filter(Boolean))).sort(),
    sources: Array.from(new Set(value.map((record) => (isRecord(record) && typeof record.source === "string" ? record.source : null)).filter(Boolean))).sort(),
  };
}

function summarizeEvidenceChecks(records) {
  return {
    layers_1_to_10: hasLayers(records, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    l5_performance_count: records.filter(isL5PerformanceRecord).length,
    l5_lighthouse_count: records.filter((record) => isL5PerformanceRecord(record) && record.source === "github_actions_lighthouse").length,
    l5_pagespeed_count: records.filter(
      (record) => isL5PerformanceRecord(record) && (record.source === "google_pagespeed" || record.source === "pagespeed_api"),
    ).length,
    l2_live_tls_count: records.filter((record) => isRecord(record) && record.probe === "tls_live_certificate_probe" && record.status !== "error").length,
    l4_runtime_record_count: records.filter((record) => isRecord(record) && record.layer === 4 && isRuntimeProbe(record.probe)).length,
    l6_runtime_api_count: records.filter((record) => isRecord(record) && record.probe === "runtime_api_requests_probe").length,
    l10_runtime_security_count: records.filter((record) => isRecord(record) && record.probe === "runtime_security_events_probe").length,
  };
}

function summarizeLayerStatuses(value) {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((layer) => ({
    layer: typeof layer.layer === "number" ? layer.layer : undefined,
    status: typeof layer.status === "string" ? layer.status : undefined,
    evidence_ref_count: Array.isArray(layer.evidence_refs) ? layer.evidence_refs.length : undefined,
    missing_data_ids: Array.isArray(layer.missing_data_ids) ? layer.missing_data_ids : undefined,
  }));
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
    error_code: isRecord(job.error) && typeof job.error.code === "string" ? job.error.code : typeof job.error_code === "string" ? job.error_code : undefined,
    error: isRecord(job.error) && typeof job.error.message === "string" ? truncate(job.error.message, 240) : undefined,
  }));
}

function readProviderJobs(body) {
  const job = isRecord(body) && isRecord(body.job)
    ? body.job
    : isRecord(body) && isRecord(body.meta)
      ? body.meta
      : null;
  return Array.isArray(job?.provider_jobs) ? job.provider_jobs.filter(isRecord) : [];
}

function findProviderJob(providerJobs, capability) {
  return [...providerJobs].reverse().find((job) => job.capability === capability) ?? null;
}

function readJobId(body) {
  return isRecord(body) && isRecord(body.job) && typeof body.job.id === "string" ? body.job.id : null;
}

function artifactHasSelectedFullEvidence(body) {
  const records = isRecord(body) && Array.isArray(body.records) ? body.records : [];
  if (!hasLayers(records, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])) return false;
  if (asyncProviders.includes("live_tls") && !records.some((record) => isRecord(record) && record.probe === "tls_live_certificate_probe" && record.status !== "error")) return false;
  if (!records.some(isL5PerformanceRecord)) return false;
  if (!records.some((record) => isRecord(record) && record.layer === 4 && isRuntimeProbe(record.probe))) return false;
  if (!records.some((record) => isRecord(record) && record.probe === "runtime_api_requests_probe")) return false;
  if (!records.some((record) => isRecord(record) && record.probe === "runtime_security_events_probe")) return false;
  return isRecord(body.analysis) && isRecord(body.brief) && typeof body.markdown?.analysis === "string";
}

function hasLayers(records, expectedLayers) {
  const layers = new Set(records.map((record) => (isRecord(record) ? record.layer : null)));
  return expectedLayers.every((layer) => layers.has(layer));
}

function isL5PerformanceRecord(value) {
  return Boolean(isRecord(value) && value.layer === 5 && value.probe === "performance_probe" && value.status !== "error");
}

function isRuntimeProbe(probe) {
  return typeof probe === "string" && probe.startsWith("runtime_");
}

function isTerminalStatus(status) {
  return status === "completed" || status === "failed" || status === "skipped" || status === "cancelled";
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const rawValue = item[key];
    const value = typeof rawValue === "number" || typeof rawValue === "string" ? String(rawValue) : "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function writeSmokeResult(summary) {
  const dir = resolve(process.cwd(), "smoke-results");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTarget = target.replace(/^[a-z]+:\/\//i, "").replace(/[^a-z0-9.-]+/gi, "_");
  writeFileSync(resolve(dir, `persisted-selected-full-${safeTarget}-${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`);
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

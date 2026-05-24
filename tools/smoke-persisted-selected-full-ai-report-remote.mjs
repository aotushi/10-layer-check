#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const env = { ...process.env, ...readDevVars(resolve(process.cwd(), ".dev.vars")) };

const endpoint = trimTrailingSlash(env.PERSISTED_SELECTED_FULL_AI_REPORT_ENDPOINT ?? "https://probe.9shi.cc");
const target = env.PERSISTED_SELECTED_FULL_AI_REPORT_TARGET ?? "https://example.com";
const syncProbes = parseList(
  env.PERSISTED_SELECTED_FULL_AI_REPORT_SYNC_PROBES ??
    "dns_infrastructure,tls_certificate,subdomain_attack_surface,organization_intelligence,remote_fetch,performance_basic,api_reachability,service_fingerprint,public_host_fingerprint,public_security_details,public_content_surface,public_content_detail,public_spa_metadata",
);
const asyncProviders = parseList(
  env.PERSISTED_SELECTED_FULL_AI_REPORT_ASYNC_PROVIDERS ?? "pagespeed,lighthouse,browser_runtime,live_tls",
);
const strategy = env.PERSISTED_SELECTED_FULL_AI_REPORT_STRATEGY === "desktop" ? "desktop" : "mobile";
const timeoutMs = parsePositiveInteger(env.PERSISTED_SELECTED_FULL_AI_REPORT_TIMEOUT_MS, 25 * 60 * 1000);
const initialDelayMs = parsePositiveInteger(env.PERSISTED_SELECTED_FULL_AI_REPORT_INITIAL_DELAY_MS, 30 * 1000);
const pollIntervalMs = parsePositiveInteger(env.PERSISTED_SELECTED_FULL_AI_REPORT_POLL_INTERVAL_MS, 15 * 1000);
const apiKey = env.PROBE_API_KEY;

if (!apiKey) {
  console.log(
    JSON.stringify(
      {
        status: "blocked_missing_probe_api_key",
        endpoint,
        target,
        message: "Set PROBE_API_KEY in the environment or .dev.vars before running selected full AI report smoke.",
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

const report = jobId ? await postJson(`${endpoint}/scan/jobs/${encodeURIComponent(jobId)}/report`, {}) : null;
const markdownReport = jobId ? await postText(`${endpoint}/scan/jobs/${encodeURIComponent(jobId)}/report.md`, {}) : null;
const summary = summarize({ created, latestPoll, report, markdownReport, jobId, startedAt });

writeSmokeResult(summary, markdownReport?.body);
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

async function postText(url, body) {
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
      content_type: response.headers.get("content-type"),
      body: await response.text(),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      content_type: null,
      body: error instanceof Error ? error.message : String(error),
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

function summarize({ created, latestPoll, report, markdownReport, jobId, startedAt }) {
  const reportBody = isRecord(report?.body) ? report.body : {};
  const artifact = isRecord(reportBody.artifact) ? reportBody.artifact : {};
  const scanPolicy = isRecord(artifact.scan_policy) ? artifact.scan_policy : {};
  const records = Array.isArray(artifact.records) ? artifact.records.filter(isRecord) : [];
  const brief = isRecord(artifact.brief) ? artifact.brief : {};
  const aiReport = isRecord(reportBody.ai_narrative_report) ? reportBody.ai_narrative_report : {};
  const providerError = isRecord(reportBody.provider_error) ? reportBody.provider_error : {};
  const markdown = typeof aiReport.markdown === "string" ? aiReport.markdown : "";
  const directMarkdown = typeof markdownReport?.body === "string" ? markdownReport.body : "";
  const sections = Array.isArray(aiReport.sections) ? aiReport.sections.filter(isRecord) : [];
  const evidenceIds = new Set(Array.isArray(brief.evidence_index) ? brief.evidence_index.map((item) => item.id).filter(Boolean) : []);
  const missingDataIds = new Set(Array.isArray(brief.missing_data) ? brief.missing_data.map((item) => item.id).filter(Boolean) : []);
  const markdownEvidenceRefs = extractBracketRefs(markdown, "E");
  const markdownMissingRefs = extractBracketRefs(markdown, "M");
  const directMarkdownEvidenceRefs = extractBracketRefs(directMarkdown, "E");
  const directMarkdownMissingRefs = extractBracketRefs(directMarkdown, "M");
  const unknownEvidenceRefs = markdownEvidenceRefs.filter((ref) => !evidenceIds.has(ref));
  const unknownMissingDataRefs = markdownMissingRefs.filter((ref) => !missingDataIds.has(ref));
  const unknownDirectMarkdownEvidenceRefs = directMarkdownEvidenceRefs.filter((ref) => !evidenceIds.has(ref));
  const unknownDirectMarkdownMissingDataRefs = directMarkdownMissingRefs.filter((ref) => !missingDataIds.has(ref));
  const markdownSectionHeadings = extractSectionHeadings(markdown);
  const directMarkdownSectionHeadings = extractSectionHeadings(directMarkdown);
  const duplicateMarkdownSectionHeadings = findDuplicateSectionHeadings(markdownSectionHeadings);
  const duplicateDirectMarkdownSectionHeadings = findDuplicateSectionHeadings(directMarkdownSectionHeadings);
  const missingMarkdownSectionHeadings = requiredAiReportSectionHeadings().filter(
    (heading) => !markdownSectionHeadings.includes(heading),
  );
  const missingDirectMarkdownSectionHeadings = requiredAiReportSectionHeadings().filter(
    (heading) => !directMarkdownSectionHeadings.includes(heading),
  );
  const providerJobs = [
    ...readProviderJobs(created.body),
    ...readProviderJobs(latestPoll?.body),
    ...readProviderJobs(reportBody),
  ];
  const evidenceChecks = summarizeEvidenceChecks(records);

  return {
    endpoint,
    target,
    sync_probes: syncProbes,
    async_providers: asyncProviders,
    strategy,
    status: summarizeStatus({
      created,
      latestPoll,
      report,
      reportBody,
      artifact,
      scanPolicy,
      aiReport,
      sections,
      records,
      providerJobs,
      evidenceChecks,
      unknownEvidenceRefs,
      unknownMissingDataRefs,
      directMarkdown,
      markdownReport,
      unknownDirectMarkdownEvidenceRefs,
      unknownDirectMarkdownMissingDataRefs,
      duplicateMarkdownSectionHeadings,
      duplicateDirectMarkdownSectionHeadings,
      missingMarkdownSectionHeadings,
      missingDirectMarkdownSectionHeadings,
      startedAt,
    }),
    elapsed_ms: Date.now() - startedAt,
    job_id: jobId,
    created: summarizeJobEnvelope(created),
    polls,
    report_http_status: report?.status ?? null,
    report_schema_version: typeof reportBody.schema_version === "string" ? reportBody.schema_version : undefined,
    report_ok: typeof reportBody.ok === "boolean" ? reportBody.ok : undefined,
    artifact_schema_version: typeof artifact.schema_version === "string" ? artifact.schema_version : undefined,
    artifact_storage_persisted: isRecord(artifact.boundaries) ? artifact.boundaries.storage_persisted : undefined,
    artifact_record_count: isRecord(artifact.run) ? artifact.run.record_count : undefined,
    artifact_scan_policy: summarizeScanPolicy(scanPolicy),
    artifact_records: summarizeRecords(records),
    evidence_checks: evidenceChecks,
    ai_report_schema_version: typeof aiReport.schema_version === "string" ? aiReport.schema_version : undefined,
    ai_report_section_count: sections.length,
    markdown_length: markdown.length,
    markdown_preview: markdown ? truncate(markdown, 800) : undefined,
    direct_markdown_http_status: markdownReport?.status ?? null,
    direct_markdown_content_type: markdownReport?.content_type ?? null,
    direct_markdown_length: directMarkdown.length,
    direct_markdown_preview: directMarkdown ? truncate(directMarkdown, 800) : undefined,
    direct_markdown_evidence_refs: directMarkdownEvidenceRefs,
    direct_markdown_missing_data_refs: directMarkdownMissingRefs,
    unknown_direct_markdown_evidence_refs: unknownDirectMarkdownEvidenceRefs,
    unknown_direct_markdown_missing_data_refs: unknownDirectMarkdownMissingDataRefs,
    direct_markdown_section_headings: directMarkdownSectionHeadings,
    missing_direct_markdown_section_headings: missingDirectMarkdownSectionHeadings,
    duplicate_direct_markdown_section_headings: duplicateDirectMarkdownSectionHeadings,
    direct_markdown_matches_json: Boolean(markdown && directMarkdown && directMarkdown === markdown),
    markdown_evidence_refs: markdownEvidenceRefs,
    markdown_missing_data_refs: markdownMissingRefs,
    unknown_evidence_refs: unknownEvidenceRefs,
    unknown_missing_data_refs: unknownMissingDataRefs,
    markdown_section_headings: markdownSectionHeadings,
    missing_markdown_section_headings: missingMarkdownSectionHeadings,
    duplicate_markdown_section_headings: duplicateMarkdownSectionHeadings,
    boundaries: isRecord(reportBody.boundaries) ? reportBody.boundaries : undefined,
    provider_error_code: typeof providerError.error_code === "string" ? providerError.error_code : undefined,
    provider_error: typeof providerError.error === "string" ? truncate(providerError.error, 300) : undefined,
    validation_errors: Array.isArray(providerError.validation_errors)
      ? providerError.validation_errors.map((value) => truncate(String(value), 500))
      : undefined,
  };
}

function summarizeStatus(input) {
  const createdOk = Boolean(
    input.created.ok &&
      isRecord(input.created.body) &&
      input.created.body.schema_version === "site-10-layer-scan-job/v0.1" &&
      input.created.body.boundaries?.storage_persisted === true,
  );
  const reportOk = Boolean(
    input.report?.ok &&
      input.reportBody.ok === true &&
      input.reportBody.schema_version === "site-10-layer-persisted-scan-ai-report/v0.1" &&
      input.artifact.schema_version === "site-10-layer-scan-export-artifact/v0.1" &&
      input.artifact.boundaries?.storage_persisted === true &&
      input.scanPolicy.schema_version === "site-10-layer-scan-policy/v0.1" &&
      input.aiReport.schema_version === "site-10-layer-ai-narrative-report-result/v0.1" &&
      input.sections.length > 0 &&
      typeof input.aiReport.markdown === "string" &&
      input.aiReport.markdown.length >= 80 &&
      input.unknownEvidenceRefs.length === 0 &&
      input.unknownMissingDataRefs.length === 0 &&
      input.missingMarkdownSectionHeadings.length === 0 &&
      input.duplicateMarkdownSectionHeadings.length === 0,
  );
  const requiredProviderJobs = asyncProviders.filter((capability) => capability !== "pagespeed");
  const requiredAsyncDone = requiredProviderJobs.every((capability) =>
    isTerminalStatus(findProviderJob(input.providerJobs, capability)?.status),
  );
  const directMarkdownOk = Boolean(
    input.markdownReport?.ok &&
      input.markdownReport.status === 200 &&
      input.markdownReport.content_type?.includes("text/markdown") &&
      input.directMarkdown.length >= 80 &&
      input.unknownDirectMarkdownEvidenceRefs.length === 0 &&
      input.unknownDirectMarkdownMissingDataRefs.length === 0 &&
      input.missingDirectMarkdownSectionHeadings.length === 0 &&
      input.duplicateDirectMarkdownSectionHeadings.length === 0,
  );

  if (!createdOk || !reportOk || !directMarkdownOk) return "failed";
  if (!requiredAsyncDone && Date.now() - input.startedAt >= timeoutMs) return "timed_out";
  if (!requiredAsyncDone) return "failed";
  if (!artifactHasSelectedFullEvidence(input.records, input.evidenceChecks)) return "failed";

  const pagespeedJob = findProviderJob(input.providerJobs, "pagespeed");
  if (pagespeedJob?.status === "failed") return "passed_with_pagespeed_provider_state";
  return "passed";
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
    provider_jobs: summarizeProviderJobs(job.provider_jobs),
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
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

function summarizeRecords(records) {
  return {
    layers: Array.from(new Set(records.map((record) => record.layer).filter((layer) => typeof layer === "number"))).sort((a, b) => a - b),
    probes: Array.from(new Set(records.map((record) => record.probe).filter((probe) => typeof probe === "string"))).sort(),
    sources: Array.from(new Set(records.map((record) => record.source).filter((source) => typeof source === "string"))).sort(),
  };
}

function summarizeScanPolicy(policy) {
  if (!isRecord(policy)) return undefined;
  return {
    schema_version: typeof policy.schema_version === "string" ? policy.schema_version : undefined,
    profile: typeof policy.profile === "string" ? policy.profile : undefined,
    authorization_basis: isRecord(policy.authorization_basis)
      ? policy.authorization_basis.basis
      : undefined,
    allowed_check_count: Array.isArray(policy.allowed_checks) ? policy.allowed_checks.length : undefined,
    denied_check_count: Array.isArray(policy.denied_checks) ? policy.denied_checks.length : undefined,
    denied_checks: Array.isArray(policy.denied_checks)
      ? policy.denied_checks
          .filter(isRecord)
          .map((check) => check.id)
          .filter((id) => typeof id === "string")
      : undefined,
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
    l2_live_tls_count: records.filter((record) => record.probe === "tls_live_certificate_probe" && record.status !== "error").length,
    l4_runtime_record_count: records.filter((record) => record.layer === 4 && isRuntimeProbe(record.probe)).length,
    l6_runtime_api_count: records.filter((record) => record.probe === "runtime_api_requests_probe").length,
    l10_runtime_security_count: records.filter((record) => record.probe === "runtime_security_events_probe").length,
  };
}

function artifactHasSelectedFullEvidence(records, checks) {
  if (!hasLayers(records, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])) return false;
  if (asyncProviders.includes("live_tls") && checks.l2_live_tls_count < 1) return false;
  if (asyncProviders.includes("lighthouse") && checks.l5_lighthouse_count < 1) return false;
  if (asyncProviders.includes("browser_runtime") && checks.l4_runtime_record_count < 1) return false;
  if (asyncProviders.includes("browser_runtime") && checks.l6_runtime_api_count < 1) return false;
  if (asyncProviders.includes("browser_runtime") && checks.l10_runtime_security_count < 1) return false;
  return true;
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
      : isRecord(body) && isRecord(body.artifact)
        ? body.artifact
        : null;
  return Array.isArray(job?.provider_jobs) ? job.provider_jobs.filter(isRecord) : [];
}

function findProviderJob(providerJobs, capability) {
  return [...providerJobs].reverse().find((job) => job.capability === capability) ?? null;
}

function readJobId(body) {
  return isRecord(body) && isRecord(body.job) && typeof body.job.id === "string" ? body.job.id : null;
}

function hasLayers(records, expectedLayers) {
  const layers = new Set(records.map((record) => record.layer));
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

function writeSmokeResult(summary, directMarkdown) {
  const dir = resolve(process.cwd(), "smoke-results");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTarget = target.replace(/^[a-z]+:\/\//i, "").replace(/[^a-z0-9.-]+/gi, "_");
  writeFileSync(resolve(dir, `persisted-selected-full-ai-report-${safeTarget}-${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  if (typeof directMarkdown === "string" && directMarkdown.length > 0) {
    writeFileSync(resolve(dir, `persisted-selected-full-ai-report-${safeTarget}-${stamp}.md`), `${directMarkdown}\n`);
  }
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

function requiredAiReportSectionHeadings() {
  return [
    "Executive Summary",
    "Public Information Architecture",
    "Technology Stack",
    "Deployment and Network Surface",
    "Request and Rendering Chain",
    "API and Protocol Surface",
    "Subdomains and Attack Surface",
    "Organization and Operations Signals",
    "Security Posture",
    "Missing Data and Next Steps",
  ];
}

function extractSectionHeadings(value) {
  return Array.from(value.matchAll(/^## ([^\n]+)$/gm)).map((match) => match[1]);
}

function findDuplicateSectionHeadings(headings) {
  const counts = new Map();
  for (const heading of headings) counts.set(heading, (counts.get(heading) ?? 0) + 1);
  return Array.from(counts)
    .filter(([, count]) => count > 1)
    .map(([heading]) => heading)
    .sort();
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

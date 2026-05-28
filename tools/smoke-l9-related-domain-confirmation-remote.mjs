#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const env = { ...process.env, ...readDevVars(resolve(process.cwd(), ".dev.vars")) };

const endpoint = trimTrailingSlash(env.L9_CONFIRMATION_SMOKE_ENDPOINT ?? "https://probe.9shi.cc/api");
const apiKey = env.PROBE_API_KEY;
const contract = createContract();

if (!apiKey) {
  console.log(
    JSON.stringify(
      {
        status: "blocked_missing_probe_api_key",
        endpoint,
        message: "Set PROBE_API_KEY in the environment or .dev.vars before running remote L9 confirmation smoke.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const response = await postJson(`${endpoint}/provider/related-domains/confirm`, { contract });
const summary = summarizeResponse(response, contract);

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
      preview: text.slice(0, 240),
    };
  }
}

function summarizeResponse(response, contract) {
  const body = isRecord(response.body) ? response.body : {};
  const result = isRecord(body.result) ? body.result : {};
  const items = Array.isArray(result.results) ? result.results.filter(isRecord) : [];
  const allowedRefs = new Set(contract.input.evidence.map((item) => item.evidence_ref));
  const citedRefs = Array.from(new Set(items.flatMap((item) => asStringArray(item.evidence_refs)))).sort();
  const unknownRefs = citedRefs.filter((ref) => !allowedRefs.has(ref));
  const missingConfig =
    body.error_code === "missing_related_domain_confirmation_provider_config" ||
    (Array.isArray(body.missing_config) && body.missing_config.length > 0);

  return {
    endpoint,
    status: summarizeStatus({ response, body, items, unknownRefs, missingConfig }),
    http_status: response.status,
    schema_version: typeof body.schema_version === "string" ? body.schema_version : undefined,
    provider: typeof body.provider === "string" ? body.provider : undefined,
    result_schema_version: typeof result.schema_version === "string" ? result.schema_version : undefined,
    invokes_provider: typeof result.invokes_provider === "boolean" ? result.invokes_provider : undefined,
    target: contract.target,
    normalized_target: contract.normalized_target,
    candidate_hosts: contract.input.evidence.flatMap((evidence) => evidence.candidates.map((candidate) => candidate.host)),
    allowed_evidence_refs: Array.from(allowedRefs).sort(),
    cited_evidence_refs: citedRefs,
    unknown_evidence_refs: unknownRefs,
    result_count: items.length,
    results: items.map((item) => ({
      candidate_host: typeof item.candidate_host === "string" ? item.candidate_host : undefined,
      relationship: typeof item.relationship === "string" ? item.relationship : undefined,
      evidence_refs: asStringArray(item.evidence_refs),
      reasoning: typeof item.reasoning === "string" ? truncate(item.reasoning, 240) : undefined,
      limitations: asStringArray(item.limitations).map((value) => truncate(value, 160)),
    })),
    missing_config: Array.isArray(body.missing_config) ? body.missing_config : undefined,
    error_code: typeof body.error_code === "string" ? body.error_code : undefined,
    error: typeof body.error === "string" ? truncate(body.error, 240) : undefined,
    validation_errors: Array.isArray(body.validation_errors) ? body.validation_errors.map(String) : undefined,
    boundary: {
      not_in_default_full_scan: true,
      relationship_evidence_only: true,
      no_ownership_claim: true,
    },
  };
}

function summarizeStatus({ response, body, items, unknownRefs, missingConfig }) {
  if (missingConfig) return "blocked_missing_provider_config";
  if (!response.ok || body.ok !== true) return "failed";
  if (unknownRefs.length > 0) return "failed";
  if (items.length === 0) return "failed";
  if (!items.every((item) => asStringArray(item.evidence_refs).length > 0)) return "failed";
  return "passed";
}

function createContract() {
  return {
    schema_version: "site-10-layer-related-domain-confirmation-contract/v0.1",
    invokes_provider: false,
    target: "https://example.com/",
    normalized_target: "example.com",
    input: {
      layer: 9,
      evidence: [
        {
          evidence_ref: "RDC001",
          layer: 9,
          probe: "organization_intelligence_probe",
          item: "organization_intelligence",
          source: "cloudflare_worker_org_intel",
          status: "ok",
          summary: "Homepage-visible related-domain candidates were found.",
          metadata: {
            origin: "worker_probe",
            method: "homepage_html_static_parse",
            role: "candidate_evidence",
            limitations: ["Homepage-visible links can point to vendors, docs, CDN, or unrelated third-party services."],
          },
          candidates: [
            {
              host: "docs.example.net",
              url: "https://docs.example.net/start",
              signal: "homepage_anchor_host",
              role: "documentation",
              source: "homepage_html",
              evidence_refs: ["RDC001"],
              evidence_items: [
                {
                  type: "homepage_html",
                  name: "href",
                  value: "https://docs.example.net/start",
                },
              ],
            },
            {
              host: "assets.example-cdn.net",
              url: "https://assets.example-cdn.net/app.js",
              signal: "homepage_resource_host",
              role: "cdn_asset",
              source: "homepage_html",
              evidence_refs: ["RDC001"],
              evidence_items: [
                {
                  type: "homepage_html",
                  name: "src",
                  value: "https://assets.example-cdn.net/app.js",
                },
              ],
            },
          ],
          evidence_items: [
            {
              type: "homepage_html",
              name: "related_domain_candidates",
              value:
                '[{"host":"docs.example.net","role":"documentation"},{"host":"assets.example-cdn.net","role":"cdn_asset"}]',
            },
          ],
          limitations: ["Homepage-visible candidates alone are weak relationship evidence and cannot prove ownership."],
        },
      ],
      instruction:
        "Evaluate whether homepage-visible related-domain candidates have additional relationship evidence. Do not infer legal ownership, operating entity identity, or business relationship from candidates alone.",
    },
    output_contract: {
      required_fields: ["candidate_host", "relationship", "reasoning", "evidence_refs", "limitations"],
      relationship_values: ["confirmed", "likely", "possible", "unconfirmed", "not_related"],
      rules: [
        "Every output item must cite one or more evidence_refs from input.evidence.",
        "Homepage-visible candidates alone should remain possible or unconfirmed unless additional evidence is supplied.",
        "Relationship output is not an ownership, legal-entity, or operating-entity claim.",
        "Absence of a candidate is not proof that no related domain exists.",
      ],
      example: {
        candidate_host: "docs.example.net",
        relationship: "possible",
        reasoning: "The candidate appears in homepage links, but no shared identifier or external confirmation is present.",
        evidence_refs: ["RDC001"],
        limitations: ["Homepage-visible links can point to vendors, partners, docs, CDN, or unrelated third-party services."],
      },
    },
  };
}

function writeSmokeResult(summary) {
  const dir = resolve(process.cwd(), "smoke-results");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(resolve(dir, `l9-related-domain-confirmation-remote-${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`);
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

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.length > 0) : [];
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

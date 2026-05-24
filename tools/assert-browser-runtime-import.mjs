#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const snapshotPath = process.argv[2] ? path.resolve(process.argv[2]) : null;

if (!snapshotPath) {
  console.error("Usage: node tools/assert-browser-runtime-import.mjs <browser-snapshot.json>");
  process.exit(1);
}

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const { normalizeImportedRecords, createImportedRun } = await server.ssrLoadModule("/src/core/model.ts");
  const raw = JSON.parse(await readFile(snapshotPath, "utf-8"));
  injectCachePolicyFixture(raw);
  const records = normalizeImportedRecords(raw);
  const run = createImportedRun(records);
  const probes = new Set(run.records.map((record) => record.probe));

  for (const probe of [
    "cdn_header_evidence_probe",
    "runtime_resource_bytes_probe",
    "runtime_api_requests_probe",
    "runtime_security_events_probe",
    "runtime_asset_cache_policy_probe",
  ]) {
    if (!probes.has(probe)) {
      throw new Error(`Imported run is missing ${probe}.`);
    }
  }

  const cdnHeaderRecord = run.records.find((record) => record.probe === "cdn_header_evidence_probe");
  if (cdnHeaderRecord?.layer !== 1) {
    throw new Error("cdn_header_evidence_probe must be a Layer 1 record.");
  }

  if (!cdnHeaderRecord?.value || typeof cdnHeaderRecord.value !== "object" || !("header_signals" in cdnHeaderRecord.value)) {
    throw new Error("cdn_header_evidence_probe is missing header_signals.");
  }

  const assetCacheRecord = run.records.find((record) => record.probe === "runtime_asset_cache_policy_probe");
  if (!assetCacheRecord?.value || typeof assetCacheRecord.value !== "object") {
    throw new Error("runtime_asset_cache_policy_probe has no value object.");
  }

  if (!("known_policy_count" in assetCacheRecord.value) || !("unknown_policy_count" in assetCacheRecord.value)) {
    throw new Error("runtime_asset_cache_policy_probe is missing known/unknown policy counts.");
  }

  console.log(`Browser runtime import check passed: ${snapshotPath}`);
} finally {
  await server.close();
}

function injectCachePolicyFixture(records) {
  const browserRecord = Array.isArray(records) ? records.find((record) => record?.probe === "browser_page_probe") : null;
  const resources = browserRecord?.value?.resources;

  if (!Array.isArray(resources)) {
    return;
  }

  const finalUrl = browserRecord.value.final_url ?? "https://example.com/";
  const origin = new URL(finalUrl).origin;

  resources.push(
    {
      request_id: "fixture_cache_script",
      url: `${origin}/assets/app.12345678.js`,
      method: "GET",
      resource_type: "script",
      status_code: 200,
      failure: null,
      domain: new URL(origin).hostname,
      same_origin: true,
      content_type: "application/javascript",
      cache_control: "public, max-age=31536000, immutable",
      cdn_headers: {
        "cf-ray": "fixture-cloudflare-ray",
        "cf-cache-status": "HIT",
        server: "cloudflare",
      },
      transfer_size: 1200,
      encoded_body_size: 1000,
      decoded_body_size: 3000,
      duration_ms: 12,
      start_time_ms: 20,
      timing_source: "performance_resource_timing",
    },
    {
      request_id: "fixture_cache_style",
      url: `${origin}/assets/site.css`,
      method: "GET",
      resource_type: "stylesheet",
      status_code: 200,
      failure: null,
      domain: new URL(origin).hostname,
      same_origin: true,
      content_type: "text/css",
      cache_control: "no-cache",
      cdn_headers: {},
      transfer_size: 500,
      encoded_body_size: 400,
      decoded_body_size: 800,
      duration_ms: 8,
      start_time_ms: 30,
      timing_source: "performance_resource_timing",
    },
  );
}

#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

class FakeKvNamespace {
  #values = new Map();

  async get(key) {
    return this.#values.get(key) ?? null;
  }

  async put(key, value) {
    this.#values.set(key, value);
  }

  async delete(key) {
    this.#values.delete(key);
  }
}

const originalFetch = globalThis.fetch;
let dispatchPayload = null;

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");
  const env = {
    ALLOW_LOCAL_DEV_NO_AUTH: "true",
    SCAN_JOB_KV: new FakeKvNamespace(),
    SCAN_JOB_TTL_SECONDS: "3600",
    GITHUB_TOKEN: "fixture-github-token",
    GITHUB_OWNER: "aotushi",
    GITHUB_REPO: "02-browser-runtime-remote-git",
    GITHUB_BROWSER_RUNTIME_WORKFLOW: "site-10-layer-check-browser.yml",
    GITHUB_REF: "main",
  };

  globalThis.fetch = async (request, init = {}) => {
    const url = String(request);

    if (url.endsWith("/actions/workflows/site-10-layer-check-browser.yml/dispatches")) {
      dispatchPayload = JSON.parse(String(init.body));
      return new Response(null, { status: 204 });
    }

    if (url.includes("/actions/workflows/site-10-layer-check-browser.yml/runs?")) {
      const requestId = dispatchPayload?.inputs?.request_id ?? "fixture-request";
      return jsonResponse({
        workflow_runs: [
          {
            id: 987654,
            name: "Browser runtime check",
            display_title: `Browser runtime ${requestId}`,
            status: "in_progress",
            conclusion: null,
            html_url: "https://github.com/aotushi/02-browser-runtime-remote-git/actions/runs/987654",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });
    }

    if (url.endsWith("/actions/runs/987654")) {
      return jsonResponse({
        id: 987654,
        name: "Browser runtime check",
        display_title: `Browser runtime ${dispatchPayload?.inputs?.request_id ?? "fixture-request"}`,
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/aotushi/02-browser-runtime-remote-git/actions/runs/987654",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    if (url.endsWith("/actions/runs/987654/artifacts")) {
      return jsonResponse({
        artifacts: [
          {
            id: 444,
            name: `site-10-layer-check-browser-${dispatchPayload?.inputs?.request_id ?? "fixture-request"}`,
            archive_download_url: "https://api.github.com/artifacts/444/zip",
            expired: false,
          },
        ],
      });
    }

    if (url.endsWith("/actions/artifacts/444/zip")) {
      return new Response(createStoredZip({
        "snapshots/example.com-browser.json": JSON.stringify([createBrowserRuntimeRecord()], null, 2),
      }), {
        status: 200,
        headers: { "content-type": "application/zip" },
      });
    }

    throw new Error(`Unexpected fetch in browser runtime persisted L10 check: ${url}`);
  };

  const start = await request(worker, "POST", "http://worker.local/scan/jobs", {
    target: "https://example.com",
    sync_probes: [],
    async_providers: ["browser_runtime"],
  }, env);
  assert.equal(start.status, 200);
  assert.equal(start.body.boundaries.storage_persisted, true);
  assert.equal(start.body.job.status, "async_pending");
  assert.equal(start.body.job.provider_jobs[0].capability, "browser_runtime");
  assert.equal(start.body.job.provider_jobs[0].status, "running");
  assert.ok(!start.body.job.records.some((record) => record.probe === "runtime_security_events_probe"));

  const poll = await request(worker, "POST", `http://worker.local/scan/jobs/${start.body.job.id}/poll`, {}, env);
  assert.equal(poll.status, 200);
  assert.equal(poll.body.job.status, "completed");
  assert.equal(poll.body.job.provider_jobs[0].status, "completed");
  assert.equal(poll.body.poll.checked_provider_jobs[0].result_collected, true);
  assert.ok(
    poll.body.job.records.some((record) => record.layer === 10 && record.probe === "runtime_security_events_probe"),
    "Polling a completed browser runtime job must merge L10 runtime security events into the persisted job records.",
  );

  const artifact = await request(worker, "GET", `http://worker.local/scan/jobs/${start.body.job.id}/artifact`, null, env);
  assert.equal(artifact.status, 200);
  assert.equal(artifact.body.schema_version, "site-10-layer-scan-export-artifact/v0.1");
  assert.equal(artifact.body.boundaries.storage_persisted, true);
  assert.ok(
    artifact.body.records.some((record) => record.layer === 10 && record.probe === "runtime_security_events_probe"),
    "Persisted artifact must include L10 runtime security events from completed browser runtime artifacts.",
  );
  assert.ok(artifact.body.analysis.layer_summaries.some((layer) => layer.layer === 10));
  assert.ok(artifact.body.brief.layers.some((layer) => layer.layer === 10));
  assert.match(artifact.body.markdown.analysis, /runtime_security_events_probe/);

  console.log("browser runtime persisted L10 check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

async function request(worker, method, url, body, env) {
  const response = await worker.default.fetch(
    new Request(url, {
      method,
      headers: body === null ? {} : { "content-type": "application/json" },
      body: body === null ? null : JSON.stringify(body),
    }),
    env,
  );
  return {
    status: response.status,
    body: await response.json(),
  };
}

function createBrowserRuntimeRecord() {
  return {
    target: "https://example.com",
    normalized_target: "example.com",
    snapshot_at: "2026-05-22T00:00:00.000Z",
    probe: "browser_page_probe",
    layer: 4,
    item: "browser_runtime",
    probe_type: "browser_runtime",
    source: "github-actions-browser",
    status: "ok",
    value: {
      final_url: "https://example.com/",
      status_code: 200,
      title: "Example",
      html_bytes: 2048,
      visible_text_bytes: 256,
      resource_counts: {
        document: 1,
        script: 1,
        fetch: 1,
      },
      resources: [
        {
          request_id: "document",
          url: "https://example.com/",
          method: "GET",
          resource_type: "document",
          status_code: 200,
          failure: null,
          domain: "example.com",
          same_origin: true,
          content_type: "text/html",
          cache_control: "max-age=60",
          cdn_headers: {},
          transfer_size: 1200,
          encoded_body_size: 900,
          decoded_body_size: 2048,
          duration_ms: 40,
          start_time_ms: 0,
          timing_source: "performance_resource_timing",
        },
        {
          request_id: "mixed-script",
          url: "http://example.com/insecure.js",
          method: "GET",
          resource_type: "script",
          status_code: null,
          failure: "net::ERR_BLOCKED_BY_CLIENT",
          domain: "example.com",
          same_origin: false,
          content_type: null,
          cache_control: null,
          cdn_headers: {},
          transfer_size: null,
          encoded_body_size: null,
          decoded_body_size: null,
          duration_ms: 5,
          start_time_ms: 45,
          timing_source: "performance_resource_timing",
        },
      ],
      console_messages: [
        {
          type: "error",
          text: "Mixed Content: The page was loaded over HTTPS but requested an insecure script.",
          location: "https://example.com/",
        },
      ],
      page_errors: ["ReferenceError: fixture is not defined"],
      runtime_security: {
        mixed_content_candidates: [
          {
            url: "http://example.com/insecure.js",
            resource_type: "script",
            reason: "HTTP resource observed from an HTTPS page.",
          },
        ],
        failed_request_count: 1,
        console_error_count: 1,
        page_error_count: 1,
      },
      screenshot_path: null,
      access_barrier: {
        detected: false,
        types: [],
        title: "Example",
        visible_text_sample: "Example",
      },
    },
    risk: { level: "info", summary: "Fixture browser runtime record." },
    evidence: [{ type: "fixture", name: "browser_runtime", value: "record" }],
    browser: {
      provider: "github-actions-browser",
      headed: false,
      wait_ms: 0,
      timeout_ms: 30000,
    },
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createStoredZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.byteLength, true);
    local.setUint32(22, data.byteLength, true);
    local.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0, true);
    central.setUint16(10, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.byteLength, true);
    central.setUint32(24, data.byteLength, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.byteLength + data.byteLength;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, Object.keys(files).length, true);
  endView.setUint16(10, Object.keys(files).length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return concatBytes([...localParts, ...centralParts, end]);
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

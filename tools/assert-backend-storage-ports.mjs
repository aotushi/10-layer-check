#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const {
    InMemoryScanArtifactStore,
    InMemoryScanJobStore,
    createPersistedScanJobMeta,
    createStorageNotConfiguredResponse,
    redactSensitiveHeaders,
  } = await server.ssrLoadModule("/src/scan/storage.ts");

  const now = new Date("2026-05-22T00:00:00.000Z");
  const job = createScanJobFixture();
  const meta = createPersistedScanJobMeta({
    job,
    rawRef: "raw/scan-job-fixture.json",
    artifactRef: "artifacts/scan-job-fixture.json",
    ttlSeconds: 60,
    now,
  });

  assert.equal(meta.schema_version, "site-10-layer-persisted-scan-job-meta/v0.1");
  assert.equal(meta.id, job.id);
  assert.equal(meta.ttl_expires_at, "2026-05-22T00:01:00.000Z");

  const jobStore = new InMemoryScanJobStore({ now: () => now });
  await jobStore.putJobMeta(meta);
  assert.deepEqual(await jobStore.getJobMeta(job.id), meta);

  const expiredStore = new InMemoryScanJobStore({ now: () => new Date("2026-05-22T00:02:00.000Z") });
  await expiredStore.putJobMeta(meta);
  assert.equal(await expiredStore.getJobMeta(job.id), null);

  const artifactStore = new InMemoryScanArtifactStore({ maxObjectBytes: 10_000 });
  await artifactStore.putRawEnvelope("raw/scan-job-fixture.json", {
    headers: {
      authorization: "Bearer secret",
      "set-cookie": "session=secret",
      server: "fixture",
    },
  });
  const rawEnvelope = await artifactStore.getRawEnvelope("raw/scan-job-fixture.json");
  assert.equal(rawEnvelope.headers.authorization, "[redacted]");
  assert.equal(rawEnvelope.headers["set-cookie"], "[redacted]");
  assert.equal(rawEnvelope.headers.server, "fixture");

  await artifactStore.putArtifact("artifacts/scan-job-fixture.json", createArtifactFixture(job));
  const artifact = await artifactStore.getArtifact("artifacts/scan-job-fixture.json");
  assert.equal(artifact.schema_version, "site-10-layer-scan-export-artifact/v0.1");

  await assert.rejects(
    () => new InMemoryScanArtifactStore({ maxObjectBytes: 20 }).putRawEnvelope("oversized", { text: "x".repeat(100) }),
    /maxObjectBytes/,
  );

  assert.deepEqual(createStorageNotConfiguredResponse("job_store"), {
    ok: false,
    schema_version: "site-10-layer-storage-status/v0.1",
    error_code: "storage_not_configured",
    error: "job_store is not configured for persisted scan jobs.",
    resource: "job_store",
  });

  const nested = redactSensitiveHeaders({
    headers: {
      cookie: "secret",
      nested: { "x-api-key": "secret" },
    },
  });
  assert.equal(nested.headers.cookie, "[redacted]");
  assert.equal(nested.headers.nested["x-api-key"], "[redacted]");

  console.log("backend storage ports check passed.");
} finally {
  await server.close();
}

function createScanJobFixture() {
  return {
    id: "scan_fixture",
    target: "https://example.com/",
    normalized_target: "example.com",
    status: "completed",
    requested_sync_probes: ["remote_fetch"],
    requested_async_providers: [],
    provider_jobs: [],
    records: [],
    artifact_ref: "artifacts/scan-job-fixture.json",
    error: null,
    created_at: "2026-05-22T00:00:00.000Z",
    updated_at: "2026-05-22T00:00:00.000Z",
    completed_at: "2026-05-22T00:00:00.000Z",
    raw_inputs: {
      scan_start_envelope: { schema_version: "site-10-layer-scan-start/v0.1" },
      async_result_envelopes: {},
    },
    providers: [],
  };
}

function createArtifactFixture(job) {
  return {
    schema_version: "site-10-layer-scan-export-artifact/v0.1",
    id: job.id,
    target: job.target,
    normalized_target: job.normalized_target,
    created_at: job.created_at,
    generated_at: job.updated_at,
    source: "provider",
    providers: [],
    raw_inputs: {
      scan_start_envelope: job.raw_inputs.scan_start_envelope,
      async_result_envelopes: {},
    },
    records: [],
    analysis: { schema_version: "fixture", target: job.target },
    report_brief: { schema_version: "fixture", target: job.target },
    markdown: {
      analysis: "# Fixture",
      narrative: "# Site Narrative Report",
    },
    boundaries: {
      invokes_ai_provider: false,
      storage_persisted: false,
      frontend_state_mutated: false,
    },
  };
}

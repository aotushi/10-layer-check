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

try {
  const { createDefaultScanPolicy } = await server.ssrLoadModule("/src/scan/policy.ts");
  const { createScanJobFromStartEnvelope, createScanJobArtifact } = await server.ssrLoadModule("/src/scan/job.ts");
  const { createPersistedScanJobMeta } = await server.ssrLoadModule("/src/scan/storage.ts");
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");

  const policy = createDefaultScanPolicy({
    target: "https://example.com/",
    normalizedTarget: "example.com",
    requestedSyncProbes: ["remote_fetch", "public_host_fingerprint"],
    requestedAsyncProviders: ["browser_runtime"],
    createdAt: "2026-05-23T00:00:00.000Z",
  });

  assertPolicyShape(policy);
  assert.ok(policy.allowed_checks.some((check) => check.id === "remote_fetch"));
  assert.ok(policy.allowed_checks.some((check) => check.id === "public_host_fingerprint"));
  assert.ok(policy.allowed_checks.some((check) => check.id === "browser_runtime"));
  assert.ok(policy.allowed_checks.some((check) => check.id === "bounded_cors_header_validation"));
  assert.ok(policy.allowed_checks.some((check) => check.id === "bounded_public_api_error_surface"));
  assert.ok(policy.allowed_checks.some((check) => check.id === "bounded_public_cms_metadata"));
  assert.ok(policy.denied_checks.some((check) => check.id === "wordpress_user_enumeration"));
  assert.ok(policy.denied_checks.some((check) => check.id === "deep_port_service_inventory"));

  const scanStartEnvelope = createScanStartEnvelope(policy);
  const job = createScanJobFromStartEnvelope({
    id: "scan-policy-fixture",
    target: "https://example.com/",
    normalizedTarget: "example.com",
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:01.000Z",
    providers: [],
    scanStartEnvelope,
  });
  assertPolicyShape(job.scan_policy);
  assert.deepEqual(job.scan_policy, policy);

  const meta = createPersistedScanJobMeta({
    job,
    rawRef: "scan-jobs/raw/scan-policy-fixture.json",
    artifactRef: null,
    ttlSeconds: 3600,
    now: new Date("2026-05-23T00:00:00.000Z"),
  });
  assertPolicyShape(meta.scan_policy);
  assert.deepEqual(meta.scan_policy.denied_checks, policy.denied_checks);

  const artifact = createScanJobArtifact(job, {
    generatedAt: "2026-05-23T00:00:02.000Z",
    source: "provider",
  });
  assertPolicyShape(artifact.scan_policy);
  assert.deepEqual(artifact.scan_policy, policy);

  await assertPersistedRoutesExposePolicy(worker);

  console.log("scan policy contract check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

async function assertPersistedRoutesExposePolicy(worker) {
  globalThis.fetch = async (request) => {
    const url = String(request);

    if (url === "https://example.com/") {
      return new Response("<!doctype html><title>Example</title>", {
        status: 200,
        headers: { "content-type": "text/html", server: "example" },
      });
    }

    if (url === "https://example.com/robots.txt" || url === "https://example.com/sitemap.xml") {
      return new Response("", { status: 404 });
    }

    throw new Error(`Unexpected fetch in scan policy contract check: ${url}`);
  };

  const env = {
    ALLOW_LOCAL_DEV_NO_AUTH: "true",
    SCAN_JOB_KV: new FakeKvNamespace(),
    SCAN_JOB_TTL_SECONDS: "3600",
  };

  const created = await request(worker, "POST", "http://worker.local/scan/jobs", {
    target: "https://example.com",
    sync_probes: ["remote_fetch"],
    async_providers: [],
  }, env);
  assert.equal(created.status, 200);
  assertPolicyShape(created.body.job.scan_policy);
  assert.equal(created.body.job.scan_policy.audit_metadata.requested_sync_probes[0], "remote_fetch");

  const read = await request(worker, "GET", `http://worker.local/scan/jobs/${created.body.job.id}`, null, env);
  assert.equal(read.status, 200);
  assertPolicyShape(read.body.meta.scan_policy);
  assert.equal(read.body.meta.scan_policy.scope_policy.normalized_target, "example.com");

  const artifact = await request(worker, "GET", `http://worker.local/scan/jobs/${created.body.job.id}/artifact`, null, env);
  assert.equal(artifact.status, 200);
  assertPolicyShape(artifact.body.scan_policy);
  assert.ok(artifact.body.scan_policy.allowed_checks.some((check) => check.id === "bounded_public_api_error_surface"));
  assert.ok(artifact.body.scan_policy.denied_checks.some((check) => check.id === "wordpress_user_enumeration"));
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

function assertPolicyShape(policy) {
  assert.equal(policy.schema_version, "site-10-layer-scan-policy/v0.1");
  assert.equal(policy.profile, "public_default");
  assert.equal(policy.authorization_basis.basis, "user_submitted_target");
  assert.equal(policy.authorization_basis.permissioned_checks_require_explicit_policy, false);
  assert.equal(policy.scope_policy.public_subdomains, "bounded_public_evidence_only");
  assert.equal(policy.scope_policy.authenticated_routes, "not_used_by_default");
  assert.equal(policy.scope_policy.credentialed_requests, "not_used_by_default");
  assert.ok(Array.isArray(policy.allowed_checks));
  assert.ok(Array.isArray(policy.denied_checks));
  assert.equal(typeof policy.limits.max_redirects, "number");
  assert.equal(typeof policy.limits.max_public_host_candidates, "number");
  assert.equal(typeof policy.limits.max_requests_per_public_host, "number");
  assert.equal(typeof policy.limits.max_public_host_concurrency, "number");
  assert.equal(policy.audit_metadata.generated_by, "cloudflare_worker_site_scan");
  assert.equal(policy.audit_metadata.policy_source, "backend_default");
}

function createScanStartEnvelope(policy) {
  return {
    schema_version: "site-10-layer-scan-start/v0.1",
    provider: "cloudflare_worker_site_scan",
    requested_url: "https://example.com/",
    normalized_url: "https://example.com/",
    normalized_target: "example.com",
    status: "ok",
    sync_probes: ["remote_fetch", "public_host_fingerprint"],
    async_providers: ["browser_runtime"],
    scan_policy: policy,
    sync_results: {
      remote_fetch: {
        status: "fulfilled",
        result: {
          requested_url: "https://example.com/",
          final_url: "https://example.com/",
          status_code: 200,
          ok: true,
          redirected: false,
          redirect_chain: [],
          headers: { "content-type": "text/html", server: "example" },
          html: "<!doctype html><title>Example</title>",
          duration_ms: 10,
          provider_id: "cloudflare_worker_fetch",
          source: "cloudflare_worker_fetch",
        },
      },
    },
    async_jobs: [
      {
        capability: "browser_runtime",
        provider: "github_actions_browser_runtime",
        provider_schema_version: null,
        request_id: "browser-fixture",
        run_id: 123,
        status: "queued",
        status_code: 204,
        conclusion: null,
        html_url: "https://github.example/runs/123",
        endpoints: { status: "/status", result: "/result" },
      },
    ],
    coverage: {
      collected: ["remote_fetch"],
      pending: ["browser_runtime"],
      failed: [],
      limitations: ["Fixture scan start envelope."],
    },
  };
}

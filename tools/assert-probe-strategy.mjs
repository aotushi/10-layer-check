// @ts-check
import assert from "node:assert/strict";
import {
  inferSiteTypeHints,
  selectTargetedProbes,
  createProbeStrategy,
  createProbeOptions,
  FAST_PROBES,
} from "../src/scan/probe-strategy.ts";

// ─── inferSiteTypeHints ───────────────────────────────────────────────────────

{
  // Next.js SPA 检测（HTML 超过 200 字符以触发 high confidence）
  const nextHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>App</title></head><body><div id="__next"><div>Loading...</div></div><script id="__NEXT_DATA__" type="application/json">{"props":{},"page":"/"}</script></body></html>';
  const hints = inferSiteTypeHints({
    service_fingerprint: null,
    remote_fetch: { html: nextHtml, content_type: "text/html" },
  });
  assert.equal(hints.is_spa, true, "Next.js __NEXT_DATA__ => is_spa");
  assert.equal(hints.is_static, false, "SPA is not static");
  assert.equal(hints.confidence, "high", "HTML > 200 chars => high confidence");
}

{
  // WordPress 检测
  const hints = inferSiteTypeHints({
    service_fingerprint: {
      checked_hosts: [{ host: "example.com", service_hints: [{ label: "WordPress 6.5", category: "framework" }] }],
    },
    remote_fetch: { html: '<link rel="stylesheet" href="/wp-content/themes/...">', content_type: "text/html" },
  });
  assert.equal(hints.is_cms, "wordpress", "WordPress label => is_cms=wordpress");
  assert.equal(hints.is_spa, false, "WordPress is not SPA");
  assert.equal(hints.is_static, false, "WordPress is not static");
}

{
  // 纯静态站点（无任何框架信号）
  const hints = inferSiteTypeHints({
    service_fingerprint: { checked_hosts: [] },
    remote_fetch: { html: "<html><body>Hello</body></html>", content_type: "text/html" },
  });
  assert.equal(hints.is_static, true, "No signals => is_static");
  assert.equal(hints.is_spa, false);
  assert.equal(hints.is_cms, null);
  assert.equal(hints.confidence, "high", "HTML present => high confidence");
}

{
  // 低置信度（无 HTML）
  const hints = inferSiteTypeHints({
    service_fingerprint: null,
    remote_fetch: null,
  });
  assert.equal(hints.confidence, "low", "No data => low confidence");
}

// ─── selectTargetedProbes ─────────────────────────────────────────────────────

{
  // 静态站点应跳过 public_spa_metadata 和 api_reachability
  const allProbes = [
    ...FAST_PROBES,
    "tls_certificate",
    "public_spa_metadata",
    "api_reachability",
    "public_content_surface",
  ];
  const staticHints = {
    is_spa: false, is_cms: null, is_api_service: false, is_static: true, confidence: "high",
  };
  const { run, skipped } = selectTargetedProbes(staticHints, allProbes);
  assert.ok(skipped.includes("public_spa_metadata"), "Static site => skip public_spa_metadata");
  assert.ok(skipped.includes("api_reachability"), "Static site => skip api_reachability");
  assert.ok(run.includes("tls_certificate"), "tls_certificate always runs");
  assert.ok(run.includes("public_content_surface"), "public_content_surface always runs");
}

{
  // SPA 站点不应跳过任何探针
  const allProbes = [...FAST_PROBES, "public_spa_metadata", "api_reachability"];
  const spaHints = {
    is_spa: true, is_cms: null, is_api_service: false, is_static: false, confidence: "high",
  };
  const { skipped } = selectTargetedProbes(spaHints, allProbes);
  assert.equal(skipped.length, 0, "SPA site => no probes skipped");
}

{
  // 低置信度时不应跳过任何探针
  const allProbes = [...FAST_PROBES, "public_spa_metadata", "api_reachability"];
  const lowConfHints = {
    is_spa: false, is_cms: null, is_api_service: false, is_static: true, confidence: "low",
  };
  const { skipped } = selectTargetedProbes(lowConfHints, allProbes);
  assert.equal(skipped.length, 0, "Low confidence => no probes skipped");
}

// ─── createProbeStrategy ──────────────────────────────────────────────────────

{
  const hints = { is_spa: true, is_cms: null, is_api_service: false, is_static: false, confidence: "high" };
  const strategy = createProbeStrategy(hints, ["dns_infrastructure", "service_fingerprint"], ["public_spa_metadata"]);
  assert.equal(strategy.schema_version, "site-10-layer-probe-strategy/v0.1");
  const runEntry = strategy.probe_manifest.find((e) => e.probe === "dns_infrastructure");
  assert.equal(runEntry?.status, "run");
  const skippedEntry = strategy.probe_manifest.find((e) => e.probe === "public_spa_metadata");
  assert.equal(skippedEntry?.status, "skipped");
  assert.ok(skippedEntry?.reason.includes("SPA"), "Skipped reason mentions SPA");
}

// ─── createProbeOptions ───────────────────────────────────────────────────────

{
  // 静态站 → api_paths 为空数组
  const opts = createProbeOptions({
    is_spa: false, is_cms: null, is_api_service: false, is_static: true, confidence: "high",
  });
  assert.deepEqual(opts.public_security_details?.api_paths, [], "Static site => empty api_paths");
}

{
  // SPA（非 API）→ 只检查 /health
  const opts = createProbeOptions({
    is_spa: true, is_cms: null, is_api_service: false, is_static: false, confidence: "high",
  });
  assert.deepEqual(opts.public_security_details?.api_paths, ["/health"], "SPA => [/health]");
}

{
  // API 服务 → 包含 /v1/models
  const opts = createProbeOptions({
    is_spa: false, is_cms: null, is_api_service: true, is_static: false, confidence: "high",
  });
  assert.ok(opts.public_security_details?.api_paths?.includes("/v1/models"), "API service => includes /v1/models");
}

{
  // 低置信度 → 不覆盖任何选项
  const opts = createProbeOptions({
    is_spa: false, is_cms: null, is_api_service: false, is_static: true, confidence: "low",
  });
  assert.deepEqual(opts, {}, "Low confidence => no overrides");
}

console.log("✅ assert-probe-strategy: all assertions passed");

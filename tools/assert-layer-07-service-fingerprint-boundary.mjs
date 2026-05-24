#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const spec = await readFile(new URL("../specs/layer-07-service-fingerprint-boundary.md", import.meta.url), "utf8");
const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
const rootReadme = await readFile(new URL("../../README.md", import.meta.url), "utf8");
const stageReadme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const acceptanceSpec = await readFile(new URL("../../specs/10-layer-acceptance-spec.md", import.meta.url), "utf8");
const taskConsole = await readFile(new URL("../../../../../.scratch/10-layer-site-check/task.md", import.meta.url), "utf8");

const requiredSpecTokens = [
  "Allowed Default Signals",
  "Forbidden Default Behavior",
  "TCP or UDP port scanning",
  "Rate Limits",
  "max_hosts",
  "max_concurrency",
  "Runtime Placement",
  "service_fingerprint_probe",
  "requires_permission",
  "add_provider",
  "Do not use this record to claim",
];

for (const token of requiredSpecTokens) {
  if (!spec.includes(token)) {
    throw new Error(`Layer 7 boundary spec is missing required token: ${token}`);
  }
}

if (!packageJson.includes("check:layer-07-service-fingerprint-boundary")) {
  throw new Error("package.json should register check:layer-07-service-fingerprint-boundary.");
}

const references = [
  ["root README", rootReadme],
  ["03 README", stageReadme],
  ["acceptance spec", acceptanceSpec],
  ["task console", taskConsole],
];

for (const [label, source] of references) {
  if (!source.includes("layer-07-service-fingerprint-boundary.md")) {
    throw new Error(`${label} should reference layer-07-service-fingerprint-boundary.md.`);
  }
}

console.log("Layer 7 service fingerprint boundary check passed.");

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const spec = readFileSync(resolve(root, "specs/backend-persisted-job-store.md"), "utf8");
const signedSpec = readFileSync(resolve(root, "specs/backend-signed-job-handle.md"), "utf8");
const storageSpec = readFileSync(resolve(root, "specs/backend-storage-job-handle.md"), "utf8");
const rootReadme = readFileSync(resolve(root, "../README.md"), "utf8");
const stageReadme = readFileSync(resolve(root, "README.md"), "utf8");
const task = readFileSync(resolve(root, "../../../../.scratch/10-layer-site-check/task.md"), "utf8");

for (const required of [
  "# Backend Persisted Job Store Spec",
  "KV for job index / status metadata",
  "R2 for larger raw envelopes and final scan export artifacts",
  "D1 only after login/history/query requirements",
  "`/scan/jobs/:id`",
  "storage_not_configured",
  "SCAN_JOB_KV",
  "SCAN_ARTIFACT_BUCKET",
  "authorization",
  "set-cookie",
  "Local Verification First",
  "No remote D1 operation may be executed without explicit user approval.",
  "ScanJobStore",
  "ScanArtifactStore",
]) {
  assertIncludes("persisted job store spec", spec, required);
}

for (const [label, text] of [
  ["signed job handle spec", signedSpec],
  ["storage/job-handle spec", storageSpec],
  ["root README", rootReadme],
  ["03 README", stageReadme],
  ["task console", task],
]) {
  assertIncludes(label, text, "backend-persisted-job-store.md");
}

console.log("backend persisted job store spec check passed.");

function assertIncludes(label, text, needle) {
  if (!text.includes(needle)) {
    throw new Error(`${label} must include: ${needle}`);
  }
}

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const spec = readFileSync(resolve(root, "specs/backend-signed-job-handle.md"), "utf8");
const storageSpec = readFileSync(resolve(root, "specs/backend-storage-job-handle.md"), "utf8");
const scanJobSpec = readFileSync(resolve(root, "specs/backend-scan-job-v2.md"), "utf8");
const rootReadme = readFileSync(resolve(root, "../README.md"), "utf8");
const stageReadme = readFileSync(resolve(root, "README.md"), "utf8");
const task = readFileSync(resolve(root, "../../../../.scratch/10-layer-site-check/task.md"), "utf8");

for (const required of [
  "# Backend Signed Job Handle Spec",
  "Signed handles are useful for tamper-resistant caller-owned state",
  "do not by themselves support id-based `GET /scan/jobs/:id` recovery",
  "SCAN_JOB_HANDLE_SECRET",
  "SCAN_JOB_HANDLE_KID",
  "SCAN_JOB_HANDLE_TTL_SECONDS",
  "site-10-layer-signed-job-handle/v0.1",
  "HMAC-SHA-256",
  "expires_at",
  "never include secrets",
  "Keep `GET /scan/jobs/:id` blocked",
  "No remote D1 operation may be executed without explicit user approval.",
]) {
  assertIncludes("signed job handle spec", spec, required);
}

for (const [label, text] of [
  ["storage/job-handle spec", storageSpec],
  ["backend scan job v2 spec", scanJobSpec],
  ["root README", rootReadme],
  ["03 README", stageReadme],
  ["task console", task],
]) {
  assertIncludes(label, text, "backend-signed-job-handle.md");
}

console.log("backend signed job handle spec check passed.");

function assertIncludes(label, text, needle) {
  if (!text.includes(needle)) {
    throw new Error(`${label} must include: ${needle}`);
  }
}

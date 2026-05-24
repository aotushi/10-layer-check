#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const spec = readFileSync(resolve(root, "specs/backend-storage-job-handle.md"), "utf8");
const jobSpec = readFileSync(resolve(root, "specs/backend-scan-job-v2.md"), "utf8");
const rootReadme = readFileSync(resolve(root, "../README.md"), "utf8");
const task = readFileSync(resolve(root, "../../../../.scratch/10-layer-site-check/task.md"), "utf8");

for (const required of [
  "# Backend Storage / Job Handle Spec",
  "Caller-owned state",
  "Signed job token",
  "KV/R2 job store",
  "D1 job store",
  "V2.1 no-storage caller-owned state",
  "V2.2 persisted job store",
  "POST /scan/jobs/collect",
  "POST /scan/jobs/artifact",
  "GET /scan/jobs/:id",
  "No remote D1 operation may be executed without explicit user approval.",
]) {
  assertIncludes("storage/job-handle spec", spec, required);
}

assertIncludes("backend scan job v2 spec", jobSpec, "backend-storage-job-handle.md");
assertIncludes("root README", rootReadme, "[x] 定义 storage/job-handle spec");
assertIncludes("task console", task, "Backend Storage / Job Handle Spec");

console.log("backend storage/job-handle spec check passed.");

function assertIncludes(label, text, needle) {
  if (!text.includes(needle)) {
    throw new Error(`${label} must include: ${needle}`);
  }
}

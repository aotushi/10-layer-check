#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const spec = readFileSync(resolve(root, "specs/backend-scan-job-v2.md"), "utf8");
const rootReadme = readFileSync(resolve(root, "../README.md"), "utf8");
const task = readFileSync(resolve(root, "../../../../.scratch/10-layer-site-check/task.md"), "utf8");

for (const required of [
  "## Follow-up Endpoint Decision",
  "Decision: do not implement no-storage follow-up endpoints yet.",
  "GET /scan/jobs/:id",
  "POST /scan/jobs/:id/collect",
  "POST /scan/jobs/:id/cancel",
  "GET /scan/jobs/:id/artifact",
  "requires a recoverable job handle",
  "storage/job-handle spec",
]) {
  assertIncludes("backend scan job v2 spec", spec, required);
}

assertIncludes("root README", rootReadme, "[x] 审阅 V2 follow-up endpoints");
assertIncludes("root README", rootReadme, "默认不实现 `GET /scan/jobs/:id` / collect / cancel / artifact");
assertIncludes("task console", task, "follow-up endpoints decision");
assertIncludes("task console", task, "storage/job-handle spec");

console.log("backend scan job v2 follow-up decision check passed.");

function assertIncludes(label, text, needle) {
  if (!text.includes(needle)) {
    throw new Error(`${label} must include: ${needle}`);
  }
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const specPath = resolve(root, "specs/backend-scan-job-v2.md");
const readmePath = resolve(root, "README.md");
const rootReadmePath = resolve(root, "../README.md");
const acceptanceSpecPath = resolve(root, "../specs/10-layer-acceptance-spec.md");
const taskPath = resolve(root, "../../../../.scratch/10-layer-site-check/task.md");

const files = [
  ["backend scan job v2 spec", specPath],
  ["03 README", readmePath],
  ["root README", rootReadmePath],
  ["10-layer acceptance spec", acceptanceSpecPath],
  ["task console", taskPath],
];

function readRequired(label, path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

const contents = Object.fromEntries(files.map(([label, path]) => [label, readRequired(label, path)]));

function assertIncludes(label, text, needle) {
  if (!text.includes(needle)) {
    throw new Error(`${label} must include: ${needle}`);
  }
}

const spec = contents["backend scan job v2 spec"];
for (const required of [
  "# Backend Scan Job V2 Spec",
  "type ScanJob",
  "type ProviderJob",
  "type ProviderPolicy",
  "type ScanError",
  "## Lifecycle",
  "## V2 Endpoint Sketch",
  "## Storage Boundary",
  "V2.0 no-storage",
  "V2.1 persistent",
  "POST /scan/jobs",
  "GET /scan/jobs/:id",
  "POST /scan/jobs/:id/collect",
  "POST /scan/jobs/:id/cancel",
  "GET /scan/jobs/:id/artifact",
  "No D1",
  "V1 remains valid",
  "No frontend files are modified",
]) {
  assertIncludes("backend scan job v2 spec", spec, required);
}

for (const [label, text] of Object.entries(contents)) {
  assertIncludes(label, text, "backend-scan-job-v2.md");
}

console.log("backend scan job v2 spec ok");

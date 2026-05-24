import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(__dirname, "../../specs/narrative-report-spec.md");
const spec = readFileSync(specPath, "utf8");

const requiredPhrases = [
  "Status: draft",
  "deterministic renderer shipped",
  "AI narrative provider",
  "Every report claim must cite",
  "supported_by_collected_evidence",
  "supported_with_explicit_limits",
  "requires_missing_data",
  "requires_manual_or_ai_review",
  "First Deterministic Output Shape",
  "AI / Manual Review Boundary",
  "Business model and platform mechanism",
  "Related-domain analysis",
  "The deterministic renderer and AI provider must not",
];

for (const phrase of requiredPhrases) {
  assert(spec.includes(phrase), `Narrative report spec is missing required phrase: ${phrase}`);
}

const sectionRows = spec
  .split("\n")
  .filter((line) => line.startsWith("| ") && !line.includes("---") && !line.includes("Narrative Section"));

assert(sectionRows.length >= 12, `Expected at least 12 narrative section rows, got ${sectionRows.length}`);

for (const status of [
  "supported_by_collected_evidence",
  "supported_with_explicit_limits",
  "requires_missing_data",
  "requires_manual_or_ai_review",
]) {
  assert(sectionRows.some((line) => line.includes(status)), `No narrative section uses status: ${status}`);
}

console.log("narrative report spec ok");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

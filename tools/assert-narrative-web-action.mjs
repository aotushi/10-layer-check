#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = resolve(__dirname, "../src/main.ts");
const main = readFileSync(mainPath, "utf8");

for (const required of [
  "createReportBrief",
  "renderNarrativeMarkdown",
  "copy-narrative-report",
  "Copy narrative report",
  "Copied narrative markdown report.",
]) {
  if (!main.includes(required)) {
    throw new Error(`Web App narrative action is missing: ${required}`);
  }
}

if (!/copy-narrative-report[\s\S]*createReportBrief\(run\)[\s\S]*renderNarrativeMarkdown\(brief\)/.test(main)) {
  throw new Error("Narrative copy action must build ReportBrief from the active Run and render narrative Markdown.");
}

if (!/copy-markdown-report[\s\S]*renderAnalysisMarkdown\(report\)/.test(main)) {
  throw new Error("Existing Analysis Markdown copy action must remain intact.");
}

console.log("narrative Web App action check passed.");

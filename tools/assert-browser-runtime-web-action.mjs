#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(resolve(__dirname, "../src/main.ts"), "utf8");
const githubClient = readFileSync(resolve(__dirname, "../src/providers/github-actions/client.ts"), "utf8");
const model = readFileSync(resolve(__dirname, "../src/core/model.ts"), "utf8");

for (const required of [
  "Run browser runtime",
  "run-browser-runtime",
  "startGitHubBrowserRuntimeProvider",
  "getGitHubBrowserRuntimeStatus",
  "getGitHubBrowserRuntimeResult",
  'item.type === "browser_runtime" && item.enabled',
  "createImportedRun(records)",
  "mergeProviderRun(run, providerRun)",
]) {
  if (!main.includes(required)) {
    throw new Error(`Web App browser runtime action is missing: ${required}`);
  }
}

for (const required of [
  "GitHubBrowserRuntimeStartResult",
  "GitHubBrowserRuntimeStatusResult",
  "GitHubBrowserRuntimeResult",
  "/provider/github/browser-runtime/start",
  "/provider/github/browser-runtime/status",
  "/provider/github/browser-runtime/result",
]) {
  if (!githubClient.includes(required)) {
    throw new Error(`GitHub Actions client is missing browser runtime support: ${required}`);
  }
}

if (!model.includes("Local Worker Browser Runtime Provider")) {
  throw new Error("Default browser_runtime provider should point to the Worker-mediated browser runtime endpoint.");
}

console.log("browser runtime Web App action check passed.");

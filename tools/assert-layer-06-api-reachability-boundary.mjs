#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const spec = readFileSync("specs/layer-06-api-reachability-boundary.md", "utf8");

for (const required of [
  "same-origin",
  "HEAD",
  "GET",
  "No POST/PUT/PATCH/DELETE",
  "No authenticated endpoints",
  "No brute forcing endpoint paths",
  "No GraphQL introspection query",
  "POST /probe/api-reachability",
  "\"api_reachability\"",
  "Layer 6 / api_reachability_probe",
]) {
  assert.ok(spec.includes(required), `Expected L6 API reachability boundary spec to include: ${required}`);
}

console.log("layer 06 api reachability boundary spec check passed.");

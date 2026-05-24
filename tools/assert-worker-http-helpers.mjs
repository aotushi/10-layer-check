#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const workerSource = await readFile(new URL("../worker/remote-fetch.ts", import.meta.url), "utf8");
const dispatchSource = await readFile(new URL("../worker/routes/dispatch.ts", import.meta.url), "utf8").catch(() => "");
const authSource = await readFile(new URL("../worker/http/auth.ts", import.meta.url), "utf8").catch(() => "");
const responseSource = await readFile(new URL("../worker/http/response.ts", import.meta.url), "utf8").catch(() => "");

if (!workerSource.includes('from "./routes/dispatch"') || !dispatchSource.includes('from "../http/auth"')) {
  throw new Error("Worker HTTP handling should reach auth and response helpers through worker/routes/dispatch.ts.");
}

for (const forbidden of ["function authenticate", "function jsonResponse", "const CORS_HEADERS"]) {
  if (workerSource.includes(forbidden)) {
    throw new Error(`worker/remote-fetch.ts should not contain ${forbidden}.`);
  }
}

if (!authSource.includes("authenticate") || !authSource.includes("PROBE_API_KEY")) {
  throw new Error("worker/http/auth.ts should own Worker auth behavior.");
}

if (!responseSource.includes("jsonResponse") || !responseSource.includes("CORS_HEADERS")) {
  throw new Error("worker/http/response.ts should own JSON/CORS response behavior.");
}

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");

  const health = await worker.default.fetch(new Request("http://worker.local/health"), {});
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("access-control-allow-origin"), "*");
  assert.equal((await health.json()).ok, true);

  const missingKey = await worker.default.fetch(
    new Request("http://worker.local/probe/remote-fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://example.com" }),
    }),
    {},
  );
  assert.equal(missingKey.status, 503);
  assert.match((await missingKey.text()), /PROBE_API_KEY is not configured/);

  const unauthorized = await worker.default.fetch(
    new Request("http://worker.local/probe/remote-fetch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "wrong" },
      body: JSON.stringify({ target: "https://example.com" }),
    }),
    { PROBE_API_KEY: "expected" },
  );
  assert.equal(unauthorized.status, 401);
  assert.match((await unauthorized.text()), /Unauthorized remote fetch request/);

  const localAllowed = await worker.default.fetch(
    new Request("http://worker.local/probe/remote-fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "" }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );
  assert.equal(localAllowed.status, 400);
  assert.match((await localAllowed.text()), /target string/);

  console.log("worker HTTP helper check passed.");
} finally {
  await server.close();
}

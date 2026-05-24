#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const routeSource = await readFile(new URL("../worker/routes/probes.ts", import.meta.url), "utf8");
const probeSource = await readFile(new URL("../worker/probes/remote-fetch.ts", import.meta.url), "utf8").catch(() => "");

if (!routeSource.includes('from "../probes/remote-fetch"')) {
  throw new Error("Worker remote-fetch route should delegate through worker/probes/remote-fetch.ts.");
}

if (routeSource.includes("async function remoteFetch") || routeSource.includes("function extractSitemapUrls")) {
  throw new Error("worker/routes/probes.ts should not own remote_fetch probe implementation details.");
}

for (const token of ["remoteFetch", "fetchCrawlMetadata", "fetchRobotsTxt", "fetchSitemapXml", "redirect_chain"]) {
  if (!probeSource.includes(token)) {
    throw new Error(`worker/probes/remote-fetch.ts should contain ${token}.`);
  }
}

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

const originalFetch = globalThis.fetch;

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");

  globalThis.fetch = async (request) => {
    const url = String(request);

    if (url === "https://example.com/") {
      return new Response("<!doctype html><title>Example</title>", {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "max-age=60",
        },
      });
    }

    if (url === "https://example.com/robots.txt") {
      return new Response("User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap.xml\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    if (url === "https://example.com/sitemap.xml") {
      return new Response("<urlset></urlset>", {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }

    throw new Error(`Unexpected fetch in remote-fetch probe module check: ${url}`);
  };

  const response = await worker.default.fetch(
    new Request("http://worker.local/probe/remote-fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://example.com" }),
    }),
    { ALLOW_LOCAL_DEV_NO_AUTH: "true" },
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status_code, 200);
  assert.equal(body.final_url, "https://example.com/");
  assert.equal(body.provider_id, "worker-fetch");
  assert.equal(body.crawl_metadata.robots_txt.found, true);
  assert.equal(body.crawl_metadata.robots_txt.disallow_count, 1);
  assert.deepEqual(body.crawl_metadata.robots_txt.sitemap_urls, ["https://example.com/sitemap.xml"]);
  assert.equal(body.crawl_metadata.sitemap_xml.found, true);

  console.log("remote-fetch probe module check passed.");
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

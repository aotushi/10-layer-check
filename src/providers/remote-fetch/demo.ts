import type { RemoteFetchResult } from "./types";

export function createDemoRemoteFetchResult(target: string): RemoteFetchResult {
  const finalUrl = normalizeUrl(target);
  const isCloudflare = finalUrl.includes("cloudflare.com");
  const now = new Date().getTime();

  return {
    requested_url: target,
    final_url: finalUrl,
    status_code: 200,
    ok: true,
    redirected: finalUrl !== target,
    redirect_chain: finalUrl !== target ? [{ from: target, to: finalUrl, status_code: 301 }] : [],
    headers: isCloudflare
      ? {
          "content-type": "text/html; charset=utf-8",
          server: "cloudflare",
          "cache-control": "public, max-age=14400",
          "strict-transport-security": "max-age=31536000; includeSubDomains",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        }
      : {
          "content-type": "text/html",
          server: "demo-origin",
          "cache-control": "max-age=3600",
        },
    html: isCloudflare
      ? '<!doctype html><html><head><title>DNS A record</title><script src="https://www.googletagmanager.com/gtm.js?id=GTM-DEMO"></script><link rel="stylesheet" href="/assets/app.abc123.css"></head><main><h1>DNS A record</h1></main></html>'
      : '<!doctype html><html><head><title>Example Domain</title><meta name="generator" content="Static HTML"><script type="module" src="/assets/main.abc123.js"></script><link rel="stylesheet" href="/assets/main.abc123.css"></head><main><h1>Example Domain</h1><img src="/example.webp" alt=""></main></html>',
    crawl_metadata: {
      robots_txt: {
        url: new URL("/robots.txt", finalUrl).toString(),
        status_code: 200,
        found: true,
        body_excerpt: "User-agent: *\nDisallow:\nSitemap: /sitemap.xml",
        sitemap_urls: [new URL("/sitemap.xml", finalUrl).toString()],
        disallow_count: 1,
      },
      sitemap_xml: {
        url: new URL("/sitemap.xml", finalUrl).toString(),
        status_code: 200,
        found: true,
        content_type: "application/xml",
        body_excerpt: "<?xml version=\"1.0\"?><urlset></urlset>",
      },
    },
    duration_ms: Math.max(80, now % 240),
    provider_id: "demo-remote-fetch",
    source: "demo_remote_fetch_fixture",
  };
}

function normalizeUrl(target: string): string {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `https://${target}`;
  return new URL(withProtocol).toString();
}

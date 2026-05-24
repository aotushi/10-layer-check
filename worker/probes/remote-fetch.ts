const MAX_HTML_BYTES = 512_000;

type RedirectHop = {
  from: string;
  to: string;
  status_code: number;
};

export type RemoteFetchResult = {
  requested_url: string;
  final_url: string;
  status_code: number;
  ok: boolean;
  redirected: boolean;
  redirect_chain: RedirectHop[];
  headers: Record<string, string>;
  html: string;
  crawl_metadata: {
    robots_txt: {
      url: string;
      status_code: number;
      found: boolean;
      body_excerpt: string;
      sitemap_urls: string[];
      disallow_count: number;
    } | null;
    sitemap_xml: {
      url: string;
      status_code: number;
      found: boolean;
      content_type: string | null;
      body_excerpt: string;
    } | null;
  };
  duration_ms: number;
  provider_id: string;
  source: string;
};

export async function remoteFetch(target: string, maxRedirects: number): Promise<RemoteFetchResult> {
  const startedAt = Date.now();
  let currentUrl = normalizeTargetUrl(target);
  const requestedUrl = currentUrl;
  const redirectChain: RedirectHop[] = [];
  let response: Response | null = null;

  for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
    response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400 && Boolean(location);

    if (!isRedirect || !location) {
      break;
    }

    const nextUrl = new URL(location, currentUrl).toString();
    redirectChain.push({
      from: currentUrl,
      to: nextUrl,
      status_code: response.status,
    });
    currentUrl = nextUrl;
  }

  if (!response) {
    throw new Error("No response received.");
  }

  const html = await readLimitedText(response, MAX_HTML_BYTES);
  const crawlMetadata = await fetchCrawlMetadata(currentUrl);
  return {
    requested_url: requestedUrl,
    final_url: currentUrl,
    status_code: response.status,
    ok: response.ok,
    redirected: redirectChain.length > 0,
    redirect_chain: redirectChain,
    headers: normalizeHeaders(response.headers),
    html,
    crawl_metadata: crawlMetadata,
    duration_ms: Date.now() - startedAt,
    provider_id: "worker-fetch",
    source: "cloudflare_worker_fetch",
  };
}

async function fetchCrawlMetadata(finalUrl: string): Promise<RemoteFetchResult["crawl_metadata"]> {
  const origin = new URL(finalUrl).origin;
  const robotsUrl = `${origin}/robots.txt`;
  const sitemapUrl = `${origin}/sitemap.xml`;
  const [robotsTxt, sitemapXml] = await Promise.all([fetchRobotsTxt(robotsUrl), fetchSitemapXml(sitemapUrl)]);

  return {
    robots_txt: robotsTxt,
    sitemap_xml: sitemapXml,
  };
}

async function fetchRobotsTxt(url: string): Promise<RemoteFetchResult["crawl_metadata"]["robots_txt"]> {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/plain,*/*;q=0.8",
      },
    });
    const body = await readLimitedText(response, 64_000);

    return {
      url,
      status_code: response.status,
      found: response.ok,
      body_excerpt: body.slice(0, 4000),
      sitemap_urls: extractSitemapUrls(body, url),
      disallow_count: countRobotsDirective(body, "disallow"),
    };
  } catch {
    return null;
  }
}

async function fetchSitemapXml(url: string): Promise<RemoteFetchResult["crawl_metadata"]["sitemap_xml"]> {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/xml,text/xml,text/plain,*/*;q=0.8",
      },
    });
    const body = await readLimitedText(response, 64_000);

    return {
      url,
      status_code: response.status,
      found: response.ok,
      content_type: response.headers.get("content-type"),
      body_excerpt: body.slice(0, 4000),
    };
  } catch {
    return null;
  }
}

function normalizeTargetUrl(value: string): string {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https targets are supported. Received: ${url.protocol}`);
  }

  return url.toString();
}

function normalizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
  }
  return new TextDecoder().decode(concatBytes(chunks, Math.min(size, maxBytes)));
}

function concatBytes(chunks: Uint8Array[], maxBytes: number): Uint8Array {
  const output = new Uint8Array(maxBytes);
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.min(chunk.byteLength, maxBytes - offset));
    output.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= maxBytes) break;
  }
  return output;
}

function extractSitemapUrls(body: string, robotsUrl: string): string[] {
  return Array.from(body.matchAll(/^\s*sitemap\s*:\s*(.+)$/gim))
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => new URL(value, robotsUrl).toString());
}

function countRobotsDirective(body: string, directive: string): number {
  const pattern = new RegExp(`^\\s*${directive}\\s*:`, "gim");
  return Array.from(body.matchAll(pattern)).length;
}

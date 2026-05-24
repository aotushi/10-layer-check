export type RedirectHop = {
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
  crawl_metadata?: {
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

import type { Env } from "../env";
import { authenticate } from "../http/auth";
import { parseTarget } from "../http/request";
import { CORS_HEADERS, jsonResponse } from "../http/response";
import type { ProbeRequest } from "../services/scan-orchestrator";
import { handleAiRoute } from "./ai";
import { handleGithubGetRoute, handleGithubPostRoute } from "./github";
import { handlePerformanceGetRoute, handlePerformancePostRoute } from "./performance";
import { handleProbeRoute } from "./probes";
import { handleRelatedDomainsRoute } from "./related-domains";
import { handleScanGetRoute, handleScanRoute, isScanJobIdGetRoute, isScanJobIdPostRoute, isScanJobIdRoute } from "./scan";
import { authenticateUserRequest, handleUserRoute } from "./user";

const POST_ENDPOINTS = new Set([
  "/probe/remote-fetch",
  "/scan/jobs",
  "/scan/jobs/collect",
  "/scan/jobs/artifact",
  "/scan/site/start",
  "/scan/site/export",
  "/scan/site/report",
  "/scan/site/report.md",
  "/probe/dns-infrastructure",
  "/probe/tls-certificate",
  "/probe/subdomain-attack-surface",
  "/probe/service-fingerprint",
  "/probe/public-host-fingerprint",
  "/probe/public-security-details",
  "/probe/public-content-surface",
  "/probe/public-content-detail",
  "/probe/public-spa-metadata",
  "/probe/organization-intelligence",
  "/probe/api-reachability",
  "/probe/performance-basic",
  "/provider/github/live-tls/start",
  "/provider/github/lighthouse/start",
  "/provider/performance/pagespeed/run",
  "/provider/performance/webpagetest/start",
  "/provider/github/browser-runtime/start",
  "/provider/ai/classifier",
  "/provider/ai/narrative-report",
  "/provider/related-domains/confirm",
]);

const GET_ENDPOINTS = new Set([
  "/provider/github/live-tls/status",
  "/provider/github/live-tls/result",
  "/provider/github/lighthouse/status",
  "/provider/github/lighthouse/result",
  "/provider/performance/webpagetest/status",
  "/provider/performance/webpagetest/result",
  "/provider/github/browser-runtime/status",
  "/provider/github/browser-runtime/result",
]);

export async function handleWorkerRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (url.pathname === "/health") {
    return jsonResponse({
      ok: true,
      provider: "cloudflare_worker_fetch",
      auth: {
        jwt_secret_configured: Boolean(env.JWT_SECRET),
        db_configured: Boolean(env.SCAN_JOB_DB),
        probe_api_key_configured: Boolean(env.PROBE_API_KEY),
        local_no_auth_enabled: env.ALLOW_LOCAL_DEV_NO_AUTH === "true",
      },
    });
  }

  try {
    const userResponse = await handleUserRoute(url.pathname, request, env);
    if (userResponse) return userResponse;

    if (!POST_ENDPOINTS.has(url.pathname) && !GET_ENDPOINTS.has(url.pathname) && !isScanJobIdRoute(url.pathname)) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    const methodError = validateMethod(url.pathname, request.method);
    if (methodError) return methodError;

    const authenticatedUser = await authenticateUserRequest(request, env);
    const authError = authenticatedUser ? null : authenticate(request, env);
    if (authError) return authError;

    const getResponse =
      (await handleScanGetRoute(url.pathname, env, authenticatedUser)) ??
      (await handleGithubGetRoute(url.pathname, env, url)) ??
      (await handlePerformanceGetRoute(url.pathname, env, url));
    if (getResponse) return getResponse;

    const body = (await request.json()) as ProbeRequest & { contract?: unknown };
    const aiResponse = await handleAiRoute(url.pathname, env, body);
    if (aiResponse) return aiResponse;
    const relatedDomainsResponse = await handleRelatedDomainsRoute(url.pathname, env, body);
    if (relatedDomainsResponse) return relatedDomainsResponse;

    const target = routeSkipsTarget(url.pathname)
      ? ""
      : parseTarget(body.target);
    const postResponse =
      (await handleScanRoute(url.pathname, env, target, body, url, authenticatedUser)) ??
      (await handleGithubPostRoute(url.pathname, env, target, body)) ??
      (await handlePerformancePostRoute(url.pathname, env, target, url, body)) ??
      (await handleProbeRoute(url.pathname, target, body));

    return postResponse ?? jsonResponse({ error: "Not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 400);
  }
}

function validateMethod(pathname: string, method: string): Response | null {
  if (GET_ENDPOINTS.has(pathname) || isScanJobIdGetRoute(pathname)) {
    if (method === "GET") return null;
    if (isScanJobIdGetRoute(pathname)) {
      return jsonResponse({ error: "Use GET for scan job read/artifact endpoints." }, 405);
    }
    if (pathname.startsWith("/provider/github/live-tls/")) {
      return jsonResponse({ error: "Use GET for GitHub live TLS status/result endpoints." }, 405);
    }
    if (pathname.startsWith("/provider/github/lighthouse/")) {
      return jsonResponse({ error: "Use GET for GitHub Lighthouse status/result endpoints." }, 405);
    }
    if (pathname.startsWith("/provider/performance/webpagetest/")) {
      return jsonResponse({ error: "Use GET for WebPageTest status/result endpoints." }, 405);
    }
    return jsonResponse({ error: "Use GET for GitHub browser runtime status/result endpoints." }, 405);
  }

  if (POST_ENDPOINTS.has(pathname) || isScanJobIdPostRoute(pathname)) {
    if (method === "POST") return null;
  }

  return jsonResponse(
    {
      error:
        "Use POST /probe/remote-fetch, /scan/jobs, /scan/jobs/collect, /scan/jobs/artifact, /scan/site/start, /scan/site/export, /scan/site/report, /scan/site/report.md, /probe/dns-infrastructure, /probe/tls-certificate, /probe/subdomain-attack-surface, /probe/service-fingerprint, /probe/public-host-fingerprint, /probe/public-security-details, /probe/public-content-surface, /probe/public-content-detail, /probe/public-spa-metadata, /probe/organization-intelligence, /probe/api-reachability, /probe/performance-basic, /provider/github/live-tls/start, /provider/github/lighthouse/start, /provider/performance/pagespeed/run, /provider/performance/webpagetest/start, /provider/github/browser-runtime/start, /provider/ai/classifier, /provider/ai/narrative-report, or /provider/related-domains/confirm",
    },
    405,
  );
}

function routeSkipsTarget(pathname: string): boolean {
  return pathname === "/scan/jobs/collect" || pathname === "/scan/jobs/artifact" || isScanJobIdPostRoute(pathname);
}

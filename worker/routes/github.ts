import type { Env } from "../env";
import {
  githubBrowserRuntimeResult,
  githubBrowserRuntimeStart,
  githubBrowserRuntimeStatus,
  githubLighthouseResult,
  githubLighthouseStart,
  githubLighthouseStatus,
  githubLiveTlsResult,
  githubLiveTlsStart,
  githubLiveTlsStatus,
} from "../services/github-actions";
import { parseLighthouseStrategy } from "../http/request";
import { jsonResponse } from "../http/response";

export async function handleGithubGetRoute(pathname: string, env: Env, url: URL): Promise<Response | null> {
  if (pathname === "/provider/github/live-tls/status") return jsonResponse(await githubLiveTlsStatus(env, url));
  if (pathname === "/provider/github/live-tls/result") return jsonResponse(await githubLiveTlsResult(env, url));
  if (pathname === "/provider/github/lighthouse/status") return jsonResponse(await githubLighthouseStatus(env, url));
  if (pathname === "/provider/github/lighthouse/result") return jsonResponse(await githubLighthouseResult(env, url));
  if (pathname === "/provider/github/browser-runtime/status") return jsonResponse(await githubBrowserRuntimeStatus(env, url));
  if (pathname === "/provider/github/browser-runtime/result") return jsonResponse(await githubBrowserRuntimeResult(env, url));
  return null;
}

export async function handleGithubPostRoute(
  pathname: string,
  env: Env,
  target: string,
  body: Record<string, unknown>,
): Promise<Response | null> {
  if (pathname === "/provider/github/live-tls/start") return jsonResponse(await githubLiveTlsStart(env, target));
  if (pathname === "/provider/github/lighthouse/start") {
    return jsonResponse(await githubLighthouseStart(env, target, parseLighthouseStrategy(body.strategy)));
  }
  if (pathname === "/provider/github/browser-runtime/start") return jsonResponse(await githubBrowserRuntimeStart(env, target));
  return null;
}

export { githubBrowserRuntimeStart, githubLighthouseStart, githubLiveTlsStart };

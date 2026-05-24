import type { Env } from "../env";
import {
  pageSpeedRun,
  webPageTestResult,
  webPageTestStart,
  webPageTestStatus,
} from "../services/performance-providers";
import { getResponseStatus, parseLighthouseStrategy, parseOptionalString } from "../http/request";
import { jsonResponse } from "../http/response";

export async function handlePerformanceGetRoute(pathname: string, env: Env, url: URL): Promise<Response | null> {
  if (pathname === "/provider/performance/webpagetest/status") {
    const result = await webPageTestStatus(env, url);
    return jsonResponse(result, getResponseStatus(result));
  }
  if (pathname === "/provider/performance/webpagetest/result") {
    const result = await webPageTestResult(env, url);
    return jsonResponse(result, getResponseStatus(result));
  }
  return null;
}

export async function handlePerformancePostRoute(
  pathname: string,
  env: Env,
  target: string,
  url: URL,
  body: Record<string, unknown>,
): Promise<Response | null> {
  if (pathname === "/provider/performance/pagespeed/run") {
    const result = await pageSpeedRun(env, target, parseLighthouseStrategy(body.strategy));
    return jsonResponse(result, result.ok ? 200 : result.status);
  }
  if (pathname === "/provider/performance/webpagetest/start") {
    const result = await webPageTestStart(env, target, url, parseOptionalString(body.location));
    return jsonResponse(result, result.ok ? 200 : result.status);
  }
  return null;
}

export { pageSpeedRun, webPageTestStart };

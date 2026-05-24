import type { Env } from "../env";
import { runAiClassifierProvider } from "../services/ai-classifier";
import { runAiNarrativeReportProvider } from "../services/ai-narrative-report";
import { jsonResponse } from "../http/response";

export async function handleAiRoute(pathname: string, env: Env, body: Record<string, unknown>): Promise<Response | null> {
  if (pathname === "/provider/ai/narrative-report") {
    const result = await runAiNarrativeReportProvider(body, env);
    return jsonResponse(result, result.ok ? 200 : result.status);
  }

  if (pathname !== "/provider/ai/classifier") return null;

  const result = await runAiClassifierProvider(body, env);
  return jsonResponse(result, result.ok ? 200 : result.status);
}

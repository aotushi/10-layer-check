import {
  parseAiNarrativeReportWorkerRequest,
  runWorkerAiNarrativeReportProvider,
  type AiNarrativeReportWorkerEnv,
  type AiNarrativeReportWorkerRequest,
  type AiNarrativeReportWorkerResponse,
} from "../../src/providers/narrative-report/worker-adapter";

export type AiNarrativeReportEnv = AiNarrativeReportWorkerEnv;

export async function runAiNarrativeReportProvider(
  body: AiNarrativeReportWorkerRequest,
  env: AiNarrativeReportEnv,
): Promise<AiNarrativeReportWorkerResponse> {
  const contract = parseAiNarrativeReportWorkerRequest(body);
  if (!contract) {
    return {
      ok: false,
      schema_version: "site-10-layer-ai-narrative-report-worker-response/v0.1",
      provider: "worker_ai_narrative_report",
      error_code: "invalid_contract",
      error: "Request body must include a valid AI narrative report contract.",
      status: 400,
    };
  }

  return runWorkerAiNarrativeReportProvider(contract, env);
}

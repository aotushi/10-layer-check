import {
  parseWorkerAiClassifierRequest,
  runWorkerAiClassifierProvider,
  type WorkerAiClassifierRequest,
  type WorkerAiClassifierResponse,
  type WorkersAiBinding,
} from "../../src/providers/ai-classifier/worker-adapter";

export type { WorkersAiBinding };

export type AiClassifierEnv = {
  AI?: WorkersAiBinding;
  AI_PROVIDER_API_KEY?: string;
  AI_PROVIDER_MODEL?: string;
  AI_PROVIDER_BASE_URL?: string;
};

export async function runAiClassifierProvider(
  body: WorkerAiClassifierRequest,
  env: AiClassifierEnv,
): Promise<WorkerAiClassifierResponse> {
  const contract = parseWorkerAiClassifierRequest(body);
  if (!contract) {
    return {
      ok: false,
      schema_version: "site-10-layer-ai-classifier-worker-response/v0.1",
      provider: "worker_ai_classifier",
      error_code: "invalid_contract",
      error: "Request body must include a valid AI classifier contract.",
      status: 400,
    };
  }

  return runWorkerAiClassifierProvider(contract, env);
}

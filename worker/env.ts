import type { WorkersAiBinding } from "./services/ai-classifier";

export type WorkerKvNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

export type WorkerD1Database = {
  prepare(query: string): unknown;
};

export type Env = {
  AI?: WorkersAiBinding;
  SCAN_JOB_KV?: WorkerKvNamespace;
  SCAN_JOB_DB?: WorkerD1Database;
  PROBE_API_KEY?: string;
  ALLOW_LOCAL_DEV_NO_AUTH?: string;
  GITHUB_TOKEN?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  GITHUB_LIVE_TLS_WORKFLOW?: string;
  GITHUB_LIGHTHOUSE_WORKFLOW?: string;
  GITHUB_BROWSER_RUNTIME_WORKFLOW?: string;
  GITHUB_REF?: string;
  AI_PROVIDER_API_KEY?: string;
  AI_PROVIDER_MODEL?: string;
  AI_PROVIDER_BASE_URL?: string;
  PAGESPEED_API_KEY?: string;
  PAGESPEED_API_URL?: string;
  WEBPAGETEST_API_KEY?: string;
  WEBPAGETEST_BASE_URL?: string;
  SCAN_JOB_HANDLE_SECRET?: string;
  SCAN_JOB_HANDLE_KID?: string;
  SCAN_JOB_HANDLE_TTL_SECONDS?: string;
  SCAN_JOB_HANDLE_MAX_PAYLOAD_BYTES?: string;
  SCAN_JOB_HANDLE_MAX_TOKEN_BYTES?: string;
  SCAN_JOB_TTL_SECONDS?: string;
  SCAN_JOB_MAX_OBJECT_BYTES?: string;
};

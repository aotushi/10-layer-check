import type { ScanJob } from "./job";

export type SignedJobHandle = {
  schema_version: "site-10-layer-signed-job-handle/v0.1";
  alg: "HMAC-SHA-256";
  kid: string;
  issued_at: string;
  expires_at: string;
  token: string;
};

export type SignedJobHandleConfig = {
  secret: string;
  kid: string;
  ttlSeconds: number;
  maxPayloadBytes: number;
  maxTokenBytes: number;
  now?: Date;
};

type SignedJobHandlePayload = {
  schema_version: "site-10-layer-signed-job-handle-payload/v0.1";
  scan_id: string;
  target: string;
  normalized_target: string;
  created_at: string;
  updated_at: string;
  issued_at: string;
  expires_at: string;
  job: ScanJob;
};

export async function createSignedJobHandle(job: ScanJob, config: SignedJobHandleConfig): Promise<SignedJobHandle> {
  validateConfig(config);
  const issuedAt = (config.now ?? new Date()).toISOString();
  const expiresAt = new Date(new Date(issuedAt).getTime() + config.ttlSeconds * 1000).toISOString();
  const payload: SignedJobHandlePayload = {
    schema_version: "site-10-layer-signed-job-handle-payload/v0.1",
    scan_id: job.id,
    target: job.target,
    normalized_target: job.normalized_target,
    created_at: job.created_at,
    updated_at: job.updated_at,
    issued_at: issuedAt,
    expires_at: expiresAt,
    job,
  };
  const payloadJson = JSON.stringify(payload);
  assertByteLimit("signed job handle payload", payloadJson, config.maxPayloadBytes);
  const payloadToken = base64UrlEncode(payloadJson);
  const signature = await sign(payloadToken, config.secret);
  const token = `${payloadToken}.${signature}`;

  if (token.length > config.maxTokenBytes) {
    throw new Error(`signed job handle token exceeds maxTokenBytes (${config.maxTokenBytes}).`);
  }

  return {
    schema_version: "site-10-layer-signed-job-handle/v0.1",
    alg: "HMAC-SHA-256",
    kid: config.kid,
    issued_at: issuedAt,
    expires_at: expiresAt,
    token,
  };
}

export async function verifySignedJobHandle(handle: unknown, config: SignedJobHandleConfig): Promise<ScanJob> {
  validateConfig(config);
  const normalized = normalizeHandle(handle);

  if (normalized.kid !== config.kid) {
    throw new Error("signed job handle key id does not match current configuration.");
  }
  if (normalized.token.length > config.maxTokenBytes) {
    throw new Error(`signed job handle token exceeds maxTokenBytes (${config.maxTokenBytes}).`);
  }

  const [payloadToken, signature] = normalized.token.split(".");
  if (!payloadToken || !signature) {
    throw new Error("signed job handle token must contain payload and signature.");
  }
  const expectedSignature = await sign(payloadToken, config.secret);
  if (!constantTimeEqual(signature, expectedSignature)) {
    throw new Error("signed job handle signature is invalid.");
  }

  const payloadJson = base64UrlDecode(payloadToken);
  assertByteLimit("signed job handle payload", payloadJson, config.maxPayloadBytes);
  const payload = JSON.parse(payloadJson) as SignedJobHandlePayload;
  if (payload.schema_version !== "site-10-layer-signed-job-handle-payload/v0.1") {
    throw new Error("signed job handle payload schema version is invalid.");
  }
  if (new Date(payload.expires_at).getTime() <= (config.now ?? new Date()).getTime()) {
    throw new Error("signed job handle is expired.");
  }
  if (!isScanJobLike(payload.job)) {
    throw new Error("signed job handle payload does not contain a valid ScanJob.");
  }

  return payload.job;
}

function normalizeHandle(value: unknown): SignedJobHandle {
  const handle = isRecord(value) ? value : null;
  if (!handle) {
    throw new Error("job_handle must be an object.");
  }
  if (handle.schema_version !== "site-10-layer-signed-job-handle/v0.1") {
    throw new Error("job_handle schema version is invalid.");
  }
  if (handle.alg !== "HMAC-SHA-256") {
    throw new Error("job_handle algorithm is invalid.");
  }
  if (typeof handle.kid !== "string" || typeof handle.token !== "string") {
    throw new Error("job_handle must include kid and token.");
  }

  return handle as SignedJobHandle;
}

function validateConfig(config: SignedJobHandleConfig): void {
  if (!config.secret) throw new Error("SCAN_JOB_HANDLE_SECRET is required for signed job handles.");
  if (!config.kid) throw new Error("SCAN_JOB_HANDLE_KID is required for signed job handles.");
  if (!Number.isInteger(config.ttlSeconds) || config.ttlSeconds <= 0) {
    throw new Error("SCAN_JOB_HANDLE_TTL_SECONDS must be a positive integer.");
  }
  if (!Number.isInteger(config.maxPayloadBytes) || config.maxPayloadBytes <= 0) {
    throw new Error("Signed job handle maxPayloadBytes must be a positive integer.");
  }
  if (!Number.isInteger(config.maxTokenBytes) || config.maxTokenBytes <= 0) {
    throw new Error("Signed job handle maxTokenBytes must be a positive integer.");
  }
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, toArrayBuffer(encode(value)));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function assertByteLimit(label: string, value: string, limit: number): void {
  const size = encode(value).byteLength;
  if (size > limit) {
    throw new Error(`${label} exceeds limit (${size} > ${limit}).`);
  }
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function isScanJobLike(value: unknown): value is ScanJob {
  const job = isRecord(value) ? value : null;
  if (!job) return false;
  return (
    typeof job.id === "string" &&
    typeof job.target === "string" &&
    typeof job.normalized_target === "string" &&
    typeof job.created_at === "string" &&
    typeof job.updated_at === "string" &&
    Array.isArray(job.records) &&
    Array.isArray(job.provider_jobs) &&
    isRecord(job.raw_inputs)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const JWT_ALGORITHM = "HS256";
const JWT_TYPE = "JWT";
const JWT_ISSUER = "site-10-layer-check";
const DEFAULT_JWT_EXPIRES_SECONDS = 7 * 24 * 60 * 60;

export type UserJwtPayload = {
  sub: string;
  email: string;
  ver: number;
  iss: string;
  iat: number;
  exp: number;
};

export async function signUserJwt(input: {
  secret: string;
  userId: string;
  email: string;
  tokenVersion: number;
  expiresSeconds?: string;
  now?: Date;
}): Promise<string> {
  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const expiresIn = parseExpiresSeconds(input.expiresSeconds);
  const header = base64UrlEncodeJson({ alg: JWT_ALGORITHM, typ: JWT_TYPE });
  const payload = base64UrlEncodeJson({
    sub: input.userId,
    email: input.email,
    ver: input.tokenVersion,
    iss: JWT_ISSUER,
    iat: issuedAt,
    exp: issuedAt + expiresIn,
  } satisfies UserJwtPayload);
  const signingInput = `${header}.${payload}`;
  const signature = await signHmacSha256(signingInput, input.secret);

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export async function verifyUserJwt(token: string, secret: string, now = new Date()): Promise<UserJwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = readJsonRecord(base64UrlDecodeString(headerPart));
  if (header.alg !== JWT_ALGORITHM || header.typ !== JWT_TYPE) return null;

  const verified = await verifyHmacSha256(`${headerPart}.${payloadPart}`, signaturePart, secret);
  if (!verified) return null;

  const payload = readJsonRecord(base64UrlDecodeString(payloadPart));
  if (!isUserJwtPayload(payload)) return null;
  if (payload.iss !== JWT_ISSUER) return null;
  if (payload.exp <= Math.floor(now.getTime() / 1000)) return null;

  return payload;
}

function parseExpiresSeconds(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_JWT_EXPIRES_SECONDS;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_JWT_EXPIRES_SECONDS;
}

async function signHmacSha256(value: string, secret: string): Promise<Uint8Array> {
  const key = await createHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

async function verifyHmacSha256(value: string, signature: string, secret: string): Promise<boolean> {
  const key = await createHmacKey(secret, ["verify"]);
  return crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(signature),
    new TextEncoder().encode(value),
  );
}

function createHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlDecodeString(value: string): string {
  return new TextDecoder().decode(base64UrlDecode(value));
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function readJsonRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function isUserJwtPayload(value: Record<string, unknown>): value is UserJwtPayload {
  return (
    typeof value.sub === "string" &&
    typeof value.email === "string" &&
    typeof value.ver === "number" &&
    typeof value.iss === "string" &&
    typeof value.iat === "number" &&
    typeof value.exp === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

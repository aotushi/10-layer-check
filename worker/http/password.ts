const PASSWORD_FORMAT = "pbkdf2_sha256";
const PASSWORD_VERSION = "1";
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derivePasswordHash(password, salt, PBKDF2_ITERATIONS);

  return [
    PASSWORD_FORMAT,
    `v=${PASSWORD_VERSION}`,
    `i=${PBKDF2_ITERATIONS}`,
    `s=${base64UrlEncode(salt)}`,
    `h=${base64UrlEncode(hash)}`,
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;

  const hash = await derivePasswordHash(password, parsed.salt, parsed.iterations);
  return constantTimeEqual(hash, parsed.hash);
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    key,
    HASH_BYTES * 8,
  );

  return new Uint8Array(bits);
}

function parsePasswordHash(encoded: string):
  | {
      iterations: number;
      salt: Uint8Array;
      hash: Uint8Array;
    }
  | null {
  const parts = encoded.split("$");
  if (parts.length !== 5 || parts[0] !== PASSWORD_FORMAT) return null;

  const values = Object.fromEntries(
    parts.slice(1).map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );

  if (values.v !== PASSWORD_VERSION || !values.i || !values.s || !values.h) return null;
  const iterations = Number(values.i);
  if (!Number.isInteger(iterations) || iterations <= 0) return null;

  return {
    iterations,
    salt: base64UrlDecode(values.s),
    hash: base64UrlDecode(values.h),
  };
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;

  let diff = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
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

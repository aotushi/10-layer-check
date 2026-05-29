import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";

const DB_NAME = "db-for-site10layer";
const SEED_SQL_PATH = resolve(".wrangler/tmp/local-dev-auth-seed.sql");
const DEMO_USER = {
  id: "user_demo_local",
  email: "demo@10-layer-check.test",
  password: "Demo_10Layer_Check_2026!",
};
const DEMO_HISTORY = {
  id: "history_demo_overreacted",
  jobId: "sample-overreacted",
  target: "overreacted.io",
  status: "completed",
  createdAt: "2026-05-26T03:42:37.997Z",
  completedAt: "2026-05-26T03:42:37.997Z",
};

const PASSWORD_FORMAT = "pbkdf2_sha256";
const PASSWORD_VERSION = "1";
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const passwordHash = await hashPassword(DEMO_USER.password);
const seedSql = [
  `INSERT INTO users (id, email, password_hash, token_version, created_at)
VALUES (${sql(DEMO_USER.id)}, ${sql(DEMO_USER.email)}, ${sql(passwordHash)}, 0, ${sql(new Date().toISOString())})
ON CONFLICT(email) DO UPDATE SET
  password_hash = excluded.password_hash,
  token_version = 0;`,
  `INSERT INTO scan_history (id, user_id, job_id, target, status, created_at, completed_at)
VALUES (
  ${sql(DEMO_HISTORY.id)},
  (SELECT id FROM users WHERE email = ${sql(DEMO_USER.email)}),
  ${sql(DEMO_HISTORY.jobId)},
  ${sql(DEMO_HISTORY.target)},
  ${sql(DEMO_HISTORY.status)},
  ${sql(DEMO_HISTORY.createdAt)},
  ${sql(DEMO_HISTORY.completedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  job_id = excluded.job_id,
  target = excluded.target,
  status = excluded.status,
  created_at = excluded.created_at,
  completed_at = excluded.completed_at;`,
].join("\n\n");

await mkdir(dirname(SEED_SQL_PATH), { recursive: true });
await writeFile(SEED_SQL_PATH, seedSql, "utf8");

const result = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", DB_NAME, "--local", "--file", SEED_SQL_PATH, "--yes"],
  {
    shell: process.platform === "win32",
    stdio: "inherit",
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Seeded local demo account: ${DEMO_USER.email}`);
console.log(`Seeded local history item: ${DEMO_HISTORY.jobId}`);

async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derivePasswordHash(password, salt, PBKDF2_ITERATIONS);

  return [
    PASSWORD_FORMAT,
    `v=${PASSWORD_VERSION}`,
    `i=${PBKDF2_ITERATIONS}`,
    `s=${base64UrlEncode(salt)}`,
    `h=${base64UrlEncode(hash)}`,
  ].join("$");
}

async function derivePasswordHash(password, salt, iterations) {
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
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

function base64UrlEncode(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function sql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

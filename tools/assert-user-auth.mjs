#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

try {
  const worker = await server.ssrLoadModule("/worker/remote-fetch.ts");
  const env = {
    JWT_SECRET: "local-user-auth-test-secret-with-enough-entropy",
    JWT_EXPIRES_SECONDS: "604800",
    SCAN_JOB_DB: createMemoryD1(),
  };

  const missingConfig = await request(worker, "POST", "http://worker.local/user/register", {
    email: "missing@example.com",
    password: "password-1234",
  });
  assert.equal(missingConfig.status, 503);
  assert.equal(missingConfig.body.ok, false);
  assert.equal(missingConfig.body.code, "not_configured");
  assert.match(missingConfig.body.message, /SCAN_JOB_DB/);

  const register = await request(worker, "POST", "http://worker.local/user/register", {
    email: "Owner@Example.com",
    password: "password-1234",
  }, env);
  assert.equal(register.status, 200);
  assert.equal(register.body.ok, true);
  assert.equal(register.body.user.email, "owner@example.com");
  assert.equal(typeof register.body.token, "string");

  const me = await request(worker, "GET", "http://worker.local/user/me", null, env, register.body.token);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "owner@example.com");

  const login = await request(worker, "POST", "http://worker.local/user/login", {
    email: "owner@example.com",
    password: "password-1234",
  }, env);
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.token, "string");

  const scan = await request(worker, "POST", "http://worker.local/scan/jobs", {
    target: "overreacted.io",
    sync_probes: [],
    async_providers: [],
  }, env, register.body.token);
  assert.equal(scan.status, 200);
  assert.equal(scan.body.job.normalized_target, "overreacted.io");

  const history = await request(worker, "GET", "http://worker.local/user/history", null, env, register.body.token);
  assert.equal(history.status, 200);
  assert.equal(history.body.history.length, 1);
  assert.equal(history.body.history[0].job_id, scan.body.job.id);
  assert.equal(history.body.history[0].target, "overreacted.io");

  console.log("user auth and scan history check passed.");
} finally {
  await server.close();
}

async function request(worker, method, url, body = null, env = {}, token = null) {
  const headers = body === null ? {} : { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await worker.default.fetch(
    new Request(url, {
      method,
      headers,
      body: body === null ? null : JSON.stringify(body),
    }),
    env,
  );
  return {
    status: response.status,
    body: await response.json(),
  };
}

function createMemoryD1() {
  const users = new Map();
  const history = new Map();

  return {
    prepare(sql) {
      return createStatement(sql, users, history);
    },
  };
}

function createStatement(sql, users, history) {
  const normalized = sql.replace(/\s+/g, " ").trim();
  let params = [];

  return {
    bind(...values) {
      params = values;
      return this;
    },
    async run() {
      if (normalized.startsWith("INSERT INTO users")) {
        const [id, email, passwordHash, tokenVersion, createdAt] = params;
        users.set(id, {
          id,
          email,
          password_hash: passwordHash,
          token_version: tokenVersion,
          created_at: createdAt,
        });
        return { success: true };
      }

      if (normalized.startsWith("INSERT INTO scan_history")) {
        const [id, userId, jobId, target, status, createdAt, completedAt] = params;
        const key = `${userId}:${jobId}`;
        const existing = history.get(key);
        history.set(key, {
          id: existing?.id ?? id,
          user_id: userId,
          job_id: jobId,
          target,
          status,
          created_at: existing?.created_at ?? createdAt,
          completed_at: completedAt,
        });
        return { success: true };
      }

      if (normalized.startsWith("UPDATE scan_history")) {
        const [status, completedAt, userId, jobId] = params;
        const key = `${userId}:${jobId}`;
        const item = history.get(key);
        if (item) {
          history.set(key, {
            ...item,
            status,
            completed_at: completedAt ?? item.completed_at,
          });
        }
        return { success: true };
      }

      throw new Error(`Unsupported D1 run statement: ${normalized}`);
    },
    async first() {
      if (normalized === "SELECT * FROM users WHERE email = ?") {
        return [...users.values()].find((user) => user.email === params[0]) ?? null;
      }

      if (normalized === "SELECT * FROM users WHERE id = ?") {
        return users.get(params[0]) ?? null;
      }

      if (normalized === "SELECT * FROM scan_history WHERE user_id = ? AND job_id = ?") {
        return history.get(`${params[0]}:${params[1]}`) ?? null;
      }

      throw new Error(`Unsupported D1 first statement: ${normalized}`);
    },
    async all() {
      if (normalized === "SELECT * FROM scan_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?") {
        const [userId, limit] = params;
        const results = [...history.values()]
          .filter((item) => item.user_id === userId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, limit);
        return { results };
      }

      throw new Error(`Unsupported D1 all statement: ${normalized}`);
    },
  };
}

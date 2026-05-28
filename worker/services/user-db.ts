import type { D1Database } from "@cloudflare/workers-types";

export type UserRecord = {
  id: string;
  email: string;
  password_hash: string;
  token_version: number;
  created_at: string;
};

export type ScanHistoryRecord = {
  id: string;
  user_id: string;
  job_id: string;
  target: string;
  status: string;
  created_at: string;
  completed_at: string | null;
};

export function createUserRecord(input: {
  id?: string;
  email: string;
  passwordHash: string;
  createdAt?: string;
}): UserRecord {
  return {
    id: input.id ?? `user_${crypto.randomUUID()}`,
    email: input.email,
    password_hash: input.passwordHash,
    token_version: 0,
    created_at: input.createdAt ?? new Date().toISOString(),
  };
}

export async function insertUser(db: D1Database, user: UserRecord): Promise<UserRecord> {
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, token_version, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(user.id, user.email, user.password_hash, user.token_version, user.created_at)
    .run();
  return user;
}

export function findUserByEmail(db: D1Database, email: string): Promise<UserRecord | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRecord>();
}

export function findUserById(db: D1Database, id: string): Promise<UserRecord | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRecord>();
}

export async function upsertScanHistory(
  db: D1Database,
  input: {
    userId: string;
    jobId: string;
    target: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO scan_history (id, user_id, job_id, target, status, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, job_id) DO UPDATE SET
         target = excluded.target,
         status = excluded.status,
         completed_at = excluded.completed_at`,
    )
    .bind(
      `history_${crypto.randomUUID()}`,
      input.userId,
      input.jobId,
      input.target,
      input.status,
      input.createdAt,
      input.completedAt,
    )
    .run();
}

export async function updateScanHistoryStatus(
  db: D1Database,
  input: {
    userId: string;
    jobId: string;
    status: string;
    completedAt: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE scan_history
       SET status = ?, completed_at = COALESCE(?, completed_at)
       WHERE user_id = ? AND job_id = ?`,
    )
    .bind(input.status, input.completedAt, input.userId, input.jobId)
    .run();
}

export async function listScanHistory(
  db: D1Database,
  input: {
    userId: string;
    limit?: number;
  },
): Promise<ScanHistoryRecord[]> {
  const limit = input.limit ?? 50;
  const result = await db
    .prepare(
      `SELECT *
       FROM scan_history
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(input.userId, limit)
    .all<ScanHistoryRecord>();

  return result.results ?? [];
}

export function getScanHistoryByJobId(
  db: D1Database,
  input: {
    userId: string;
    jobId: string;
  },
): Promise<ScanHistoryRecord | null> {
  return db
    .prepare(
      `SELECT *
       FROM scan_history
       WHERE user_id = ? AND job_id = ?`,
    )
    .bind(input.userId, input.jobId)
    .first<ScanHistoryRecord>();
}

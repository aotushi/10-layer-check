import type { Env } from "../env";
import { signUserJwt, verifyUserJwt } from "../http/jwt";
import { hashPassword, verifyPassword } from "../http/password";
import { jsonResponse } from "../http/response";
import {
  createUserRecord,
  findUserByEmail,
  findUserById,
  getScanHistoryByJobId,
  insertUser,
  listScanHistory,
  type UserRecord,
} from "../services/user-db";

export type AuthenticatedUser = {
  id: string;
  email: string;
  tokenVersion: number;
};

export async function handleUserRoute(pathname: string, request: Request, env: Env): Promise<Response | null> {
  if (!pathname.startsWith("/user")) return null;

  if (pathname === "/user/register") {
    if (request.method !== "POST") return userErrorResponse("method_not_allowed", "Use POST /user/register.", 405);
    return handleRegister(request, env);
  }

  if (pathname === "/user/login") {
    if (request.method !== "POST") return userErrorResponse("method_not_allowed", "Use POST /user/login.", 405);
    return handleLogin(request, env);
  }

  if (pathname === "/user/me") {
    if (request.method !== "GET") return userErrorResponse("method_not_allowed", "Use GET /user/me.", 405);
    return handleMe(request, env);
  }

  if (pathname === "/user/history") {
    if (request.method !== "GET") return userErrorResponse("method_not_allowed", "Use GET /user/history.", 405);
    return handleHistory(request, env);
  }

  if (pathname.startsWith("/user/history/")) {
    if (request.method !== "GET") return userErrorResponse("method_not_allowed", "Use GET /user/history/:id.", 405);
    const jobId = decodeURIComponent(pathname.slice("/user/history/".length));
    return handleHistoryDetail(request, env, jobId);
  }

  return userErrorResponse("not_found", "User route not found.", 404);
}

export async function authenticateUserRequest(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const token = readBearerToken(request);
  if (!token || !env.JWT_SECRET || !env.SCAN_JOB_DB) return null;

  const payload = await verifyUserJwt(token, env.JWT_SECRET);
  if (!payload) return null;

  const user = await findUserById(env.SCAN_JOB_DB, payload.sub);
  if (!user || user.token_version !== payload.ver) return null;

  return {
    id: user.id,
    email: user.email,
    tokenVersion: user.token_version,
  };
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const configError = validateUserConfig(env);
  if (configError) return configError;

  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  const password = readPassword(body.password);
  const validationError = validateCredentials(email, password);
  if (validationError) return validationError;

  const existing = await findUserByEmail(env.SCAN_JOB_DB, email);
  if (existing) return userErrorResponse("email_taken", "Email is already registered.", 409);

  const user = createUserRecord({
    email,
    passwordHash: await hashPassword(password),
  });
  await insertUser(env.SCAN_JOB_DB, user);

  return createAuthResponse(user, env);
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const configError = validateUserConfig(env);
  if (configError) return configError;

  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  const password = readPassword(body.password);
  const validationError = validateCredentials(email, password);
  if (validationError) return validationError;

  const user = await findUserByEmail(env.SCAN_JOB_DB, email);
  const verified = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !verified) return userErrorResponse("invalid_credentials", "Invalid email or password.", 401);

  return createAuthResponse(user, env);
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedUser(request, env);
  if (auth.response) return auth.response;

  return jsonResponse({
    ok: true,
    user: toPublicUser(auth.user),
  });
}

async function handleHistory(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedUser(request, env);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const limit = readLimit(url.searchParams.get("limit"));
  return jsonResponse({
    ok: true,
    history: await listScanHistory(env.SCAN_JOB_DB, {
      userId: auth.user.id,
      limit,
    }),
  });
}

async function handleHistoryDetail(request: Request, env: Env, jobId: string): Promise<Response> {
  const auth = await requireAuthenticatedUser(request, env);
  if (auth.response) return auth.response;

  if (!jobId) return userErrorResponse("invalid_input", "History job id is required.", 400);
  const item = await getScanHistoryByJobId(env.SCAN_JOB_DB, {
    userId: auth.user.id,
    jobId,
  });

  if (!item) return userErrorResponse("not_found", "History item was not found.", 404);
  return jsonResponse({ ok: true, item });
}

async function requireAuthenticatedUser(
  request: Request,
  env: Env,
): Promise<
  | {
      user: AuthenticatedUser;
      response?: never;
    }
  | {
      user?: never;
      response: Response;
    }
> {
  const configError = validateUserConfig(env);
  if (configError) return { response: configError };

  const token = readBearerToken(request);
  if (!token) return { response: userErrorResponse("unauthorized", "Bearer token is required.", 401) };

  const user = await authenticateUserRequest(request, env);
  if (!user) return { response: userErrorResponse("unauthorized", "Invalid or expired bearer token.", 401) };

  return { user };
}

async function createAuthResponse(user: UserRecord, env: Env): Promise<Response> {
  const secret = env.JWT_SECRET;
  if (!secret) return userErrorResponse("not_configured", "JWT_SECRET is not configured.", 503);

  return jsonResponse({
    ok: true,
    user: toPublicUser(user),
    token: await signUserJwt({
      secret,
      userId: user.id,
      email: user.email,
      tokenVersion: user.token_version,
      expiresSeconds: env.JWT_EXPIRES_SECONDS,
    }),
  });
}

function validateUserConfig(env: Env): Response | null {
  if (!env.SCAN_JOB_DB) return userErrorResponse("not_configured", "SCAN_JOB_DB is not configured.", 503);
  if (!env.JWT_SECRET) return userErrorResponse("not_configured", "JWT_SECRET is not configured.", 503);
  return null;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const value = (await request.json()) as unknown;
  if (!isRecord(value)) throw new Error("Request body must be a JSON object.");
  return value;
}

function validateCredentials(email: string, password: string): Response | null {
  if (!email) return userErrorResponse("invalid_input", "A valid email is required.", 400);
  if (!password || password.length < 8) return userErrorResponse("invalid_input", "Password must be at least 8 characters.", 400);
  return null;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readPassword(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 50;
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

function toPublicUser(user: UserRecord | AuthenticatedUser) {
  return {
    id: user.id,
    email: user.email,
  };
}

function userErrorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ ok: false, code, message }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

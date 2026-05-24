import { jsonResponse } from "./response";

type AuthEnv = {
  PROBE_API_KEY?: string;
  ALLOW_LOCAL_DEV_NO_AUTH?: string;
};

export function authenticate(request: Request, env: AuthEnv): Response | null {
  if (env.ALLOW_LOCAL_DEV_NO_AUTH === "true") return null;

  if (!env.PROBE_API_KEY) {
    return jsonResponse({ error: "Remote PROBE_API_KEY is not configured." }, 503);
  }

  const apiKey = request.headers.get("x-api-key");
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;

  if (apiKey !== env.PROBE_API_KEY && bearer !== env.PROBE_API_KEY) {
    return jsonResponse({ error: "Unauthorized remote fetch request." }, 401);
  }

  return null;
}

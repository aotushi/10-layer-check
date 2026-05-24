import type { Env } from "../env";
import { jsonResponse } from "../http/response";
import { runRelatedDomainConfirmationProvider } from "../services/related-domain-confirmation";

export async function handleRelatedDomainsRoute(
  pathname: string,
  env: Env,
  body: Record<string, unknown>,
): Promise<Response | null> {
  if (pathname !== "/provider/related-domains/confirm") return null;

  const result = await runRelatedDomainConfirmationProvider(body, env);
  return jsonResponse(result, result.ok ? 200 : result.status);
}

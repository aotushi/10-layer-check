const DEFAULT_MAX_REDIRECTS = 10;

export function parseOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getResponseStatus(value: unknown): number {
  if (!isPlainObject(value)) return 200;
  const status = value.status;
  return typeof status === "number" && status >= 100 && status <= 599 ? status : 200;
}

export function normalizeTargetUrl(value: string): string {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https targets are supported. Received: ${url.protocol}`);
  }

  url.hash = "";
  return url.toString();
}

export function createScanRunId(normalizedTarget: string): string {
  return `scan-${normalizedTarget}-${crypto.randomUUID()}`;
}

export function parseTarget(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Request body requires a non-empty target string.");
  }

  return value.trim();
}

export function parseMaxRedirects(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_REDIRECTS;
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 20) {
    throw new Error("max_redirects must be an integer between 0 and 20.");
  }

  return parsed;
}

export function parseLighthouseStrategy(value: unknown): "mobile" | "desktop" {
  return value === "desktop" ? "desktop" : "mobile";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

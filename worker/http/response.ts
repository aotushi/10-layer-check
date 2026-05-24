export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-api-key",
  "access-control-max-age": "86400",
};

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function markdownResponse(value: string, filename?: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "text/markdown; charset=utf-8",
      ...(filename ? { "content-disposition": `attachment; filename="${filename}"` } : {}),
    },
  });
}

# Layer 6 API Reachability Boundary

Status: accepted for bounded backend implementation

Layer 6 covers public API / interface evidence: discovered endpoint candidates, CORS clues, error surface, protocol hints, and runtime API requests. The next engineering gap is reachability sampling for already-discovered API-like URLs.

## Goal

Add a default-safe Worker probe that checks whether public, same-origin API-like URL candidates are reachable and what non-sensitive response shape they expose.

## Allowed Automation

- Discover candidates from the target page using the same static HTML heuristic as the existing L6 API endpoint probe.
- Probe only same-origin candidates from the target origin.
- Use only `HEAD` and safe `GET` requests.
- Send no request body.
- Send no credentials, cookies, bearer tokens, or user-provided auth headers.
- Cap total candidate checks.
- Read only a small response preview when `GET` is used.
- Record status code, content type, selected CORS/cache/security headers, response size preview, and conservative error-surface signals.

## Forbidden Automation

- No POST/PUT/PATCH/DELETE.
- No authenticated endpoints.
- No brute forcing endpoint paths.
- No parameter fuzzing.
- No GraphQL introspection query.
- No mutation operations.
- No admin/logout/delete/payment/account/action-like paths.
- No cross-origin probing in the default probe.

## Result Contract

Worker probe:

```http
POST /probe/api-reachability
```

Scan sync probe:

```json
"api_reachability"
```

Expected provider result shape:

```ts
type ApiReachabilityResult = {
  requested_url: string;
  final_url: string;
  host: string;
  candidates: ApiReachabilityCandidate[];
  checks: ApiReachabilityCheck[];
  skipped: ApiReachabilitySkipped[];
  limits: {
    max_candidates: number;
    checked_count: number;
    same_origin_only: true;
    methods: ["HEAD", "GET"];
    preview_bytes: number;
  };
  coverage: {
    collected: string[];
    missing: string[];
    limitations: string[];
  };
  duration_ms: number;
  provider_id: "cloudflare_worker_api_reachability";
  source: "cloudflare_worker_api_reachability";
};
```

Normalizer output:

```text
Layer 6 / api_reachability_probe
```

## Evidence Wording

This probe may say:

- "N same-origin API-like candidates were sampled."
- "Candidate X returned HTTP 200 with JSON content type."
- "Candidate X returned HTTP 405 to HEAD and HTTP 200 to GET fallback."

This probe must not say:

- "All APIs are discovered."
- "The API is secure."
- "Authenticated API behavior is covered."
- "No hidden endpoints exist."

## Verification

Required checks:

```bash
npm run check:layer-06-api-reachability-boundary
npm run check:api-reachability-probe-module
npm run check:scan-sync-normalizer
npm run check
```

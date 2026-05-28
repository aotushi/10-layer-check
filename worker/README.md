# Worker Backend Architecture

This Worker is the product backend boundary for `03-web-app-shell`. It is no longer treated as a temporary fetch script.

## Goals

- Accept one user target URL and run backend-supported probes / providers.
- Keep Worker-safe probes close to the edge runtime.
- Delegate heavyweight or unavailable runtime work to external providers such as GitHub Actions, PageSpeed, WebPageTest, or AI providers.
- Return stable provider envelopes and scan artifacts that the Web App, future plugin, storage layer, and AI/report layer can consume.

## Current Boundary

```text
HTTP request
  -> worker/remote-fetch.ts
  -> route branch
  -> service orchestration
  -> probe / external provider function
  -> provider envelope
  -> core normalizer / artifact helper when requested
```

The current HTTP entry remains `worker/remote-fetch.ts`. It should become thinner over time, but route behavior must stay stable while code moves.

## Target Module Shape

```text
worker/
  remote-fetch.ts              # Current HTTP entry; route dispatch only after migration.
  README.md                    # Backend architecture and rules.
  env.ts                       # Current split: Worker environment binding shape.
  http/
    auth.ts                    # Current split: PROBE_API_KEY / local-dev auth.
    request.ts                 # Current split: shared request parsing helpers.
    response.ts                # Current split: CORS and JSON response helpers.
  routes/
    dispatch.ts                # Current split: endpoint allowlist, method checks, top-level dispatch.
    scan.ts                    # Current split: /scan/site/start and /scan/site/export route handlers.
    probes.ts                  # Current split: /probe/* handlers and scan sync probe execution.
    github.ts                  # Current split: /provider/github/* handlers.
    performance.ts             # Current split: /provider/performance/* handlers.
    ai.ts                      # Current split: /provider/ai/classifier.
  services/
    scan-orchestrator.ts       # Current first split: scan start/export orchestration.
    scan-storage.ts            # Current split: KV-backed persisted scan job state for id-based job routes.
    performance-providers.ts   # Current second split: PageSpeed / WebPageTest provider boundary.
    github-actions.ts          # Current third split: GitHub Actions provider boundary.
    ai-classifier.ts           # Current fourth split: AI classifier provider boundary.
  probes/
    remote-fetch.ts            # Current split: Worker remote_fetch probe implementation.
    dns-infrastructure.ts      # Current split: L1 DNS / ASN / protocol reachability probe.
    tls-certificate.ts         # Current split: L2 HTTPS / HSTS / CT metadata probe.
    subdomain-attack-surface.ts # Current split: L7 CT subdomain candidate / bounded reachability probe.
    organization-intelligence.ts # Current split: L9 DNS org hints / RDAP / Wayback / related-domain candidates.
    performance-basic.ts       # Current fifth split: L5 Worker baseline performance probe.
```

## Responsibilities

| Layer | Responsibility | Must Not |
| --- | --- | --- |
| HTTP entry / route | Parse request, enforce method/auth, select handler, return JSON response. | Implement probe details or report logic. |
| Service orchestration | Combine probes/providers into a product workflow such as scan start/export. | Fetch arbitrary external APIs directly unless delegated through provider dependencies. |
| Storage adapter | Persist bounded job metadata/raw/artifact state through explicit Worker bindings. | Run remote D1 migrations or hide missing storage as success. |
| Probe implementation | Collect one concrete Worker-safe evidence slice. | Claim whole-layer completion from a partial signal. |
| External provider adapter | Start/poll/read one external provider and return a provider envelope. | Convert failed or pending provider state into positive target evidence. |
| Core/report helper | Normalize envelopes and build Analysis/ReportBrief/Markdown/artifacts. | Call external providers or mutate frontend state. |

## Endpoint Rules

- `POST /scan/site/start` returns raw `site-10-layer-scan-start/v0.1` only.
- `POST /scan/site/start` must not return normalized `SnapshotRecord[]`, `AnalysisReport`, `ReportBrief`, or Markdown.
- `POST /scan/site/export` returns `site-10-layer-scan-export-artifact/v0.1`.
- `POST /scan/site/export` may normalize immediately completed provider envelopes, such as embedded PageSpeed results.
- Long-running async jobs, such as queued WebPageTest or GitHub Actions jobs, remain provider state until completed result envelopes are available.
- Failed, missing-config, pending, malformed, or unsupported provider results become status-only evidence boundaries.
- `POST /scan/jobs` may persist through `SCAN_JOB_KV` when the binding is configured; without KV, id-based routes must return structured `storage_not_configured`.
- When a request carries a valid user JWT, persisted scan job id routes must enforce D1 ownership through `scan_history.user_id + job_id` before returning job state, artifacts, or derived report output. Cross-user access returns `not_found` to avoid exposing whether another user's job exists.
- `POST /scan/jobs/:id/poll` may poll pending persisted provider jobs by reusing existing provider service functions; it must only merge completed result envelopes and must not convert pending provider state into positive evidence.
- API-key and local service flows keep service-level access to persisted scan jobs; they are operational integration paths, not end-user dashboard authorization.
- D1 is reserved for future login/history/query needs. No route may run D1 schema changes, migrations, remote writes, or hidden database side effects without explicit approval.

## Framework Policy

No third-party Worker framework is introduced in the first architecture pass.

Reason: the current risk is unclear responsibility boundaries, not missing route syntax. First split service/probe/provider boundaries using native `fetch`. Consider Hono later only after business modules are already separated and route count / middleware duplication justifies it.

## Verification Policy

Every movement must preserve behavior with focused checks:

```powershell
npm run check:backend-scan-contract
npm run check:worker-scan-export
npm run check:scan-performance-providers
npm run check:browser-runtime-worker-provider
npm run check:scan-export-artifact
npm run check
npm run build
```

When moving a new endpoint family, add or reuse a focused verifier before changing behavior.

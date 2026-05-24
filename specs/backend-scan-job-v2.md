# Backend Scan Job V2 Spec

Status: draft

Path: `specs/backend-scan-job-v2.md`

Implementation status:

- V2.0 no-storage model/helper exists in `src/scan/job.ts`.
- `POST /scan/jobs` exists as the first no-storage Worker endpoint boundary.
- `POST /scan/jobs/collect` and `POST /scan/jobs/artifact` exist as caller-owned no-storage endpoints.
- `backend-signed-job-handle.md` clarifies that signed handles can make caller-owned state tamper-resistant, but do not support id-only recovery.
- Signed-handle runtime support exists for `/scan/jobs`, `/scan/jobs/collect`, and `/scan/jobs/artifact` when `SCAN_JOB_HANDLE_SECRET` and `SCAN_JOB_HANDLE_KID` are configured.
- id-based `GET /scan/jobs/:id`, `POST /scan/jobs/:id/collect`, `POST /scan/jobs/:id/cancel`, and `GET /scan/jobs/:id/artifact` are still blocked because no persistent job store exists yet.

This spec defines the next backend shape for `03-web-app-shell`. It exists because the current `POST /scan/site/start` contract is intentionally raw-only: it starts sync probes and async providers, but it does not own job state, provider polling, storage, or final artifact lifecycle.

The Web App remains the primary product surface. The frontend should still be able to submit one URL and receive a coherent scan result, but the durable orchestration model belongs behind the Worker/backend boundary.

## Scope

In scope:

- Backend scan job lifecycle.
- Sync Worker probe orchestration.
- Async provider job orchestration.
- Provider result normalization into `SnapshotRecord[]`.
- Stable scan artifact assembly.
- Explicit provider policy, quota, timeout, and permission boundaries.
- A no-storage V2.0 slice before any persistent storage is added.

Out of scope for this spec:

- Frontend redesign.
- Browser extension implementation.
- User accounts or team management.
- Database schema implementation.
- Remote D1 operations.
- Port scanning, intrusive security testing, credential probing, or user enumeration.
- AI narrative generation.

## Current V1 Boundary

Current backend endpoints:

| Endpoint | Role | Limitation |
| --- | --- | --- |
| `POST /scan/site/start` | Starts selected sync probes and async providers; returns raw provider envelopes. | No persisted job, no owned polling, no final normalized records. |
| `POST /scan/site/export` | Convenience endpoint that starts a scan and immediately builds a scan export artifact from available results. | Still request/response only; no durable async collection. |
| `/provider/*` | Provider-specific start/status/result endpoints. | Caller still coordinates provider polling and final merge. |
| `/probe/*` | Single Worker-safe probe endpoints. | Debug/provider endpoints, not the product-level job model. |

V1 remains valid and should not be broken while V2 is introduced.

## V2 Goal

V2 turns the backend into an explicit scan job coordinator:

```text
POST /scan/jobs
-> create ScanJob
-> run sync Worker probes
-> dispatch async ProviderJob entries
-> collect completed provider envelopes
-> normalize to SnapshotRecord[]
-> assemble ScanExportArtifact
-> expose final artifact
```

The first implementation slice is V2.0 no-storage. It should prove the model and normalizers without adding D1, KV, R2, login, or frontend redesign.

## Core Model

```ts
type ScanJob = {
  id: string;
  target: string;
  normalized_target: string;
  status:
    | "created"
    | "running_sync"
    | "async_pending"
    | "collecting_async"
    | "normalizing"
    | "report_ready"
    | "completed"
    | "partial"
    | "failed"
    | "cancelled";
  requested_sync_probes: string[];
  requested_async_providers: string[];
  provider_jobs: ProviderJob[];
  records: SnapshotRecord[];
  artifact_ref: string | null;
  error: ScanError | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ProviderJob = {
  id: string;
  scan_id: string;
  provider: string;
  capability: string;
  status:
    | "queued"
    | "dispatching"
    | "running"
    | "polling"
    | "completed"
    | "failed"
    | "skipped"
    | "cancelled";
  attempt_count: number;
  request_payload: unknown;
  result_envelope: unknown | null;
  normalized_record_count: number;
  error: ScanError | null;
  policy: ProviderPolicy;
  started_at: string | null;
  completed_at: string | null;
};

type ProviderPolicy = {
  requires_secret: string[];
  requires_permission: boolean;
  timeout_ms: number;
  retry_limit: number;
  rate_limit_key: string;
  max_result_bytes: number;
  quota_cost_hint: string | null;
};

type ScanError = {
  code: string;
  message: string;
  provider?: string;
  retryable: boolean;
};
```

## Lifecycle

Happy path:

```text
created
-> running_sync
-> async_pending
-> collecting_async
-> normalizing
-> report_ready
-> completed
```

Partial path:

```text
created
-> running_sync
-> async_pending
-> collecting_async
-> normalizing
-> partial
```

Failure path:

```text
created
-> running_sync
-> failed
```

Rules:

- `partial` means at least one selected provider failed or stayed pending, but the scan still has usable normalized records or a usable artifact.
- `failed` means no usable scan result can be produced.
- Provider failures must become explicit provider-state records or missing-data entries; they must not become positive layer evidence.
- Cancellation must stop new dispatches, but it does not need to cancel already-running third-party provider jobs in V2.0.

## V2 Endpoint Sketch

Canonical endpoint identifiers:

- `POST /scan/jobs`
- `GET /scan/jobs/:id`
- `POST /scan/jobs/:id/collect`
- `POST /scan/jobs/:id/cancel`
- `GET /scan/jobs/:id/artifact`

| Endpoint | Method | Role |
| --- | --- | --- |
| `/scan/jobs` | `POST` | Create a scan job, run selected sync probes, dispatch selected async providers, and return the job state. |
| `/scan/jobs/collect` | `POST` | Caller-owned no-storage endpoint. Accepts prior `ScanJob` and async result envelopes, returns updated job state. |
| `/scan/jobs/artifact` | `POST` | Caller-owned no-storage endpoint. Accepts prior `ScanJob`, returns `ScanExportArtifact`. |
| `/scan/jobs/:id` | `GET` | Planned. Read current job state once a storage/job handle exists. |
| `/scan/jobs/:id/collect` | `POST` | Planned. Collect or poll async provider results and update job state once a storage/job handle exists. |
| `/scan/jobs/:id/cancel` | `POST` | Planned. Mark job cancelled and stop further backend dispatch once a storage/job handle exists. |
| `/scan/jobs/:id/artifact` | `GET` | Planned. Return the current or final `ScanExportArtifact` once a storage/job handle exists. |

V2.0 implements the model/helper first and exposes only `POST /scan/jobs` as a no-storage runtime boundary. Follow-up endpoints should not be added until their state ownership story is explicit.

## Follow-up Endpoint Decision

Decision: do not implement no-storage follow-up endpoints yet.

Affected planned endpoints:

- `GET /scan/jobs/:id`
- `POST /scan/jobs/:id/collect`
- `POST /scan/jobs/:id/cancel`
- `GET /scan/jobs/:id/artifact`

Reason:

- A follow-up endpoint requires a recoverable job handle.
- V2.0 currently has no D1/KV/R2 storage and no in-memory state guarantee across Worker requests.
- Returning a `ScanJob` from `POST /scan/jobs` is safe because it is request-local and preserves the raw V1 scan-start envelope.
- Reading, collecting, cancelling, or returning later artifacts needs either durable storage or an explicitly signed/self-contained job handle.
- Adding those routes without state ownership would create misleading APIs that cannot reliably recover the original job.

Next allowed step:

- Follow `specs/backend-storage-job-handle.md`, which chooses one of:
  - self-contained signed job token;
  - KV/R2/D1-backed job persistence;
  - caller-owned state where collect/artifact accepts the whole prior job envelope.
- Only after that spec is accepted should `GET /scan/jobs/:id`, `collect`, `cancel`, or `artifact` be implemented.

Current endpoint policy:

| Endpoint | V2.0 Decision | Reason |
| --- | --- | --- |
| `POST /scan/jobs` | Implemented | Request-local job creation is deterministic and does not require recovery. |
| `GET /scan/jobs/:id` | Do not implement yet | Needs recoverable job state. |
| `POST /scan/jobs/:id/collect` | Do not implement yet | Needs recoverable job state plus provider polling policy. |
| `POST /scan/jobs/:id/cancel` | Do not implement yet | Needs persisted job state and cancellation semantics. |
| `GET /scan/jobs/:id/artifact` | Do not implement yet | Needs artifact persistence or a self-contained job handle. |

## Storage Boundary

V2.0 no-storage:

- No D1, KV, R2, login, or user tables.
- Job state may be represented by pure functions and fixtures.
- Current `/scan/site/start` and `/scan/site/export` remain the runtime endpoints.
- Verification focuses on state transitions, provider job envelopes, normalization, and artifact assembly.

V2.1 persistent:

- May introduce D1/KV/R2 after a separate storage spec.
- No remote D1 command may be run without explicit user approval.
- Storage must preserve raw provider envelopes, normalized records, final artifact metadata, provider job status, and provider policy fields.
- Secrets remain Worker secrets or future user/team secret references, never frontend-visible values.

## Provider Mapping

| Capability | Current Provider | Runtime |
| --- | --- | --- |
| Main response / headers / HTML / static signals | `remote_fetch` | Worker sync probe |
| DNS / ASN / protocol reachability | `dns_infrastructure` | Worker sync probe |
| HTTPS / HSTS / CT metadata | `tls_certificate` | Worker sync probe |
| Live TLS certificate chain | `live_tls` | GitHub Actions async provider |
| Subdomain candidates / bounded reachability | `subdomain_attack_surface` | Worker sync probe |
| Organization DNS / RDAP / Wayback / social / related candidates | `organization_intelligence` | Worker sync probe |
| Basic TTFB / page weight estimate | `performance_basic` | Worker sync probe |
| Lighthouse | `lighthouse` | GitHub Actions async provider |
| Browser runtime resource/API/security observation | `browser_runtime` | GitHub Actions async provider |
| PageSpeed | `pagespeed` | Worker-mediated external API provider |
| WebPageTest | `webpagetest` | Worker-mediated external API async provider |
| L4/L8 AI classification | `ai_classifier` | Worker-mediated AI provider |

## Security And Policy

Required guardrails:

- `PROBE_API_KEY` protects deployed Worker probe/provider/job endpoints.
- Local no-auth probing must remain explicitly opt-in via `ALLOW_LOCAL_DEV_NO_AUTH=true`.
- Target normalization must reject unsupported protocols.
- Private IP, localhost, metadata service, and internal network targets require a separate SSRF protection decision before V2 runtime endpoints are exposed.
- Provider jobs must declare `ProviderPolicy`.
- Provider result size must be bounded by `max_result_bytes`.
- Provider failures and missing secrets must be represented as provider state, not collected target evidence.
- Deep L7 scans and L10 user-enumeration style checks require explicit permission and must stay out of default V2.

## Acceptance

This spec slice is accepted when:

- This file exists and is linked from root README, `03-web-app-shell/README.md`, the 10-layer acceptance spec, and `.scratch/10-layer-site-check/task.md`.
- It defines `ScanJob`, `ProviderJob`, `ProviderPolicy`, `ScanError`, lifecycle states, V2 endpoints, and Storage Boundary.
- It distinguishes V2.0 no-storage from V2.1 persistent storage.
- It states that existing V1 endpoints remain valid.
- It preserves the frontend freeze and does not require UI changes.
- It preserves the no remote D1 guardrail.
- `npm run check:backend-scan-job-v2-spec` passes.

## Next Implementation Slice

After this planning slice, the next code slice should be:

```text
Implement no-storage ScanJob model helpers and fixtures.
```

Acceptance for that later slice:

- A fixture can convert a raw `site-10-layer-scan-start/v0.1` envelope into a `ScanJob`.
- Completed async result envelopes can update matching `ProviderJob` entries.
- Job state moves to `completed` or `partial` according to provider outcomes.
- Artifact assembly still uses existing `createScanExportArtifact`.
- No frontend files are modified.

Current implementation verifier:

```bash
npm run check:backend-scan-job-v2-endpoint
```

This proves `POST /scan/jobs` returns `site-10-layer-scan-job/v0.1`, preserves the raw V1 scan-start envelope, includes normalized sync records, exposes async `ProviderJob` state and policy, and keeps `storage_persisted=false`.

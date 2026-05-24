# Backend Storage / Job Handle Spec

Status: draft

Path: `specs/backend-storage-job-handle.md`

Implementation status:

- `POST /scan/jobs/collect` is implemented as a V2.1 caller-owned no-storage endpoint.
- `POST /scan/jobs/artifact` is implemented as a V2.1 caller-owned no-storage endpoint.
- `backend-signed-job-handle.md` defines the signed-handle boundary: signed handles can upgrade caller-owned state, but do not enable id-only job recovery.
- Signed-handle runtime support is implemented for `/scan/jobs`, `/scan/jobs/collect`, and `/scan/jobs/artifact` when `SCAN_JOB_HANDLE_SECRET` and `SCAN_JOB_HANDLE_KID` are configured.
- `backend-persisted-job-store.md` defines the persisted KV/R2-first job store boundary required before id-based endpoints.
- id-based `GET /scan/jobs/:id`, `POST /scan/jobs/:id/collect`, `POST /scan/jobs/:id/cancel`, and `GET /scan/jobs/:id/artifact` remain blocked until persisted storage exists. Signed handles may upgrade caller-owned POST bodies, but they are not id-only storage.

This spec decides how Backend Scan Job V2 can recover job state across requests. It is the prerequisite for `GET /scan/jobs/:id`, `POST /scan/jobs/:id/collect`, `POST /scan/jobs/:id/cancel`, and `GET /scan/jobs/:id/artifact`.

## Problem

`POST /scan/jobs` currently returns a no-storage `ScanJob` in one request. That is valid because all state is produced and returned immediately.

Follow-up endpoints need state recovery:

- read the same job later;
- collect async provider results against the same provider jobs;
- cancel a job;
- return a previously assembled artifact.

Cloudflare Workers do not provide reliable in-memory state across requests. Therefore, follow-up endpoints require one explicit state ownership model.

## Options

| Option | Description | Pros | Cons | Current Decision |
| --- | --- | --- | --- | --- |
| Caller-owned state | The client sends the prior `ScanJob` / raw scan envelope back to collect or artifact endpoints. | No storage, easiest to test, transparent. | Larger request bodies; client owns state integrity unless signed. | Acceptable for a V2.1 no-storage collect prototype. |
| Signed job token | Worker returns a compact signed token containing enough job state or a pointer. | No DB required; prevents tampering. | Needs signing secret, max payload limits, rotation policy. | Acceptable after token format spec. |
| KV/R2 job store | Worker writes job and artifacts to KV/R2. | Durable enough for async artifacts; simple key-value model. | Needs TTL, cleanup, quota, consistency policy. | Candidate for login-less product history. |
| D1 job store | Worker writes job metadata and provider state to D1. | Queryable, relational, good for users/history. | Requires schema/migrations and explicit remote D1 approval. | Not in current no-user slice. |
| Browser localStorage only | Frontend stores job state and calls existing provider endpoints directly. | Already possible in Web App. | Does not make backend the orchestration owner. | Debug/fallback only, not V2 backend. |

## Recommendation

Use a two-step path:

1. V2.1 no-storage caller-owned state:
   - add `POST /scan/jobs/collect` and/or `POST /scan/jobs/artifact` only if the full prior `ScanJob` or raw scan-start envelope is included in the request body;
   - do not add `GET /scan/jobs/:id`;
   - do not claim backend persistence;
   - preserve `storage_persisted=false`.

2. V2.2 persisted job store:
   - introduce KV/R2 or D1 only after a separate storage implementation spec;
   - add `GET /scan/jobs/:id`, `POST /scan/jobs/:id/collect`, `POST /scan/jobs/:id/cancel`, and `GET /scan/jobs/:id/artifact`;
   - preserve raw provider envelopes, normalized records, provider job status, artifacts, timestamps, and failure state.

This keeps the next implementation useful without pretending a no-storage Worker can recover state by id.

## V2.1 Caller-Owned State Contract

Allowed endpoints:

| Endpoint | Method | Body | Output |
| --- | --- | --- | --- |
| `/scan/jobs/collect` | `POST` | `{ job, async_result_envelopes }` | Updated `site-10-layer-scan-job/v0.1` envelope |
| `/scan/jobs/artifact` | `POST` | `{ job }` | `site-10-layer-scan-export-artifact/v0.1` |

Blocked endpoints in V2.1:

- `GET /scan/jobs/:id`
- `POST /scan/jobs/:id/collect`
- `POST /scan/jobs/:id/cancel`
- `GET /scan/jobs/:id/artifact`

Reason: id-based endpoints imply server-owned state, which V2.1 does not have.

## V2.2 Persistent Store Contract

Persistent storage must preserve:

- `ScanJob.id`
- `target`
- `normalized_target`
- `status`
- requested sync probes and async providers
- `ProviderJob[]`
- raw `scan_start_envelope`
- async result envelopes
- normalized `SnapshotRecord[]`
- artifact metadata or artifact object reference
- errors
- timestamps
- provider policy fields

Persistent storage must define:

- TTL and cleanup policy
- max artifact size
- secret storage boundary
- rate-limit key
- migration strategy
- local-only validation path
- remote operation approval path

No remote D1 operation may be executed without explicit user approval.

## Acceptance

This spec is accepted when:

- It explains why no-storage id-based endpoints are blocked.
- It selects caller-owned state as the only acceptable no-storage follow-up model.
- It reserves id-based `GET/collect/cancel/artifact` for a persisted store.
- It documents required persisted fields.
- It preserves the no remote D1 guardrail.
- `npm run check:backend-storage-job-handle-spec` passes.

Current implementation verifier:

```bash
npm run check:backend-scan-job-v2-caller-owned-endpoints
```

This proves caller-owned collect can merge completed async provider envelopes into the prior job and caller-owned artifact can render the resulting job into `site-10-layer-scan-export-artifact/v0.1` without storage or frontend mutation.

Signed-handle verifier:

```bash
npm run check:backend-signed-job-handle-spec
```

This proves `backend-signed-job-handle.md` keeps signed handles scoped to tamper-resistant caller-owned state and keeps id-only job recovery blocked without persisted storage.

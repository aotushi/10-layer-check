# Backend Signed Job Handle Spec

Status: draft

Path: `specs/backend-signed-job-handle.md`

Implementation status:

- `src/scan/signed-job-handle.ts` implements HMAC-SHA-256 signed handles.
- `/scan/jobs` returns `job_handle` when `SCAN_JOB_HANDLE_SECRET` and `SCAN_JOB_HANDLE_KID` are configured.
- `/scan/jobs/collect` accepts `{ job_handle, async_result_envelopes }` as an alternative to raw `{ job, async_result_envelopes }`.
- `/scan/jobs/artifact` accepts `{ job_handle }` as an alternative to raw `{ job }`.
- Tampered handles are rejected before artifact assembly or async result merge.
- id-based job endpoints remain blocked because signed handles are still caller-owned state, not server storage.

This spec refines the `Signed job token` option from `backend-storage-job-handle.md`. It decides whether signed handles are enough to support id-based scan job endpoints without D1/KV/R2.

## Decision

Signed handles are useful for tamper-resistant caller-owned state, but they do not by themselves support id-based `GET /scan/jobs/:id` recovery.

Therefore:

- `POST /scan/jobs/collect` and `POST /scan/jobs/artifact` may later accept a signed `job_handle` instead of a raw `job` body.
- `GET /scan/jobs/:id`, `POST /scan/jobs/:id/collect`, `POST /scan/jobs/:id/cancel`, and `GET /scan/jobs/:id/artifact` remain blocked unless a persisted store exists.
- Do not place full job state in a URL path or query string.
- Do not treat signed tokens as storage.

## Why Signed Handles Are Not Id-Based Storage

A signed handle can prove that the state came from the Worker and was not tampered with. It cannot make the Worker remember state by id after the request ends.

Id-based endpoints imply server-owned state:

```text
GET /scan/jobs/:id
```

The request only carries `id`, so the Worker needs a durable lookup table. A signed token can avoid a DB only if the client sends the token back in the request body or an authorization-style header.

## Allowed No-Storage Signed Handle Shape

Allowed endpoints:

| Endpoint | Method | Body | Output |
| --- | --- | --- | --- |
| `/scan/jobs/collect` | `POST` | `{ job_handle, async_result_envelopes }` | Updated `site-10-layer-scan-job/v0.1` and next `job_handle` |
| `/scan/jobs/artifact` | `POST` | `{ job_handle }` | `site-10-layer-scan-export-artifact/v0.1` |

Allowed response addition:

```ts
type SignedJobHandle = {
  schema_version: "site-10-layer-signed-job-handle/v0.1";
  alg: "HMAC-SHA-256";
  kid: string;
  issued_at: string;
  expires_at: string;
  token: string;
};
```

Payload fields inside the signed token:

- `scan_id`
- `target`
- `normalized_target`
- `created_at`
- `updated_at`
- `expires_at`
- compressed or compacted `ScanJob`
- `schema_version`

## Required Worker Configuration

Signed handles require:

- `SCAN_JOB_HANDLE_SECRET`
- `SCAN_JOB_HANDLE_KID`
- `SCAN_JOB_HANDLE_TTL_SECONDS`
- maximum decoded payload size
- maximum encoded token size
- key rotation policy

Current optional Worker vars:

- `SCAN_JOB_HANDLE_SECRET`
- `SCAN_JOB_HANDLE_KID`
- `SCAN_JOB_HANDLE_TTL_SECONDS` defaults to `3600`
- `SCAN_JOB_HANDLE_MAX_PAYLOAD_BYTES` defaults to `1000000`
- `SCAN_JOB_HANDLE_MAX_TOKEN_BYTES` defaults to `1500000`

If these values are missing, signed-handle endpoints must fail with a structured provider/state error and must not silently fall back to unsigned state.

## Security Boundaries

Signed handles must:

- use HMAC with Web Crypto in Worker runtime;
- include expiration;
- include `kid` for key rotation;
- be verified before any provider result is merged;
- reject expired handles;
- reject handles whose decoded size exceeds the configured maximum;
- never include secrets, API keys, provider tokens, or user credentials;
- preserve `storage_persisted=false`;
- be logged only as redacted metadata, never as full token text.

Signed handles must not:

- be sent as URL path or query params;
- be treated as durable history;
- support cancellation of external provider jobs unless the provider itself supports cancellation and a persisted job state exists;
- allow id-only lookup.

## Persistence Path

If the product needs true id-based endpoints, use persisted storage:

| Requirement | Minimum State Model |
| --- | --- |
| `GET /scan/jobs/:id` | KV/R2/D1 job metadata lookup |
| `POST /scan/jobs/:id/collect` | KV/R2/D1 job state plus provider result merge |
| `POST /scan/jobs/:id/cancel` | Persisted job state and provider-specific cancellation policy |
| `GET /scan/jobs/:id/artifact` | Persisted artifact or artifact reference |
| User history | Login/team model plus DB or object store |

No remote D1 operation may be executed without explicit user approval.

The persisted storage boundary is defined in `backend-persisted-job-store.md`.

## Implementation Recommendation

Next implementation should not add id-based endpoints.

If no database is wanted yet, implement signed handles only as an upgrade to the existing caller-owned endpoints:

1. Add pure helpers:
   - `createSignedJobHandle(job)`
   - `verifySignedJobHandle(handle)`
2. Add local verifier fixtures for valid, tampered, expired, and oversized handles.
3. Add optional `job_handle` support to `/scan/jobs/collect` and `/scan/jobs/artifact`.
4. Keep raw `job` body support during transition.
5. Keep `GET /scan/jobs/:id` blocked.

## Acceptance

This spec is accepted when:

- It states signed handles do not support id-only job recovery.
- It allows signed handles only as caller-owned state carried in request body/header.
- It defines required Worker configuration.
- It defines token payload and expiration boundaries.
- It keeps id-based endpoints blocked without persisted storage.
- It preserves the no remote D1 guardrail.
- `npm run check:backend-signed-job-handle-spec` passes.
- `npm run check:backend-scan-job-v2-caller-owned-endpoints` proves signed-handle runtime compatibility.

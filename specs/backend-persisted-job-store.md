# Backend Persisted Job Store Spec

Status: draft

Path: `specs/backend-persisted-job-store.md`

Implementation status:

- `src/scan/storage.ts` defines `ScanJobStore`, `ScanArtifactStore`, `PersistedScanJobMeta`, in-memory test adapters, redaction helper, size limits, TTL behavior, and `storage_not_configured` status shape.
- `src/scan/policy.ts` defines the default backend `scan_policy` contract for public/default-triggered checks and denied permissioned/security-depth checks.
- `check:backend-storage-ports` verifies local storage ports without remote bindings.
- Worker id-based job routes now return structured `storage_not_configured` until real storage adapters/bindings are injected.
- `check:backend-persisted-job-store-routes` verifies `GET /scan/jobs/:id`, `POST /scan/jobs/:id/collect`, `POST /scan/jobs/:id/cancel`, and `GET /scan/jobs/:id/artifact` missing-storage behavior.
- `wrangler.toml` now binds user-provided `SCAN_JOB_KV` and `SCAN_JOB_DB`; no remote D1 command has been executed.
- `worker/services/scan-storage.ts` injects `SCAN_JOB_KV` as the first persisted scan job store and keeps `SCAN_JOB_DB` reserved for later login/history/query needs.
- `check:backend-persisted-job-store-kv-routes` verifies create/read/collect/cancel/artifact lifecycle with a local fake KV binding.
- `POST /scan/jobs/:id/poll` polls persisted async provider jobs through existing provider service functions and is verified by `check:backend-persisted-job-store-polling`.
- Worker version `6f0b5525-824a-47a6-b774-f432a37195a5` is deployed with `SCAN_JOB_KV` / `SCAN_JOB_DB` bindings, and `smoke:persisted-job-remote` passed against `https://probe.9shi.cc` without any D1 command.

This spec defines the storage boundary required before id-based scan job endpoints can exist.

## Decision

Do not implement id-based job endpoints until a persisted store is configured and locally verified.

Recommended first persisted model for the no-user Web App:

- KV for job index / status metadata.
- KV can also hold bounded raw job payloads and export artifacts for the first no-user slice, with strict byte limits and TTL.
- R2 remains the recommended upgrade path for larger raw envelopes and final scan export artifacts.
- R2 for larger raw envelopes and final scan export artifacts.
- D1 only after login/history/query requirements justify relational storage.

This avoids remote D1 migrations in the current product phase while still allowing job recovery by id.

## Required Endpoints After Persistence Exists

| Endpoint | Method | Requires Store | Role |
| --- | --- | --- | --- |
| `/scan/jobs/:id` | `GET` | yes | Read job status and provider state. |
| `/scan/jobs/:id/collect` | `POST` | yes | Poll/merge completed async provider result envelopes into stored job state. |
| `/scan/jobs/:id/poll` | `POST` | yes | Ask the backend to poll pending provider status/result endpoints and merge completed results. |
| `/scan/jobs/:id/cancel` | `POST` | yes | Mark job cancelled and stop future polling where provider supports it. |
| `/scan/jobs/:id/artifact` | `GET` | yes | Return stored artifact or assemble from stored raw inputs. |

Until bindings are configured, these endpoints must return structured `storage_not_configured` if introduced for local testing, or remain unregistered.

## Storage Shape

Job metadata should be stored separately from large raw payloads.

```ts
type PersistedScanJobMeta = {
  schema_version: "site-10-layer-persisted-scan-job-meta/v0.1";
  id: string;
  target: string;
  normalized_target: string;
  status: ScanJobStatus;
  scan_policy: ScanPolicy;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  requested_sync_probes: string[];
  requested_async_providers: string[];
  provider_jobs: ProviderJob[];
  raw_ref: string;
  artifact_ref: string | null;
  error: ScanError | null;
  ttl_expires_at: string;
};
```

Large object payloads:

- raw scan-start envelope
- async result envelopes
- normalized records
- scan export artifact
- markdown output

## Binding Names

Suggested Worker bindings:

- `SCAN_JOB_KV`
- `SCAN_ARTIFACT_BUCKET` (future, for large artifacts)

Optional later D1 binding:

- `SCAN_JOB_DB`

No code should assume these bindings exist until `wrangler.toml`, local dev config, and verifier fixtures are added.

## Persistence Policy

Required policy fields:

- `SCAN_JOB_TTL_SECONDS`
- max raw envelope bytes
- max artifact bytes
- max jobs per API key / future user
- storage namespace version
- cleanup behavior
- redaction policy

Default TTL recommendation: 7 days for no-user beta.

## Security And Privacy

Persisted storage must not store:

- API keys
- bearer tokens
- provider secrets
- cookies
- authorization headers
- full signed job handles
- user credentials

Persisted storage may store:

- target URL
- normalized target
- response metadata
- public headers after redaction
- evidence records
- provider job ids
- provider run URLs
- generated reports

Persisted scan jobs and exported artifacts must include `scan_policy`:

- profile
- authorization basis
- scope policy
- allowed checks
- denied checks
- limits
- audit metadata

The default profile is `public_default`. Bounded public CORS/header/API/cookie/CMS metadata observations are allowed by default for the backend full scan. Intrusive or enumeration-like behavior remains denied by default, including WordPress user enumeration, login rate-limit validation, and deep port/service inventory.

Before writing any persisted artifact, redact:

- `authorization`
- `cookie`
- `set-cookie`
- `x-api-key`
- `proxy-authorization`

## Local Verification First

Before any deployed storage use:

1. Add in-memory fake KV/R2 adapters for tests.
2. Prove create/read/collect/artifact lifecycle locally.
3. Prove missing binding returns structured error.
4. Prove redaction removes sensitive header values.
5. Prove TTL and size limits reject oversized artifacts.

## Remote Operation Guardrail

No remote D1 operation may be executed without explicit user approval.

For KV/R2:

- Creating or binding remote namespaces/buckets must be explicit and documented.
- Deployment may reference existing bindings only after the user confirms names.
- Local tests must pass before any remote deploy.

## Implementation Order

1. Add pure storage port interfaces:
   - `ScanJobStore`
   - `ScanArtifactStore`
2. Add in-memory test adapters.
3. Add `storage_not_configured` Worker response helpers.
4. Add id-based route tests using fake adapters.
5. Add runtime routes only after storage adapters are injected.
6. Add Wrangler bindings only after user confirms desired KV/D1/R2 names.

Current implementation note:

- User-confirmed KV binding: `SCAN_JOB_KV`, namespace `kv-for-site10layer`, id `bb485af9804a448b91b5e09103dce877`.
- User-confirmed D1 binding: `SCAN_JOB_DB`, database `db-for-site10layer`, id `bf7c75e1-5108-4088-951a-780824bf541a`.
- D1 is bound for future use only; this slice does not prepare, migrate, read, write, or delete D1 data.
- Because no R2 bucket was provided, first persisted artifacts are stored in KV under bounded refs:
  - `scan-jobs/meta/{id}.json`
  - `scan-jobs/raw/{id}.json`
  - `scan-jobs/artifacts/{id}.json`

## Acceptance

This spec is accepted when:

- It selects KV/R2 as the recommended no-user persisted path.
- It reserves D1 for later login/history/query needs.
- It defines id-based endpoint prerequisites.
- It defines metadata and large-object storage shapes.
- It defines binding names and missing-binding behavior.
- It defines redaction, TTL, size, and remote-operation guardrails.
- It preserves the no remote D1 rule.
- `npm run check:backend-persisted-job-store-spec` passes.
- `npm run check:backend-storage-ports` passes.
- `npm run check:backend-persisted-job-store-routes` passes.
- `npm run check:backend-persisted-job-store-kv-routes` passes.
- `npm run check:backend-persisted-job-store-polling` passes.

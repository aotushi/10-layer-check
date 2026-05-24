# 03 Web App Shell

Web App is the primary product surface for Site 10-Layer Check. Browser Extension is a parallel surface that should generate the same `SnapshotRecord` and `Run` model, not a different product.

This stage builds the no-user Web App version first. It does not require login or database. It can call local or remote Providers when they are configured, while keeping Provider config and run history in `localStorage`.

```text
Target
→ ProviderConfig
→ SnapshotRecord[]
→ Run
→ 10-layer report
→ Local history
```

## Why This Stage Exists

The previous stages proved technical feasibility:

- `01-mvp-cli`: fetch probes and static report generation.
- `02-browser-runtime`: Playwright browser runtime and screenshots.
- `02-browser-runtime-remote-github`: GitHub Actions remote execution and artifact delivery.

Those are not the final product shape. The final product needs a Web App where users can configure Providers, import or trigger runs, inspect 10-layer results, and later save history under an account.

## No-User Scope

This version stores everything locally in the browser:

- Provider configs in `localStorage`.
- Runs imported from snapshot JSON in `localStorage`.
- Draft targets in `localStorage`.

It intentionally does not:

- Store remote secrets on a server.
- Implement login.
- Call paid APIs.
- Persist to D1/Postgres.
- Run real remote probes directly from the browser.

## Provider Configuration Model

Provider config is treated as a first-class object from the beginning.

```ts
type ProviderConfig = {
  id: string;
  type: "remote_fetch" | "browser_runtime" | "performance" | "dns_tls" | "manual_import" | "ai_classifier";
  displayName: string;
  endpoint: string;
  authMode: "none" | "api_key" | "bearer" | "custom_header";
  secretRef: string;
  enabled: boolean;
  capabilityTags: string[];
};
```

In this no-user version, `secretRef` is just local configuration text. It is useful for local demos and endpoint selection, but it is not secure server-side secret storage. In a login version, it becomes a user or team secret reference controlled by the backend.

For a real `ai_classifier` Provider, the recommended runtime is Worker-mediated:

```text
Web App
→ create L4/L8 AI classifier contract
→ POST contract to Worker AI Provider endpoint
→ Worker calls Cloudflare Workers AI binding, or falls back to an OpenAI-compatible endpoint
→ Worker validates classifier result schema and evidence refs
→ Web App merges the validated result into the active Run
```

Direct frontend BYOK calls are not the default path because the browser necessarily exposes the key to page JavaScript. They can remain a private/local deployment escape hatch, but the shared product path should use Worker secrets now and backend user/team secret refs later.

Layer 9 related-domain confirmation uses the same Worker-mediated AI policy:

```text
Web App / backend
→ create related-domain confirmation contract from L9 candidate evidence
→ POST contract to Worker related-domain confirmation Provider endpoint
→ Worker calls Cloudflare Workers AI binding, or falls back to an OpenAI-compatible endpoint
→ Worker validates that every result cites known evidence_refs
→ Valid results become relationship evidence; invalid output becomes provider error only
```

Narrative report generation uses the same backend boundary, but it consumes `ReportBrief` instead of layer-specific evidence:

```text
Backend / Web App
→ create site-10-layer-ai-narrative-report-contract/v0.1 from ReportBrief
→ POST contract to Worker /provider/ai/narrative-report
→ Worker calls Cloudflare Workers AI binding or an OpenAI-compatible endpoint
→ Worker validates every evidence_ref and missing_data_ref against ReportBrief
→ Valid result returns structured report sections plus Markdown; invalid output remains provider error only
```

This AI narrative provider is separate from `/scan/site/export`. The export artifact remains deterministic until the product endpoint explicitly asks for an AI report.

The first product-path report endpoint is `POST /scan/site/report`. It runs the same scan/export pipeline, preserves the deterministic artifact, then calls `/provider/ai/narrative-report`. If the AI provider is unavailable or returns invalid refs, the response keeps the deterministic artifact and reports a structured provider error instead of pretending an AI report exists.

The persisted report endpoint is `POST /scan/jobs/:id/report`. It reads the KV-backed job artifact, so it can generate the same overall AI report from a completed job that already includes async provider evidence such as browser runtime, Lighthouse, live TLS, or PageSpeed.

For consumers that need Markdown directly, the Worker also exposes:

- `POST /scan/site/report.md`
- `POST /scan/jobs/:id/report.md`

These endpoints run the same AI narrative validation path, then return `text/markdown` when the provider succeeds. If the provider is missing, rate-limited, or returns invalid output, the Worker returns the same structured JSON provider-error envelope as the JSON report endpoint. It must not return deterministic Markdown while labeling it as an AI report.

Remote smoke:

```powershell
npm run smoke:ai-narrative-report-remote
npm run smoke:persisted-ai-narrative-report-remote
npm run smoke:persisted-selected-full-ai-report-remote
```

The smoke commands post to `https://probe.9shi.cc` by default, read `PROBE_API_KEY` from the environment or `.dev.vars`, and verify that the response contains a deterministic scan artifact plus validated AI narrative Markdown with resolvable `[E###]` / `[M###]` citations. The selected full AI report smoke also verifies the direct Markdown endpoint and saves the returned `.md` file under `smoke-results/`.

Latest remote verification:

- Worker version: `92f852eb-db6e-41e6-a28c-5d1361c7cea2`
- Target: `https://example.com`
- Result: `site-10-layer-scan-ai-report/v0.1`, 20 deterministic records, 6 AI report sections, 1766-character Markdown, no unknown evidence or missing-data refs.
- Smoke artifact: `smoke-results/ai-narrative-report-example.com-2026-05-22T11-11-31-810Z.json`
- Persisted job report Worker version: `fc47bd51-3ec6-42d7-a7a9-12b6312db902`
- Persisted job report result: `site-10-layer-persisted-scan-ai-report/v0.1`, job `scan-example.com-3b0d6ea7-8c48-474e-877d-5729d42211c3`, 20 persisted deterministic records, 6 AI report sections, 2165-character Markdown, no unknown evidence or missing-data refs.
- Persisted smoke artifact: `smoke-results/persisted-ai-narrative-report-example.com-2026-05-22T11-18-42-393Z.json`
- Persisted selected full AI report result: `site-10-layer-persisted-scan-ai-report/v0.1`, job `scan-example.com-6f0458a7-cea9-4dd3-b834-2e185bef96e9`, 43 persisted records covering Layers 1-10, completed PageSpeed / Lighthouse / browser runtime / live TLS provider evidence, 6 AI report sections, 2198-character Markdown, and no unknown evidence or missing-data refs.
- Persisted selected full AI report smoke artifact: `smoke-results/persisted-selected-full-ai-report-example.com-2026-05-22T11-27-02-314Z.json`
- Direct Markdown report Worker version: `a98d1be8-e1bf-411c-9a32-7901d72056fc`
- Direct Markdown selected full AI report result: job `scan-example.com-3f1517c4-9c0f-4664-886f-37711aca0433`, 43 persisted records covering Layers 1-10, completed PageSpeed / Lighthouse / browser runtime / live TLS provider evidence, JSON report `markdown_length=2198`, direct Markdown `content-type=text/markdown`, direct Markdown length `2198`, and no unknown evidence or missing-data refs.
- Direct Markdown smoke artifacts: `smoke-results/persisted-selected-full-ai-report-example.com-2026-05-22T14-49-00-096Z.json` and `smoke-results/persisted-selected-full-ai-report-example.com-2026-05-22T14-49-00-096Z.md`
- Topical poixe-style output Worker version: `a20fb1a7-45eb-4407-8a8a-ef9ca09e80ce`
- Topical poixe-style selected full AI report result: job `scan-example.com-47b1871e-f5a9-4a56-9dd8-0d7b64d6c9d5`, 43 persisted records covering Layers 1-10, 8 AI sections, JSON report `markdown_length=3442`, direct Markdown `content-type=text/markdown`, direct Markdown length `3506`, no unknown evidence or missing-data refs, and generated sections use topical report headings such as Public Information Architecture, Technology Stack, Deployment and Network Surface, API and Protocol Surface, and Security Posture rather than one section per raw layer.
- Topical poixe-style smoke artifacts: `smoke-results/persisted-selected-full-ai-report-example.com-2026-05-22T15-09-51-762Z.json` and `smoke-results/persisted-selected-full-ai-report-example.com-2026-05-22T15-09-51-762Z.md`
- Target-domain comparison note: the same selected full AI report smoke was run against `https://poixe.com`, but PageSpeed, Lighthouse, browser runtime, and live TLS provider jobs failed with Cloudflare Worker `Too many subrequests by single Worker invocation`. The report endpoint still returned validated topical Markdown for job `scan-poixe.com-fba638b3-de0a-4af4-b187-0e783247c20e`, saved as `smoke-results/persisted-selected-full-ai-report-poixe.com-2026-05-22T15-20-01-562Z.json` and `.md`.
- Sync-only target-domain verification: `https://poixe.com` passed without async providers for job `scan-poixe.com-be414b15-9117-4fa6-b38e-7c3c46837dac`, producing 29 records across Layers 1-10, 8 topical AI sections, direct `text/markdown`, and no unknown refs. Artifact: `smoke-results/persisted-selected-full-ai-report-poixe.com-2026-05-22T15-23-36-673Z.json` and `.md`.
- Reference comparison: the generated poixe reports are structurally constrained but not yet content-equivalent to `../2026-03-31-[poixe.com-site-analysis].md`. The reference is about 48KB with 68 headings and includes docs/blog/community/api/status subdomain analysis plus Vercel/Mintlify/WordPress/Discourse/Matomo/Larksuite/CORS/Cookie/wp-json evidence. Current generated poixe Markdown is about 2.8KB with 9 topical headings because those deeper target-document facts are not present in the bounded evidence set.
- Paid Workers verification: after the account was upgraded, `wrangler.toml` was deployed with `[limits] subrequests = 1000` and Cloudflare accepted the limits configuration. Worker version `a85c7e90-3dbc-4fe5-a30c-dd2dfe9c247d` passed the full selected AI report smoke against `https://poixe.com`: job `scan-poixe.com-09662574-b3a1-4647-b239-35859649f631`, 43 records covering Layers 1-10, PageSpeed / Lighthouse / browser runtime / live TLS completed, AI report HTTP 200, canonical 10-section Markdown, exact JSON/direct Markdown match, and no unknown refs. Artifacts: `smoke-results/persisted-selected-full-ai-report-poixe.com-2026-05-23T10-08-49-143Z.json` and `.md`.
- Report synthesis detail formatting verification: Worker version `2f5751d3-3b06-44bc-aafd-cd483dddb097` passed the full selected AI report smoke against `https://poixe.com`: job `scan-poixe.com-b2fc14b3-2693-4953-ab3a-501ddefd80a9`, 57 records, 10 AI sections, exact JSON/direct Markdown match, no unknown refs, no repeated `Current evidence highlights`, and `Organization and Operations Signals` now summarizes public business evidence as supplier/vendor onboarding, payouts/withdrawals, provider routing, platform overview, cost reduction content, and vendor/product pages. Artifacts: `smoke-results/persisted-selected-full-ai-report-poixe.com-2026-05-24T10-21-48-777Z.json` and `.md`.

Current parity progress:

- Overall target: close the poixe target-report parity gap without using the reference report as evidence.
- Current gap ledger item: `G1 report_synthesis`.
- Current subtask: `G1.3 Report Section Structure Pass`.
- Last completed subtask: `G1.2 Business Detail Fact Formatting`.
- Next engineering focus: split dense generated fact-pack paragraphs, starting with `Organization and Operations Signals`, while keeping the canonical 10-section report and validated refs.

## Current Features

- Target list and draft run creation.
- Provider config panel with local save.
- Snapshot JSON import from CLI / GitHub Actions artifacts.
- 10-layer report view grouped by layer.
- Local run history.
- Coverage and status summary.
- Provider run merge: DNS / fetch results are merged into the active report instead of replacing the whole 10-layer run.
- 10-layer probe registry with one logic entry per layer.
- Provider-required / provider-configured records for layers that are not collected yet.
- Layer 1 network infrastructure logic wired to Worker DoH / protocol checks / Team Cymru DNS ASN enrichment.
- Layer 1 CDN header evidence derived from remote_fetch main-response headers and browser runtime resource headers.
- Layer 2 TLS logic wired to Worker HTTPS / HSTS / CT log checks; Node live TLS script can generate importable SAN / issuer / expiry / chain / protocol / cipher records.
- Layer 7 bounded service fingerprint logic wired to Worker HTTP(S) root-document observation; it records headers, title/meta hints, explicit limits, and missing-data boundaries without port scanning.
- Layer 9 related-domain confirmation provider boundary wired to Worker AI / OpenAI-compatible adapter; output must cite existing evidence refs and cannot claim legal ownership.
- AI narrative report provider boundary wired to Worker AI / OpenAI-compatible adapter; output must cite existing `ReportBrief` evidence and missing-data refs before it can be returned as a poixe-style report.
- Remote fetch data contract.
- Layer 3 HTTP/access barrier logic migrated from `01-mvp-cli`.
- Layer 3 cache policy logic implemented from `remote_fetch` response headers.
- Layer 4 browser runtime artifact import adapter for `02-browser-runtime` / GitHub Actions `browser_page_probe`.
- Worker-mediated browser runtime Provider endpoints for starting, polling, and retrieving GitHub Actions Playwright artifacts.
- Layer 4 runtime resource bytes derived from enriched browser runtime artifacts.
- Layer 4 runtime asset cache policy derived from browser runtime resource headers.
- Layer 5 basic performance endpoint wired to Worker TTFB / page weight baseline, plus Worker-mediated GitHub Actions Lighthouse Provider result ingestion.
- Layer 5 external performance provider boundary wired to Worker: PageSpeed sync run plus WebPageTest async start/status/result. Missing provider keys return structured missing-config errors and cannot become positive performance evidence.
- Layer 5 PageSpeed mapping preserves optional CrUX field-data summaries from `loadingExperience` / `originLoadingExperience` when available, while keeping field data as missing when Google does not return it.
- Layer 5 PageSpeed provider resilience: HTTP 429 is reported as `performance_provider_rate_limited` with retry metadata and no positive L5 evidence; successful responses can be cached in `SCAN_JOB_KV` by target + strategy to reduce quota pressure.
- Backend/core provider result normalizer that converts completed PageSpeed/WebPageTest/GitHub artifact envelopes into `SnapshotRecord[]`; completed GitHub Actions live TLS artifacts become L2 `tls_live_certificate_probe` evidence, while pending live TLS jobs remain status-only. It also expands `/scan/site/start.sync_results` for fulfilled `dns_infrastructure`, `tls_certificate`, `subdomain_attack_surface`, `organization_intelligence`, `remote_fetch`, and `performance_basic` results. `normalizeSiteScanProviderResults()` can aggregate one raw scan-start envelope, embedded completed PageSpeed `async_jobs[].result_envelope`, plus completed async result envelopes into a single `SnapshotRecord[]`. Pending, missing-config, rejected, unsupported, malformed, and error envelopes become status-only `provider_result_status` records.
- Backend/core scan report pipeline verifier that proves aggregated scan records can produce `AnalysisReport`, `ReportBrief`, and deterministic narrative Markdown; pending async provider jobs remain missing-data boundaries and do not become positive layer evidence.
- Backend/core full scan-run report fixture that combines all current scan-start sync probes, embedded PageSpeed completed result, and WebPageTest pending job into one report pipeline, proving Layers 1-10 can be represented by collected records while pending WebPageTest remains a missing-data boundary. It also verifies `ReportBrief.missing_data` does not repeat L5 gaps already satisfied by PageSpeed evidence.
- Layer 6 API surface static logic implemented from main HTML and response headers.
- Layer 6 bounded API reachability sampling implemented through Worker `POST /probe/api-reachability` and scan sync probe `api_reachability`; it only samples same-origin API-like candidates with HEAD / safe GET, skips cross-origin and sensitive/destructive paths, and normalizes to `api_reachability_probe`.
- Layer 6 runtime API request observation derived from enriched browser runtime artifacts.
- Layer 7 CT-based subdomain attack surface logic wired to Worker with bounded reachability checks.
- Layer 9 organization intelligence wired to Worker DNS, homepage social links, homepage-visible related-domain candidates, RDAP / WHOIS-lite registration-evidence, and Wayback historical-archive checks. Related-domain candidates now preserve role/evidence context such as documentation links, CDN/resource hosts, form endpoints, and analytics/tracker endpoints. RDAP now retries `.com` / `.net` domains against Verisign RDAP when `rdap.org` is unavailable, and Wayback retries CDX host/path queries plus `archive.org/wayback/available` before returning a structured unavailable/error state.
- Worker version `ae27e545-4c4a-4ce4-bc40-22c5939b15ba` is deployed with the L9 provider reliability fix. Remote `/probe/organization-intelligence` and persisted `/scan/jobs/:id/artifact` both return `ok` L9 RDAP and Wayback records for `https://example.com`.
- Remote selected full-scan persisted smoke was rerun after the L9 fix. Job `scan-example.com-fb645741-4253-4405-9787-019582e188d0` returned 30 records across Layers 1-10, completed PageSpeed evidence, and artifact `smoke-results/persisted-job-example.com-2026-05-22T-fullscan-after-l9-fix-artifact.json`; L9 `rdap_whois_lite_probe` and `wayback_history_probe` are both `ok`.
- Layer 9 related-domain confirmation contract and result mapper boundary; future AI/external/manual providers must cite candidate evidence refs. The contract now passes candidate role and compact evidence items to the provider input, and mapper output is relationship evidence only, not ownership or operating-entity proof.
- Layer 9 analytics candidate detection now uses endpoint/script-specific matching instead of broad keyword matching. Remote Worker smoke on `https://probe.9shi.cc` version `b997ff86-c4fd-4a07-918e-a71c318b92f6` confirmed Matomo/Plausible/web.dev ordinary links/resources no longer become analytics candidates, while wordpress.org GTM and mozilla.org Sentry endpoints still produce analytics candidates. poixe.com currently returns no live homepage related-domain candidates, although RDAP and Wayback are collected.
- Reusable remote L9 organization smoke now exists at `npm run smoke:l9-organization-remote`. It verifies RDAP/Wayback baseline collection for poixe.com, guards analytics false positives on Matomo/Plausible/web.dev, and verifies positive GTM/Sentry analytics endpoint candidates on WordPress/Mozilla without deploying Worker code.
- Reusable remote L9 related-domain confirmation smoke now exists at `npm run smoke:l9-related-domain-confirmation-remote`. It verifies the optional Worker AI confirmation Provider separately from selected full-scan, requires legal `evidence_refs`, and keeps output as relationship evidence only.
- Layer 10 security posture logic migrated and expanded: security headers, cookie attributes, iframe policy, static mixed content, and leakage signals.
- Layer 10 runtime security events derived from browser runtime mixed-content candidates, failed requests, console errors, and page errors.
- Persisted `/scan/jobs` browser runtime path verified for Layer 10: completed GitHub Actions browser artifacts merge into stored `ScanJob` records as `runtime_security_events_probe` and appear in persisted export artifacts, Analysis, ReportBrief, and Markdown.
- Demo remote fetch run that exercises Layer 3 / Layer 4 / Layer 8 / Layer 10 records without pretending to be a real network Provider.
- Local Cloudflare Worker `remote_fetch` and `dns_tls` Provider endpoints.
- Worker backend architecture guide at `worker/README.md`; it defines route/service/probe/provider/report boundaries and keeps native Worker `fetch` for the first split rather than introducing a framework immediately.
- Worker HTTP and route responsibilities now live under `worker/http/*` and `worker/routes/*`; `worker/remote-fetch.ts` is only the Cloudflare Worker entry that delegates to `handleWorkerRequest()`.
- Worker probe implementations now live under `worker/probes/*` for `remote-fetch`, `dns-infrastructure`, `tls-certificate`, `subdomain-attack-surface`, `organization-intelligence`, and `performance-basic`; `worker/remote-fetch.ts` keeps HTTP route dispatch and dependency wiring.
- Backend-only Worker scan start contract at `POST /scan/site/start`; it accepts one target URL, selected sync probes, and selected async providers, then returns sync Worker probe results plus async GitHub Actions job descriptors without frontend-specific state.
- Backend Scan Job V2 planning spec at `specs/backend-scan-job-v2.md`; it keeps V1 `/scan/site/start` and `/scan/site/export` valid while defining the next no-storage `ScanJob` / `ProviderJob` lifecycle, provider policy, storage boundary, and V2 endpoint sketch.
- Backend/core no-storage ScanJob V2 model at `src/scan/job.ts`; it can convert a raw scan-start envelope into `ScanJob`, apply completed async result envelopes to `ProviderJob` entries, move job status to `completed` / `partial`, and assemble the existing `ScanExportArtifact` without adding storage or frontend behavior.
- Backend-only V2 job endpoint at `POST /scan/jobs`; without `SCAN_JOB_KV` it behaves as a caller-owned/no-storage endpoint, and with `SCAN_JOB_KV` it persists scan job state and returns `storage_persisted=true`.
- Backend-only caller-owned no-storage V2 follow-up endpoints remain available: `POST /scan/jobs/collect` updates a prior `ScanJob` from completed async result envelopes, and `POST /scan/jobs/artifact` converts a caller-owned job into `site-10-layer-scan-export-artifact/v0.1`.
- Backend-only persisted V2 id routes are enabled when `SCAN_JOB_KV` is bound: `GET /scan/jobs/:id`, `POST /scan/jobs/:id/collect`, `POST /scan/jobs/:id/poll`, `POST /scan/jobs/:id/cancel`, and `GET /scan/jobs/:id/artifact`. Without KV they return structured `storage_not_configured`.
- Backend-only Worker scan start now accepts L5 `pagespeed` and `webpagetest` async providers: PageSpeed can return a completed provider result envelope immediately, while WebPageTest returns a queued job descriptor with status/result endpoints.
- Backend-only Worker scan export endpoint at `POST /scan/site/export`; it reuses the raw scan-start envelope and returns `site-10-layer-scan-export-artifact/v0.1` with normalized records, Analysis JSON, ReportBrief JSON, Analysis Markdown, deterministic narrative Markdown, and explicit no-AI/no-storage/no-frontend boundaries.
- Worker scan start/export orchestration now lives in `worker/services/scan-orchestrator.ts`; `worker/remote-fetch.ts` remains the HTTP entry and delegates scan workflows through explicit dependencies.
- L5 PageSpeed / WebPageTest provider orchestration now lives in `worker/services/performance-providers.ts`; `worker/remote-fetch.ts` keeps only route dispatch for performance provider endpoints.
- GitHub Actions provider orchestration now lives in `worker/services/github-actions.ts`; `worker/remote-fetch.ts` keeps only route dispatch for live TLS, Lighthouse, and browser runtime provider endpoints.
- AI classifier provider orchestration now lives in `worker/services/ai-classifier.ts`; `worker/remote-fetch.ts` keeps only route dispatch for `POST /provider/ai/classifier`.
- L5 Worker baseline performance probe now lives in `worker/probes/performance-basic.ts`; `worker/remote-fetch.ts` keeps only route dispatch for `POST /probe/performance-basic`.
- Web App `Run DNS` action that calls the local Worker and generates Layer 1 records.
- Web App `Run TLS` action that calls the local Worker and generates Layer 2 records.
- Web App `Run subdomains` action that calls the local Worker and generates Layer 7 records.
- Web App `Run org` action that calls the local Worker and generates Layer 9 records.
- Web App `Run remote fetch` action that calls the local Worker and generates Layer 3 / Layer 4 / Layer 6 / Layer 8 / Layer 10 records.
- Web App `Run worker scan` action that orchestrates Worker DNS/TLS/subdomain/org/remote_fetch providers from one target URL and merges the resulting records into the active Run.
- Web App `Run browser runtime` action that calls the configured Worker-mediated GitHub Actions browser runtime Provider, polls status/result, and merges returned browser runtime records through the existing import adapter.
- Analysis JSON reporter that converts raw `SnapshotRecord[]` into coverage, layer summaries, risks, next steps, and evidence refs.
- ReportBrief JSON reporter that prepares AI/report consumption without invoking an AI provider.
- Deterministic narrative Markdown renderer that consumes `ReportBrief`, cites evidence refs / missing-data IDs, and does not invoke an AI provider.
- L4/L8 AI classifier contract that defines later model input/output without invoking an AI provider.
- Fake L4/L8 AI classifier provider that validates structured classifier output and rejects unknown evidence refs without invoking a real AI provider.
- Worker-mediated L4/L8 AI classifier adapter at `POST /provider/ai/classifier`; it prefers the Cloudflare Workers AI binding with `AI_PROVIDER_MODEL`, requests Workers AI JSON Mode, falls back to `AI_PROVIDER_API_KEY` / OpenAI-compatible endpoint mode when no binding exists, returns structured missing-config errors, and validates model output before returning it.
- AI classifier result mapper that converts validated Worker classifier success into L4/L8 `SnapshotRecord[]`, while provider failures become status records instead of positive technology evidence.
- Web App `Run AI classifier` action that builds a contract from the active Run, calls the configured Worker `ai_classifier` Provider, and merges validated L4/L8 classifier records or status-only provider errors back into the active Run.
- AI classifier reporting verifier that proves Analysis JSON, Markdown, and ReportBrief expose L4/L8 classifier records and provider errors without converting failures into positive technology evidence.
- Markdown reporter that renders from Analysis JSON instead of reinterpreting raw records.
- Web App actions for copying raw run JSON, Analysis JSON, Analysis Markdown report, and deterministic narrative Markdown report.
- Desktop and narrow viewport rendering verified with Playwright.

## Report Pipeline

The reporting path is intentionally layered:

```text
Run.records / SnapshotRecord[]
  -> AnalysisReport JSON
  -> ReportBrief JSON
  -> Markdown report / future AI report
  -> ScanExportArtifact JSON bundle
```

Files:

| File | Role |
| --- | --- |
| `src/reporters/analysis.ts` | Creates stable Analysis JSON for UI, plugin, Markdown, and export use. |
| `src/reporters/brief.ts` | Creates deterministic ReportBrief JSON for later AI/report generation, preserving evidence refs, compact evidence items, metadata, limitations, and explicit missing-data classifications without calling AI. |
| `src/reporters/markdown.ts` | Renders human-readable Markdown from Analysis JSON and deterministic narrative Markdown from ReportBrief. |
| `src/reporters/artifact.ts` | Creates a stable backend/core scan export artifact from raw scan envelopes, normalized records, Analysis JSON, ReportBrief JSON, and both Markdown reports without invoking AI, persisting storage, or mutating frontend state. |
| `src/providers/ai-classifier/contract.ts` | Creates the model-agnostic L4/L8 classifier input/output contract. |
| `src/providers/ai-classifier/fake.ts` | Runs the first provider-adapter loop without real AI calls, validating classifier result fields and `evidence_refs`. |
| `src/providers/results/normalize.ts` | Normalizes completed provider result envelopes into `SnapshotRecord[]`, including all current `/scan/site/start` sync probes and embedded completed PageSpeed scan jobs, and maps pending/missing-config/error/unsupported envelopes to status-only records. |
| `src/scan/job.ts` | Provides no-storage Backend Scan Job V2 helpers: `ScanJob`, `ProviderJob`, provider policy, async result application, status resolution, and artifact assembly. |
| `src/scan/storage.ts` | Defines pure persisted job storage ports, in-memory test adapters, metadata shape, TTL handling, size limits, sensitive-header redaction, and `storage_not_configured` responses. |
| `worker/services/scan-storage.ts` | Injects Worker `SCAN_JOB_KV` as the first persisted job store, stores bounded job metadata/raw/artifact payloads with TTL, and keeps `SCAN_JOB_DB` reserved for later login/history/query work. |
| `src/providers/related-domains/contract.ts` | Creates the L9 related-domain confirmation input/output contract from organization candidate evidence without invoking a provider. |
| `src/providers/related-domains/records.ts` | Maps validated related-domain confirmation results into L9 relationship evidence records, while provider failures stay status-only. |
| `worker/README.md` | Documents Worker backend layering, endpoint rules, provider boundaries, framework policy, and verification policy. |
| `worker/services/scan-orchestrator.ts` | Owns scan start/export orchestration and delegates concrete probe/provider execution through dependencies supplied by the Worker HTTP entry. |
| `worker/services/performance-providers.ts` | Owns PageSpeed / WebPageTest provider calls, missing-config envelopes, WebPageTest async endpoint assembly, and provider result mapping. |
| `worker/services/github-actions.ts` | Owns GitHub Actions config parsing, workflow dispatch, workflow status resolution, artifact lookup/download, and ZIP JSON extraction for live TLS, Lighthouse, and browser runtime providers. |
| `worker/services/ai-classifier.ts` | Owns Worker AI classifier request parsing, provider invocation delegation, invalid-contract responses, and route-facing provider envelope assembly. |
| `worker/probes/performance-basic.ts` | Owns the Worker-safe L5 baseline performance probe: HTML timing, declared resource extraction, sampled resource HEAD requests, and page-weight estimate assembly. |
| `worker/probes/api-reachability.ts` | Owns bounded L6 API-like candidate reachability sampling with same-origin, method, count, and sensitive-path limits. |
| `specs/backend-scan-job-v2.md` | Defines the next backend scan job model: `ScanJob`, `ProviderJob`, lifecycle, provider policy, V2 endpoint sketch, and no-storage vs persistent storage boundary. |

Runtime boundary:

- `worker/*` is the Cloudflare Worker runtime. Code reachable from `worker/remote-fetch.ts` can be bundled by Wrangler and deployed.
- `src/*` is Web App and shared core code. Frontend-only imports go into the browser bundle; modules imported by Worker code can also enter the Worker bundle.
- `tools/*` is verification and development tooling only. These scripts are not deployed to Worker and must not be required by the product page at runtime.
- Provider runtime code that must execute outside Worker belongs in the corresponding Provider project, such as `02-browser-runtime-remote-github`, not in `tools/*`.

Key backend/report verifiers:

| Command | Coverage |
| --- | --- |
| `npm run check:scan-sync-normalizer` | All current Worker scan sync probes normalize into their layer records; unsupported sync results remain status-only. |
| `npm run check:live-tls-result-normalizer` | Completed GitHub Actions live TLS artifacts normalize into L2 evidence and flow through Analysis, ReportBrief, and narrative Markdown; pending live TLS jobs stay provider-state only. |
| `npm run check:webpagetest-result-normalizer` | Completed WebPageTest result envelopes normalize into L5 evidence and flow through Analysis, ReportBrief, and narrative Markdown; queued WebPageTest jobs stay provider-state only until results are supplied. |
| `npm run check:scan-performance-providers` | Scan-start can orchestrate PageSpeed / WebPageTest and preserve pending/missing-config boundaries. |
| `npm run check:scan-full-report-fixture` | Full scan fixture covers Layers 1-10 and produces `AnalysisReport`, `ReportBrief`, and deterministic narrative Markdown. It verifies PageSpeed `performance_score` / `lighthouse_lab_metrics` satisfies the L5 `lighthouse_score` gap, and PageSpeed `crux_field_data` satisfies the L5 `core_web_vitals_field_data` gap. |
| `npm run check:scan-export-artifact` | Raw scan-start envelopes plus embedded completed async results produce a stable JSON bundle with records, Analysis, ReportBrief, Markdown, raw inputs, and explicit no-AI/no-storage/no-frontend boundaries. |
| `npm run check:worker-scan-export` | Worker `POST /scan/site/export` returns the stable artifact bundle while `POST /scan/site/start` remains raw-only. |
| `npm run check:scan-report-pipeline` | Mixed scan-start + async provider result aggregation remains reportable and keeps pending async jobs as missing data. |
| `npm run check:backend-scan-job-v2-spec` | Verifies the Backend Scan Job V2 spec exists, defines required job/provider/storage fields, and is linked from the project control docs. |
| `npm run check:backend-scan-job-v2-model` | Verifies no-storage `ScanJob` helpers convert scan-start envelopes, update async ProviderJobs from completed results, resolve partial/completed status, and assemble `ScanExportArtifact`. |
| `npm run check:backend-scan-job-v2-endpoint` | Verifies Worker `POST /scan/jobs` returns a no-storage V2 job envelope, normalized sync records, async ProviderJob state/policy, and raw V1 scan-start compatibility. |
| `npm run check:backend-scan-job-v2-caller-owned-endpoints` | Verifies caller-owned `POST /scan/jobs/collect` and `POST /scan/jobs/artifact` update/render jobs without server storage. |
| `npm run check:backend-persisted-job-store-kv-routes` | Verifies fake-KV persisted `POST /scan/jobs`, `GET /scan/jobs/:id`, id collect/cancel, and id artifact routes without remote KV/D1 operations. |
| `npm run check:backend-persisted-job-store-polling` | Verifies persisted `POST /scan/jobs/:id/poll` can poll a mocked WebPageTest job, merge completed result evidence, and keep no-KV behavior as `storage_not_configured`. |
| `npm run smoke:persisted-job-remote` | Verifies deployed Worker KV persistence through `/scan/jobs`, `/scan/jobs/:id`, and `/scan/jobs/:id/artifact` without printing secrets or running D1 commands. |

The Analysis Markdown renderer must not add new conclusions that are absent from Analysis JSON. The narrative Markdown renderer must consume `ReportBrief`, cite evidence refs or missing-data IDs, and keep AI/manual-review boundaries visible. Future AI outputs should consume `ReportBrief` first, cite its `evidence_refs`, read its compact `evidence_items`, and account for its `limitations` and `missing_data`. Ordinary limitations stay as evidence boundaries; only explicit gaps such as `coverage.missing`, `status=not_collected`, missing layers, or `provider_result_status` pending/error records become `missing_data`. If another collected record in the same layer already satisfies an explicit gap, `ReportBrief` should suppress that duplicate missing-data item rather than asking for data already collected.

## Requirement Alignment Rule

The root README is the source of truth for layer requirements. Before adding or migrating a probe in this product directory, update the docs with an alignment check:

```text
Root layer requirement
→ covered signals
→ missing signals
→ provider / data source
→ next implementation step
```

Rules:

- A sub-probe cannot claim the whole layer. For example, `robots_sitemap_probe` covers only Layer 4 crawl metadata, not the full frontend-code layer.
- Raw evidence is not the same as analysis. For example, collecting `cache-control` means cache headers are available; it does not mean cache policy has been interpreted.
- `provider_configured` means capability is available, not that data was collected. Coverage must count only collected or imported `SnapshotRecord` data.
- Registry names, README scope, and UI labels must stay aligned. If a probe covers only a slice, keep the slice visible in the name and summary.

## Layer Logic Status

The Web App now has a logic entry for every layer. This does not mean all 10 layers are fully collected. It means each layer has a probe contract that can produce a `SnapshotRecord` explaining either collected data, configured provider readiness, or missing provider requirements.

Layer acceptance is tracked in [`../specs/10-layer-acceptance-spec.md`](../specs/10-layer-acceptance-spec.md). The table below is an implementation view; final acceptance status still requires user review in the spec.

| Layer | Probe | Current state | Acceptance conclusion | Required provider types |
| ---: | --- | --- | --- | --- |
| 1 | `network_infrastructure_probe`, `cdn_header_evidence_probe` | Worker `dns_tls` wired for DNS / IPv4 / IPv6 / CDN hint / protocol checks / Team Cymru DNS ASN enrichment; remote_fetch/browser runtime headers add CDN header signals | recommended `accepted_partial`; CDN is still a hint | `dns_tls`, `remote_fetch`, `browser_runtime` |
| 2 | `tls_certificate_probe`, `tls_live_certificate_probe` | Worker `dns_tls` wired for HTTPS reachability / HSTS / CT log summary; Worker-mediated GitHub Actions live TLS returns live certificate records | recommended `accepted_mvp`, pending user confirmation | `dns_tls`, `remote_fetch`, `manual_import` |
| 3 | `http_headers_probe`, `access_barrier_probe`, `cache_policy_probe` | remote_fetch wired for main response status, headers, redirect chain, and structured cache policy | recommended `accepted_mvp` | `remote_fetch` |
| 4 | `frontend_assets_probe`, `frontend_technology_probe`, `third_party_scripts_probe`, `resource_weight_probe`, `robots_sitemap_probe`, `ai_frontend_evidence_pack`, runtime import records, `ai_classifier_probe` | static minimum slice implemented; enriched `02-browser-runtime` import adapter derives resource waterfall, third-party resources, screenshot, runtime resource bytes, and runtime asset cache policy; Web App can call the configured Worker AI classifier Provider and merge validated classifier records or provider error records | recommended `accepted_partial` | `remote_fetch`, `browser_runtime`, `ai_classifier`, `manual_import` |
| 5 | `performance_basic_probe`, `performance_probe` | Worker basic performance endpoint wired for TTFB, total fetch time, HTML bytes, declared resources, sampled resource content-length/cache headers; Worker-mediated GitHub Actions Lighthouse returns performance score, FCP, LCP, TBT, CLS, Speed Index, and opportunities | recommended `accepted_mvp`, pending user confirmation | `remote_fetch`, `performance`, `browser_runtime` |
| 6 | `api_endpoint_probe`, `cors_policy_probe`, `api_error_surface_probe`, `api_protocol_probe`, `runtime_api_requests_probe` | static main-document slice implemented; browser runtime import derives observed XHR/fetch/API-like requests from enriched artifacts | recommended `accepted_partial` | `remote_fetch`, `browser_runtime` |
| 7 | `subdomain_attack_surface_probe` | CT-discovered subdomain logic implemented with Cert Spotter + `crt.sh` fallback and bounded HTTPS reachability details | recommended `accepted_partial` | `dns_tls` |
| 8 | `app_fingerprint_probe` | static fingerprint logic implemented from remote_fetch evidence | recommended `accepted_partial` | `remote_fetch`, `browser_runtime`, `manual_import` |
| 9 | `organization_intelligence_probe`, `rdap_whois_lite_probe`, `wayback_history_probe` | MX / NS / TXT / CAA, mail provider hints, homepage social links, homepage-visible `related_domain_candidates` with role/evidence context, public RDAP registration evidence, and Internet Archive CDX historical snapshot evidence implemented; ICP remains out of scope and related-domain confirmation remains separate provider/manual evidence | recommended `accepted_partial` | `dns_tls`, `manual_import` |
| 10 | `security_headers_probe`, `cookie_security_probe`, `iframe_embedding_probe`, `mixed_content_probe`, `leakage_signal_probe`, `runtime_security_events_probe` | static security posture implemented; browser runtime import derives mixed-content candidates, failed requests, console errors, and page errors | recommended `accepted_partial` | `remote_fetch`, `browser_runtime` |

Coverage in the UI only counts actually collected records. A configured provider contract is shown separately as provider-ready; it is not counted as collected coverage.

Product capability names stay broad, but evidence payloads should be precise. For example, the UI can keep a CDN check, technology check, or organization intelligence check, while records expose `signals`, `conclusion`, `confidence`, and `limitations` so the later report layer can reason without overclaiming.

Product-level acceptance should start only after this table is understood: the Web App can be accepted as a shell even though only Layer 3 and Layer 5 are recommended as MVP-complete, and the remaining layers are partial slices pending user review.

The `Run remote fetch` action calls the local Worker endpoint:

```text
http://127.0.0.1:8787/probe/remote-fetch
```

The `Run DNS` action calls the local Worker endpoint:

```text
http://127.0.0.1:8787/probe/dns-infrastructure
```

The `Run TLS` action calls the local Worker endpoint:

```text
http://127.0.0.1:8787/probe/tls-certificate
http://127.0.0.1:8787/probe/subdomain-attack-surface
http://127.0.0.1:8787/probe/organization-intelligence
```

The `Run demo fetch` action still uses a fixture adapter:

```text
providers/remote-fetch/demo.ts
```

It validates the probe output and UI flow when the Worker is not running.

## Layer 4 Frontend Intelligence Scope

Layer 4 is the Wappalyzer-like frontend intelligence layer. It should answer what the site appears to be built with, how the frontend is packaged, what resources and third-party dependencies are visible, and what crawl metadata is exposed.

The implementation model is AI-assisted, not AI-only:

```text
Evidence extraction
→ HTML, headers, scripts, links, meta, resource URLs, robots, sitemap

Deterministic signals
→ high-confidence signatures such as __NEXT_DATA__, /_next/static/, meta generator, gtm.js

Optional AI classifier
→ consumes the evidence pack
→ returns technology guesses with confidence, reasoning, and evidence_refs
```

The AI classifier must not receive an unstructured instruction to guess from a page. It should receive the structured evidence pack and cite evidence IDs. This keeps the report explainable and lets users later bring their own model/API key without changing the Layer 4 data model.

It is broader than `robots/sitemap`; those are only crawl metadata within Layer 4.

| Probe | Purpose | Primary provider | Notes |
| --- | --- | --- | --- |
| `frontend_assets_probe` | Extract scripts, stylesheets, images, preload hints, asset counts, and HTML size from the main document. | `remote_fetch` | Minimum static slice. Can run in Worker. |
| `frontend_technology_probe` | Detect frameworks, meta generators, CMS hints, build tools, and app platform signals. | `remote_fetch`, `browser_runtime`, `ai_classifier` | Evidence-driven deterministic and optional AI classification over HTML, headers, script URLs, DOM globals, and meta tags. |
| `third_party_scripts_probe` | Classify external scripts and linked resources by domain and category. | `remote_fetch`, `browser_runtime` | Analytics, tag managers, CDN, support chat, ads, monitoring, A/B testing. |
| `resource_weight_probe` | Estimate page/resource weight and large asset pressure. | `remote_fetch`, `browser_runtime` | Static phase can report HTML bytes and declared assets; browser runtime adds transfer sizes. |
| `runtime_asset_cache_policy_probe` | Interpret cache policy for JS/CSS/image/font resources observed during browser runtime. | `browser_runtime` | Separate from L3 main-response `cache_policy_probe`; reports known/unknown resource cache policy counts. |
| `robots_sitemap_probe` | Check `robots.txt`, sitemap declarations, and default sitemap URL availability. | `remote_fetch` | Crawl metadata, not the whole Layer 4. |

Provider split:

| Provider | Layer 4 responsibility |
| --- | --- |
| `remote_fetch` | Main HTML fetch, response headers, static HTML parsing, robots/sitemap fetch, script/style/image URL extraction, first-pass Wappalyzer-like signatures. |
| `browser_runtime` | JS-rendered DOM, runtime-injected scripts, network waterfall, transfer sizes, screenshots, DOM globals, SPA framework evidence. |
| `manual_import` | Imported GitHub Actions / Playwright artifacts until browser runtime is directly connected to the Web App. |
| `ai_classifier` | Optional evidence-driven technology classification and explanation. No-user version defines the L4/L8 classifier contract, Worker endpoint, validation, result-to-record mapping, Web App action, and deployed Cloudflare Workers AI smoke path. Real model calls require an enabled provider plus Cloudflare Workers AI binding / `AI_PROVIDER_MODEL`, or OpenAI-compatible `AI_PROVIDER_API_KEY` configuration. |

AI classifier contract:

```text
src/providers/ai-classifier/contract.ts
```

The contract consumes L4 `ai_frontend_evidence_pack` / `frontend_technology_probe` and L8 `app_fingerprint_probe` records. It passes compact `evidence_items`, evidence metadata, local evidence refs, candidates, and limitations to the future model adapter. It requires later model output to include `technology`, `category`, `confidence`, `reasoning`, `evidence_refs`, and `limitations`.

`src/providers/ai-classifier/fake.ts` is the first provider-adapter loop. It consumes the contract, emits `site-10-layer-ai-classifier-result/v0.1`, validates required fields, and rejects unknown `evidence_refs`. It is a test adapter, not a model call; real AI Provider integration still waits for API-key and runtime design review.

Real AI Provider design:

| Option | Decision | Reason |
| --- | --- | --- |
| Cloudflare Workers AI binding | Use as the first real implementation path | Keeps model execution inside the Worker platform and avoids a browser-exposed model key. |
| Worker-mediated OpenAI-compatible provider with `AI_PROVIDER_*` secrets | Keep as fallback | Keeps third-party model keys out of the browser, matches current Worker Provider architecture, and gives one place for auth, rate limits, schema validation, and error handling. |
| Frontend direct BYOK model calls | Do not use by default | The key is visible to the browser runtime and should not be presented as secure storage. |
| Logged-in backend user/team secret refs | Future product mode | Correct long-term model for user-owned keys, quotas, audit, and persistence. |

Real model output must be treated as untrusted until validation passes. The adapter must reject missing required fields, unknown `evidence_refs`, unsupported confidence values, non-array `limitations`, oversized free-text fields, and any result that claims organization ownership, related-domain identity, or complete stack inventory. Invalid model output can be stored as an error/status record, but it must not become report evidence.

The next Layer 4 implementation should be a minimum complete slice, not only `robots_sitemap_probe`:

```text
Worker /probe/frontend-surface
→ fetch main HTML
→ parse assets and metadata
→ fetch robots.txt and sitemap.xml
→ classify third-party script domains
→ prepare AI-ready evidence pack
→ emit Layer 4 SnapshotRecord[]
```

Browser runtime can then enrich the same Layer 4 records with rendered DOM and actual resource waterfall data.

## L1-L3 Alignment Review

The root project README defines the first three layers as:

| Layer | Root README requirement | Current 03 status | Gap |
| ---: | --- | --- | --- |
| 1 | DNS, IP, ASN, CDN, IPv6, protocol support | `network_infrastructure_probe` collects A / AAAA / CNAME / HTTPS DNS records, IPv4 / IPv6 addresses, CDN DNS hints, HTTP / HTTPS reachability through Worker DoH, and IP → ASN data through Team Cymru DNS TXT; `cdn_header_evidence_probe` adds response/resource header CDN signals. | CDN remains DNS/header evidence, not full edge-routing analysis. ASN lookup is an external intelligence source and can return partial/error. |
| 2 | Certificate info, expiry, CT logs, HSTS | `tls_certificate_probe` collects HTTPS reachability, HSTS, and CT log metadata summaries through Worker `dns_tls`. | Live certificate chain, negotiated TLS version, and true current cert inspection are still explicit gaps because Worker Fetch does not expose TLS handshake details. CT entries are historical evidence, not live certificate posture. |
| 3 | Status code, response headers, redirect chain, cache policy | `http_headers_probe`, `access_barrier_probe`, and `cache_policy_probe` are implemented from `remote_fetch`. | Initial L3 scope is covered for the main response. Future work can refine cache rules with more site examples. |

So L1-L3 are aligned as first-pass probes with named gaps. Layer 1 now has a real first-pass `dns_tls` Provider for DNS, IP, protocol reachability, CDN hints, and ASN enrichment. Layer 2 now has a first-pass Worker Provider for HTTPS / HSTS / CT metadata, while live certificate-chain inspection remains a named gap.

## Layer 3 Cache Policy Scope

The root Layer 3 requirement is:

```text
Status code, response headers, redirect chain, cache policy
```

`remote_fetch` already gives the raw inputs for this:

| Input | Examples |
| --- | --- |
| Status | `200`, `301`, `403` |
| Headers | `cache-control`, `pragma`, `expires`, `etag`, `last-modified`, `vary` |
| CDN cache hints | `cf-cache-status`, `x-cache`, `age`, `server-timing` |
| URL / content type | Used to distinguish HTML pages from static assets. |

The implemented `cache_policy_probe` turns raw headers into stable fields:

```json
{
  "cacheability": "cacheable",
  "browserMaxAgeSeconds": 31536000,
  "sharedMaxAgeSeconds": null,
  "immutable": true,
  "hasValidator": true,
  "validator": "etag",
  "cdnCacheStatus": "hit",
  "summary": "Static asset is long-lived and immutable."
}
```

Implementation boundary:

- Layer 3 analyzes only the main response for the requested URL.
- JS/CSS/image/font resource cache behavior belongs to Layer 4 `runtime_asset_cache_policy_probe`, derived from browser-runtime resource headers.
- HTML and static assets need different rules: long-lived HTML can be an update risk, while long-lived hashed assets are usually healthy.
- The current implementation is a pure function in `src/probes/layer-03-http.ts` because Worker `remote_fetch` already returns the required headers.

## Run Locally

```bash
npm install
npm run dev
```

Run the local Cloudflare Worker in a second terminal:

```bash
npm run dev:worker
```

Do not use a bare `npx wrangler dev --local` for local product testing. The local Worker must receive `ALLOW_LOCAL_DEV_NO_AUTH=true`; `npm run dev:worker` injects it explicitly. If you run Wrangler manually, use one of:

```bash
npx wrangler dev --local --port 8787 --var ALLOW_LOCAL_DEV_NO_AUTH:true
npx wrangler dev --port 8787
```

The second form relies on local `.dev.vars`.

Deploy the remote Worker:

```bash
npm run deploy:worker
```

The current custom domain is:

```text
https://probe.9shi.cc
```

The remote probe endpoint is protected. It will not run remote fetch unless `PROBE_API_KEY` is configured as a Worker secret and the Web App provider sends the same value through `x-api-key`.

Local development is explicitly opt-in for no-auth probing. `npm run dev:worker` passes `ALLOW_LOCAL_DEV_NO_AUTH=true` to Wrangler; deployed Workers must not set this flag.

AI provider configuration:

```bash
npx wrangler secret put PROBE_API_KEY
# Cloudflare Workers AI binding is configured in wrangler.toml with:
# [ai]
# binding = "AI"
# AI_PROVIDER_MODEL is a normal Worker var in wrangler.toml.

# OpenAI-compatible fallback mode only:
npx wrangler secret put AI_PROVIDER_API_KEY
npx wrangler secret put AI_PROVIDER_BASE_URL
```

Local `.dev.vars` is ignored by git. Use `.dev.vars.example` as the template. Leave `PROBE_API_KEY` unset for no-auth local development, or set it locally when testing the same auth path as production. For Cloudflare Workers AI, `wrangler.toml` binds `AI` and sets `AI_PROVIDER_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast"`. If the Worker has neither an `AI` binding nor `AI_PROVIDER_API_KEY`, `/provider/ai/classifier` returns a structured `missing_ai_provider_config` error without calling a model. After changing `.dev.vars`, `wrangler.toml`, or the Worker command, restart Wrangler; an already-running Worker keeps the old environment.

Build:

```bash
npm run build
```

Current local dev server:

```text
http://127.0.0.1:5173
```

Verified commands:

```bash
npm run check
npm run build
```

Verified local Worker:

```bash
npm run dev:worker
POST http://127.0.0.1:8787/probe/remote-fetch
POST http://127.0.0.1:8787/probe/dns-infrastructure
POST http://127.0.0.1:8787/probe/tls-certificate
```

Verified remote Worker deployment:

```text
https://site-10-layer-check-remote-fetch.nullsh.workers.dev
https://probe.9shi.cc
```

`GET /health` returns `200`. `POST /probe/remote-fetch` returns `503` until `PROBE_API_KEY` is configured, which prevents the Worker from becoming an open fetch proxy.

Verified remote Workers AI classifier smoke:

```bash
AI_CLASSIFIER_SMOKE_ENDPOINT=https://probe.9shi.cc/provider/ai/classifier npm run smoke:ai-classifier-worker
```

Result: HTTP `200`, `worker_ok=true`, one `ai_classifier_probe` record generated, zero provider error records, and the result is visible in `ReportBrief`.

Verified Web App flow:

```text
Reset local shell data
→ Add target URL
→ Run worker scan
→ Layer 1 + Layer 2 + Layer 3 + Layer 4 + Layer 6 + Layer 7 + Layer 8 + Layer 9 + Layer 10 records appear in the 10-layer report
```

## Worker vs Actions

`remote_fetch` and the first `dns_tls` endpoint use Cloudflare Worker because it is a lightweight real-time API for DNS-over-HTTPS, protocol reachability, headers, redirects, HTML snippets, static frontend intelligence, robots/sitemap, and security-header probes.

GitHub Actions remains the right provider for heavier browser runtime work:

```text
Worker remote_fetch
→ Layer 1 DNS, protocol reachability, and ASN enrichment through /probe/dns-infrastructure
→ Layer 2 HTTPS, HSTS, and CT log summary through /probe/tls-certificate
→ Layer 7 CT subdomains, CT provider attempts, and bounded reachability details through /probe/subdomain-attack-surface
→ Layer 9 organization DNS, homepage social links, RDAP / WHOIS-lite, and Wayback history through /probe/organization-intelligence
→ Layer 3 HTTP
→ Layer 4 static frontend intelligence
→ Layer 6 static API hints, CORS headers, error surfaces, protocol clues
→ Layer 8 application fingerprint
→ Layer 10 security headers, cookies, iframe policy, static mixed content, leakage signals

GitHub Actions browser_runtime
→ selected provider id stamped in artifact (`github-actions-browser` or `playwright-local`)
→ Playwright
→ screenshots
→ JS-rendered DOM
→ resource waterfall
→ runtime frontend intelligence
```

`02-browser-runtime-remote-github` now accepts `--provider` and the browser workflow exposes the same `provider` input. The generated `browser_page_probe` keeps the existing artifact schema consumed by this Web App, while `source` and `browser.provider` identify whether the run came from local Playwright or GitHub Actions.

The product path is now Worker-mediated for browser runtime as well:

```text
Web App
→ Worker /provider/github/browser-runtime/start
→ GitHub Actions workflow_dispatch
→ Worker /provider/github/browser-runtime/status
→ Worker /provider/github/browser-runtime/result
→ browser_page_probe artifact JSON consumed by the existing import adapter
→ runtime Layer 4 / Layer 6 / Layer 10 records merged into the active Run
```

The Worker dispatches `site-10-layer-check-browser.yml` with `provider=github-actions-browser` and a generated `request_id`. The browser workflow includes the same `request_id` in its run name, so Worker status/result polling can resolve the GitHub run without the frontend calling GitHub directly.

Layer 5 now has three backend provider paths:

```text
Worker /probe/performance-basic
→ immediate TTFB / HTML bytes / sampled resource weight baseline

Worker /provider/github/lighthouse/start + status/result
→ GitHub Actions Lighthouse lab metrics

Worker /provider/performance/pagespeed/run
→ PageSpeed API Lighthouse-derived metrics when PAGESPEED_API_KEY is configured

Worker /provider/performance/webpagetest/start + status/result
→ WebPageTest asynchronous lab run when WEBPAGETEST_API_KEY is configured
```

Required optional secrets:

```bash
npx wrangler secret put PAGESPEED_API_KEY
npx wrangler secret put WEBPAGETEST_API_KEY
```

Without those secrets, PageSpeed / WebPageTest endpoints return `missing_performance_provider_config` with HTTP `503`. That state is a provider configuration gap, not collected Layer 5 evidence.

The backend-only unified scan start contract sits above individual Worker probe endpoints:

```http
POST /scan/site/start
content-type: application/json

{
  "target": "https://example.com",
  "sync_probes": ["remote_fetch"],
  "async_providers": ["browser_runtime"]
}
```

It returns `schema_version = "site-10-layer-scan-start/v0.1"` with:

- `normalized_target` / `normalized_url`;
- `sync_results`, keyed by selected Worker probe name, where each value is `fulfilled` with raw provider result or `rejected` with structured error;
- `async_jobs`, keyed by selected long-running provider, with generated `request_id`, provider status, and Worker polling URLs;
- `coverage.collected`, `coverage.pending`, and `coverage.failed`;
- no frontend local-storage state and no `SnapshotRecord[]` merge side effect.

This endpoint is the future "user enters URL -> backend starts collection" boundary. It intentionally does not wait for long-running GitHub Actions jobs. The frontend or later backend job runner must poll the returned `status_url` / `result_url`, then normalize returned provider artifacts into `SnapshotRecord[]`.

Completed provider result normalization now has a backend/core adapter:

```text
src/providers/results/normalize.ts
```

The adapter consumes completed PageSpeed/WebPageTest envelopes, GitHub artifact results with embedded records, and `/scan/site/start.sync_results`. Fulfilled `remote_fetch` scan results produce L1/L3/L4/L6/L8/L10 records through the same factories as the Worker fetch action. Fulfilled `performance_basic` scan results produce L5 `basic_performance_probe`. `normalizeSiteScanProviderResults()` then combines those sync records with completed async result envelopes such as browser runtime or live TLS artifacts. Async jobs without completed result envelopes produce `provider_result_status` records only, so they can be shown as provider state without being counted as collected layer evidence.

Completed live TLS result normalization is verified separately:

```bash
npm run check:live-tls-result-normalizer
```

This proves a completed `github_actions_live_tls` artifact containing `tls_live_certificate_probe` records becomes L2 evidence in `AnalysisReport`, `ReportBrief`, and deterministic narrative Markdown. Pending live TLS jobs remain provider-state / missing-data boundaries until a completed artifact is supplied.

Completed WebPageTest result normalization is verified separately:

```bash
npm run check:webpagetest-result-normalizer
```

This proves a completed `site-10-layer-webpagetest-result/v0.1` envelope embedded in a scan async job becomes L5 `performance_probe` evidence in `AnalysisReport`, `ReportBrief`, and deterministic narrative Markdown. Queued WebPageTest jobs remain provider-state / missing-data boundaries until the result endpoint supplies a completed envelope.

GitHub Actions live TLS can fill the Worker TLS gap through `../02-browser-runtime-remote-github/.github/workflows/site-10-layer-check-live-tls.yml`:

```bash
npm run probe:tls -- https://example.com --out snapshots/example.com-live-tls.json
```

The output is a `{ records: [...] }` artifact that can be imported into the Web App. It collects Layer 2 live certificate evidence from a Node TLS socket: SAN, issuer, expiry, chain, negotiated protocol, and cipher.

The product path is Worker-mediated, not direct frontend-to-GitHub:

```text
Web App
→ Worker /provider/github/live-tls/start
→ GitHub Actions workflow_dispatch
→ Worker /provider/github/live-tls/status
→ Worker /provider/github/live-tls/result
→ SnapshotRecord[] merged into the active Run
```

Required Worker secrets:

```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put PROBE_API_KEY
```

`GITHUB_TOKEN` must be a fine-grained token with access to `aotushi/02-browser-runtime-remote-git` and repository permissions:

```text
Actions: Read and write
Metadata: Read
```

`PROBE_API_KEY` protects the Worker endpoints. The Web App Provider config must send the same value as `x-api-key` when it calls the deployed Worker.

Verified Worker-mediated live TLS run:

```text
request_id: 8e7cd6d0-3a87-4b04-9f25-9bf55ea7ab1e
github_run: 26151170691
result: tls_live_certificate_probe / layer 2 / ok
protocol: TLSv1.3
issuer: Cloudflare TLS Issuing ECC CA 1
SAN: example.com, *.example.com
```

Verified Worker-mediated Lighthouse run:

```text
request_id: c108c5bf-0cd2-4568-adde-e749313783d5
github_run: 26154513311
result: performance_probe / layer 5 / ok
strategy: mobile
score: 100
metrics: FCP/LCP/TBT/CLS/Speed Index all good
```

Verified artifact import:

```text
D:\Users\shiihs_new\Downloads\site-10-layer-check-browser-26074992986\snapshots\example.com-browser-2026-05-19.json
```

Verified Worker browser runtime provider wiring:

```bash
npm run check:browser-runtime-worker-provider
npm run check:browser-runtime-web-action
npm run check:browser-runtime-persisted-l10
```

Verified backend scan start contract:

```bash
npm run check:backend-scan-contract
```

The verifier proves `POST /scan/site/start` can combine a sync `remote_fetch` result with an async browser runtime job descriptor while leaving frontend state untouched.

`check:browser-runtime-persisted-l10` extends this to the persisted product path: it mocks GitHub Actions artifact completion, polls `/scan/jobs/:id/poll`, and verifies L10 `runtime_security_events_probe` is present in the persisted job artifact and report outputs. It is local/CI verification only; a real remote browser runtime persisted smoke can be run later when triggering GitHub Actions is acceptable.

Verified L5 external performance provider boundary:

```bash
npm run check:performance-provider-boundary
```

The verifier covers PageSpeed missing-config, PageSpeed mocked success normalization, WebPageTest missing-config, and WebPageTest mocked start/status/result envelopes.

Verified backend/core provider result normalization:

```bash
npm run check:provider-result-normalizer
```

The verifier covers PageSpeed success, WebPageTest completed result, missing provider configuration, pending WebPageTest status, GitHub artifact records, `/scan/site/start.sync_results` fulfilled/rejected paths, and scan-start plus completed-async-result aggregation without touching frontend state.

Verified backend/core scan report pipeline:

```bash
npm run check:scan-report-pipeline
```

The verifier covers fixture `/scan/site/start` sync results plus completed and pending async provider envelopes, then proves the aggregated records can produce Analysis JSON, ReportBrief JSON, and deterministic narrative Markdown. Pending async jobs are visible as missing-data boundaries, while not counting as collected layer evidence.

Verified backend/core scan export artifact:

```bash
npm run check:scan-export-artifact
```

The verifier proves a raw scan-start envelope with embedded PageSpeed and queued WebPageTest can become one stable export JSON bundle. The bundle preserves raw inputs, normalized records, Analysis JSON, ReportBrief JSON, Analysis Markdown, deterministic narrative Markdown, and explicit boundaries showing that no AI provider was invoked, no storage was persisted, and no frontend state was mutated.

Verified Worker scan export endpoint:

```bash
npm run check:worker-scan-export
```

The verifier calls both Worker endpoints: `/scan/site/start` remains `site-10-layer-scan-start/v0.1` raw-only, while `/scan/site/export` returns `site-10-layer-scan-export-artifact/v0.1`. Embedded PageSpeed becomes L5 evidence through the normalizer; queued WebPageTest remains provider state and missing data.

Verified remote Worker scan export smoke:

```text
endpoint: https://probe.9shi.cc/scan/site/export
worker version: ee9f903b-a335-4e59-9e3f-23dd85bd1529
target: https://example.com
sync_probes: ["remote_fetch"]
async_providers: []
result: site-10-layer-scan-export-artifact/v0.1 / record_count=20 / Analysis+ReportBrief+Markdown present
boundary: raw scan-start has no normalized records; invokes_ai_provider=false; storage_persisted=false; frontend_state_mutated=false
```

Verified remote Worker architecture-split deploy:

```text
endpoint: https://probe.9shi.cc/health
worker version: 91cfbe6e-5ca3-4327-970b-db7ef535e8be
result: ok=true / probe_api_key_configured=true

endpoint: https://probe.9shi.cc/scan/site/start
target: https://example.com
sync_probes: ["remote_fetch"]
result: site-10-layer-scan-start/v0.1 / ok / remote_fetch fulfilled / status_code=200

endpoint: https://probe.9shi.cc/scan/site/export
target: https://example.com
sync_probes: ["dns_infrastructure","tls_certificate","subdomain_attack_surface","organization_intelligence","remote_fetch","performance_basic"]
result: site-10-layer-scan-export-artifact/v0.1 / record_count=27 / layers=1,2,3,4,5,6,7,8,9,10
artifact: Analysis+ReportBrief+AnalysisMarkdown+NarrativeMarkdown present
boundary: invokes_ai_provider=false; storage_persisted=false; frontend_state_mutated=false
```

Verified L9 related-domain confirmation boundary:

```bash
npm run check:related-domain-confirmation-boundary
```

The verifier proves `related_domain_candidates` can be converted into a provider input contract with candidate role and compact evidence items, valid confirmation output becomes L9 `related_domain_confirmation_probe` relationship evidence, and invalid output with unknown `evidence_refs` becomes `related_domain_confirmation_provider_error`. The boundary explicitly avoids ownership or operating-entity claims.

Reusable remote L9 organization smoke:

```bash
npm run smoke:l9-organization-remote
```

Latest result: passed against `https://probe.9shi.cc`. It checked `poixe.com` / `www.poixe.com` RDAP and Wayback collection, verified Matomo/Plausible/web.dev ordinary links/resources produce zero analytics candidates, and verified wordpress.org GTM plus mozilla.org Sentry endpoints still produce analytics candidates. The smoke writes a JSON summary to `smoke-results/l9-organization-remote-*.json`.

Reusable remote L9 related-domain confirmation smoke:

```bash
npm run smoke:l9-related-domain-confirmation-remote
```

Latest result: passed against `https://probe.9shi.cc`. The smoke posts a fixed `site-10-layer-related-domain-confirmation-contract/v0.1` to `/provider/related-domains/confirm`, verifies the Worker AI Provider returns `site-10-layer-related-domain-confirmation-result/v0.1`, requires every result to cite known `evidence_refs`, and records the boundary that confirmation is optional, not part of default selected full-scan, and not an ownership claim. The smoke writes a JSON summary to `smoke-results/l9-related-domain-confirmation-remote-*.json`.

Verified remote L5 missing-config smoke:

```text
endpoint: https://probe.9shi.cc/provider/performance/pagespeed/run
result: site-10-layer-performance-provider-result/v0.1 / missing_performance_provider_config / PAGESPEED_API_KEY

endpoint: https://probe.9shi.cc/provider/performance/webpagetest/start
result: site-10-layer-webpagetest-start/v0.1 / missing_performance_provider_config / WEBPAGETEST_API_KEY

endpoint: https://probe.9shi.cc/provider/performance/webpagetest/status?id=test-id
result: site-10-layer-webpagetest-status/v0.1 / missing_performance_provider_config / WEBPAGETEST_API_KEY

endpoint: https://probe.9shi.cc/provider/performance/webpagetest/result?id=test-id
result: site-10-layer-webpagetest-result/v0.1 / missing_performance_provider_config / WEBPAGETEST_API_KEY

worker_version: c87f6ad1-8a13-4353-81fd-878c6605b09e
```

Reusable remote smoke command:

```bash
npm run smoke:performance-providers-remote
```

Latest result: PageSpeed real-key smoke passes through the deployed Worker after the Google API key restriction policy was corrected. The smoke defaults to PageSpeed-only, skips WebPageTest unless explicitly selected, and returns either a `site-10-layer-performance-provider-result/v0.1` success envelope with Lighthouse metrics or a structured provider-state response such as `performance_provider_rate_limited`. WebPageTest remains optional because the available free tier does not provide API access.

Reusable persisted product-path smoke:

```powershell
$env:PERSISTED_JOB_SMOKE_ASYNC_PROVIDERS="pagespeed"; npm run smoke:persisted-job-remote
```

Latest result: `/scan/jobs` persisted a completed PageSpeed provider job, normalized it into one L5 `performance_probe`, and `/scan/jobs/:id/artifact` returned Analysis, ReportBrief, and Markdown. This verifies the current Web App backend path rather than only the standalone provider endpoint.

Verified remote backend scan start smoke:

```text
endpoint: https://probe.9shi.cc/scan/site/start
worker_version: 543d339a-e167-49ea-bf0d-7daa1dad17a7
target: https://example.com
sync_probes: remote_fetch
async_providers: none
result: site-10-layer-scan-start/v0.1 / ok / remote_fetch fulfilled
```

Verified Worker-mediated browser runtime smoke:

```text
target: https://example.com
request_id: 79914d6f-d846-4ba4-a8f7-812716dc7f5d
github_run: 26209285049
result: browser_page_probe / layer 4 / ok
source: github-actions-browser
saved_result: smoke-results/browser-runtime-example.com-79914d6f.json
validation: npm run check:browser-runtime-import -- smoke-results\browser-runtime-example.com-79914d6f.json
```

## Next Steps

- Use `specs/backend-scan-job-v2.md` as the monitoring document for the second backend version before adding job/state runtime code; the first implementation slice should be a no-storage ScanJob model/helper, not a frontend change.
- The no-storage ScanJob model/helper now exists; the next backend slice should expose or exercise it only through a narrow Worker boundary, and must not introduce persistent storage before a separate storage spec is approved.
- `POST /scan/jobs` now exists as that narrow Worker boundary. Do not add `GET /scan/jobs/:id`, collect, cancel, or artifact endpoints until the no-storage vs storage ownership is explicitly reviewed.
- Caller-owned `POST /scan/jobs/collect` and `POST /scan/jobs/artifact` now exist because their state is supplied in the request body. Id-based job endpoints remain blocked until storage or signed-handle ownership is designed.
- `specs/backend-signed-job-handle.md` defines that signed handles can only upgrade caller-owned state; id-only job endpoints still require persisted storage. Runtime support now returns and accepts `job_handle` on no-storage job endpoints when `SCAN_JOB_HANDLE_SECRET` and `SCAN_JOB_HANDLE_KID` are configured.
- `specs/backend-persisted-job-store.md` defines the KV/R2-first persisted job store boundary required before id-based job endpoints are implemented. `src/scan/storage.ts` now provides pure storage ports and in-memory adapters for local verification only.
- Id-based job routes now have explicit storage-dependent semantics: without `SCAN_JOB_KV`, `GET /scan/jobs/:id`, `POST /scan/jobs/:id/collect`, `POST /scan/jobs/:id/poll`, `POST /scan/jobs/:id/cancel`, and `GET /scan/jobs/:id/artifact` return `storage_not_configured`; with `SCAN_JOB_KV`, the Worker stores bounded metadata/raw/artifact payloads in KV and marks responses `storage_persisted=true`.
- `POST /scan/jobs/:id/poll` is backend-only async provider orchestration. It reads persisted `ProviderJob` state, reuses existing GitHub/WebPageTest service functions for status/result calls, merges completed result envelopes into the stored `ScanJob`, and keeps pending jobs as provider state instead of positive evidence.
- `wrangler.toml` now contains the user-provided bindings `SCAN_JOB_KV = kv-for-site10layer / bb485af9804a448b91b5e09103dce877` and `SCAN_JOB_DB = db-for-site10layer / bf7c75e1-5108-4088-951a-780824bf541a`. D1 is bound but unused in this slice; no D1 remote command is part of local verification.
- KV-backed Worker deployment smoke passed: Worker version `6f0b5525-824a-47a6-b774-f432a37195a5` at `https://probe.9shi.cc`; `POST /scan/jobs` for `https://example.com` returned `storage_persisted=true`, job `scan-example.com-cb2076bf-fd86-4d94-b923-6522aa96207c`, and `record_count=20`; `GET /scan/jobs/:id` returned persisted metadata; `GET /scan/jobs/:id/artifact` returned `site-10-layer-scan-export-artifact/v0.1` with Analysis, Brief, and Markdown. The smoke wrote short-lived KV records through the Worker API and did not execute a D1 command.
- Layer 7 deeper service fingerprinting is governed by `specs/layer-07-service-fingerprint-boundary.md`: default automation may only use passive or bounded web-safe signals, with explicit rate limits and no port scanning, brute forcing, vulnerability probing, or user enumeration. The first default-safe implementation is `service_fingerprint_probe`.
- Keep the Worker-mediated GitHub Actions live TLS provider as the L2 MVP certificate source; later add OCSP/revocation or multi-region checks if required.
- Keep L9 RDAP / WHOIS-lite evidence in Worker as registration evidence only; do not claim legal operating-entity ownership.
- Keep L9 Wayback evidence in Worker as historical archive evidence only; do not claim current operation, ownership, or complete site history.
- Keep GitHub Actions Lighthouse as the first full Layer 5 Provider; later add PageSpeed / WebPageTest or browser_runtime performance providers if required.
- Keep PageSpeed / WebPageTest behind Worker secrets and structured provider boundaries; WebPageTest is optional for the current MVP because the available free tier does not provide API access.
- 2026-05-22 remote smoke policy: `npm run smoke:performance-providers-remote` defaults to PageSpeed-only. WebPageTest is included only when `PERFORMANCE_SMOKE_PROVIDERS=pagespeed,webpagetest` is set and a paid/self-hosted API key exists. Missing provider config must not be treated as collected L5 evidence.
- 2026-05-22 PageSpeed remote smoke now reaches Google with the configured Worker secret, but the key is rejected with `Requests from referer <empty> are blocked.` Use a backend-compatible Google API key restriction policy before rerunning the smoke; this is a provider configuration issue, not a Worker routing issue.
- 2026-05-22 PageSpeed remote smoke passed after the Google API key restriction policy was corrected: the smoke selected `pagespeed`, skipped `webpagetest`, and the deployed Worker provider endpoint returned HTTP 200.
- 2026-05-22 PageSpeed real response coverage is enough for current L5 reporting: six core Lighthouse metrics, opportunities, final URL, strategy, source, and performance score are present in the Worker provider result summary.
- 2026-05-22 persisted `/scan/jobs` product-path smoke with `async_providers=["pagespeed"]` passed: PageSpeed completed inside the persisted job, normalized into L5 `performance_probe`, and the persisted artifact returned Analysis, ReportBrief, and Markdown.
- 2026-05-22 PageSpeed field-data preservation is implemented locally: `loadingExperience` / `originLoadingExperience` become `raw_summary.field_data`, and coverage reports `crux_field_data` only when those fields are present.
- 2026-05-22 bounded L6 API reachability sampling is implemented locally: `api_reachability` scan sync results normalize into Layer 6 `api_reachability_probe`, while cross-origin and sensitive/destructive candidates are skipped.
- 2026-05-22 bounded L6 API reachability is deployed in Worker version `d65cef1f-d429-46b1-a837-066150b9362f`; remote persisted-job smoke with `sync_probes=["api_reachability"]` returned one L6 `api_reachability_probe` record and a persisted artifact with Analysis, Brief, and Markdown.
- 2026-05-22 persisted browser runtime L10 verification is implemented locally: `check:browser-runtime-persisted-l10` proves completed browser runtime artifacts merge into persisted `/scan/jobs` records as L10 `runtime_security_events_probe` and flow into Analysis, ReportBrief, and Markdown without frontend changes.
- 2026-05-22 persisted browser runtime product path is verified remotely: `npm run smoke:persisted-browser-runtime-remote` created persisted job `scan-example.com-9896a17e-41d4-44e7-890b-beb61e52daf3`, polled `/scan/jobs/:id/poll` until GitHub Actions browser runtime completed, merged 11 records, and returned a persisted artifact covering L1/L4/L6/L10 with L10 `runtime_security_events_probe`, L6 `runtime_api_requests_probe`, L4 runtime resource bytes/cache/resource records, Analysis, ReportBrief, and Markdown. The smoke result is stored at `smoke-results/persisted-browser-runtime-example.com-2026-05-22T06-33-09-244Z.json`.
- 2026-05-22 selected full-scan persisted product-path smoke passed remotely: `/scan/jobs` ran DNS/TLS/subdomain/org/remote_fetch/performance_basic/API reachability/service fingerprint sync probes plus async PageSpeed for `https://example.com`, persisted job `scan-example.com-1873b8e7-e917-40b3-ad7d-53b1d3e192b7`, produced 30 records covering Layers 1-10, and returned a persisted artifact with Analysis, ReportBrief, and Markdown.
- 2026-05-22 ReportBrief L5 missing-data aggregation was corrected: same-layer PageSpeed evidence now suppresses duplicate `lighthouse_score` and `core_web_vitals_field_data` gaps, while true runtime/WebPageTest gaps remain visible. Local fixture checks pass; the latest remote PageSpeed recheck returned provider HTTP 429 and is correctly kept as provider state rather than collected L5 evidence.
- 2026-05-22 PageSpeed 429 resilience was added: the Worker now returns `performance_provider_rate_limited`, `retryable=true`, optional `retry_after_seconds`, and no collected L5 evidence for rate-limited responses. When `SCAN_JOB_KV` is bound, successful PageSpeed responses are cached by target + strategy and repeat requests can return `cache.status="hit"` without another Google call.
- 2026-05-22 PageSpeed resilience deployed in Worker version `a9f99aa6-e311-4edf-b12d-7a81506c555d`: first remote smoke for `https://example.com` returned `cache_status=stored`; the immediate second smoke returned `cache_status=hit`.
- 2026-05-22 persisted GitHub Actions Lighthouse product path is verified remotely: `npm run smoke:persisted-lighthouse-remote` created persisted job `scan-example.com-e50e11be-6898-43ff-bc75-4cf9f518c7c4`, polled `/scan/jobs/:id/poll` until Lighthouse completed, merged one L5 `performance_probe`, and returned a persisted artifact with Analysis, ReportBrief, and Markdown. The smoke result is stored at `smoke-results/persisted-lighthouse-example.com-2026-05-22T06-29-05-367Z.json`.
- 2026-05-22 selected full-scan persisted product path is verified with all current high-value async providers: `npm run smoke:persisted-selected-full-remote` ran sync DNS/TLS/subdomain/org/remote_fetch/performance_basic/API reachability/service fingerprint plus async PageSpeed, Lighthouse, and browser runtime for `https://example.com`; persisted job `scan-example.com-07d893a8-d4ac-43a1-a314-0ee3b8242a2e` completed after three polls with 42 records, Layers 1-10, L5 PageSpeed and Lighthouse evidence, L4 runtime records, L6 runtime API evidence, L10 runtime security evidence, Analysis, ReportBrief, Analysis Markdown, and Narrative Markdown. The smoke result is stored at `smoke-results/persisted-selected-full-example.com-2026-05-22T08-17-12-461Z.json`; remaining reported gaps are L2 live certificate details, L5 runtime-performance wording gaps, L7 permissioned/deep service inventory, and L9 ICP/related-domain confirmation boundaries.
- 2026-05-22 selected full-scan smoke now includes async `live_tls` and the report layer suppresses gaps already satisfied by L2 live TLS plus L4 browser-runtime waterfall evidence. Worker version `dc5a3bf5-5dc4-41cd-9f3e-2aaad0fb5150` is deployed; job `scan-example.com-cd04c08f-b98c-436f-af9c-a1811ca80347` completed with 43 records, `tls_live_certificate_probe=1`, PageSpeed + Lighthouse + browser runtime evidence, and `missing_data_count=6`. Remaining gaps are only L7 permissioned/deep/external service inventory and L9 ICP/related-domain confirmation boundaries. Smoke result: `smoke-results/persisted-selected-full-example.com-2026-05-22T08-30-39-932Z.json`.
- 2026-05-22 selected full-scan persisted AI report path is verified remotely: `npm run smoke:persisted-selected-full-ai-report-remote` created persisted job `scan-example.com-6f0458a7-cea9-4dd3-b834-2e185bef96e9`, ran sync DNS/TLS/subdomain/org/remote_fetch/performance_basic/API reachability/service fingerprint plus async PageSpeed, Lighthouse, browser runtime, and live TLS, then called `POST /scan/jobs/:id/report`. The final response returned 43 records covering Layers 1-10, 6 AI report sections, 2198-character Markdown, and no unknown `[E###]` / `[M###]` refs. Smoke result: `smoke-results/persisted-selected-full-ai-report-example.com-2026-05-22T11-27-02-314Z.json`.
- 2026-05-22 L7 subdomain attack-surface enrichment is implemented locally: `subdomain_attack_surface_probe` keeps Cert Spotter as the first CT source, falls back to `crt.sh` when Cert Spotter fails or returns no certificates, records CT provider attempts, and enriches bounded HTTPS reachability with final URL, content type, server, x-powered-by, title, and sampled byte count. This remains CT/history plus bounded web observation only, not passive DNS, brute-force enumeration, port scanning, authenticated checking, or proof of current exposure.
- 2026-05-22 L7 remaining gaps are now explicit permissioned backlog: service fingerprint coverage reports `l7_permissioned_deep_port_service_inventory`, `l7_permissioned_authenticated_surface_check`, and `l7_permissioned_external_service_intelligence`; `ReportBrief.missing_data` classifies them as `requires_permission` rather than default `add_provider` work.
- 2026-05-22 L9 related-domain confirmation stays out of default selected full-scan and is verified through a dedicated optional smoke: `npm run smoke:l9-related-domain-confirmation-remote` returned HTTP 200, cited only `RDC001`, produced two relationship evidence items for fixed documentation/CDN candidates, and saved `smoke-results/l9-related-domain-confirmation-remote-2026-05-22T09-49-11-281Z.json`.
- Keep `ReportBrief` as the AI/report boundary; do not call an AI Provider until its input/output contract has been reviewed.
- Keep the L4/L8 AI classifier contract as model-agnostic shape; use the fake provider and Worker mapper checks to validate adapter output, evidence refs, and record conversion.
- Use Worker-mediated `AI_PROVIDER_*` secrets for the real AI Provider adapter; keep frontend direct BYOK out of the default product path.
- Prefer Cloudflare Workers AI binding for the first real `ai_classifier` smoke test; keep OpenAI-compatible `AI_PROVIDER_*` as fallback for later provider portability.
- Keep Layer 7 subdomain enumeration default-safe: CT logs may use Cert Spotter with `crt.sh` fallback, bounded web reachability details, and bounded HTTP(S) fingerprinting, but no passive DNS, zone walking, brute-force enumeration, port scan, authenticated access, permissioned external service intelligence, or vulnerability probing is part of the default product path. Remaining `l7_permissioned_*` gaps must be classified as permissioned backlog rather than default add-provider work.
- Add dedicated external intelligence providers for Layer 9 related domains; keep ICP conditional/out of scope unless a target jurisdiction policy is defined.
- Use the `poixe.com` reference analysis to shape the first deterministic human-readable report section.
- Keep manual GitHub Actions artifact import as a fallback/debug path; the product path should use the Worker-mediated browser runtime action.
- Add run index and diff model.
- Add user login and backend persistence after the no-user model stabilizes.
- Add Browser Extension surface that reuses the same core model.

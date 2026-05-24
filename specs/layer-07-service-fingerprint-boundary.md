# Layer 7 Service Fingerprint Boundary

Status: draft

Path: `specs/layer-07-service-fingerprint-boundary.md`

Implementation status:

- `worker/probes/service-fingerprint.ts` implements the first default-safe bounded HTTP(S) root-document observation.
- `POST /probe/service-fingerprint` exposes the single-probe endpoint.
- `/scan/site/start.sync_probes` accepts `service_fingerprint`.
- `src/providers/results/normalize.ts` maps fulfilled `service_fingerprint` sync results into L7 `service_fingerprint_probe` records.
- `check:service-fingerprint-probe-module` verifies route wiring, bounded request behavior, same-target host filtering, and record normalization.

This spec defines what "deeper service fingerprinting" may safely mean for Layer 7 in the Web App + Worker product. It exists because the current L7 implementation collects CT-derived subdomain candidates, bounded HTTPS reachability, and naming hints, but a broad phrase like service fingerprinting can easily drift into port scanning or intrusive security testing.

## Current L7 Baseline

Current Worker-safe L7 evidence:

- CT log derived subdomain candidates.
- Bounded HTTPS reachability checks for a small number of CT-derived subdomains.
- Naming-pattern surface hints such as `admin`, `staging`, `dev`, `grafana`, `kibana`, and `jenkins`.
- Explicit `limits.max_reachability_checks` and `limits.checked_count`.

This is useful attack-surface evidence, but it is not a full service inventory.

## Allowed Default Signals

Default automated L7 service fingerprinting may use only passive or bounded web-safe signals:

| Signal | Runtime | Allowed Method | Notes |
| --- | --- | --- | --- |
| CT subdomain candidates | Worker | Public CT API lookup | Already implemented through the L7 provider. |
| HTTPS root reachability | Worker | `GET` or `HEAD` to `https://host/` | Must be bounded and same registrable domain. |
| HTTP response headers | Worker | Main response headers only | `server`, `via`, `x-powered-by`, CDN headers, redirects, cache headers. |
| HTML title / meta / generator | Worker or browser runtime | First HTML document only | No crawling or path discovery by default. |
| TLS certificate metadata | Worker or external provider | Existing TLS provider output | May reference SAN, issuer, ALPN/protocol evidence where available. |
| DNS service hints | Worker | DNS records already collected by L1/L9 | CNAME, MX, NS, TXT can suggest hosted services but not ownership. |
| Browser-observed runtime hosts | Browser runtime provider | Network requests during first page load | Must stay within the browser runtime artifact, not direct frontend scanning. |

Allowed output must be worded as evidence or candidate service hints, not definitive exposure claims.

## Forbidden Default Behavior

The default product must not perform:

- TCP or UDP port scanning.
- `nmap`, `masscan`, or equivalent host/port sweeps.
- Directory brute forcing or wordlist probing.
- Authentication, password reset, registration, or user-enumeration workflows.
- Vulnerability exploitation, payload injection, or CVE probing.
- Multi-page crawling beyond the first page unless a separate crawl boundary is approved.
- Probing private IP ranges, localhost, metadata services, or internal networks.
- Checks against domains that are not the normalized target host or CT/browser-observed subdomains of the same registrable domain.

Any future feature that needs these behaviors must be an explicit opt-in provider with permission, rate limits, and audit wording.

## Rate Limits

Default L7 service fingerprinting must keep these limits:

- `max_hosts`: 10 by default for follow-up host reachability/fingerprint requests.
- `max_requests_per_host`: 1 root document request by default.
- `max_concurrency`: 3 outbound requests.
- `timeout_ms`: 10000 per request.
- `redirects`: manual or one-hop observation only; do not recursively follow chains for fingerprinting.
- `methods`: `HEAD` preferred when enough; `GET` only for root HTML/title/header evidence.

If a provider needs higher limits, it must expose those limits in the returned evidence and report limitations.

## Runtime Placement

| Runtime | Role |
| --- | --- |
| Worker | Owns default L7 route, target normalization, SSRF guardrails, CT lookup, bounded HTTP(S) evidence, and structured missing-data records. |
| GitHub Actions provider | May run heavier browser or CLI tooling only when dispatched as an explicit provider job. |
| Browser runtime provider | May provide page-load network evidence that L7 can reference, but must not become direct frontend probing. |
| External intelligence provider | May enrich service hints from passive APIs after provider key and quota policy are configured. |
| Frontend | Must only submit target/config and render results; it must not directly scan hosts. |

## Evidence Contract

Future deeper L7 records should use a separate probe id so the current CT subdomain probe is not overstated:

```ts
{
  layer: 7,
  probe: "service_fingerprint_probe",
  source: "cloudflare_worker_service_fingerprint",
  status: "ok" | "warning" | "error",
  value: {
    target_host: string,
    checked_hosts: Array<{
      host: string,
      url: string,
      observed_status: number | null,
      service_hints: Array<{
        category: "cdn" | "server" | "framework" | "admin_surface" | "monitoring_surface" | "mail" | "unknown",
        label: string,
        evidence: Array<{ type: string; name: string; value: string }>,
      }>,
      limitations: string[],
    }>,
    limits: {
      max_hosts: number,
      checked_hosts: number,
      max_requests_per_host: number,
      max_concurrency: number,
      timeout_ms: number,
    },
  },
  metadata: {
    origin: "worker",
    method: "bounded_http_observation",
    role: "evidence",
  },
  limitations: string[]
}
```

Do not use this record to claim:

- Complete service inventory.
- Open ports beyond the observed HTTP(S) URL.
- Ownership of third-party hosted services.
- Vulnerability presence.

## Missing Data

If deeper signals are requested but not collected, use explicit missing-data wording:

| Missing Data ID | Classification | Reason |
| --- | --- | --- |
| `l7_deep_port_service_inventory` | `requires_permission` | Requires active port/service scanning outside default product boundaries. |
| `l7_authenticated_surface_check` | `requires_permission` | Requires login/interaction scope. |
| `l7_external_service_intel` | `add_provider` | Requires configured passive intelligence provider and quota policy. |
| `l7_large_scale_subdomain_probe` | `requires_permission` | Requires broader host enumeration and rate-limit policy. |

## Implementation Order

1. Keep the current `subdomain_attack_surface` probe as the baseline CT/reachability layer.
2. Add a separate Worker probe only for bounded `service_fingerprint_probe`.
3. Reuse existing `remote_fetch`, DNS, TLS, and browser runtime evidence where possible before issuing new requests.
4. Add tests that prove forbidden behaviors are absent from the default route.
5. Only after that, expose it through `/scan/site/start.sync_probes`.

## Acceptance

This boundary is accepted when:

- The spec states allowed default signals.
- The spec states forbidden default behavior.
- The spec defines rate limits.
- The spec defines runtime placement.
- The spec defines an evidence contract for future `service_fingerprint_probe`.
- The root README, `03-web-app-shell/README.md`, 10-layer acceptance spec, and task console reference this boundary before any deeper L7 implementation.

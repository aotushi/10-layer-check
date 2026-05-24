# Site Analysis: poixe.com

## Public Information Architecture

This report covers 10 layers of evidence, with 6 layers containing warning or error records. The top risks include HTTPS being reachable but HSTS not found, subdomain hints indicating exposed admin or staging surfaces, and missing security headers.

Evidence: [E004] [E021] [E029] [M014] [M015] [M016]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Technology Stack

The technology stack includes a deterministic frontend technology candidate, Vite-like build, and application fingerprints for Cloudflare and React.

Evidence: [E010] [E022] [M007]

Boundaries: Static and heuristic technology evidence is candidate evidence unless directly corroborated.

## Deployment and Network Surface

The deployment and network surface includes DNS and protocol checks, CDN/header signals, TLS, HTTP, cache, and performance evidence.

Evidence: [E001] [E002] [E004] [E015] [M008] [M009] [M010] [M011] [M012] [M013]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Request and Rendering Chain

The request and rendering chain includes the observed request path from DNS/HTTP response through browser runtime resources and API calls.

Evidence: [E015] [E020] [M008] [M009] [M010] [M011] [M012] [M013]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.

## API and Protocol Surface

The API and protocol surface includes API-like requests, protocol/header clues, error surfaces, and skipped reachability boundaries.

Evidence: [E018] [E019] [M014] [M015] [M016]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.

## Subdomains and Attack Surface

The subdomains and attack surface include CT-discovered subdomains, bounded reachability, and service fingerprint hints.

Evidence: [E020] [E021] [M014] [M015] [M016]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Organization and Operations Signals

The organization and operations signals include RDAP, MX/TXT, homepage social/related-domain candidates, and Wayback evidence.

Evidence: [E023] [E024] [M017] [M018] [M019] [M020]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.

## Security Posture

The security posture includes security headers, iframe policy, mixed content, leakage, runtime console/page errors, and risk wording.

Evidence: [E026] [E027] [E028] [E029] [M017] [M018] [M019] [M020]

Boundaries: Report missing controls as risk signals, not confirmed exploitability without authorized testing.

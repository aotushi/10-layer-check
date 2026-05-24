# Site Analysis: poixe.com

## Public Information Architecture

This report covers 10 layers of evidence, with 5 layers containing warning or error records. The top risks include HTTPS is reachable, but HSTS was not found on the probed response, and missing security headers: content-security-policy, strict-transport-security, permissions-policy.

Evidence: [E004] [E029]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Technology Stack

The technology stack includes a deterministic frontend technology candidate, Vite-like build, and a possible React framework. The resource surface includes 2 declared resources and weighs 2799 bytes.

Evidence: [E010] [E012]

Boundaries: Static and heuristic technology evidence is candidate evidence unless directly corroborated.

## Deployment and Network Surface

The deployment and network surface includes DNS and protocol checks completed; no CDN signal was found from DNS records, and a CDN header signal found: cloudflare.

Evidence: [E002] [E001]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Request and Rendering Chain

The request and rendering chain includes a final response returned HTTP 200, and a TTFB 763ms; known sampled page weight 3KB.

Evidence: [E007] [E015]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.

## API and Protocol Surface

The API and protocol surface includes no obvious API or server error surface was detected in the main response, and found 2 protocol or platform clue(s) from response headers.

Evidence: [E018] [E019]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.

## Subdomains and Attack Surface

The subdomains and attack surface includes collected 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s), and found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces.

Evidence: [E020] [E021]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Organization and Operations Signals

The organization and operations signals include collected organization-facing DNS, homepage, registration, or archive evidence, and collected RDAP / WHOIS-lite registration evidence.

Evidence: [E023] [E024]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.

## Security Posture

The security posture includes frame embedding policy is present, no obvious static leakage signals were found in the main HTML, and missing security headers: content-security-policy, strict-transport-security, permissions-policy.

Evidence: [E026] [E027] [E029]

Boundaries: Report missing controls as risk signals, not confirmed exploitability without authorized testing.

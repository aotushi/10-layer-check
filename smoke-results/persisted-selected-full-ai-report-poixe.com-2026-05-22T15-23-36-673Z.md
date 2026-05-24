# Site Analysis: poixe.com

## Public Information Architecture

This report covers a technical site analysis of poixe.com, with a focus on its public information architecture, technology stack, deployment and network surface, request and rendering chain, API and protocol surface, subdomains and attack surface, organization and operations signals, security posture, and missing data and next steps.

Evidence: [E001] [E002] [M001] [M002]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Technology Stack

The technology stack of poixe.com includes frontend technologies such as Vite-like build, and app fingerprint candidates like Cloudflare and React.

Evidence: [E007] [E008] [E009] [E018] [M003] [M004]

Boundaries: Static and heuristic technology evidence is candidate evidence unless directly corroborated.

## Deployment and Network Surface

The deployment and network surface of poixe.com includes DNS records, CDN/header signals, TLS evidence, HTTP cache policy, and performance metrics.

Evidence: [E001] [E002] [E003] [E005] [E013] [M005] [M006]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Request and Rendering Chain

The request and rendering chain of poixe.com includes the observed request path from DNS/HTTP response through browser runtime resources and API calls.

Evidence: [E004] [E006] [E014] [E015] [M007] [M008]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.

## API and Protocol Surface

The API and protocol surface of poixe.com includes API-like requests, protocol/header clues, error surfaces, and skipped reachability boundaries.

Evidence: [E014] [E015] [E025] [M009] [M010]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.

## Subdomains and Attack Surface

The subdomains and attack surface of poixe.com includes CT-discovered subdomains, bounded reachability, and service fingerprint hints.

Evidence: [E016] [E017] [M011] [M012]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Organization and Operations Signals

The organization and operations signals of poixe.com include RDAP, MX/TXT, homepage social/related-domain candidates, and Wayback evidence.

Evidence: [E019] [E020] [E021] [M013] [M014]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.

## Security Posture

The security posture of poixe.com includes security headers, iframe policy, mixed content, leakage, runtime console/page errors, and risk wording.

Evidence: [E022] [E023] [E024] [E025] [M015] [M016]

Boundaries: Report missing controls as risk signals, not confirmed exploitability without authorized testing.

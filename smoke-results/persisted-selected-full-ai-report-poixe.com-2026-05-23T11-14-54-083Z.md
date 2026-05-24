# Site Analysis: poixe.com

## Executive Summary

This report summarizes the technical analysis of the Poixe website. The analysis covers 10 layers, including network, TLS, HTTP, frontend, performance, API, subdomains, fingerprint, organization, and security. The report highlights the strongest evidence-backed conclusions, coverage, and top risks.

Evidence: [E004] [E024] [E025] [E030] [E039] [E003] [E019] [E029] [E038] [E001] [M001] [M002] [M003] [M004]

Boundaries: This record is derived from response/resource headers only.; It complements, but does not replace, DNS-based CDN hints in network_infrastructure_probe.; It does not prove full edge routing, origin shielding, cache behavior, or CDN provider coverage.

## Public Information Architecture

The Poixe website has a public information architecture that includes visible routes, robots/sitemap signals, page/resource shape, subdomain candidates, and endpoint hints. The website has a single URL and bounded runtime evidence, which may miss authenticated routes and deep crawl paths.

Evidence: [E030] [E012] [E015] [E010] [E018] [E016] [E019] [E009] [M001] [M002] [M003]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Technology Stack

The Poixe website has a technology stack that includes frontend, app fingerprint, resource, and runtime clues. The website has static and heuristic technology evidence, which is candidate evidence unless directly corroborated.

Evidence: [E012] [E013] [E021] [E022] [E031] [E010] [E009] [E016]

## Deployment and Network Surface

The Poixe website has a deployment and network surface that includes DNS, CDN/header, TLS, HTTP, cache, and performance evidence. The website has CDN header signal(s) found: cloudflare, which indicates that the website is using a Content Delivery Network (CDN) provided by Cloudflare.

Evidence: [E004] [E024] [E025] [E001] [E002] [E005] [E007] [E008]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Request and Rendering Chain

The Poixe website has a request and rendering chain that includes the observed request path from DNS/HTTP response through browser runtime resources and API calls. The website has a worker fetch and one browser run, which do not represent every user route or session state.

Evidence: [E019] [E011] [E017] [E018] [E028] [E010] [E008] [E016]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.

## API and Protocol Surface

The Poixe website has an API and protocol surface that includes API-like requests, protocol/header clues, error surfaces, and skipped reachability boundaries. The website has no obvious API or server error surface was detected in the main response.

Evidence: [E026] [E027] [E028] [E004] [E019] [E024] [E025] [E030]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.

## Subdomains and Attack Surface

The Poixe website has a subdomains and attack surface that includes CT-discovered subdomains, bounded reachability, and service fingerprint hints. The website has found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces.

Evidence: [E030] [E029] [E031] [E004] [E019] [E024] [E025] [E038] [M001] [M002] [M003]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Organization and Operations Signals

The Poixe website has an organization and operations signals that includes RDAP, MX/TXT, homepage social/related-domain candidates, and Wayback evidence. The website has collected organization-facing DNS, homepage, registration, or archive evidence.

Evidence: [E032] [E033] [E034] [E004] [E019] [E024] [E025] [E030] [M004] [M005] [M006]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.

## Security Posture

The Poixe website has a security posture that includes security headers, iframe policy, mixed content, leakage, runtime console/page errors, and risk wording. The website has missing security headers: content-security-policy, strict-transport-security, permissions-policy.

Evidence: [E038] [E039] [E035] [E036] [E037] [E008] [E004] [E019]

Boundaries: Report missing controls as risk signals, not confirmed exploitability without authorized testing.

## Missing Data and Next Steps

The Poixe website has missing data and next steps that includes remaining gaps by add_provider, requires_permission, manual_review, requires_user_input, and out_of_scope. The website has missing data: l7_permissioned_authenticated_surface_check (requires_permission).

Evidence: [E004] [E019] [E024] [E025] [E030] [E038] [E039] [M001] [M002] [M003] [M004] [M005] [M006]

# Site Analysis: poixe.com

## Executive Summary

This site has 10/10 layers with collected evidence. 5 layer(s) contain warning or error records. 5 high/medium risk item(s) should be reviewed first.

Evidence: [E001] [E002] [E003]

Boundaries: This record is derived from response/resource headers only.; It complements, but does not replace, DNS-based CDN hints in network_infrastructure_probe.; It does not prove full edge routing, origin shielding, cache behavior, or CDN provider coverage.

## Public Information Architecture

The site has a public information architecture with visible routes, robots/sitemap signals, page/resource shape, subdomain candidates, and endpoint hints. The site has a robots.txt file and a sitemap.xml file.

Evidence: [E015]

Boundaries: This checks robots.txt and the default /sitemap.xml URL only.; Nested sitemap crawling and full crawl policy interpretation are out of MVP scope.

## Technology Stack

The site uses Cloudflare as its CDN provider. The site has a Cloudflare CDN header signal.

Evidence: [E001] [E002]

Boundaries: This record is derived from response/resource headers only.; It complements, but does not replace, DNS-based CDN hints in network_infrastructure_probe.; It does not prove full edge routing, origin shielding, cache behavior, or CDN provider coverage.

## Deployment and Network Surface

The site has a deployment and network surface with DNS, CDN/header, TLS, HTTP, cache, and performance evidence. The site has a Cloudflare CDN header signal.

Evidence: [E001] [E002] [E003]

Boundaries: DNS records and ASN enrichment are collected through external DNS intelligence providers.; CDN provider detection is a DNS/response-hint inference and does not prove full edge routing or origin topology.; Protocol reachability confirms the probed HTTP/HTTPS URLs only, not every endpoint on the site.

## Request and Rendering Chain

The site has a request and rendering chain with observed request path from DNS/HTTP response through browser runtime resources and API calls. The site has a Cloudflare CDN header signal.

Evidence: [E001] [E002] [E003]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.

## API and Protocol Surface

The site has an API and protocol surface with API-like requests, protocol/header clues, error surfaces, and skipped reachability boundaries. The site has a Cloudflare CDN header signal.

Evidence: [E001] [E002] [E003]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.

## Subdomains and Attack Surface

The site has a subdomain attack surface with CT-discovered subdomains, bounded reachability, and service fingerprint hints. The site has a Cloudflare CDN header signal.

Evidence: [E029] [M001] [M002] [M003]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Organization and Operations Signals

The site has an organization and operations signals with RDAP, MX/TXT, homepage social/related-domain candidates, and Wayback evidence. The site has a Cloudflare CDN header signal.

Evidence: [E032] [E033] [E034] [M004] [M005] [M006]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.

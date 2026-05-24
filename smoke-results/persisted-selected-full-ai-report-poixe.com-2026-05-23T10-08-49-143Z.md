# Site Analysis: poixe.com

## Executive Summary

This site has 10/10 layers with collected evidence. 5 layer(s) contain warning or error records. 5 high/medium risk item(s) should be reviewed first.

Evidence: [E004] [E024] [E025] [E030] [E039] [E003] [E019] [E029] [E038] [E001] [M001] [M002] [M003]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Public Information Architecture

Current evidence includes Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Crawl metadata found: robots.txt=yes, sitemap.xml=yes. Remaining gaps: l7_permissioned_authenticated_surface_check (requires_permission) l7_permissioned_deep_port_service_inventory (requires_permission) l7_permissioned_external_service_intelligence (requires_permission)

Evidence: [E030] [E012] [E015] [E010] [E018] [E016] [E019] [E009] [M001] [M002] [M003]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Technology Stack

The site uses Cloudflare as its CDN provider, as indicated by the presence of Cloudflare headers in the HTTP response. The site also uses React as its frontend framework, as indicated by the presence of React-specific HTML patterns.

Evidence: [E012] [E013] [E021] [E022] [E031] [E010] [E009] [E016]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Deployment and Network Surface

Current evidence includes HTTPS is reachable, but HSTS was not found on the probed response. Performance score 30; 5 metric(s) are poor. Lighthouse performance score 33; 4 metric(s) are poor.

Evidence: [E004] [E024] [E025] [E001] [E002] [E005] [E007] [E008]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Request and Rendering Chain

The site's request and rendering chain involves a DNS lookup, followed by an HTTP request to the site's root URL. The browser then renders the site's HTML content, which includes resources such as scripts and stylesheets.

Evidence: [E019] [E011] [E017] [E018] [E028] [E010] [E008] [E016]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.

## API and Protocol Surface

Current evidence includes No obvious API or server error surface was detected in the main response. Found 2 protocol or platform clue(s) from response headers. Browser runtime observed 6 API-like request(s), including 0 third-party request(s).

Evidence: [E026] [E027] [E028] [E004] [E019] [E024] [E025] [E030]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.

## Subdomains and Attack Surface

The site has a number of subdomains, including academy.poixe.com, admin.s3.poixe.com, and blog.poixe.com. These subdomains are reachable via HTTPS, but do not appear to be serving any content.

Evidence: [E030] [E029] [E031] [E004] [E019] [E024] [E025] [E038] [M004] [M005] [M006]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.

## Organization and Operations Signals

Current evidence includes Collected organization-facing DNS, homepage, registration, or archive evidence. Collected RDAP / WHOIS-lite registration evidence. Collected Wayback historical archive evidence. Remaining gaps: icp (out_of_scope) related_domain_candidates (manual_review) related_domain_confirmation (manual_review)

Evidence: [E032] [E033] [E034] [E004] [E019] [E024] [E025] [E030] [M004] [M005] [M006]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.

## Security Posture

The site has a number of security-related issues, including missing security headers and a lack of iframe policy. The site also has a number of runtime console/page errors.

Evidence: [E038] [E039] [E035] [E036] [E037] [E008] [E004] [E019] [M001] [M002] [M003] [M004] [M005] [M006]

Boundaries: Do not present missing data as collected evidence.

## Missing Data and Next Steps

Current evidence includes HTTPS is reachable, but HSTS was not found on the probed response. Browser runtime observed 2 failed resource(s). Performance score 30; 5 metric(s) are poor. Remaining gaps: l7_permissioned_authenticated_surface_check (requires_permission) l7_permissioned_deep_port_service_inventory (requires_permission) l7_permissioned_external_service_intelligence (requires_permission)

Evidence: [E004] [E019] [E024] [E025] [E030] [E038] [E039] [M001] [M002] [M003] [M004] [M005] [M006]

Boundaries: Do not present missing data as collected evidence.

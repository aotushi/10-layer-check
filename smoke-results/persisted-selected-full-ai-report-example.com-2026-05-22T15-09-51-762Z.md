# Site Analysis: example.com

## Public Information Architecture

This report covers a technical analysis of the site example.com. The analysis is based on 10 layers of evidence, with 3 layers containing warning or error records. The report highlights 2 high/medium risk items that should be reviewed first.

Evidence: [E001] [E002] [E003]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Technology Stack

The site's technology stack includes a frontend with no high-confidence static frontend technology candidate found. The browser runtime loaded the page without common access barrier signals. The browser runtime loaded the page and captured rendered-page evidence.

Evidence: [E009] [E010] [E011]

Boundaries: Static and heuristic technology evidence is candidate evidence unless directly corroborated.

## Deployment and Network Surface

The site's deployment and network surface includes a CDN header signal found: cloudflare. DNS and protocol checks completed; no CDN signal was found from DNS records. The live certificate expires in 40 day(s).

Evidence: [E001] [E003] [E005]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Request and Rendering Chain

The site's request and rendering chain includes a browser runtime loaded the page without common access barrier signals. The browser runtime loaded the page and captured rendered-page evidence. The browser runtime did not observe XHR/fetch/API-like requests during this page load.

Evidence: [E010] [E011] [E028]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.

## API and Protocol Surface

The site's API and protocol surface includes no obvious API or server error surface was detected in the main response. Found 2 protocol or platform clue(s) from response headers. Browser runtime did not observe XHR/fetch/API-like requests during this page load.

Evidence: [E026] [E027] [E028]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.

## Subdomains and Attack Surface

The site's subdomains and attack surface includes 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s). Found 1 CT-discovered subdomain candidate(s).

Evidence: [E029] [E030] [M001] [M002] [M003]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Organization and Operations Signals

The site's organization and operations signals include collected organization-facing DNS, homepage, registration, or archive evidence. Collected RDAP / WHOIS-lite registration evidence. Collected Wayback historical archive evidence.

Evidence: [E032] [E033] [E034] [M004] [M005]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.

## Security Posture

The site's security posture includes no X-Frame-Options or CSP frame-ancestors policy was found. No obvious static leakage signals were found in the main HTML. No static mixed-content URLs were found in the main HTML. Browser runtime did not observe mixed content, console errors, page errors, or failed requests. Missing security headers: content-security-policy, strict-transport-security, x-frame-options, x-content-type-options, referrer-policy, permissions-policy.

Evidence: [E035] [E036] [E037] [E038] [E039]

Boundaries: Report missing controls as risk signals, not confirmed exploitability without authorized testing.

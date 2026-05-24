## Public Information Architecture

The site has 10 layers of evidence, with 3 layers containing warning or error records. 2 high/medium risk items should be reviewed first. [E004] [E039] [E003] [E015] [E029] [E030] [E035] [M001] [M002] [M003] [M004] [M005]

Limitations: HTTPS is reachable, but HSTS was not found on the probed response.; Missing security headers: content-security-policy, strict-transport-security, x-frame-options, x-content-type-options, referrer-policy, permissions-policy; DNS and protocol checks completed; no CDN signal was found from DNS records.; No robots.txt or default sitemap.xml was found by the remote fetch provider.; Collected 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s).; Found 1 CT-discovered subdomain candidate(s).; No X-Frame-Options or CSP frame-ancestors policy was found.

## Deployment Network Surface

The site has a CDN provider, but the CDN provider detection is a DNS/response-hint inference and does not prove full edge routing or origin topology. [E001] [E002] [E003]

Limitations: This record is derived from response/resource headers only.; It complements, but does not replace, DNS-based CDN hints in network_infrastructure_probe.; It does not prove full edge routing, origin shielding, cache behavior, or CDN provider coverage.

## API Protocol Surface

The site has a performance score of 100, but the performance results depend on the selected provider, strategy, location, device profile, and run timing. [E023] [E024] [E025]

Limitations: Worker fetch timing is lab-like backend timing from the Worker location, not a real user browser metric.; TTFB is measured as elapsed time until response headers are available to the Worker fetch call.; Page weight is an estimate from the HTML response plus sampled declared resources with known content-length.; JavaScript-rendered resources and browser-only timings require browser_runtime or Lighthouse provider data.

## Organization Operations

The site has a subdomain attack surface, but the reachability checks are intentionally bounded and do not constitute a full port or service scan. [E029] [E030] [M001] [M002] [M003]

Limitations: This probe only performs bounded HTTP(S) root-document observation.; It does not perform TCP/UDP port scanning, directory brute forcing, authentication workflows, or vulnerability probing.; Service hints are candidates derived from headers and first-page HTML, not a complete service inventory.

## Missing Data Next Steps

The site has a security posture, but the security-header checks apply to the probed main response only. [E035] [E036] [E037] [E038] [E039]

Limitations: Frame embedding assessment is based on response headers and static iframe tags from the main response.; It does not test browser embedding behavior from external origins.; Leakage patterns are conservative static checks and can produce false positives.; Potential secrets must be manually confirmed before being reported as exposed credentials.; Static mixed-content detection scans the main HTML only.; Runtime mixed content from JavaScript, CSS, or iframe activity requires browser_runtime evidence.

## Public Information Architecture

This site has 10 layers of evidence, with 3 layers containing warning or error records. 2 high/medium risk items should be reviewed first. [E004] [E039] [M001] [M002] [M003]

Limitations: HTTPS is reachable, but HSTS was not found on the probed response.; Missing security headers: content-security-policy, strict-transport-security, x-frame-options, x-content-type-options, referrer-policy, permissions-policy

## Technology Stack

The site has a public information architecture with a clear structure and navigation. The homepage has a robots.txt file and a default sitemap.xml file. [E015] [M004] [M005]

Limitations: This checks robots.txt and the default /sitemap.xml URL only.; Nested sitemap crawling and full crawl policy interpretation are out of MVP scope.

## Deployment Network Surface

The site uses a Cloudflare CDN and has a performance score of 100. The site also uses a Lighthouse performance probe. [E023] [E024] [E025]

Limitations: Worker fetch timing is lab-like backend timing from the Worker location, not a real user browser metric.; TTFB is measured as elapsed time until response headers are available to the Worker fetch call.; Page weight is an estimate from the HTML response plus sampled declared resources with known content-length.

## Request Rendering Chain

The site has a deployment network surface with a Cloudflare CDN. The site also has a service fingerprint probe. [E029] [M001] [M002] [M003]

Limitations: This probe only performs bounded HTTP(S) root-document observation.; It does not perform TCP/UDP port scanning, directory brute forcing, authentication workflows, or vulnerability probing.

## API Protocol Surface

The site has a request rendering chain with a Cloudflare CDN. The site also has a runtime security events probe. [E038]

Limitations: Browser runtime records are derived from imported runtime artifacts.; Artifact paths, network visibility, and timing depend on the browser provider environment.; Runtime resource records may still contain null transfer size, encoded body size, or decoded body size values.

## Subdomain Attack Surface

The site has an API protocol surface with a Cloudflare CDN. The site also has a protocol probe. [E027]

Limitations: Protocol clues are inferred from visible response headers.; Absence of a clue does not prove absence of REST, GraphQL, RPC, WebSocket, or SSE interfaces.

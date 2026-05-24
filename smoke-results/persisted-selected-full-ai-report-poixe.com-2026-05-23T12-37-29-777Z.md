# Site Analysis: poixe.com

## Executive Summary

This site has 10/10 layers with collected evidence. However, 5 layers contain warning or error records. The top risks include HTTPS is reachable, but HSTS was not found on the probed response, Performance score 30; 5 metric(s) are poor, Lighthouse performance score 32; 4 metric(s) are poor, Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces, and Missing security headers: content-security-policy, strict-transport-security, permissions-policy. Current evidence highlights: HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Performance score 30; 5 metric(s) are poor. Evidence: pagespeed=5 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+2 more); pagespeed=5 item(s): unminified-javascript, redirects, unminified-css (+2 more). Lighthouse performance score 32; 4 metric(s) are poor. Evidence: lighthouse=4 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+1 more); lighthouse=4 item(s): unused-javascript, server-response-time, redirects (+1 more). Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.po... Missing security headers: content-security-policy, strict-transport-security, permissions-policy. Evidence: x-frame-options=SAMEORIGIN; x-content-type-options=nosniff; referrer-policy=strict-origin-when-cross-origin. DNS and protocol checks completed; no CDN signal was found from DNS records. Evidence: A=2 item(s): 172.67.209.147, 104.21.75.2; AAAA=2 item(s): 2606:4700:3034::6815:4b02, 2606:4700:3032::ac43:d193; CNAME=none; HTTPS=1 item(s): \# 136 00 01 00 00 01 00 06 02 68 33 02 68 32 00 04 00 08 68 15 4b 02 ac 43 d1 93 00 05 00 47 00 45 fe 0d 00 41 15 00 20 00 20 bf... Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6.

Evidence: [E004] [E024] [E025] [E031] [E041] [E003] [E019] [E030] [E040] [M001] [M002] [M003]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Public Information Architecture

Current evidence highlights: Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.po... Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Evidence: html_bytes=2799; scripts=1; stylesheets=1; images=0. Crawl metadata found: robots.txt=yes, sitemap.xml=yes. Evidence: https://poixe.com/robots.txt=200; https://poixe.com/sitemap.xml=200. Browser runtime loaded the page without common access barrier signals. Evidence: final_url=https://poixe.com/; status_code=200; html_title=Poixe AI; screenshot=/home/runner/work/02-browser-runtime-remote-git/02-browser-runtime-remote-git/screenshots/poixe.com-2026-05-23.png. Browser runtime observed 22 resources. Evidence: runtime_resource_count=22; runtime_resource_counts=document=1, script=3, stylesheet=1, image=4. Remaining gaps: l7_permissioned_authenticated_surface_check (requires_permission) l7_permissioned_deep_port_service_inventory (requires_permission) l7_permissioned_external_service_intelligence (requires_permission)

Evidence: [E031] [E012] [E015] [E010] [E018] [E016] [E019] [E009] [M001] [M002] [M003]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Technology Stack

Current evidence highlights: Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Evidence: html_bytes=2799; scripts=1; stylesheets=1; images=0. Found 1 deterministic frontend technology candidate(s). Evidence: Vite-like_build=category=build_tool, confidence=possible, evidence_refs=3 item(s): script:1, stylesheet:1, marker:type=module. Browser runtime observed 2 third-party scripts and 12 third-party resources. Evidence: script=https://static.cloudflareinsights.com/beacon.min.js/v833ccba57c9e4d2798f2e76cebdd09a11778172276447; script=https://matomo.gptocean.com/matomo.js; ping=https://matomo.gptocean.com/matomo.php?...; image=https://s3.poixe.com/apple/avatar-2.webp. No third-party script was found in static HTML. Found 2 application fingerprint candidate(s): Cloudflare, React. Evidence: Cloudflare=category=hosting, confidence=high, evidence=server: cloudflare; Cloudflare=category=hosting, confidence=high, evidence=cf-ray: a0041a5bba42cb94-LAX; React=category=framework, confidence=medium, evidence=html matched /id=["']root["']/i.

Evidence: [E012] [E013] [E021] [E022] [E032] [E010] [E009] [E016]

Boundaries: Static and heuristic technology evidence is candidate evidence unless directly corroborated.

## Deployment and Network Surface

Current evidence highlights: HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Performance score 30; 5 metric(s) are poor. Evidence: pagespeed=5 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+2 more); pagespeed=5 item(s): unminified-javascript, redirects, unminified-css (+2 more). Lighthouse performance score 32; 4 metric(s) are poor. Evidence: lighthouse=4 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+1 more); lighthouse=4 item(s): unused-javascript, server-response-time, redirects (+1 more). CDN header signal(s) found: cloudflare. Evidence: cf-cache-status=url=https://poixe.com/, provider=cloudflare; cf-ray=url=https://poixe.com/, provider=cloudflare; report-to=url=https://poixe.com/, provider=cloudflare; server=url=https://poixe.com/, provider=cloudflare. CDN header signal(s) found: cloudflare. Evidence: cf-ray=url=https://poixe.com/, provider=cloudflare; cf-cache-status=url=https://poixe.com/, provider=cloudflare; server=url=https://poixe.com/, provider=cloudflare; cf-ray=url=https://poixe.com/assets/index-CF1CQuMX.js, provider=cloudflare.

Evidence: [E004] [E024] [E025] [E001] [E002] [E005] [E007] [E008]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Request and Rendering Chain

Current evidence highlights: Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6. Browser runtime loaded the page and captured rendered-page evidence. Evidence: final_url=https://poixe.com/; status_code=200; html_title=Poixe AI. Browser runtime observed 0.52 MiB of known transfer size with 2 unknown resource size(s). Evidence: runtime_transfer_size_total=544948; runtime_transfer_size_known_count=20; runtime_transfer_size_unknown_count=2. Browser runtime observed 22 resources. Evidence: runtime_resource_count=22; runtime_resource_counts=document=1, script=3, stylesheet=1, image=4. Browser runtime observed 6 API-like request(s), including 0 third-party request(s). Evidence: runtime_api_request_count=6; runtime_api_failed_count=0; runtime_api_third_party_count=0.

Evidence: [E019] [E011] [E017] [E018] [E029] [E010] [E008] [E016]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.

## API and Protocol Surface

Current evidence highlights: No obvious API or server error surface was detected in the main response. Evidence: error_surface=status_code=200, content_type=text/html. Found 2 protocol or platform clue(s) from response headers. Evidence: protocol_clues=server=cloudflare. Browser runtime observed 6 API-like request(s), including 0 third-party request(s). Evidence: runtime_api_request_count=6; runtime_api_failed_count=0; runtime_api_third_party_count=0. No CORS headers were found on the main response. Evidence: cors=5 field(s). HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more).

Evidence: [E026] [E027] [E029] [E028] [E004] [E019] [E024] [E025]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.

## Subdomains and Attack Surface

This site has 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s). Current evidence highlights: Collected 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s). Evidence: checked_hosts=1 host(s): poixe.com; service_fingerprint_limits=max_hosts=1, checked_hosts=1, max_requests_per_host=1, max_concurrency=3. Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.po... Found 2 application fingerprint candidate(s): Cloudflare, React. Evidence: Cloudflare=category=hosting, confidence=high, evidence=server: cloudflare; Cloudflare=category=hosting, confidence=high, evidence=cf-ray: a0041a5bba42cb94-LAX; React=category=framework, confidence=medium, evidence=html matched /id=["']root["']/i. HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6. Performance score 30; 5 metric(s) are poor. Evidence: pagespeed=5 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+2 more); pagespeed=5 item(s): unminified-javascript, redirects, unminified-css (+2 more). Lighthouse performance score 32; 4 metric(s) are poor. Evidence: lighthouse=4 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+1 more); lighthouse=4 item(s): unused-javascript, server-response-time, redirects (+1 more).

Evidence: [E030] [M001] [M002] [M003]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Organization and Operations Signals

This site has collected organization-facing DNS, homepage, registration, or archive evidence. Current evidence highlights: Collected organization-facing DNS, homepage, registration, or archive evidence. Evidence: mx=3 item(s): 1 mx1.larksuite.com., 10 mx3.larksuite.com., 5 mx2.larksuite.com.; txt=2 item(s): "v=spf1 +include:spf.onlarksuite.com -all", "verification-code-site-App_lark=Sdxd3rHU75iYSAvjtheE"; social_links=none; related_domain_candidates=none. Collected RDAP / WHOIS-lite registration evidence. Evidence: rdap_registrar=NameSilo, LLC; rdap_events=4 item(s): 2019-03-05T05:45:05Z, 2027-03-05T05:45:05Z, 2026-01-31T13:52:33Z (+1 more); rdap_nameservers=2 item(s): CURT.NS.CLOUDFLARE.COM, ROSEMARY.NS.CLOUDFLARE.COM. Collected Wayback historical archive evidence. Evidence: wayback_snapshot_count_estimate=null; wayback_first_snapshot=status_code=200; wayback_last_snapshot=status_code=200. HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6. Performance score 30; 5 metric(s) are poor. Evidence: pagespeed=5 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+2 more); pagespeed=5 item(s): unminified-javascript, redirects, unminified-css (+2 more). Lighthouse performance score 32; 4 metric(s) are poor. Evidence: lighthouse=4 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+1 more); lighthouse=4 item(s): unused-javascript, server-response-time, redirects (+1 more).

Evidence: [E033] [M004] [M005] [M006]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.

## Security Posture

This site has missing security headers: content-security-policy, strict-transport-security, permissions-policy. Current evidence highlights: Missing security headers: content-security-policy, strict-transport-security, permissions-policy. Evidence: x-frame-options=SAMEORIGIN; x-content-type-options=nosniff; referrer-policy=strict-origin-when-cross-origin. No Set-Cookie header was observed on the main response. Evidence: set-cookie=null. No CORS headers were found on the main response. Evidence: cors=5 field(s). Frame embedding policy is present. Evidence: x-frame-options=SAMEORIGIN; content-security-policy=null; iframe_sources=none. HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Browser runtime observed 0 console error(s) and 2 failed request(s). Evidence: runtime_mixed_content_candidate_count=0; runtime_failed_request_count=2; runtime_console_error_count=0; runtime_page_error_count=0. No obvious static leakage signals were found in the main HTML. Evidence: leakage_signals=none.

Evidence: [E041]

Boundaries: Report missing controls as risk signals, not confirmed exploitability without authorized testing.

## Missing Data and Next Steps

This site has missing data: l7_permissioned_authenticated_surface_check (requires_permission), l7_permissioned_deep_port_service_inventory (requires_permission), l7_permissioned_external_service_intelligence (requires_permission), icp (out_of_scope), related_domain_candidates (manual_review), and related_domain_confirmation (manual_review). Gap groups: requires_permission: 3 (l7_permissioned_authenticated_surface_check; l7_permissioned_deep_port_service_inventory; l7_permissioned_external_service_intelligence) | manual_review: 2 (related_domain_candidates; related_domain_confirmation) | out_of_scope: 1 (icp) Current evidence highlights: Missing data: l7_permissioned_authenticated_surface_check (requires_permission). Missing data: l7_permissioned_deep_port_service_inventory (requires_permission). Missing data: l7_permissioned_external_service_intelligence (requires_permission). Missing data: icp (out_of_scope). Missing data: related_domain_candidates (manual_review). Missing data: related_domain_confirmation (manual_review). HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6.

Evidence: [E004] [E019] [E024] [E025] [E031] [E040] [E041] [M001] [M002] [M003] [M004] [M005] [M006]

Boundaries: Do not present missing data as collected evidence.

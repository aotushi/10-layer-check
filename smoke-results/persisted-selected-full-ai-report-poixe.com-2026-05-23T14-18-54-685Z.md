# Site Analysis: poixe.com

## Executive Summary

HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more).

Evidence: [E004] [M001] [M002] [M003] [M004]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Public Information Architecture

Observed CORS response header signal(s) on 4 bounded public check(s). Evidence: bounded_cors_checks=1 host(s): poixe.com status 200; public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3. Current evidence highlights: Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.po... Checked 6 bounded public host candidate(s); observed role hint(s): root, api, blog, community, docs, status. Evidence: public_host_roles=6 item(s): poixe.com status 200, api.poixe.com status 200, blog.poixe.com status 200 (+3 more); public_hosts=4 host(s): poixe.com status 200, api.poixe.com status 200, blog.poixe.com status 200 (+1 more); reachable_publi... Browser runtime loaded the page without common access barrier signals. Evidence: final_url=https://poixe.com/; status_code=200; html_title=Poixe AI; screenshot=/home/runner/work/02-browser-runtime-remote-git/02-browser-runtime-remote-git/screenshots/poixe.com-2026-05-23.png. Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6. Browser runtime loaded the page and captured rendered-page evidence. Evidence: final_url=https://poixe.com/; status_code=200; html_title=Poixe AI. Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Evidence: html_bytes=2799; scripts=1; stylesheets=1; images=0. Crawl metadata found: robots.txt=yes, sitemap.xml=yes. Evidence: https://poixe.com/robots.txt=200; https://poixe.com/sitemap.xml=200.

Evidence: [E028] [M005] [M006] [M007] [M008] [M009] [M010]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Technology Stack

CDN header signal(s) found: cloudflare. Evidence: cf-cache-status=url=https://poixe.com/, provider=cloudflare; cf-ray=url=https://poixe.com/, provider=cloudflare; report-to=url=https://poixe.com/, provider=cloudflare; server=url=https://poixe.com/, provider=cloudflare. Current evidence highlights: Observed public app marker(s): Mintlify, WordPress, Discourse, wp-json, api, blog, community, docs, status. Evidence: public_app_marker_names=6 host(s): docs.poixe.com, blog.poixe.com, community.poixe.com (+3 more); public_app_markers=3 host(s): docs.poixe.com, blog.poixe.com, community.poixe.com; public_marker_checks=2 item(s): wp-json on poixe.com statu... Missing data: wordpress_user_enumeration (add_provider). Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Evidence: html_bytes=2799; scripts=1; stylesheets=1; images=0. Found 1 deterministic frontend technology candidate(s). Evidence: Vite-like_build=category=build_tool, confidence=possible, evidence_refs=3 item(s): script:1, stylesheet:1, marker:type=module. Browser runtime observed 2 third-party scripts and 10 third-party resources. Evidence: script=https://static.cloudflareinsights.com/beacon.min.js/v833ccba57c9e4d2798f2e76cebdd09a11778172276447; script=https://matomo.gptocean.com/matomo.js; ping=https://matomo.gptocean.com/matomo.php?...; image=https://s3.poixe.com/apple/avatar-2.webp. No third-party script was found in static HTML. Found 2 application fingerprint candidate(s): Cloudflare, React. Evidence: Cloudflare=category=hosting, confidence=high, evidence=server: cloudflare; Cloudflare=category=hosting, confidence=high, evidence=cf-ray: a004ae8e5d0b0906-LAX; React=category=framework, confidence=medium, evidence=html matched /id=["']root["']/i.

Evidence: [E001]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Deployment and Network Surface

Current evidence highlights: HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Performance score 30; 5 metric(s) are poor. Evidence: pagespeed=5 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+2 more); pagespeed=5 item(s): unminified-javascript, redirects, unminified-css (+2 more). Lighthouse performance score 32; 4 metric(s) are poor. Evidence: lighthouse=4 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+1 more); lighthouse=4 item(s): unused-javascript, server-response-time, unused-css-rules (+1 more). CDN header signal(s) found: cloudflare. Evidence: cf-cache-status=url=https://poixe.com/, provider=cloudflare; cf-ray=url=https://poixe.com/, provider=cloudflare; report-to=url=https://poixe.com/, provider=cloudflare; server=url=https://poixe.com/, provider=cloudflare. CDN header signal(s) found: cloudflare. Evidence: cf-ray=url=https://poixe.com/, provider=cloudflare; cf-cache-status=url=https://poixe.com/, provider=cloudflare; server=url=https://poixe.com/, provider=cloudflare; cf-ray=url=https://poixe.com/assets/index-CF1CQuMX.js, provider=cloudflare.

Evidence: [E004] [E024] [E025] [E001] [E002] [E005] [E007] [E008]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Request and Rendering Chain

Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6.

Evidence: [E019] [M001] [M002] [M003] [M004]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.

## API and Protocol Surface

Current evidence highlights: Observed CORS response header signal(s) on 4 bounded public check(s). Evidence: bounded_cors_checks=1 host(s): poixe.com status 200; public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3. Checked 2 bounded public API endpoint candidate(s); 5 exposed error/request-id signal(s). Evidence: bounded_public_api_checks=1 host(s): api.poixe.com status 200; public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3. No CORS headers were found on the main response. Evidence: cors=5 field(s). No obvious API or server error surface was detected in the main response. Evidence: error_surface=status_code=200, content_type=text/html. Found 2 protocol or platform clue(s) from response headers. Evidence: protocol_clues=server=cloudflare. Remaining gaps: credentialed_authenticated_behavior (requires_permission) deep_port_service_inventory (add_provider) login_rate_limit_validation (requires_user_input)

Evidence: [E028] [E029] [E026] [E027] [E031] [E030] [E004] [E019] [M001] [M002] [M003] [M004]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.

## Subdomains and Attack Surface

Observed CORS response header signal(s) on 4 bounded public check(s). Evidence: bounded_cors_checks=1 host(s): poixe.com status 200; public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3.

Evidence: [E028] [M005] [M006] [M007] [M008] [M009] [M010]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Organization and Operations Signals

Collected organization-facing DNS, homepage, registration, or archive evidence. Evidence: mx=3 item(s): 1 mx1.larksuite.com., 10 mx3.larksuite.com., 5 mx2.larksuite.com.; txt=2 item(s):  v=spf1 +include:spf.onlarksuite.com -all, verification-code-site-App_lark=Sdxd3rHU75iYSAvjtheE; social_links=none; related_domain_candidates=none. Current evidence highlights: Collected organization-facing DNS, homepage, registration, or archive evidence. Evidence: mx=3 item(s): 1 mx1.larksuite.com., 10 mx3.larksuite.com., 5 mx2.larksuite.com.; txt=2 item(s): "v=spf1 +include:spf.onlarksuite.com -all", "verification-code-site-App_lark=Sdxd3rHU75iYSAvjtheE"; social_links=none; related_domain_candidates=none. Collected RDAP / WHOIS-lite registration evidence. Evidence: rdap_registrar=NameSilo, LLC; rdap_events=4 item(s): 2019-03-05T05:45:05Z, 2027-03-05T05:45:05Z, 2026-01-31T13:52:33Z (+1 more); rdap_nameservers=2 item(s): CURT.NS.CLOUDFLARE.COM, ROSEMARY.NS.CLOUDFLARE.COM. Collected Wayback historical archive evidence. Evidence: wayback_snapshot_count_estimate=null; wayback_first_snapshot=status_code=200; wayback_last_snapshot=status_code=200. HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6. Performance score 30; 5 metric(s) are poor. Evidence: pagespeed=5 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+2 more); pagespeed=5 item(s): unminified-javascript, redirects, unminified-css (+2 more). Lighthouse performance score 32; 4 metric(s) are poor. Evidence: lighthouse=4 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+1 more); lighthouse=4 item(s): unused-javascript, server-response-time, unused-css-rules (+1 more).

Evidence: [E038] [M015] [M016] [M017]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.

## Security Posture

Observed Set-Cookie header(s) on 1 bounded public check(s). Evidence: bounded_cookie_checks=1 host(s): poixe.com status 200; public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3.

Evidence: [E041] [M018] [M019] [M020] [M021]

Boundaries: Report missing controls as risk signals, not confirmed exploitability without authorized testing.

## Missing Data and Next Steps

Missing data: credentialed_authenticated_behavior (requires_permission). Gap groups: add_provider: 6 (deep_port_service_inventory; wordpress_user_enumeration; deep_port_service_inventory; +3 more) | requires_permission: 9 (credentialed_authenticated_behavior; l7_permissioned_authenticated_surface_check; l7_permissioned_deep_port_service_inventory; +6 more) | manual_review: 2 (related_domain_candidates; related_domain_confirmation) | requires_user_input: 3 (login_rate_limit_validation; login_rate_limit_validation; login_rate_limit_validation) | out_of_scope: 1 (icp) Current evidence highlights: Missing data: credentialed_authenticated_behavior (requires_permission). Missing data: deep_port_service_inventory (add_provider). Missing data: login_rate_limit_validation (requires_user_input). Missing data: wordpress_user_enumeration (add_provider). Missing data: l7_permissioned_authenticated_surface_check (requires_permission). Missing data: l7_permissioned_deep_port_service_inventory (requires_permission). Missing data: l7_permissioned_external_service_intelligence (requires_permission). Missing data: permissioned_authenticated_surface_check (requires_permission).

Evidence: [M001] [M002] [M003] [M004] [M005] [M006] [M007] [M008] [M009] [M010] [M011] [M012]

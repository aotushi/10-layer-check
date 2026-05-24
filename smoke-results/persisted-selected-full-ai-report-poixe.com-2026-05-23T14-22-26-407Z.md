# Site Analysis: poixe.com

## Executive Summary

HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more).

Evidence: [E004] [M001] [M002] [M003] [M004]

Boundaries: This provider uses a small fixed set of public GET/HEAD/OPTIONS-style observations.; It does not send credentials, request bodies, login attempts, exploit payloads, or repeated rate-limit traffic.; It does not enumerate WordPress users and does not scan ports.

## Public Information Architecture

Observed CORS response header signal(s) on 4 bounded public check(s). Evidence: bounded_cors_checks=1 host(s): poixe.com status 200; public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3. Current evidence highlights: Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.po... Checked 6 bounded public host candidate(s); observed role hint(s): root, api, blog, community, docs, status. Evidence: public_host_roles=6 item(s): poixe.com status 200, api.poixe.com status 200, blog.poixe.com status 200 (+3 more); public_hosts=4 host(s): poixe.com status 200, api.poixe.com status 200, blog.poixe.com status 200 (+1 more); reachable_publi... Browser runtime loaded the page without common access barrier signals. Evidence: final_url=https://poixe.com/; status_code=200; html_title=Poixe AI; screenshot=/home/runner/work/02-browser-runtime-remote-git/02-browser-runtime-remote-git/screenshots/poixe.com-2026-05-23.png. Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6. Browser runtime loaded the page and captured rendered-page evidence. Evidence: final_url=https://poixe.com/; status_code=200; html_title=Poixe AI. Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Evidence: html_bytes=2799; scripts=1; stylesheets=1; images=0. Crawl metadata found: robots.txt=yes, sitemap.xml=yes. Evidence: https://poixe.com/robots.txt=200; https://poixe.com/sitemap.xml=200.

Evidence: [E028] [M005] [M006] [M007] [M008] [M009] [M010]

Boundaries: This provider uses a small fixed set of public GET/HEAD/OPTIONS-style observations.; It does not send credentials, request bodies, login attempts, exploit payloads, or repeated rate-limit traffic.; It does not enumerate WordPress users and does not scan ports.

## Technology Stack

Current evidence highlights: Observed public app marker(s): Mintlify, WordPress, Discourse, wp-json, api, blog, community, docs, status. Evidence: public_app_marker_names=6 host(s): docs.poixe.com, blog.poixe.com, community.poixe.com (+3 more); public_app_markers=3 host(s): docs.poixe.com, blog.poixe.com, community.poixe.com; public_marker_checks=2 item(s): wp-json on poixe.com statu... Missing data: wordpress_user_enumeration (add_provider). Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Evidence: html_bytes=2799; scripts=1; stylesheets=1; images=0. Found 1 deterministic frontend technology candidate(s). Evidence: Vite-like_build=category=build_tool, confidence=possible, evidence_refs=3 item(s): script:1, stylesheet:1, marker:type=module. Browser runtime observed 2 third-party scripts and 10 third-party resources. Evidence: script=https://static.cloudflareinsights.com/beacon.min.js/v833ccba57c9e4d2798f2e76cebdd09a11778172276447; script=https://matomo.gptocean.com/matomo.js; ping=https://matomo.gptocean.com/matomo.php?...; image=https://s3.poixe.com/apple/avatar-2.webp. Remaining gaps: credentialed_authenticated_behavior (requires_permission) deep_port_service_inventory (add_provider) login_rate_limit_validation (requires_user_input)

Evidence: [E012] [E013] [E021] [E022] [E035] [E036] [E037] [E010] [M011] [M012] [M013] [M014]

Boundaries: Static and heuristic technology evidence is candidate evidence unless directly corroborated.

## Deployment and Network Surface

CDN header signal(s) found: cloudflare. Evidence: cf-cache-status=url=https://poixe.com/, provider=cloudflare; cf-ray=url=https://poixe.com/, provider=cloudflare; report-to=url=https://poixe.com/, provider=cloudflare; server=url=https://poixe.com/, provider=cloudflare.

Evidence: [E001]

Boundaries: DNS records and ASN enrichment are collected through external DNS intelligence providers.; CDN provider detection is a DNS/response-hint inference and does not prove full edge routing or origin topology.; Protocol reachability confirms the probed HTTP/HTTPS URLs only, not every endpoint on the site.

## Request and Rendering Chain

Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6.

Evidence: [E019] [M001] [M002] [M003] [M004]

Boundaries: Browser runtime records are derived from imported runtime artifacts.; Artifact paths, network visibility, and timing depend on the browser provider environment.; Runtime resource records may still contain null transfer size, encoded body size, or decoded body size values.

## API and Protocol Surface

No CORS headers were found on the main response. Evidence: cors=5 field(s).

Evidence: [E030] [M001] [M002] [M003] [M004]

Boundaries: CORS policy is read from the probed main response headers only.; A complete CORS assessment requires targeted OPTIONS/preflight tests against API endpoints and origins.

## Subdomains and Attack Surface

Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.poixe.com, admin.s3.poixe.com. Current evidence highlights: Observed CORS response header signal(s) on 4 bounded public check(s). Evidence: bounded_cors_checks=1 host(s): poixe.com status 200; public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3. Observed Set-Cookie header(s) on 1 bounded public check(s). Evidence: bounded_cookie_checks=1 host(s): poixe.com status 200; public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3. Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.po... Checked 6 bounded public host candidate(s); observed role hint(s): root, api, blog, community, docs, status. Evidence: public_host_roles=6 item(s): poixe.com status 200, api.poixe.com status 200, blog.poixe.com status 200 (+3 more); public_hosts=4 host(s): poixe.com status 200, api.poixe.com status 200, blog.poixe.com status 200 (+1 more); reachable_publi... Collected 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s). Evidence: checked_hosts=1 host(s): poixe.com; service_fingerprint_limits=max_hosts=1, checked_hosts=1, max_requests_per_host=1, max_concurrency=3. HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6.

Evidence: [E034] [M005] [M006] [M007] [M008] [M009] [M010]

Boundaries: CT-discovered subdomains are historical certificate evidence and may include retired or non-public services.; Reachability checks are intentionally bounded and do not constitute a full port or service scan.; Naming-based exposed-surface hints are candidates for review, not proof of sensitive exposure.

## Organization and Operations Signals

Collected organization-facing DNS, homepage, registration, or archive evidence. Evidence: mx=3 item(s): 1 mx1.larksuite.com., 10 mx3.larksuite.com., 5 mx2.larksuite.com.; txt=2 item(s): v=spf1 +include:spf.onlarksuite.com -all, verification-code-site-App_lark=Sdxd3rHU75iYSAvjtheE; social_links=none; related_domain_candidates=none. Current evidence highlights: Collected organization-facing DNS, homepage, registration, or archive evidence. Evidence: mx=3 item(s): 1 mx1.larksuite.com., 10 mx3.larksuite.com., 5 mx2.larksuite.com.; txt=2 item(s): "v=spf1 +include:spf.onlarksuite.com -all", "verification-code-site-App_lark=Sdxd3rHU75iYSAvjtheE"; social_links=none; related_domain_candidates=none. Collected RDAP / WHOIS-lite registration evidence. Evidence: rdap_registrar=NameSilo, LLC; rdap_events=4 item(s): 2019-03-05T05:45:05Z, 2027-03-05T05:45:05Z, 2026-01-31T13:52:33Z (+1 more); rdap_nameservers=2 item(s): CURT.NS.CLOUDFLARE.COM, ROSEMARY.NS.CLOUDFLARE.COM. Collected Wayback historical archive evidence. Evidence: wayback_snapshot_count_estimate=null; wayback_first_snapshot=status_code=200; wayback_last_snapshot=status_code=200. HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6. Performance score 30; 5 metric(s) are poor. Evidence: pagespeed=5 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+2 more); pagespeed=5 item(s): unminified-javascript, redirects, unminified-css (+2 more). Lighthouse performance score 33; 4 metric(s) are poor. Evidence: lighthouse=4 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+1 more); lighthouse=4 item(s): unused-javascript, server-response-time, unused-css-rules (+1 more).

Evidence: [E038] [M015] [M016] [M017]

Boundaries: Organization intelligence is limited to DNS records, homepage social-link hints, and RDAP registration evidence where available.; Social links and mail provider hints are candidates for analysis, not proof of operating entity ownership.; RDAP registration evidence is not proof of current operating entity ownership.; Wayback archive evidence is historical evidence, not proof of current operation or ownership.; Related-domain candidates are homepage-visible external host signals, not confirmed related-domain relationships.; ICP and related-domain confirmation require dedicated external providers, AI review, or manual review.

## Security Posture

Observed Set-Cookie header(s) on 1 bounded public check(s). Evidence: bounded_cookie_checks=1 host(s): poixe.com status 200; public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3.

Evidence: [E041] [M018] [M019] [M020] [M021]

Boundaries: This provider uses a small fixed set of public GET/HEAD/OPTIONS-style observations.; It does not send credentials, request bodies, login attempts, exploit payloads, or repeated rate-limit traffic.; It does not enumerate WordPress users and does not scan ports.

## Missing Data and Next Steps

Missing data: credentialed_authenticated_behavior (requires_permission). Gap groups: add_provider: 6 (deep_port_service_inventory; wordpress_user_enumeration; deep_port_service_inventory; +3 more) | requires_permission: 9 (credentialed_authenticated_behavior; l7_permissioned_authenticated_surface_check; l7_permissioned_deep_port_service_inventory; +6 more) | manual_review: 2 (related_domain_candidates; related_domain_confirmation) | requires_user_input: 3 (login_rate_limit_validation; login_rate_limit_validation; login_rate_limit_validation) | out_of_scope: 1 (icp) Current evidence highlights: Missing data: credentialed_authenticated_behavior (requires_permission). Missing data: deep_port_service_inventory (add_provider). Missing data: login_rate_limit_validation (requires_user_input). Missing data: wordpress_user_enumeration (add_provider). Missing data: l7_permissioned_authenticated_surface_check (requires_permission). Missing data: l7_permissioned_deep_port_service_inventory (requires_permission). Missing data: l7_permissioned_external_service_intelligence (requires_permission). Missing data: permissioned_authenticated_surface_check (requires_permission).

Evidence: [E004] [M001] [M002] [M003] [M004]

Boundaries: This provider uses a small fixed set of public GET/HEAD/OPTIONS-style observations.; It does not send credentials, request bodies, login attempts, exploit payloads, or repeated rate-limit traffic.; It does not enumerate WordPress users and does not scan ports.

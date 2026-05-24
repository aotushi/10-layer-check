# Site Analysis: poixe.com

## Executive Summary

HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=3 certificate(s): Let's Encrypt for *.poixe.com (+2 more).

Evidence: [E004] [M001] [M002] [M003] [M004]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.; Do not place CORS, cookie, API error-surface, or CMS metadata details here; use the API, Technology, Subdomain, or Security sections.

## Public Information Architecture

Current evidence highlights: Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=8 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+5 more); https_reachability=3 host(s): academy.poixe.com status 200, admin.s3.poixe.com status 200, blog.poixe.com status 200. Browser runtime loaded the page without common access barrier signals. Evidence: final_url=https://poixe.com/; status_code=200; html_title=Poixe AI; screenshot=/home/runner/work/02-browser-runtime-remote-git/02-browser-runtime-remote-git/screenshots/poixe.com-2026-05-23.png. Browser runtime loaded the page and captured rendered-page evidence. Evidence: final_url=https://poixe.com/; status_code=200; html_title=Poixe AI. Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6. Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Evidence: html_bytes=2799; scripts=1; stylesheets=1; images=0. Remaining gaps: l7_permissioned_authenticated_surface_check (requires_permission) l7_permissioned_deep_port_service_inventory (requires_permission) l7_permissioned_external_service_intelligence (requires_permission)

Evidence: [E034] [E012] [E015] [E032] [E010] [E018] [E016] [E019] [M005] [M006] [M007] [M008] [M009] [M010]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths. Do not place CORS, cookie, API error-surface, or CMS metadata details here; use the API, Technology, Subdomain, or Security sections.

## Technology Stack

Bounded public metadata check: Observed public CMS/forum metadata signal(s) on 7 bounded check(s). Evidence: bounded_public_metadata_checks=3 metadata(s): wordpress_name=Poixe Blog, wordpress_timezone=Asia//Shanghai (+1 more); public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3. Current evidence highlights: Bounded public metadata check: Observed public CMS/forum metadata signal(s) on 7 bounded check(s). Evidence: bounded_public_metadata_checks=3 metadata(s): wordpress_name=Poixe Blog, wordpress_timezone=Asia\\/Shanghai (+1 more); public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3. Observed public app marker(s): Mintlify, WordPress, Discourse, wp-json, api, blog, community, docs, status. Evidence: public_app_marker_names=9 item(s): Mintlify on docs.poixe.com medium, WordPress on blog.poixe.com high, Discourse on community.poixe.com medium (+6 more); public_app_markers=5 host(s): docs.poixe.com, blog.poixe.com, community.poixe.com (+2 more); public_marker_checks=2 item(s): poixe.com /wp-json/ status 200, blog.poixe.com /wp-json/ status 200; public_host_fingerprint_limits=max_hosts=8, checked_hosts=6, max_requests_per_host=2, max_concurrency=3. Missing data: wordpress_user_enumeration (add_provider). Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Evidence: html_bytes=2799; scripts=1; stylesheets=1; images=0. Found 1 deterministic frontend technology candidate(s). Evidence: Vite-like_build=category=build_tool, confidence=possible, evidence_refs=3 item(s): script:1, stylesheet:1, marker:type=module. Browser runtime observed 2 third-party scripts and 10 third-party resources. Evidence: script=https://static.cloudflareinsights.com/beacon.min.js/v833ccba57c9e4d2798f2e76cebdd09a11778172276447; script=https://matomo.gptocean.com/matomo.js; ping=https://matomo.gptocean.com/matomo.php?...; image=https://s3.poixe.com/apple/avatar-2.webp. No third-party script was found in static HTML.

Evidence: [E036] [M011] [M012] [M013] [M014]

Boundaries: Static and heuristic technology evidence is candidate evidence unless directly corroborated.; Keep WordPress, Discourse, Mintlify, wp-json, and public application metadata facts in Technology Stack or Subdomains sections, not Public Information Architecture.

## Deployment and Network Surface

CDN header signal(s) found: cloudflare. Evidence: cf-cache-status=url=https://poixe.com/, provider=cloudflare; cf-ray=url=https://poixe.com/, provider=cloudflare; report-to=url=https://poixe.com/, provider=cloudflare; server=url=https://poixe.com/, provider=cloudflare.

Evidence: [E001]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.; Prefer concise prose plus compact evidence references over long evidence tables.

## Request and Rendering Chain

Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6.

Evidence: [E019] [M001] [M002] [M003] [M004]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.; Mention limitations near the claim they constrain.

## API and Protocol Surface

Bounded public CORS check: Observed CORS response header signal(s) on 4 bounded public check(s). Evidence: bounded_cors_checks=2 host(s): poixe.com / status 200, api.poixe.com / status 200; public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3.

Evidence: [E028] [M001] [M002] [M003] [M004]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.; Keep CORS, Access-Control, public API endpoint, and API error-surface facts in API and Security sections, not Public Information Architecture.

## Subdomains and Attack Surface

Checked 6 bounded public host candidate(s); observed role hint(s): root, api, blog, community, docs, status. Evidence: public_host_roles=6 item(s): poixe.com status 200, api.poixe.com status 200, blog.poixe.com status 200 (+3 more); public_hosts=6 item(s): poixe.com status 200 Poixe AI cloudflare, api.poixe.com status 200 cloudflare, blog.poixe.com status 200 Poixe Blog — The most powerful platform for building AI...; reachable_public_hosts=2 host(s): poixe.com /wp-json/ status 200, api.poixe.com status 200; public_host_fingerprint_limits=max_hosts=8, checked_hosts=6, max_requests_per... Current evidence highlights: Checked 6 bounded public host candidate(s); observed role hint(s): root, api, blog, community, docs, status. Evidence: public_host_roles=6 item(s): poixe.com status 200, api.poixe.com status 200, blog.poixe.com status 200 (+3 more); public_hosts=6 item(s): poixe.com status 200 Poixe AI cloudflare, api.poixe.com status 200 cloudflare, blog.poixe.com status 200 Poixe Blog &#8211; The most powerful platform for building AI...; reachable_public_hosts=2 host(s): poixe.com /wp-json/ status 200, api.poixe.com status 200; public_host_fingerprint_limits=max_hosts=8, checked_hosts=6, max_requests_per... Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=8 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+5 more); https_reachability=3 host(s): academy.poixe.com status 200, admin.s3.poixe.com status 200, blog.poixe.com status 200. Collected 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s). Evidence: checked_hosts=1 item(s): poixe.com Poixe AI; service_fingerprint_limits=max_hosts=1, checked_hosts=1, max_requests_per_host=1, max_concurrency=3. Found 2 application fingerprint candidate(s): Cloudflare, React. Evidence: Cloudflare=category=hosting, confidence=high, evidence=server: cloudflare; Cloudflare=category=hosting, confidence=high, evidence=cf-ray: a004c64d1ce3d183-LAX; React=category=framework, confidence=medium, evidence=html matched /id=["']root["']/i. Missing data: l7_permissioned_authenticated_surface_check (requires_permission). Missing data: l7_permissioned_deep_port_service_inventory (requires_permission). Missing data: l7_permissioned_external_service_intelligence (requires_permission).

Evidence: [E032] [M005] [M006] [M007] [M008] [M009] [M010]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.; App markers are candidates from headers, root HTML, and one public marker path; absence is not proof that a technology is unused.

## Organization and Operations Signals

Collected organization-facing DNS, homepage, registration, or archive evidence. Evidence: mx=3 item(s): 1 mx1.larksuite.com., 10 mx3.larksuite.com., 5 mx2.larksuite.com.; txt=2 item(s): Current evidence highlights: Collected organization-facing DNS, homepage, registration, or archive evidence. Evidence: mx=3 item(s): 1 mx1.larksuite.com., 10 mx3.larksuite.com., 5 mx2.larksuite.com.; txt=2 item(s): "v=spf1 +include:spf.onlarksuite.com -all", "verification-code-site-App_lark=Sdxd3rHU75iYSAvjtheE"; social_links=none; related_domain_candidates=none. Collected RDAP / WHOIS-lite registration evidence. Evidence: rdap_registrar=NameSilo, LLC; rdap_events=4 item(s): 2019-03-05T05:45:05Z, 2027-03-05T05:45:05Z, 2026-01-31T13:52:33Z (+1 more); rdap_nameservers=2 item(s): CURT.NS.CLOUDFLARE.COM, ROSEMARY.NS.CLOUDFLARE.COM. Collected Wayback historical archive evidence. Evidence: wayback_snapshot_count_estimate=null; wayback_first_snapshot=status_code=200; wayback_last_snapshot=status_code=200. Missing data: icp (out_of_scope). Missing data: related_domain_candidates (manual_review). Missing data: related_domain_confirmation (manual_review).

Evidence: [E038] [M015] [M016] [M017]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.; This probe does not infer related domains, operating entity, or historical business continuity.

## Security Posture

Bounded public cookie check: Observed Set-Cookie header(s) on 1 bounded public check(s). Evidence: bounded_cookie_checks=2 host(s): poixe.com / status 200, api.poixe.com / status 200; public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3.

Evidence: [E041] [M018] [M019] [M020] [M021]

Boundaries: Report missing controls as risk signals, not confirmed exploitability without authorized testing.; Static fetch can only inspect Set-Cookie headers exposed on the probed main response.

## Missing Data and Next Steps

Missing data: credentialed_authenticated_behavior (requires_permission). Gap groups: add_provider: 6 (deep_port_service_inventory; wordpress_user_enumeration; deep_port_service_inventory; +3 more) | requires_permission: 9 (credentialed_authenticated_behavior; l7_permissioned_authenticated_surface_check; l7_permissioned_deep_port_service_inventory; +6 more) | manual_review: 2 (related_domain_candidates; related_domain_confirmation) | requires_user_input: 3 (login_rate_limit_validation; login_rate_limit_validation; login_rate_limit_validation) | out_of_scope: 1 (icp) Current evidence highlights: Missing data: credentialed_authenticated_behavior (requires_permission). Missing data: deep_port_service_inventory (add_provider). Missing data: login_rate_limit_validation (requires_user_input). Missing data: wordpress_user_enumeration (add_provider). Missing data: l7_permissioned_authenticated_surface_check (requires_permission). Missing data: l7_permissioned_deep_port_service_inventory (requires_permission). Missing data: l7_permissioned_external_service_intelligence (requires_permission). Missing data: permissioned_authenticated_surface_check (requires_permission).

Evidence: [M001] [M002] [M003] [M004] [M005] [M006] [M007] [M008] [M009] [M010] [M011] [M012]

Boundaries: Do not present missing data as collected evidence.; Group remaining gaps by add_provider, requires_permission, manual_review, requires_user_input, and out_of_scope.

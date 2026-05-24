# Site Analysis: poixe.com

## Executive Summary

This report is based on 35 normalized record(s) across 10/10 collected layer(s). 5 layer(s) contain warning or error signals. 5 high/medium risk item(s) should be reviewed first. Current evidence highlights: HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Performance score 30; 5 metric(s) are poor. Evidence: pagespeed=5 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+2 more); pagespeed=5 item(s): unminified-javascript, redirects, unminified-css (+2 more). Lighthouse performance score 33; 4 metric(s) are poor. Evidence: lighthouse=4 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+1 more); lighthouse=4 item(s): unused-javascript, server-response-time, redirects (+1 more). Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.po... Missing security headers: content-security-policy, strict-transport-security, permissions-policy. Evidence: x-frame-options=SAMEORIGIN; x-content-type-options=nosniff; referrer-policy=strict-origin-when-cross-origin. DNS and protocol checks completed; no CDN signal was found from DNS records. Evidence: A=2 item(s): 104.21.75.2, 172.67.209.147; AAAA=2 item(s): 2606:4700:3034::6815:4b02, 2606:4700:3032::ac43:d193; CNAME=none; HTTPS=1 item(s): \# 136 00 01 00 00 01 00 06 02 68 33 02 68 32 00 04 00 08 68 15 4b 02 ac 43 d1 93 00 05 00 47 00 45 fe 0d 00 41 7e 00 20 00 20 f5... Collected 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s). Evidence: checked_hosts=1 host(s): poixe.com; service_fingerprint_limits=max_hosts=1, checked_hosts=1, max_requests_per_host=1, max_concurrency=3.

Evidence: [E001] [E002] [E003] [E004] [E005] [E006] [E007] [E008] [E009] [E010] [E011] [E012] [E016] [E017] [E023] [E033] [E022] [M001] [M002] [M003] [M004] [M005] [M006] [M007] [M008] [M009] [M010] [M011] [M012]

Boundaries: Do not infer business model or ownership from technical evidence alone.

## Public Information Architecture

Current evidence highlights: Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.po... Checked 6 bounded public host candidate(s); observed role hint(s): root, api, blog, community, docs, status. Evidence: public_host_roles=6 item(s): poixe.com status 200, api.poixe.com status 200, blog.poixe.com status 200 (+3 more); public_hosts=1 host(s): poixe.com status 200; reachable_public_hosts=1 host(s): poixe.com status 200; public_host_fingerprin... Collected 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s). Evidence: checked_hosts=1 host(s): poixe.com; service_fingerprint_limits=max_hosts=1, checked_hosts=1, max_requests_per_host=1, max_concurrency=3. github_actions_browser_runtime provider did not return usable target evidence: site_scan_async_provider_failed. Evidence: site_scan_async_provider_failed=provider=github_actions_browser_runtime, status=error, error=GitHub workflow dispatch failed: 500 {"message":"Failed to run workflow dispatch","documentation_url":"https://docs..... HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Remaining gaps: github_actions_browser_runtime provider did not return usable target evidence: site_scan_async_provider_failed. (add_provider) l7_permissioned_authenticated_surface_check (requires_permission) l7_permissioned_deep_port_service_inventory (requires_permission)

Evidence: [E023] [E009] [E013] [E021] [E011] [E008] [E010] [E012] [E014] [E022] [E003] [E016] [M001] [M004] [M005] [M006] [M007] [M008] [M009]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Technology Stack

Current evidence highlights: Observed public app marker(s): Mintlify, WordPress, Discourse, wp-json, api, blog, community, docs, status. Evidence: public_app_marker_names=6 host(s): docs.poixe.com, blog.poixe.com, community.poixe.com (+3 more); public_app_markers=3 host(s): docs.poixe.com, blog.poixe.com, community.poixe.com; public_marker_checks=2 item(s): wp-json on poixe.com statu... Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Evidence: html_bytes=2799; scripts=1; stylesheets=1; images=0. Found 1 deterministic frontend technology candidate(s). Evidence: Vite-like_build=category=build_tool, confidence=possible, evidence_refs=3 item(s): script:1, stylesheet:1, marker:type=module. No third-party script was found in static HTML. Found 2 application fingerprint candidate(s): Cloudflare, React. Evidence: Cloudflare=category=hosting, confidence=high, evidence=server: cloudflare; Cloudflare=category=hosting, confidence=high, evidence=cf-ray: a00451ac0e33e9e0-LAX; React=category=framework, confidence=medium, evidence=html matched /id=["']root["']/i. Remaining gaps: github_actions_browser_runtime provider did not return usable target evidence: site_scan_async_provider_failed. (add_provider)

Evidence: [E009] [E010] [E014] [E024] [E025] [E008] [E011] [E012] [E013] [E021] [E022] [E003] [M001]

Boundaries: Static and heuristic technology evidence is candidate evidence unless directly corroborated.

## Deployment and Network Surface

Current evidence highlights: HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Performance score 30; 5 metric(s) are poor. Evidence: pagespeed=5 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+2 more); pagespeed=5 item(s): unminified-javascript, redirects, unminified-css (+2 more). Lighthouse performance score 33; 4 metric(s) are poor. Evidence: lighthouse=4 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+1 more); lighthouse=4 item(s): unused-javascript, server-response-time, redirects (+1 more). CDN header signal(s) found: cloudflare. Evidence: cf-cache-status=url=https://poixe.com/, provider=cloudflare; cf-ray=url=https://poixe.com/, provider=cloudflare; report-to=url=https://poixe.com/, provider=cloudflare; server=url=https://poixe.com/, provider=cloudflare. Live certificate expires in 56 day(s). Evidence: tls_protocol=TLSv1.3; tls_cipher=name=TLS_AES_256_GCM_SHA384, standardName=TLS_AES_256_GCM_SHA384, version=TLSv1.3; leaf=valid_to=Jul 18 20:50:10 2026 GMT; tls_certificate_chain=structured 5 item(s). Remaining gaps: browser_resource_waterfall (add_provider) javascript_runtime_resource_injection (add_provider)

Evidence: [E003] [E016] [E017] [E001] [E004] [E006] [E007] [E015] [E002] [E033] [E005] [E011] [M002] [M003]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Request and Rendering Chain

Current evidence highlights: Final response returned HTTP 200. Evidence: content-type=text/html; server=cloudflare. Static HTML declares 2 resources and weighs 2799 bytes. Evidence: html_bytes=2799; declared_resource_count=2. No obvious API or server error surface was detected in the main response. Evidence: error_surface=status_code=200, content_type=text/html. Found 2 protocol or platform clue(s) from response headers. Evidence: protocol_clues=server=cloudflare. github_actions_browser_runtime provider did not return usable target evidence: site_scan_async_provider_failed. Evidence: site_scan_async_provider_failed=provider=github_actions_browser_runtime, status=error, error=GitHub workflow dispatch failed: 500 {"message":"Failed to run workflow dispatch","documentation_url":"https://docs..... Remaining gaps: github_actions_browser_runtime provider did not return usable target evidence: site_scan_async_provider_failed. (add_provider) browser_resource_waterfall (add_provider) javascript_runtime_resource_injection (add_provider)

Evidence: [E007] [E012] [E018] [E019] [E011] [E016] [E017] [E005] [E006] [E008] [E009] [E010] [M001] [M002] [M003]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.

## API and Protocol Surface

Current evidence highlights: No obvious API or server error surface was detected in the main response. Evidence: error_surface=status_code=200, content_type=text/html. Found 2 protocol or platform clue(s) from response headers. Evidence: protocol_clues=server=cloudflare. No CORS headers were found on the main response. Evidence: cors=5 field(s). HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). github_actions_browser_runtime provider did not return usable target evidence: site_scan_async_provider_failed. Evidence: site_scan_async_provider_failed=provider=github_actions_browser_runtime, status=error, error=GitHub workflow dispatch failed: 500 {"message":"Failed to run workflow dispatch","documentation_url":"https://docs.....

Evidence: [E018] [E019] [E020] [E003] [E011] [E016] [E017] [E023] [E033]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.

## Subdomains and Attack Surface

Current evidence highlights: Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.po... Checked 6 bounded public host candidate(s); observed role hint(s): root, api, blog, community, docs, status. Evidence: public_host_roles=6 item(s): poixe.com status 200, api.poixe.com status 200, blog.poixe.com status 200 (+3 more); public_hosts=1 host(s): poixe.com status 200; reachable_public_hosts=1 host(s): poixe.com status 200; public_host_fingerprin... Collected 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s). Evidence: checked_hosts=1 host(s): poixe.com; service_fingerprint_limits=max_hosts=1, checked_hosts=1, max_requests_per_host=1, max_concurrency=3. HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). github_actions_browser_runtime provider did not return usable target evidence: site_scan_async_provider_failed. Evidence: site_scan_async_provider_failed=provider=github_actions_browser_runtime, status=error, error=GitHub workflow dispatch failed: 500 {"message":"Failed to run workflow dispatch","documentation_url":"https://docs..... Remaining gaps: l7_permissioned_authenticated_surface_check (requires_permission) l7_permissioned_deep_port_service_inventory (requires_permission) l7_permissioned_external_service_intelligence (requires_permission)

Evidence: [E023] [E021] [E022] [E024] [E003] [E011] [E016] [E017] [E033] [M004] [M005] [M006] [M007] [M008] [M009]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Organization and Operations Signals

Current evidence highlights: Collected organization-facing DNS, homepage, registration, or archive evidence. Evidence: mx=3 item(s): 1 mx1.larksuite.com., 10 mx3.larksuite.com., 5 mx2.larksuite.com.; txt=2 item(s): "v=spf1 +include:spf.onlarksuite.com -all", "verification-code-site-App_lark=Sdxd3rHU75iYSAvjtheE"; social_links=none; related_domain_candidates=none. Collected RDAP / WHOIS-lite registration evidence. Evidence: rdap_registrar=NameSilo, LLC; rdap_events=4 item(s): 2019-03-05T05:45:05Z, 2027-03-05T05:45:05Z, 2026-01-31T13:52:33Z (+1 more); rdap_nameservers=2 item(s): CURT.NS.CLOUDFLARE.COM, ROSEMARY.NS.CLOUDFLARE.COM. Collected Wayback historical archive evidence. Evidence: wayback_snapshot_count_estimate=null; wayback_first_snapshot=status_code=200; wayback_last_snapshot=status_code=200. HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). github_actions_browser_runtime provider did not return usable target evidence: site_scan_async_provider_failed. Evidence: site_scan_async_provider_failed=provider=github_actions_browser_runtime, status=error, error=GitHub workflow dispatch failed: 500 {"message":"Failed to run workflow dispatch","documentation_url":"https://docs..... Remaining gaps: icp (out_of_scope) related_domain_candidates (manual_review) related_domain_confirmation (manual_review)

Evidence: [E026] [E027] [E028] [E003] [E011] [E016] [E017] [E023] [E033] [M010] [M011] [M012]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.

## Security Posture

Current evidence highlights: Missing security headers: content-security-policy, strict-transport-security, permissions-policy. Evidence: x-frame-options=SAMEORIGIN; x-content-type-options=nosniff; referrer-policy=strict-origin-when-cross-origin. No Set-Cookie header was observed on the main response. Evidence: set-cookie=null. No CORS headers were found on the main response. Evidence: cors=5 field(s). Frame embedding policy is present. Evidence: x-frame-options=SAMEORIGIN; content-security-policy=null; iframe_sources=none. HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more).

Evidence: [E033] [E029] [E030] [E031] [E032] [E020] [E007] [E003] [E011] [E016] [E017] [E023]

Boundaries: Report missing controls as risk signals, not confirmed exploitability without authorized testing.

## Missing Data and Next Steps

Gap groups: add_provider: 3 (github_actions_browser_runtime provider did not return usable target evidence: site_scan_async_provider_failed.; browser_resource_waterfall; javascript_runtime_resource_injection) | requires_permission: 6 (l7_permissioned_authenticated_surface_check; l7_permissioned_deep_port_service_inventory; l7_permissioned_external_service_intelligence; +3 more) | manual_review: 2 (related_domain_candidates; related_domain_confirmation) | out_of_scope: 1 (icp) Current evidence highlights: Missing data: github_actions_browser_runtime provider did not return usable target evidence: site_scan_async_provider_failed. (add_provider). Missing data: browser_resource_waterfall (add_provider). Missing data: javascript_runtime_resource_injection (add_provider). Missing data: l7_permissioned_authenticated_surface_check (requires_permission). Missing data: l7_permissioned_deep_port_service_inventory (requires_permission). Missing data: l7_permissioned_external_service_intelligence (requires_permission).

Evidence: [E003] [E011] [E016] [E017] [E023] [E033] [M001] [M002] [M003] [M004] [M005] [M006] [M007] [M008] [M009] [M010] [M011] [M012]

Boundaries: Do not present missing data as collected evidence.

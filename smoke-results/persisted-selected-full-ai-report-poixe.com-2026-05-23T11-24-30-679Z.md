# Site Analysis: poixe.com

## Executive Summary

The strongest evidence-backed conclusion is that HTTPS is reachable, but HSTS was not found on the probed response. The performance score is 30, with 5 metrics being poor. The Lighthouse performance score is 31, with 4 metrics being poor. The browser runtime observed 2 failed resources. Current evidence highlights: HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Performance score 30; 5 metric(s) are poor. Evidence: pagespeed=5 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+2 more); pagespeed=5 item(s): unminified-javascript, redirects, unminified-css (+2 more). Lighthouse performance score 31; 4 metric(s) are poor. Evidence: lighthouse=4 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+1 more); lighthouse=4 item(s): unused-javascript, server-response-time, redirects (+1 more). Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.poixe.com status 200, admin.s3.po...

Evidence: [E004] [E024] [E025] [E019] [M001] [M002] [M003]

Boundaries: This is a summary of the findings, and it is not a comprehensive report.

## Public Information Architecture

Current evidence highlights: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.poixe.com status 200, admin.s3.po... Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Evidence: html_bytes=2799; scripts=1; stylesheets=1; images=0. Crawl metadata found: robots.txt=yes, sitemap.xml=yes. Evidence: https://poixe.com/robots.txt=200; https://poixe.com/sitemap.xml=200. Browser runtime loaded the page without common access barrier signals. Evidence: final_url=https://poixe.com/; status_code=200; html_title=Poixe AI; screenshot=/home/runner/work/02-browser-runtime-remote-git/02-browser-runtime-remote-git/screenshots/poixe.com-2026-05-23.png. Browser runtime observed 20 resources. Evidence: runtime_resource_count=20; runtime_resource_counts=document=1, script=3, stylesheet=1, image=4. Remaining gaps: l7_permissioned_authenticated_surface_check (requires_permission) l7_permissioned_deep_port_service_inventory (requires_permission) l7_permissioned_external_service_intelligence (requires_permission)

Evidence: [E030] [E012] [E015] [E010] [E018] [E016] [E019] [E009] [M001] [M002] [M003]

Boundaries: This section is a summary of the public information architecture, and it is not a comprehensive report.

## Technology Stack

Current evidence highlights: Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Evidence: html_bytes=2799; scripts=1; stylesheets=1; images=0. Found 1 deterministic frontend technology candidate(s). Evidence: Vite-like_build=category=build_tool, confidence=possible, evidence_refs=3 item(s): script:1, stylesheet:1, marker:type=module. Browser runtime observed 2 third-party scripts and 10 third-party resources. Evidence: script=https://static.cloudflareinsights.com/beacon.min.js/v833ccba57c9e4d2798f2e76cebdd09a11778172276447; script=https://matomo.gptocean.com/matomo.js; ping=https://matomo.gptocean.com/matomo.php?...; image=https://s3.poixe.com/apple/avatar-2.webp. No third-party script was found in static HTML. Found 2 application fingerprint candidate(s): Cloudflare, React. Evidence: Cloudflare=category=hosting, confidence=high, evidence=server: cloudflare; Cloudflare=category=hosting, confidence=high, evidence=cf-ray: a003afb27f04b84e-LAX; React=category=framework, confidence=medium, evidence=html matched /id=["']root["']/i.

Evidence: [E012] [E013] [E021] [E022] [E031] [E010] [E009] [E016]

Boundaries: This section is a summary of the technology stack, and it is not a comprehensive report.

## Deployment and Network Surface

Current evidence highlights: HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Performance score 30; 5 metric(s) are poor. Evidence: pagespeed=5 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+2 more); pagespeed=5 item(s): unminified-javascript, redirects, unminified-css (+2 more). Lighthouse performance score 31; 4 metric(s) are poor. Evidence: lighthouse=4 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+1 more); lighthouse=4 item(s): unused-javascript, server-response-time, redirects (+1 more). CDN header signal(s) found: cloudflare. Evidence: cf-cache-status=url=https://poixe.com/, provider=cloudflare; cf-ray=url=https://poixe.com/, provider=cloudflare; report-to=url=https://poixe.com/, provider=cloudflare; server=url=https://poixe.com/, provider=cloudflare. CDN header signal(s) found: cloudflare. Evidence: cf-ray=url=https://poixe.com/, provider=cloudflare; cf-cache-status=url=https://poixe.com/, provider=cloudflare; server=url=https://poixe.com/, provider=cloudflare; cf-ray=url=https://poixe.com/assets/index-CF1CQuMX.js, provider=cloudflare.

Evidence: [E004] [E024] [E025] [E001] [E002] [E005] [E007] [E008]

Boundaries: This section is a summary of the deployment and network surface, and it is not a comprehensive report.

## Request and Rendering Chain

Current evidence highlights: Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6. Browser runtime loaded the page and captured rendered-page evidence. Evidence: final_url=https://poixe.com/; status_code=200; html_title=Poixe AI. Browser runtime observed 0.52 MiB of known transfer size with 0 unknown resource size(s). Evidence: runtime_transfer_size_total=544948; runtime_transfer_size_known_count=20; runtime_transfer_size_unknown_count=0. Browser runtime observed 20 resources. Evidence: runtime_resource_count=20; runtime_resource_counts=document=1, script=3, stylesheet=1, image=4. Browser runtime observed 6 API-like request(s), including 0 third-party request(s). Evidence: runtime_api_request_count=6; runtime_api_failed_count=0; runtime_api_third_party_count=0.

Evidence: [E019] [E011] [E017] [E018] [E028] [E010] [E008] [E016]

Boundaries: This section is a summary of the request and rendering chain, and it is not a comprehensive report.

## API and Protocol Surface

Current evidence highlights: No obvious API or server error surface was detected in the main response. Evidence: error_surface=status_code=200, content_type=text/html. Found 2 protocol or platform clue(s) from response headers. Evidence: protocol_clues=server=cloudflare. Browser runtime observed 6 API-like request(s), including 0 third-party request(s). Evidence: runtime_api_request_count=6; runtime_api_failed_count=0; runtime_api_third_party_count=0. HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6.

Evidence: [E026] [E027] [E028] [E004] [E019] [E024] [E025] [E030]

Boundaries: This section is a summary of the API and protocol surface, and it is not a comprehensive report.

## Subdomains and Attack Surface

Current evidence highlights: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.poixe.com status 200, admin.s3.po... Collected 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s). Evidence: checked_hosts=1 host(s): poixe.com; service_fingerprint_limits=max_hosts=1, checked_hosts=1, max_requests_per_host=1, max_concurrency=3. Found 2 application fingerprint candidate(s): Cloudflare, React. Evidence: Cloudflare=category=hosting, confidence=high, evidence=server: cloudflare; Cloudflare=category=hosting, confidence=high, evidence=cf-ray: a003afb27f04b84e-LAX; React=category=framework, confidence=medium, evidence=html matched /id=["']root["']/i. HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6. Remaining gaps: l7_permissioned_authenticated_surface_check (requires_permission) l7_permissioned_deep_port_service_inventory (requires_permission) l7_permissioned_external_service_intelligence (requires_permission)

Evidence: [E030] [E029] [E031] [E004] [E019] [E024] [E025] [E038] [M001] [M002] [M003]

Boundaries: This section is a summary of the subdomains and attack surface, and it is not a comprehensive report.

## Organization and Operations Signals

Current evidence highlights: Collected organization-facing DNS, homepage, registration, or archive evidence. Evidence: mx=3 item(s): poixe.com, poixe.com, poixe.com; txt=2 item(s): poixe.com, poixe.com; social_links=none; related_domain_candidates=none. Collected RDAP / WHOIS-lite registration evidence. Evidence: rdap_registrar=NameSilo, LLC; rdap_events=4 item(s): 2019-03-05T05:45:05Z, 2027-03-05T05:45:05Z, 2026-01-31T13:52:33Z (+1 more); rdap_nameservers=2 item(s): CURT.NS.CLOUDFLARE.COM, ROSEMARY.NS.CLOUDFLARE.COM. Collected Wayback historical archive evidence. Evidence: wayback_snapshot_count_estimate=null; wayback_first_snapshot=status_code=200; wayback_last_snapshot=status_code=200. HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6. Remaining gaps: icp (out_of_scope) related_domain_candidates (manual_review) related_domain_confirmation (manual_review)

Evidence: [E032] [E033] [E034] [E004] [E019] [E024] [E025] [E030] [M004] [M005] [M006]

Boundaries: This section is a summary of the organization and operations signals, and it is not a comprehensive report.

## Security Posture

Current evidence highlights: Browser runtime observed 0 console error(s) and 2 failed request(s). Evidence: runtime_mixed_content_candidate_count=0; runtime_failed_request_count=2; runtime_console_error_count=0; runtime_page_error_count=0. Missing security headers: content-security-policy, strict-transport-security, permissions-policy. Evidence: x-frame-options=SAMEORIGIN; x-content-type-options=nosniff; referrer-policy=strict-origin-when-cross-origin. Frame embedding policy is present. Evidence: x-frame-options=SAMEORIGIN; content-security-policy=null; iframe_sources=none. No obvious static leakage signals were found in the main HTML. Evidence: leakage_signals=none. No static mixed-content URLs were found in the main HTML. Evidence: http_urls=none.

Evidence: [E038] [E039] [E035] [E036] [E037] [E008] [E004] [E019]

Boundaries: This section is a summary of the security posture, and it is not a comprehensive report.

## Missing Data and Next Steps

Current evidence highlights: HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=2 certificate(s): Let's Encrypt for *.poixe.com (+1 more). Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6. Performance score 30; 5 metric(s) are poor. Evidence: pagespeed=5 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+2 more); pagespeed=5 item(s): unminified-javascript, redirects, unminified-css (+2 more). Lighthouse performance score 31; 4 metric(s) are poor. Evidence: lighthouse=4 item(s): First Contentful Paint poor, Largest Contentful Paint poor, Total Blocking Time poor (+1 more); lighthouse=4 item(s): unused-javascript, server-response-time, redirects (+1 more). Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=5 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+2 more); https_reachability=2 host(s): academy.poixe.com status 200, admin.s3.po... Remaining gaps: l7_permissioned_authenticated_surface_check (requires_permission) l7_permissioned_deep_port_service_inventory (requires_permission) l7_permissioned_external_service_intelligence (requires_permission)

Evidence: [E004] [E019] [E024] [E025] [E030] [E038] [E039] [M001] [M002] [M003] [M004] [M005] [M006]

Boundaries: This section is a summary of the missing data and next steps, and it is not a comprehensive report.

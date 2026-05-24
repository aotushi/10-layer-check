# Site Analysis: poixe.com

## Executive Summary

HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=3 certificate(s): Let's Encrypt for *.poixe.com (+2 more).

Performance score 31; 5 metric(s) are poor. Evidence: pagespeed=6 item(s): First Contentful Paint 3620.752027193798 poor, Largest Contentful Paint 6620.996575738547 poor, Total Blocking Time 4924 poor (+3 more); pagespeed=6 item(s): unused-css-rules, unminified-css, server-response-time (+3 more).

Lighthouse performance score 33; 4 metric(s) are poor. Evidence: lighthouse=5 item(s): First Contentful Paint 3964.4540000000006 poor, Largest Contentful Paint 6591.537 poor, Total Blocking Time 5084 poor (+2 more); lighthouse=6 item(s): unused-javascript, server-response-time, redirects (+3 more).

Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=8 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+5 more); https_reachability=3 host(s): academy.poixe.com status 200, admin.s3.poixe.com status 200, blog.poixe.com status 200.

Evidence: [E004] [E028] [E029] [E039] [E055] [E003] [M001] [M002] [M003]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths. Do not place CORS, cookie, API error-surface, or CMS metadata details here; use the API, Technology, Subdomain, or Security sections.; Static and heuristic technology evidence is candidate evidence unless directly corroborated.

## Public Information Architecture

Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=8 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+5 more); https_reachability=3 host(s): academy.poixe.com status 200, admin.s3.poixe.com status 200, blog.poixe.com status 200.

Public content detail map: Collected 8 bounded public content detail page(s): 供应商入驻; 收益提现; 指定模型厂商（路由）; 关于我们; Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog. Evidence: detail_pages=3 endpoint(s): docs.poixe.com /cn/docs/vendor/onboarding.md status 200 (+2 more); public_content_detail_limits=max_seed_pages=5, max_candidate_urls=36, max_detail_pages=8, max_concurrency=3.

Public content surface map: Collected 8 bounded public content surface(s): Poixe AI; Poixe Blog &#8211; The most powerful platform for building AI products.; Poixe Community; developer.poixe.com/; developers.poixe.com/. Evidence: public_content_surfaces=4 endpoint(s): poixe.com / status 200, blog.poixe.com / status 200 (+2 more); public_content_surface_limits=max_candidate_urls=24, max_pages=8, max_concurrency=3, timeout_ms=10000.

Public SPA route metadata: Extracted 30 route-like string candidate(s) and 18 component/page-like symbol candidate(s) from bounded public asset previews. Evidence: route_candidates=10 route candidate(s): /billing from /assets/index-JWhzjXGG.js, /dashboard from /assets/index-JWhzjXGG.js, /log from /assets/index-JWhzjXGG.js (+7 more); component_candidates=9 component candidate(s): AuthLayout from /assets/index-JWhzjXGG.js, CancelToken from /assets/index-JWhzjXGG.js, MeasureLayout from /assets/index-JWhzjXGG.js (+6 more). Missing data: complete_docs_or_blog_corpus (add_provider). Remaining gaps: authenticated_content (requires_permission) authenticated_route_behavior (requires_permission) business_model_validation_beyond_public_text (add_provider)

Evidence: [E039] [E012] [E014] [E015] [E017] [E019] [E037] [M001] [M002] [M003] [M004]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths. Do not place CORS, cookie, API error-surface, or CMS metadata details here; use the API, Technology, Subdomain, or Security sections.

## Technology Stack

Found 1 deterministic frontend technology candidate(s). Evidence: Vite-like_build=category=build_tool, confidence=possible, evidence_refs=3 item(s): script:1, stylesheet:1, marker:type=module.

Public SPA asset metadata: Collected bounded SPA asset metadata: React (frontend_framework, confirmed); Vite-like asset pipeline (build_tool, confirmed); React Router-like client routing (router, confirmed); CSR candidate (rendering_mode, likely); Code splitting / lazy chunk hints (code_splitting, likely); Route-like strings in public bundle preview (router, possible). Evidence: html_shell=status_code=200, final_url=https://poixe.com/, content_type=text/html, title=Poixe AI; declared_assets=2 item(s): poixe.com /assets/index-JWhzjXGG.js script, poixe.com /assets/index-md0FU3kt.css styleshee...

Found 2 application fingerprint candidate(s): Cloudflare, React. Evidence: Cloudflare=category=hosting, confidence=high, evidence=server: cloudflare; Cloudflare=category=hosting, confidence=high, evidence=cf-ray: a00cc0210f2908ab-LAX; React=category=framework, confidence=medium, evidence=html matched /id=["']root["']/i.

Bounded public app header metadata: Observed public app header metadata signal(s) on 6 bounded check(s): community.poixe.com Discourse route list/latest; community.poixe.com x-runtime 0.228209; community.poixe.com x-runtime 0.300215; community.poixe.com x-runtime 0.273179; docs.poixe.com Mintlify client 0.0.2952; docs.poixe.com Mint proxy 1.0.0-prod; docs.poixe.com Vercel cache MISS; docs.poixe.com Next/RSC vary header. Evidence: public_app_header_metadata=3 endpoint(s): blog.poixe.com /wp-json/ status 200, community.poixe.com / status 200 (+1 more); public_security_detail_limits=max_hosts=... Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML. Evidence: html_bytes=2799; scripts=1; stylesheets=1; images=0. Browser runtime observed 2 third-party scripts and 12 third-party resources. Evidence: script=https://static.cloudflareinsights.com/beacon.min.js/v833ccba57c9e4d2798f2e76cebdd09a11778172276447; script=https://matomo.gptocean.com/matomo.js; ping=https://matomo.gptocean.com/matomo.php?...; image=https://s3.poixe.com/apple/avatar-2.webp. No third-party script was found in static HTML.

Missing data: authenticated_content (requires_permission). Collected bounded SPA asset metadata: React (frontend_framework, confirmed); Vite-like asset pipeline (build_tool, confirmed); React Router-like client routing (router, confirmed); CSR candidate (rendering_mode, likely); Code splitting / lazy chunk hints (code_splitting, likely); Route-like strings in public bundle preview (router, possible). Observed public app header metadata signal(s) on 6 bounded check(s): community.poixe.com Discourse route list/latest; community.poixe.com x-runtime 0.228209; community.poixe.com x-runtime 0.300215; community.poixe.com x-runtime 0.273179; docs.poixe.com Mintlify client 0.0.2952; docs.poixe.com Mint proxy 1.0.0-prod; docs.poixe.com Vercel cach...

Evidence: [E013] [E012] [E016] [E025] [E026] [E040] [E041] [M001] [M002] [M003]

Boundaries: Static and heuristic technology evidence is candidate evidence unless directly corroborated.

## Deployment and Network Surface

HTTPS is reachable, but HSTS was not found on the probed response. Evidence: https=url=https://poixe.com/, reachable=true, status_code=200; strict-transport-security=null; certspotter=3 certificate(s): Let's Encrypt for *.poixe.com (+2 more).

Performance score 31; 5 metric(s) are poor. Evidence: pagespeed=6 item(s): First Contentful Paint 3620.752027193798 poor, Largest Contentful Paint 6620.996575738547 poor, Total Blocking Time 4924 poor (+3 more); pagespeed=6 item(s): unused-css-rules, unminified-css, server-response-time (+3 more).

Lighthouse performance score 33; 4 metric(s) are poor. Evidence: lighthouse=5 item(s): First Contentful Paint 3964.4540000000006 poor, Largest Contentful Paint 6591.537 poor, Total Blocking Time 5084 poor (+2 more); lighthouse=6 item(s): unused-javascript, server-response-time, redirects (+3 more).

CDN header signal(s) found: cloudflare. Evidence: cf-cache-status=url=https://poixe.com/, provider=cloudflare; cf-ray=url=https://poixe.com/, provider=cloudflare; report-to=url=https://poixe.com/, provider=cloudflare; server=url=https://poixe.com/, provider=cloudflare.

CDN header signal(s) found: cloudflare. Evidence: cf-ray=url=https://poixe.com/, provider=cloudflare; cf-cache-status=url=https://poixe.com/, provider=cloudflare; server=url=https://poixe.com/, provider=cloudflare; cf-ray=url=https://poixe.com/assets/index-JWhzjXGG.js, provider=cloudflare.

Live certificate expires in 55 day(s). Evidence: tls_protocol=TLSv1.3; tls_cipher=name=TLS_AES_256_GCM_SHA384, standardName=TLS_AES_256_GCM_SHA384, version=TLSv1.3; leaf=valid_to=Jul 18 20:50:10 2026 GMT; tls_certificate_chain=structured 8 item(s).

Evidence: [E004] [E028] [E029] [E001] [E002] [E005] [E007]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Request and Rendering Chain

Browser runtime observed 2 failed resource(s). Evidence: failed_resource_count=2; api_like_resource_count=6.

Browser runtime loaded the page and captured rendered-page evidence. Evidence: final_url=https://poixe.com/; status_code=200; html_title=Poixe AI.

Browser runtime observed 0.52 MiB of known transfer size with 2 unknown resource size(s). Evidence: runtime_transfer_size_total=544971; runtime_transfer_size_known_count=20; runtime_transfer_size_unknown_count=2.

Browser runtime observed 22 resources. Evidence: runtime_resource_count=22; runtime_resource_counts=document=1, script=3, stylesheet=1, image=4.

Browser runtime observed 6 API-like request(s), including 0 third-party request(s). Evidence: runtime_api_request_count=6; runtime_api_failed_count=0; runtime_api_third_party_count=0.

Browser runtime loaded the page without common access barrier signals. Evidence: final_url=https://poixe.com/; status_code=200; html_title=Poixe AI; screenshot=/home/runner/work/02-browser-runtime-remote-git/02-browser-runtime-remote-git/screenshots/poixe.com-2026-05-24.png.

Evidence: [E023] [E011] [E021] [E022] [E036] [E010] [M001] [M002] [M003] [M004]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.

## API and Protocol Surface

Bounded public CORS check: Observed CORS response header signal(s) on 4 bounded public check(s). Evidence: bounded_cors_checks=4 endpoint(s): poixe.com / status 200, api.poixe.com / status 200 (+2 more); public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3.

Bounded public API endpoint inventory: Preserved 2 bounded public API endpoint observation(s): /health, /v1/models. Evidence: public_api_endpoint_inventory=2 item(s): api.poixe.com /health GET status 200 signals=cors allow origin:https://site-10-layer-check.invalid/cors allow credentials:true signals=2 item(s): cors_allow_origin:ht...; public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3.

Bounded public API check: Checked 2 bounded public API endpoint candidate(s); 0 exposed error/request-id signal(s). Evidence: bounded_public_api_checks=3 endpoint(s): api.poixe.com /health status 200 (+2 more); public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3.

No obvious API or server error surface was detected in the main response. Evidence: error_surface=status_code=200, content_type=text/html.

Found 2 protocol or platform clue(s) from response headers. Evidence: protocol_clues=server=cloudflare.

Browser runtime observed 6 API-like request(s), including 0 third-party request(s). Evidence: runtime_api_request_count=6; runtime_api_failed_count=0; runtime_api_third_party_count=0.

Evidence: [E032] [E030] [E031] [E033] [E034] [E036] [M011] [M012] [M013] [M014]

Boundaries: Do not infer authenticated API behavior, billing, or backend business logic.

## Subdomains and Attack Surface

Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces. Evidence: provider_status=provider=certspotter, status=ok, certificate_count=29; provider_attempts=1 item(s); subdomains=8 host(s): academy.poixe.com, admin.s3.poixe.com, blog.poixe.com (+5 more); https_reachability=3 host(s): academy.poixe.com status 200, admin.s3.poixe.com status 200, blog.poixe.com status 200.

Collected 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s). Evidence: checked_hosts=1 item(s): poixe.com Poixe AI; service_fingerprint_limits=max_hosts=1, checked_hosts=1, max_requests_per_host=1, max_concurrency=3.

Checked 6 bounded public host candidate(s); observed role hint(s): root, api, blog, community, docs, status. Evidence: public_host_roles=6 item(s): poixe.com status 200, api.poixe.com status 200, blog.poixe.com status 200 (+3 more); public_hosts=6 item(s): poixe.com status 200 Poixe AI cloudflare, api.poixe.com status 200 cloudflare, blog.poixe.com status 200 Poixe Blog &#8211; The most powerful platform for building AI...; reachable_public_hosts=5 endpoint(s): poixe.com /wp-json/ status 200 (+4 more); public_host_fingerprint_limits=max_hosts=8, checked_hosts=6, max_requests_per_host=2, max...

Found 2 application fingerprint candidate(s): Cloudflare, React. Evidence: Cloudflare=category=hosting, confidence=high, evidence=server: cloudflare; Cloudflare=category=hosting, confidence=high, evidence=cf-ray: a00cc0210f2908ab-LAX; React=category=framework, confidence=medium, evidence=html matched /id=["']root["']/i.

Missing data: l7_permissioned_authenticated_surface_check (requires_permission).

Evidence: [E039] [E037] [E038] [E040] [M015] [M016] [M017] [M018]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Organization and Operations Signals

Public product/business detail: Collected public product/business detail snippets from 8 bounded page(s): product / docs / product / 供应商入驻; product / docs / product / 收益提现; product / docs / product / 指定模型厂商（路由）; product / docs / product / 关于我们; article / blog / product / Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog. Observed operation topics: supplier/vendor onboarding, payouts/withdrawals, provider routing, platform overview, cost reduction content, vendor/product pages. Evidence pages: 供应商入驻; 收益提现; 指定模型厂商（路由）; 关于我们; Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog.

Public business/product content: Collected public business/product text snippets from 5 bounded page(s): homepage / unknown / Poixe AI; blog / news / Poixe Blog &#8211; The most powerful platform for building AI products.; community / community / Poixe Community; docs / technical_documentation / Poixe AI - Poixe Docs; status / commercial / poixe status. Evidence: business_product_snippets=4 endpoint(s): poixe.com /, blog.poixe.com / (+2 more); public_content_surface_limits=max_candidate_urls=24, max_pages=8, max_concurrency=3, timeout_ms=10000.

Public content detail map: Collected 8 bounded public content detail page(s): 供应商入驻; 收益提现; 指定模型厂商（路由）; 关于我们; Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog. Evidence: detail_pages=3 endpoint(s): docs.poixe.com /cn/docs/vendor/onboarding.md status 200 (+2 more); public_content_detail_limits=max_seed_pages=5, max_candidate_urls=36, max_detail_pages=8, max_concurrency=3.

Public content surface map: Collected 8 bounded public content surface(s): Poixe AI; Poixe Blog &#8211; The most powerful platform for building AI products.; Poixe Community; developer.poixe.com/; developers.poixe.com/. Evidence: public_content_surfaces=4 endpoint(s): poixe.com / status 200, blog.poixe.com / status 200 (+2 more); public_content_surface_limits=max_candidate_urls=24, max_pages=8, max_concurrency=3, timeout_ms=10000.

Collected organization-facing DNS, homepage, registration, or archive evidence. Evidence: mx=3 item(s): 1 mx1.larksuite.com., 10 mx3.larksuite.com., 5 mx2.larksuite.com.; txt=2 item(s): v=spf1 +include:spf.onlarksuite.com -all, verification-code-site-App_lark=Sdxd3rHU75iYSAvjtheE; social_links=none; related_domain_candidates=none.

Collected RDAP / WHOIS-lite registration evidence. Evidence: rdap_registrar=NameSilo, LLC; rdap_events=4 item(s): 2019-03-05T05:45:05Z, 2027-03-05T05:45:05Z, 2026-01-31T13:52:33Z (+1 more); rdap_nameservers=2 item(s): CURT.NS.CLOUDFLARE.COM, ROSEMARY.NS.CLOUDFLARE.COM.

Collected Wayback historical archive evidence. Evidence: wayback_snapshot_count_estimate=null; wayback_first_snapshot=status_code=200; wayback_last_snapshot=status_code=200.

Evidence: [E044] [E045] [E046] [E047] [E048] [E014] [E015] [M025] [M026] [M027] [M028]

Boundaries: Registration and historical evidence do not prove current operator or legal ownership.

## Security Posture

Bounded public cookie check: Observed Set-Cookie header(s) on 1 bounded public check(s). Evidence: bounded_cookie_checks=4 endpoint(s): poixe.com / status 200, api.poixe.com / status 200 (+2 more); public_security_detail_limits=max_hosts=6, checked_hosts=6, max_requests_per_host=5, max_concurrency=3.

No Set-Cookie header was observed on the main response. Evidence: set-cookie=null.

Missing security headers: content-security-policy, strict-transport-security, permissions-policy. Evidence: x-frame-options=SAMEORIGIN; x-content-type-options=nosniff; referrer-policy=strict-origin-when-cross-origin.

Frame embedding policy is present. Evidence: x-frame-options=SAMEORIGIN; content-security-policy=null; iframe_sources=none.

Browser runtime observed 0 console error(s) and 2 failed request(s). Evidence: runtime_mixed_content_candidate_count=0; runtime_failed_request_count=2; runtime_console_error_count=0; runtime_page_error_count=0. No obvious static leakage signals were found in the main HTML. Evidence: leakage_signals=none. Observed CORS response header signal(s) on 4 bounded public check(s).

Evidence: [E049] [E054] [E055] [E050] [E051] [E052] [M034] [M035] [M036] [M037]

Boundaries: Report missing controls as risk signals, not confirmed exploitability without authorized testing.

## Missing Data and Next Steps

Missing data: authenticated_content (requires_permission).

Gap groups: add_provider: 19 (business_model_validation_beyond_public_text; complete_docs_or_blog_corpus; complete_minified_bundle_reverse_engineering; +16 more) | requires_permission: 12 (authenticated_content; authenticated_route_behavior; credentialed_authenticated_behavior; +9 more) | manual_review: 2 (related_domain_candidates; related_domain_confirmation) | requires_user_input: 3 (login_rate_limit_validation; login_rate_limit_validation; login_rate_limit_validation) | out_of_scope: 1 (icp)

Missing data: authenticated_route_behavior (requires_permission).

Missing data: business_model_validation_beyond_public_text (add_provider).

Missing data: complete_docs_or_blog_corpus (add_provider).

Missing data: complete_minified_bundle_reverse_engineering (add_provider).

Missing data: deep_crawl_content (add_provider).

Missing data: executed_client_route_table (add_provider).

Missing data: form_submission_results (add_provider).

Evidence: [M001] [M002] [M003] [M004] [M005] [M006] [M007] [M008] [M009] [M010]

Boundaries: Do not present missing data as collected evidence.

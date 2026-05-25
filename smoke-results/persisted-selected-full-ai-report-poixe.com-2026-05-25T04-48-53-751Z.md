# Site Analysis: poixe.com

## Executive Summary

HTTPS is reachable, but HSTS was not found on the probed response.

Business model synthesis: Current public content/detail, public API, and SPA operation evidence supports describing the public product surface as an AI API gateway/product platform with public `/v1/models` API surface, provider routing, supplier/vendor onboarding, and payout/revenue operations. This does not prove authenticated billing, internal settlement, or operator ownership.

Performance score 36; 5 metric(s) are poor.

Lighthouse performance score 33; 4 metric(s) are poor. Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces.

Evidence: [E004] [E046] [E033] [E017] [E028] [E029] [M001] [M002] [M003]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Public Information Architecture

Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces.

Public content detail map: Collected 8 bounded public content detail page(s): 供应商入驻; 收益提现; 指定模型厂商（路由）; 关于我们; Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog.

Public content surface map: Collected 8 bounded public content surface(s): Poixe AI; Poixe Blog &#8211; The most powerful platform for building AI products.; Poixe Community; developer.poixe.com/; developers.poixe.com/.

Public SPA route metadata: Extracted 60 route-like string candidate(s) and 23 component/page-like symbol candidate(s) from bounded public asset previews. Checked 6 bounded public host candidate(s); observed role hint(s): root, api, blog, community, docs, status.

Public content surface table:
| Type | Host | Path | Status | Title |
| --- | --- | --- | --- | --- |
| unknown | poixe.com | / | 200 | Poixe AI |
| news | blog.poixe.com | / | 200 | Poixe Blog &#8211; The most powerful platform for building AI products. |

Public detail page table:
| Kind | Host | Path | Status | Title |
| --- | --- | --- | --- | --- |
| product | docs.poixe.com | /cn/docs/vendor/onboarding.md | 200 | 供应商入驻 |
| product | docs.poixe.com | /cn/docs/vendor/payouts.md | 200 | 收益提现 |

SPA route candidate table:
| Candidate | Source asset | Confidence | Derivation |
| --- | --- | --- | --- |
| /products/vendor/application | index-CyTc29mP.js | medium | direct |
| /products/vendor | index-CyTc29mP.js | medium | direct |
| /vendor | index-CyTc29mP.js | medium | direct |
| /vendor/revenue | revenue-B2FiTXel.js | low | derived alias: vendor route + revenue API path; payout docs topic |
| /setting/payment | withdrawal_method-hGW_PKDO.js | medium | direct |
| /pricing | index-CyTc29mP.js | medium | direct |
| /login | index-CyTc29mP.js | medium | direct |
| /model | index-CyTc29mP.js | medium | direct |

Evidence: [E039] [E012] [E014] [E015] [E017] [E019] [E037] [M001] [M002] [M003] [M004]

Boundaries: Single URL and bounded runtime evidence may miss authenticated routes and deep crawl paths.

## Technology Stack

Found 1 deterministic frontend technology candidate(s).

Public SPA asset metadata: Collected bounded SPA asset metadata: React (frontend_framework, confirmed); Vite-like asset pipeline (build_tool, confirmed); React Router-like client routing (router, confirmed); CSR candidate (rendering_mode, likely); Code splitting / lazy chunk hints (code_splitting, likely); Route-like strings in public bundle preview (router, possible).

Found 2 application fingerprint candidate(s): Cloudflare, React.

Bounded public app header metadata: Observed public app header metadata signal(s) on 6 bounded check(s): community.poixe.com Discourse route list/latest; community.poixe.com x-runtime 0.243901; community.poixe.com x-runtime 0.468400; community.poixe.com x-runtime 0.179164; docs.poixe.com Mintlify client 0.0.2952; docs.poixe.com Mint proxy 1.0.0-prod; docs.poixe.com Vercel cache MISS; docs.poixe.com Next/RSC vary header.

Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML.

Browser runtime observed 2 third-party scripts and 10 third-party resources.

No third-party scr...

SPA signal table:
| Category | Signal | Confidence | Basis |
| --- | --- | --- | --- |
| frontend_framework | React | confirmed |  |
| build_tool | Vite-like asset pipeline | confirmed |  |
| router | React Router-like client routing | confirmed |  |
| rendering_mode | CSR candidate | likely |  |
| code_splitting | Code splitting / lazy chunk hints | likely |  |
| router | Route-like strings in public bundle preview | possible |  |

SPA asset preview table:
| Kind | Role | Path | Status | Signals |
| --- | --- | --- | --- | --- |
| script | entry_bundle | /assets/index-CyTc29mP.js | 200 | vite map deps, dynamic import, react symbol |
| script | lazy_chunk | /assets/form_vendor_application-DZlQ4bW-.js | 200 | lazy chunk ref |
| script | lazy_chunk | /assets/channel_model_rate-C0G8tvbv.js | 200 | lazy chunk ref |
| stylesheet | style_bundle | /assets/index-md0FU3kt.css | 200 |  |

Public app marker table:
| Host | Marker | Category | Confidence |
| --- | --- | --- | --- |
| docs.poixe.com | Mintlify | docs | medium |
| blog.poixe.com | WordPress | cms | high |
| community.poixe.com | Discourse | forum | medium |
| blog.poixe.com | wp-json | cms | high |
| api.poixe.com | api | api | low |
| blog.poixe.com | blog | blog | low |

Evidence: [E013] [E012] [E016] [E025] [E026] [E040] [E041] [M001] [M002] [M003]

Boundaries: Static and heuristic technology evidence is candidate evidence unless directly corroborated.

## Deployment and Network Surface

HTTPS is reachable, but HSTS was not found on the probed response.

Live certificate expires in 54 day(s). Final response returned HTTP 200.

Performance score 36; 5 metric(s) are poor.

Lighthouse performance score 33; 4 metric(s) are poor.

Evidence: [E004] [E028] [E029] [E001] [E002] [E005] [E007]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Request and Rendering Chain

Browser runtime observed 2 failed resource(s).

Browser runtime loaded the page and captured rendered-page evidence.

Browser runtime observed 0.52 MiB of known transfer size with 0 unknown resource size(s).

Browser runtime observed 6 API-like request(s), including 0 third-party request(s).

Browser runtime loaded the page without common access barrier signals.

Evidence: [E023] [E011] [E021] [E022] [E036] [E010] [M001] [M002] [M003] [M004]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.

## API and Protocol Surface

Bounded public CORS check: Observed CORS response header signal(s) on 4 bounded public check(s). CORS response-header signals were observed in bounded public checks.

No CORS headers were found on the main response.

Bounded public API endpoint inventory: Preserved 2 bounded public API endpoint observation(s): /health, /v1/models. Bounded public checks include `/health` and `/v1/models`.

Bounded public API check: Checked 2 bounded public API endpoint candidate(s); 0 exposed error/request-id signal(s).

API endpoint table:
| Host | Method | Path | Status | Signals |
| --- | --- | --- | --- | --- |
| api.poixe.com | GET | /health | 200 | allow-origin https://site-10-layer-check.invalid, allow-credentials true |
| api.poixe.com | GET | /v1/models | 200 | allow-origin https://site-10-layer-check.invalid, allow-credentials true |

CORS observation table:
| Host | Method | Path | Status | Signals |
| --- | --- | --- | --- | --- |
| api.poixe.com | GET | / | 200 | allow-origin https://site-10-layer-check.invalid, allow-credentials true |
| api.poixe.com | GET | /health | 200 | allow-origin https://site-10-layer-check.invalid, allow-credentials true |

Evidence: [E032] [E030] [E031] [E033] [E034] [E036] [M011] [M012] [M013] [M014]

## Subdomains and Attack Surface

Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces.

Collected 2 bounded HTTP(S) service fingerprint hint(s) from 1 host(s).

Checked 6 bounded public host candidate(s); observed role hint(s): root, api, blog, community, docs, status.

Found 2 application fingerprint candidate(s): Cloudflare, React.

Public host table:
| Host | Role | Status | Observed hint |
| --- | --- | --- | --- |
| poixe.com | root | 200 | root host HTTP 200 |
| api.poixe.com | api | 200 | api host HTTP 200 |
| blog.poixe.com | blog | 200 | blog host HTTP 200 |
| community.poixe.com | community | 200 | community host HTTP 200 |
| docs.poixe.com | docs | 308 | docs host HTTP 308 |
| status.poixe.com | status | 200 | status host HTTP 200 |

Evidence: [E039] [E037] [E038] [E040] [M015] [M016] [M017] [M018]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Organization and Operations Signals

Business model synthesis: Current public content/detail, public API, and SPA operation evidence supports describing the public product surface as an AI API gateway/product platform with public `/v1/models` API surface, provider routing, supplier/vendor onboarding, and payout/revenue operations. This does not prove authenticated billing, internal settlement, or operator ownership.

Public product/business detail: Collected public product/business detail snippets from 8 bounded page(s): product / docs / product / 供应商入驻; product / docs / product / 收益提现; product / docs / product / 指定模型厂商（路由）; product / docs / product / 关于我们; article / blog / product / Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog.. Observed operation topics: supplier/vendor onboarding, payouts/withdrawals, provider routing, platform overview, cost-reduction content, vendor/product pages. Evidence pages: Poixe AI (/products/vendor/application); 指定模型厂商（路由） (/cn/docs/models-pricing/provider-routing.md); Poixe AI (/products/vendor); 收益提现 (/cn/docs/vendor/payouts.md); 供应商入驻 (/cn/docs/vendor/onboarding.md); +8 more.

Collected organization-facing DNS, homepage, registration, or archive evidence.

Public business page table:
| Kind | Hint | Path | Title |
| --- | --- | --- | --- |
| product | product | /cn/docs/models-pricing/provider-routing.md | 指定模型厂商（路由） |
| product | product | /products/vendor/application | Poixe AI |
| product | product | /cn/docs/vendor/payouts.md | 收益提现 |
| product | product | /products/vendor | Poixe AI |
| product | product | /cn/docs/vendor/onboarding.md | 供应商入驻 |
| article | product | /1041/ | Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog |

SPA operation evidence table:
| Operation | Signal | Support | Confidence |
| --- | --- | --- | --- |
| model-load/provider routing | /v1/models + provider-routing docs | public docs + public API endpoint | medium |
| vendor revenue/payout | /setting/payment (+3 related signals) | SPA asset string + public payout docs | medium |

Evidence: [E044] [E017] [E033] [E045] [E046] [E047] [E048] [M001] [M002] [M003] [M004]

Boundaries: Registration, historical, and public-surface operation evidence do not prove current operator, legal ownership, authenticated billing, or internal settlement behavior.

## Security Posture

Bounded public cookie check: Observed Set-Cookie header(s) on 1 bounded public check(s). Cookie evidence is limited to the bounded public checks.

No Set-Cookie header was observed on the main response.

Missing security headers: content-security-policy, strict-transport-security, permissions-policy

Frame embedding policy is present. Header evidence includes CSP/HSTS absence and frame/content-type/referrer controls.

Security control table:
| Control | Observed state |
| --- | --- |
| Missing headers | Missing security headers: content-security-policy, strict-transport-security,... |

Cookie observation table:
| Host | Method | Path/Cookie | Status | Attributes |
| --- | --- | --- | --- | --- |
| blog.poixe.com | HEAD | /wp-login.php | 200 | set-cookie observed, public route present |

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

Boundaries: Do not present missing data as collected evidence.; Group remaining gaps by add_provider, requires_permission, manual_review, requires_user_input, and out_of_scope.

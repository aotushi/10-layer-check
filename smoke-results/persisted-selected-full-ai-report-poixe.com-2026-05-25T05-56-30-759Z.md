# Site Analysis: poixe.com

## Executive Summary

The site has 10/10 layers with collected evidence. 6 layer(s) contain warning or error records. 6 high/medium risk item(s) should be reviewed first.

Business model synthesis: Current public content/detail, public API, and SPA operation evidence supports describing the public product surface as an AI API gateway/product platform with public `/v1/models` API surface, provider routing, supplier/vendor onboarding, and payout/revenue operations. This does not prove authenticated billing, internal settlement, or operator ownership.

Performance score 36; 5 metric(s) are poor.

Lighthouse performance score 35; 4 metric(s) are poor. Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces.

Evidence: [E047] [E033] [E017] [E004] [E028] [E029] [M001] [M002] [M003]

Boundaries: Technical evidence alone does not prove business model or ownership.

## Public Information Architecture

The site has a public information architecture with 12 bounded public content detail pages, 8 bounded public content surfaces, and 6 bounded public host candidates. Collected 12 bounded public content detail page(s): 接口地址（Base URL）; 指定模型厂商（路由）; Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog; OpenAI Chat Completions 协议; 提示词缓存（缓存亲和性路由）. Collected 8 bounded public content surface(s): Poixe AI; Poixe Blog &#8211; The most powerful platform for building AI products.; Poixe Community; developer.poixe.com/; developers.poixe.com/. SPA operation hints: Extracted 60 route-like string candidate(s) and 23 component/page-like symbol candidate(s) from bounded public asset previews.. Operation hints: vendor revenue/payout. Signals: vendor revenue/payout: /setting/payment (+3 related signals).

Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces.

Public content detail map: Collected 12 bounded public content detail page(s): 接口地址（Base URL）; 指定模型厂商（路由）; Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog; OpenAI Chat Completions 协议; 提示词缓存（缓存亲和性路由）.

Public content surface map: Collected 8 bounded public content surface(s): Poixe AI; Poixe Blog &#8211; The most powerful platform for building AI products.; Poixe Community; developer.poixe.com/; developers.poixe.com/.

Public SPA route metadata: Extracted 60 route-like string candidate(s) and 23 component/page-like symbol candidate(s) from bounded public asset previews.

Public content surface table:
| Type | Host | Path | Status | Title |
| --- | --- | --- | --- | --- |
| unknown | poixe.com | / | 200 | Poixe AI |
| news | blog.poixe.com | / | 200 | Poixe Blog &#8211; The most powerful platform for building AI products. |

Public detail page table:
| Kind | Host | Path | Status | Title |
| --- | --- | --- | --- | --- |
| documentation | docs.poixe.com | /cn/api-reference/introduction/base-url.md | 200 | 接口地址（Base URL） |

SPA route candidate table:
| Candidate | Source asset | Confidence | Derivation |
| --- | --- | --- | --- |
| /products/vendor/application | index-CyTc29mP.js | medium | direct |
| /products/vendor | index-CyTc29mP.js | medium | direct |
| /vendor | index-CyTc29mP.js | medium | direct |
| /setting/payment | withdrawal_method-hGW_PKDO.js | medium | direct |
| /pricing | index-CyTc29mP.js | medium | direct |
| /login | index-CyTc29mP.js | medium | direct |
| /model | index-CyTc29mP.js | medium | direct |

Evidence: [E040] [E012] [E014] [E015] [E017] [E019] [E038] [M001] [M002] [M003] [M004]

Boundaries: Public SPA route metadata: Extracted 60 route-like string candidate(s) and 23 component/page-like symbol candidate(s) from bounded public asset previews.

## Technology Stack

The site has a technology stack with React, Vite-like asset pipeline, and Cloudflare. Collected bounded SPA asset metadata: React (frontend_framework, confirmed); Vite-like asset pipeline (build_tool, confirmed); React Router-like client routing (router, confirmed); CSR candidate (rendering_mode, likely); Code splitting / lazy chunk hints (code_splitting, likely); Route-like strings in public bundle preview (router, possible). Observed public app header metadata signal(s) on 6 bounded check(s): community.poixe.com Discourse route list/latest; community.poixe.com x-runtime 0.220631; community.poixe.com x-runtime 0.415160; community.poixe.com x-runtime 0.168450; docs.poixe.com Mintlify client 0.0.2952; docs.poixe.com Mint proxy 1.0.0-prod; docs.poixe.com Vercel cache MISS; docs.poix... Observed public CMS/forum metadata signal(s) on 8 bounded check(s). Found 1 deterministic frontend technology candidate(s).

Public SPA asset metadata: Collected bounded SPA asset metadata: React (frontend_framework, confirmed); Vite-like asset pipeline (build_tool, confirmed); React Router-like client routing (router, confirmed); CSR candidate (rendering_mode, likely); Code splitting / lazy chunk hints (code_splitting, likely); Route-like strings in public bundle preview (router, possible).

Found 2 application fingerprint candidate(s): Cloudflare, React.

Bounded public app header metadata: Observed public app header metadata signal(s) on 6 bounded check(s): community.poixe.com Discourse route list/latest; community.poixe.com x-runtime 0.220631; community.poixe.com x-runtime 0.415160; community.poixe.com x-runtime 0.168450; docs.poixe.com Mintlify client 0.0.2952; docs.poixe.com Mint proxy 1.0.0-prod; docs.poixe.com Vercel cache MISS; docs.poixe.com Next/RSC vary header.

Extracted 1 scripts, 1 stylesheets, and 0 images from static HTML.

Browser runtime observed 2 third-party scripts and 10 third-party resources.

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

Evidence: [E012] [E013] [E016] [E025] [E026] [E041] [E042] [M001] [M002] [M003]

Boundaries: Public SPA asset metadata: Collected bounded SPA asset metadata: React (frontend_framework, confirmed); Vite-like asset pipeline (build_tool, confirmed); React Router-like client routing (router, confirmed); CSR candidate (rendering_mode,; Bounded public app header metadata: Observed public app header metadata signal(s) on 6 bounded check(s): community.poixe.com Discourse route list/latest; community.poixe.com x-runtime 0.220631; community.poixe.com x-runtime 0.415160; docs; No third-party script was found in static HTML.

## Deployment and Network Surface

The site has a deployment and network surface with HTTPS, CDN, and performance evidence. DNS and protocol checks completed; no CDN signal was found from DNS records.

Live certificate expires in 54 day(s). Final response returned HTTP 200.

Performance score 36; 5 metric(s) are poor.

Lighthouse performance score 35; 4 metric(s) are poor. HTTPS is reachable, but HSTS was not found on the probed response.

Evidence: [E004] [E028] [E029] [E001] [E002] [E005] [E007]

Boundaries: Do not claim full origin topology or CDN coverage from headers alone.

## Request and Rendering Chain

The site has a request and rendering chain with browser runtime resources and API calls. Browser runtime observed 2 failed resource(s).

Browser runtime loaded the page and captured rendered-page evidence.

Browser runtime observed 0.52 MiB of known transfer size with 0 unknown resource size(s).

Browser runtime observed 6 API-like request(s), including 0 third-party request(s).

Browser runtime loaded the page without common access barrier signals.

Evidence: [E023] [E011] [E021] [E022] [E037] [E010] [M001] [M002] [M003] [M004]

Boundaries: Worker fetch and one browser run do not represent every user route or session state.

## API and Protocol Surface

The site has an API and protocol surface with CORS, public API endpoint checks, and error surfaces. Observed CORS response header signal(s) on 4 bounded public check(s). Preserved 2 bounded public API endpoint observation(s): /health, /v1/models. Checked 2 bounded public API endpoint candidate(s); 0 exposed error/request-id signal(s).

No CORS headers were found on the main response. Public API compatibility detail: Collected public API compatibility detail snippets from 10 bounded page(s): 接口地址（Base URL） / base URL documentation, regional endpoint documentation; 指定模型厂商（路由） / model naming/provider routing documentation; Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog / Anthropic Messages-compatible surface (/v1/messages), OpenAI-compatible model/API reference, model naming/provider routing documentation; OpenAI Chat Completions 协议 / OpenAI Chat Completions-compatible path (/v1/chat/completions), Anthropic Messages-compatible surface (/v1/messages), OpenAI-compatible model/API reference, compatibility/difference documentation; 提示词缓存（缓存亲和性路由） / OpenAI Chat Completions-compatible path (/v1/chat/completions), OpenAI Responses-compatible path (/v1/responses), Anthropic Messages-compatible surfac...

Bounded public CORS check: Observed CORS response header signal(s) on 4 bounded public check(s). CORS response-header signals were observed in bounded public checks.

Bounded public API endpoint inventory: Preserved 2 bounded public API endpoint observation(s): /health, /v1/models. Bounded public checks include `/health` and `/v1/models`.

API base URL table:
| Page | Base URL | Signals | Snippet |
| --- | --- | --- | --- |
| 接口地址（Base URL） | https://api.poixe.com/ | base URL documentation; regional endpoint documentation | https://api.poixe.com/ |
| 接口地址（Base URL） | https://api-eu-central-1-dc8.poixe.com/ | base URL documentation; regional endpoint documentation | https://api.poixe.com/ |
| 接口地址（Base URL） | https://api-eu-central-1-dc15.poixe.com/ | base URL documentation; regional endpoint documentation | https://api.poixe.com/ |
| OpenAI Chat Completions 协议 | https://api.poixe.com/ | OpenAI Chat Completions-compatible path (/v1/chat/comp...; Anthropic Messages... | <RequestExample> ```bash curl theme={"theme":{"light":"min-light","dark":"min... |

API compatibility evidence table:
| Page | Path | Signals | Snippet |
| --- | --- | --- | --- |
| 接口地址（Base URL） | /cn/api-reference/introduction/base-url.md | base URL documentation; regional endpoint documentation | https://api.poixe.com/ |
| OpenAI Chat Completions 协议 | /cn/api-reference/text-api/openai-completions/overview.md | OpenAI Chat Completions-compatible path (/v1/chat/comp...; Anthropic Messages... | <RequestExample> ```bash curl theme={"theme":{"light":"min-light","dark":"min... |

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

Boundaries: Public API compatibility detail: Collected public API compatibility detail snippets from 10 bounded page(s): 接口地址（Base URL） / base URL documentation, regional endpoint documentation; 指定模型厂商（路由） / model naming/provider routing documentation;

## Subdomains and Attack Surface

The site has a subdomain and attack surface with CT-discovered subdomains, bounded reachability, and public host role hints. Subdomain/reachability matrix: Found 1 subdomain hint(s) that may indicate exposed admin, staging, or tooling surfaces.

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

Evidence: [E040] [E038] [E039] [E041] [M019] [M020] [M021] [M022]

Boundaries: This is not a port scan, brute-force enumeration, vulnerability scan, or authenticated inventory.

## Organization and Operations Signals

Business model synthesis: Current public content/detail, public API, and SPA operation evidence supports describing the public product surface as an AI API gateway/product platform with public `/v1/models` API surface, provider routing, supplier/vendor onboarding, and payout/revenue operations. This does not prove authenticated billing, internal settlement, or operator ownership.

Public product/business detail: Collected public product/business detail snippets from 12 bounded page(s): documentation / docs / technical_documentation / 接口地址（Base URL）; product / docs / product / 指定模型厂商（路由）; article / blog / product / Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog; documentation / docs / technical_documentation / OpenAI Chat Completions 协议; product / docs / product / 提示词缓存（缓存亲和性路由）.. Observed operation topics: supplier/vendor onboarding, provider routing, cost-reduction content, vendor/product pages. Evidence pages: Poixe AI (/products/vendor/application); 指定模型厂商（路由） (/cn/docs/models-pricing/provider-routing.md); Poixe AI (/products/vendor); 模型命名 (/cn/api-reference/introduction/model-naming.md); Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog (/1041/); +8 more. Collected organization-facing DNS, homepage, registration, or archive evidence.

The site has an organization and operations signals with public business/product model signals, public operation evidence, RDAP, MX/TXT, homepage social/related-domain candidates, and Wayback evidence.

Public business page table:
| Kind | Hint | Path | Title |
| --- | --- | --- | --- |
| product | product | /cn/docs/models-pricing/provider-routing.md | 指定模型厂商（路由） |
| product | product | /products/vendor/application | Poixe AI |
| product | product | /products/vendor | Poixe AI |
| article | product | /1041/ | Poixe AI 如何帮助客户降低 API 使用成本 &#8211; Poixe Blog |
| product | product | /cn/api-reference/introduction/model-naming.md | 模型命名 |
| article | product | /tag/poixe%e4%be%9b%e5%ba%94%e5%95%86/ | Poixe供应商 &#8211; Poixe Blog |

SPA operation evidence table:
| Operation | Signal | Support | Confidence |
| --- | --- | --- | --- |
| model-load/provider routing | /v1/models + provider-routing docs | public docs + public API endpoint | medium |
| vendor revenue/payout | /setting/payment (+3 related signals) | SPA asset string | medium |

Evidence: [E017] [E033] [E045] [E046] [E047] [E048] [E049] [M001] [M002] [M003] [M004]

Boundaries: Public business/product content: Collected public business/product text snippets from 5 bounded page(s): homepage / unknown / Poixe AI; blog / news / Poixe Blog &#8211; The most powerful platform for building AI products.; community / commu; Public product/business detail: Collected public product/business detail snippets from 12 bounded page(s): documentation / docs / technical_documentation / 接口地址（Base URL）; product / docs / product / 指定模型厂商（路由）; article / blog / product /; Public SPA route metadata: Extracted 60 route-like string candidate(s) and 23 component/page-like symbol candidate(s) from bounded public asset previews.

## Security Posture

The site has a security posture with security headers, iframe policy, mixed content, leakage, runtime console/page errors, bounded CORS/cookie observations, and risk wording. Observed Set-Cookie header(s) on 1 bounded public check(s).

No Set-Cookie header was observed on the main response.

Missing security headers: content-security-policy, strict-transport-security, permissions-policy Bounded public cookie check: Observed Set-Cookie header(s) on 1 bounded public check(s). Header evidence includes CSP/HSTS absence and frame/content-type/referrer controls.

Frame embedding policy is present. Header evidence includes CSP/HSTS absence and frame/content-type/referrer controls.

Security control table:
| Control | Observed state |
| --- | --- |
| Missing headers | Missing security headers: content-security-policy, strict-transport-security,... |

Cookie observation table:
| Host | Method | Path/Cookie | Status | Attributes |
| --- | --- | --- | --- | --- |
| blog.poixe.com | HEAD | /wp-login.php | 200 | set-cookie observed, public route present |

Evidence: [E050] [E055] [E056] [E051] [E052] [E053] [M038] [M039] [M040] [M041]

Boundaries: Report missing controls as risk signals, not confirmed exploitability without authorized testing.

## Missing Data and Next Steps

The site has missing data and next steps with add_provider, requires_permission, manual_review, requires_user_input, and out_of_scope.

Gap groups: add_provider: 22 (business_model_validation_beyond_public_text; complete_docs_or_blog_corpus; complete_minified_bundle_reverse_engineering; +19 more) | requires_permission: 13 (authenticated_content; authenticated_route_behavior; authenticated_api_key_validation; +10 more) | manual_review: 2 (related_domain_candidates; related_domain_confirmation) | requires_user_input: 3 (login_rate_limit_validation; login_rate_limit_validation; login_rate_limit_validation) | out_of_scope: 1 (icp)

Missing data: authenticated_content (requires_permission).

Missing data: authenticated_route_behavior (requires_permission).

Missing data: business_model_validation_beyond_public_text (add_provider).

Missing data: complete_docs_or_blog_corpus (add_provider).

Missing data: complete_minified_bundle_reverse_engineering (add_provider).

Missing data: deep_crawl_content (add_provider).

Missing data: executed_client_route_table (add_provider).

Missing data: form_submission_results (add_provider).

Evidence: [M001] [M002] [M003] [M004] [M005] [M006] [M007] [M008] [M009] [M010]

Boundaries: Missing data: authenticated_content (requires_permission).; Missing data: authenticated_route_behavior (requires_permission).; Missing data: business_model_validation_beyond_public_text (add_provider).; Missing data: complete_docs_or_blog_corpus (add_provider).; Missing data: complete_minified_bundle_reverse_engineering (add_provider).; Missing data: deep_crawl_content (add_provider).; Missing data: executed_client_route_table (add_provider).; Missing data: form_submission_results (add_provider).

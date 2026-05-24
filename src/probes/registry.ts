import {
  createProbeContractRecord,
  resolveProviderCoverage,
  type LayerProbeContext,
  type LayerProbeDefinition,
} from "../core/probe-contract";
import type { ProviderType, SnapshotRecord } from "../core/types";

export const LAYER_PROBES: LayerProbeDefinition[] = [
  createProviderProbe({
    id: "network_infrastructure_probe",
    layer: 1,
    item: "network_infrastructure",
    name: "Network Infrastructure",
    description: "DNS, IP, ASN, CDN, IPv6, and edge routing signals.",
    requiredProviderTypes: ["dns_tls"],
    nextStep: "Run the dns_tls provider for DoH, IP, ASN enrichment, CDN hint, and protocol checks; treat CDN as a DNS hint until edge-routing analysis is added.",
  }),
  createProviderProbe({
    id: "tls_certificate_probe",
    layer: 2,
    item: "tls_certificate",
    name: "TLS Certificate",
    description: "Certificate chain, SAN entries, issuer, expiry, CT log hints, and HSTS posture.",
    requiredProviderTypes: ["dns_tls", "remote_fetch"],
    nextStep: "Run the dns_tls provider for HTTPS, HSTS, and CT log checks; use the Worker-mediated GitHub Actions live TLS provider for SAN, issuer, expiry, chain, protocol, and cipher evidence.",
  }),
  createProviderProbe({
    id: "http_response_probe",
    layer: 3,
    item: "http_response",
    name: "HTTP Response",
    description: "Status code, redirect chain, response headers, cache policy, and access barriers.",
    requiredProviderTypes: ["remote_fetch"],
    nextStep: "Connect the remote_fetch provider and run http_headers_probe, access_barrier_probe, and cache_policy_probe.",
  }),
  createProviderProbe({
    id: "frontend_intelligence_probe",
    layer: 4,
    item: "frontend_intelligence",
    name: "Frontend Intelligence",
    description: "Frameworks, build clues, resources, third-party scripts, robots, sitemap, and AI-ready evidence.",
    requiredProviderTypes: ["remote_fetch", "browser_runtime", "ai_classifier", "manual_import"],
    nextStep: "Run remote_fetch for static Layer 4 records; use browser_runtime and ai_classifier to enrich evidence later.",
  }),
  createProviderProbe({
    id: "performance_probe",
    layer: 5,
    item: "performance",
    name: "Performance",
    description: "Worker TTFB baseline, page weight estimate, Lighthouse, Core Web Vitals, and resource pressure.",
    requiredProviderTypes: ["remote_fetch", "performance", "browser_runtime"],
    nextStep: "Run remote_fetch basic performance first; add Lighthouse/PageSpeed/WebPageTest or browser_runtime metrics for lab and field-style performance data.",
  }),
  createProviderProbe({
    id: "api_surface_probe",
    layer: 6,
    item: "api_surface",
    name: "API Surface",
    description: "Public endpoints, CORS behavior, fetch/XHR paths, errors, and protocol clues.",
    requiredProviderTypes: ["remote_fetch", "browser_runtime"],
    nextStep: "Run remote_fetch for static API hints; use browser_runtime later for XHR/fetch observation.",
  }),
  createProviderProbe({
    id: "subdomain_attack_surface_probe",
    layer: 7,
    item: "subdomain_attack_surface",
    name: "Subdomain Attack Surface",
    description: "CT-discovered subdomains, reachable services, staging tools, and exposed applications.",
    requiredProviderTypes: ["dns_tls"],
    nextStep: "Run dns_tls subdomain attack surface checks; keep reachability limits small to avoid scan expansion.",
  }),
  createProviderProbe({
    id: "application_fingerprint_probe",
    layer: 8,
    item: "application_fingerprint",
    name: "Application Fingerprint",
    description: "CMS, docs, forum, analytics, support, framework, and app-product signatures.",
    requiredProviderTypes: ["remote_fetch", "browser_runtime", "manual_import"],
    nextStep: "Run remote_fetch app_fingerprint_probe; later enrich it with imported/browser runtime records.",
  }),
  createProviderProbe({
    id: "organization_intelligence_probe",
    layer: 9,
    item: "organization_intelligence",
    name: "Organization Intelligence",
    description: "RDAP / WHOIS-lite, MX, social links, related domains, Wayback, and operating entity clues.",
    requiredProviderTypes: ["dns_tls", "manual_import"],
    nextStep: "Connect dns_tls organization intelligence for RDAP, MX, and social links; add Wayback, related-domain, or manual evidence later.",
  }),
  createProviderProbe({
    id: "rdap_whois_lite_probe",
    layer: 9,
    item: "rdap_whois_lite",
    name: "RDAP / WHOIS-lite",
    description: "Registrar, registration events, domain statuses, nameservers, and RDAP source evidence.",
    requiredProviderTypes: ["dns_tls"],
    nextStep: "Run the dns_tls organization intelligence provider; treat RDAP as registration evidence, not operating entity ownership proof.",
  }),
  createProviderProbe({
    id: "wayback_history_probe",
    layer: 9,
    item: "wayback_history",
    name: "Wayback History",
    description: "Internet Archive snapshot count estimate, first/last snapshots, sample URLs, and lookup status.",
    requiredProviderTypes: ["dns_tls"],
    nextStep: "Run the dns_tls organization intelligence provider; treat archive presence as historical evidence, not current operation or ownership proof.",
  }),
  createProviderProbe({
    id: "security_posture_probe",
    layer: 10,
    item: "security_posture",
    name: "Security Posture",
    description: "Security headers, cookie flags, mixed content, iframe risk, and leakage signals.",
    requiredProviderTypes: ["remote_fetch", "browser_runtime"],
    nextStep: "Connect remote_fetch and migrate security_headers_probe; use browser runtime for mixed content.",
  }),
];

export function runLayerProbeRegistry(context: LayerProbeContext): SnapshotRecord[] {
  return LAYER_PROBES.flatMap((probe) => probe.run(context));
}

function createProviderProbe(input: {
  id: string;
  layer: number;
  item: string;
  name: string;
  description: string;
  requiredProviderTypes: ProviderType[];
  nextStep: string;
}): LayerProbeDefinition {
  return {
    id: input.id,
    layer: input.layer,
    item: input.item,
    name: input.name,
    description: input.description,
    requiredProviderTypes: input.requiredProviderTypes,
    implementationStatus: "provider_contract",
    run(context) {
      const coverageState = resolveProviderCoverage(context, input.requiredProviderTypes);
      const providerList = input.requiredProviderTypes.join(", ");
      const summary =
        coverageState === "provider_configured"
          ? `${input.name} logic is registered. Run a matching provider action to collect this layer.`
          : `${input.name} requires one of these provider types: ${providerList}.`;

      return [
        createProbeContractRecord({
          context,
          probe: this,
          coverageState,
          summary,
          nextStep: input.nextStep,
        }),
      ];
    },
  };
}

import type { LayerDefinition } from "./types";

export const LAYERS: LayerDefinition[] = [
  {
    layer: 1,
    name: "Network",
    focus: "DNS, IP, ASN, CDN, IPv6, protocol reachability",
    preferredProviders: ["dns_tls", "remote_fetch"],
  },
  {
    layer: 2,
    name: "TLS",
    focus: "Certificates, SAN, CT logs, HSTS posture",
    preferredProviders: ["dns_tls", "remote_fetch"],
  },
  {
    layer: 3,
    name: "HTTP",
    focus: "Status, redirects, headers, cache policy, access barriers",
    preferredProviders: ["remote_fetch"],
  },
  {
    layer: 4,
    name: "Frontend",
    focus: "Frameworks, build clues, resources, third-party scripts, robots, sitemap",
    preferredProviders: ["remote_fetch", "browser_runtime", "ai_classifier", "manual_import"],
  },
  {
    layer: 5,
    name: "Performance",
    focus: "Lighthouse, Core Web Vitals, page weight, timing",
    preferredProviders: ["remote_fetch", "performance", "browser_runtime"],
  },
  {
    layer: 6,
    name: "API",
    focus: "Public endpoints, CORS, error surfaces, protocol clues",
    preferredProviders: ["remote_fetch", "browser_runtime"],
  },
  {
    layer: 7,
    name: "Subdomains",
    focus: "CT subdomains, exposed tools, dev and staging surfaces",
    preferredProviders: ["dns_tls"],
  },
  {
    layer: 8,
    name: "Fingerprint",
    focus: "CMS, docs, forum, analytics, support and app signatures",
    preferredProviders: ["remote_fetch", "browser_runtime", "manual_import"],
  },
  {
    layer: 9,
    name: "Organization",
    focus: "WHOIS, ICP, MX, social, related domains, Wayback clues",
    preferredProviders: ["dns_tls", "manual_import"],
  },
  {
    layer: 10,
    name: "Security",
    focus: "Security headers, cookies, mixed content, leakage signals",
    preferredProviders: ["remote_fetch", "browser_runtime"],
  },
];

export function getLayerDefinition(layer: number): LayerDefinition {
  return LAYERS.find((item) => item.layer === layer) ?? {
    layer,
    name: `Layer ${layer}`,
    focus: "Unmapped layer",
    preferredProviders: [],
  };
}

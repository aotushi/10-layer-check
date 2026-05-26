import {
  performanceBasicProbe,
  type BasicPerformanceResult,
} from "../probes/performance-basic";
import {
  apiReachabilityProbe,
} from "../probes/api-reachability";
import type { ApiReachabilityResult } from "../../src/providers/api-reachability/types";
import {
  remoteFetch,
  type RemoteFetchResult,
} from "../probes/remote-fetch";
import {
  dnsInfrastructureProbe,
  type DnsInfrastructureResult,
} from "../probes/dns-infrastructure";
import {
  tlsCertificateProbe,
  type TlsCertificateResult,
} from "../probes/tls-certificate";
import {
  subdomainAttackSurfaceProbe,
  type SubdomainAttackSurfaceResult,
} from "../probes/subdomain-attack-surface";
import {
  serviceFingerprintProbe,
  type ServiceFingerprintResult,
} from "../probes/service-fingerprint";
import {
  publicHostFingerprintProbe,
  type PublicHostFingerprintResult,
} from "../probes/public-host-fingerprint";
import {
  publicSecurityDetailsProbe,
} from "../probes/public-security-details";
import type { PublicSecurityDetailsResult } from "../../src/providers/public-security-details/types";
import {
  publicContentSurfaceProbe,
} from "../probes/public-content-surface";
import type { PublicContentSurfaceResult } from "../../src/providers/public-content-surface/types";
import {
  publicContentDetailProbe,
} from "../probes/public-content-detail";
import type { PublicContentDetailResult } from "../../src/providers/public-content-detail/types";
import {
  publicSpaMetadataProbe,
} from "../probes/public-spa-metadata";
import type { PublicSpaMetadataResult } from "../../src/providers/public-spa-metadata/types";
import {
  organizationIntelligenceProbe,
  type OrganizationIntelligenceResult,
} from "../probes/organization-intelligence";
import type { SiteScanSyncProbe } from "../services/scan-orchestrator";
import { parseMaxRedirects } from "../http/request";
import { jsonResponse } from "../http/response";

export type WorkerProbeResult =
  | RemoteFetchResult
  | DnsInfrastructureResult
  | TlsCertificateResult
  | SubdomainAttackSurfaceResult
  | ServiceFingerprintResult
  | PublicHostFingerprintResult
  | PublicSecurityDetailsResult
  | PublicContentSurfaceResult
  | PublicContentDetailResult
  | PublicSpaMetadataResult
  | OrganizationIntelligenceResult
  | ApiReachabilityResult
  | BasicPerformanceResult;

export async function handleProbeRoute(pathname: string, target: string, body: Record<string, unknown>): Promise<Response | null> {
  const result = await executeProbeRoute(pathname, target, body);
  return result === null ? null : jsonResponse(result);
}

export async function executeSiteScanSyncProbe(
  probe: SiteScanSyncProbe,
  target: string,
  maxRedirects: number,
  options?: Record<string, unknown>,
): Promise<unknown> {
  if (probe === "dns_infrastructure") return dnsInfrastructureProbe(target);
  if (probe === "tls_certificate") return tlsCertificateProbe(target);
  if (probe === "subdomain_attack_surface") return subdomainAttackSurfaceProbe(target);
  if (probe === "service_fingerprint") return serviceFingerprintProbe(target);
  if (probe === "public_host_fingerprint") return publicHostFingerprintProbe(target);
  if (probe === "public_security_details") return publicSecurityDetailsProbe(target, options ?? {});
  if (probe === "public_content_surface") return publicContentSurfaceProbe(target);
  if (probe === "public_content_detail") return publicContentDetailProbe(target);
  if (probe === "public_spa_metadata") return publicSpaMetadataProbe(target);
  if (probe === "organization_intelligence") return organizationIntelligenceProbe(target);
  if (probe === "api_reachability") return apiReachabilityProbe(target, options ?? {});
  if (probe === "performance_basic") return performanceBasicProbe(target);
  return remoteFetch(target, maxRedirects);
}

async function executeProbeRoute(
  pathname: string,
  target: string,
  body: Record<string, unknown>,
): Promise<WorkerProbeResult | null> {
  if (pathname === "/probe/dns-infrastructure") return dnsInfrastructureProbe(target);
  if (pathname === "/probe/tls-certificate") return tlsCertificateProbe(target);
  if (pathname === "/probe/subdomain-attack-surface") return subdomainAttackSurfaceProbe(target);
  if (pathname === "/probe/service-fingerprint") {
    return serviceFingerprintProbe(target, { hosts: body.hosts, maxHosts: body.max_hosts });
  }
  if (pathname === "/probe/public-host-fingerprint") {
    return publicHostFingerprintProbe(target, { hosts: body.hosts, maxHosts: body.max_hosts });
  }
  if (pathname === "/probe/public-security-details") {
    return publicSecurityDetailsProbe(target, { maxHosts: body.max_hosts });
  }
  if (pathname === "/probe/public-content-surface") {
    return publicContentSurfaceProbe(target, { maxPages: body.max_pages, maxCandidateUrls: body.max_candidate_urls });
  }
  if (pathname === "/probe/public-content-detail") {
    return publicContentDetailProbe(target, {
      maxSeedPages: body.max_seed_pages,
      maxCandidateUrls: body.max_candidate_urls,
      maxDetailPages: body.max_detail_pages,
    });
  }
  if (pathname === "/probe/public-spa-metadata") {
    return publicSpaMetadataProbe(target, { maxAssetPreviews: body.max_asset_previews });
  }
  if (pathname === "/probe/organization-intelligence") return organizationIntelligenceProbe(target);
  if (pathname === "/probe/api-reachability") {
    return apiReachabilityProbe(target, { maxCandidates: body.max_candidates, candidates: body.candidates });
  }
  if (pathname === "/probe/performance-basic") return performanceBasicProbe(target);
  if (pathname !== "/probe/remote-fetch") return null;

  return remoteFetch(target, parseMaxRedirects(body.max_redirects));
}

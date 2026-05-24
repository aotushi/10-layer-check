import { runLayerProbeRegistry } from "../probes/registry";
import { createCdnHeaderEvidenceRecord, createNetworkLayerRecords } from "../probes/layer-01-network";
import { createTlsLayerRecords } from "../probes/layer-02-tls";
import { createHttpLayerRecords } from "../probes/layer-03-http";
import { createBrowserRuntimeDerivedRecords } from "../probes/layer-04-browser-runtime";
import { createFrontendLayerRecords } from "../probes/layer-04-frontend";
import { createBasicPerformanceLayerRecords, createPerformanceLayerRecords } from "../probes/layer-05-performance";
import { createApiLayerRecords } from "../probes/layer-06-api";
import { createSubdomainLayerRecords } from "../probes/layer-07-subdomains";
import { createAppFingerprintRecords } from "../probes/layer-08-app-fingerprint";
import { createOrganizationLayerRecords } from "../probes/layer-09-organization";
import { createSecurityHeaderRecords } from "../probes/layer-10-security";
import { createAiClassifierRecords } from "../providers/ai-classifier/records";
import type { WorkerAiClassifierResponse } from "../providers/ai-classifier/worker-adapter";
import type {
  DnsInfrastructureResult,
  OrganizationIntelligenceResult,
  SubdomainAttackSurfaceResult,
  TlsCertificateResult,
} from "../providers/dns-tls/types";
import type { BasicPerformanceResult, PerformanceProviderResult } from "../providers/performance/types";
import { createDemoRemoteFetchResult } from "../providers/remote-fetch/demo";
import type { RemoteFetchResult } from "../providers/remote-fetch/types";
import { LAYERS } from "./layers";
import type { AppState, ProviderConfig, Run, SnapshotRecord, SnapshotStatus, TargetDraft } from "./types";

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "manual-import",
    type: "manual_import",
    displayName: "Manual Snapshot Import",
    endpoint: "local-file",
    authMode: "none",
    secretRef: "",
    enabled: true,
    capabilityTags: ["snapshot_json", "actions_artifact"],
  },
  {
    id: "github-actions-browser",
    type: "browser_runtime",
    displayName: "Local Worker Browser Runtime Provider",
    endpoint: "http://127.0.0.1:8787/provider/github/browser-runtime/start",
    authMode: "none",
    secretRef: "",
    enabled: true,
    capabilityTags: ["browser_runtime", "screenshot", "resource_observe"],
  },
  {
    id: "worker-fetch",
    type: "remote_fetch",
    displayName: "Local Worker Fetch Provider",
    endpoint: "http://127.0.0.1:8787/probe/remote-fetch",
    authMode: "none",
    secretRef: "",
    enabled: true,
    capabilityTags: ["fetch", "headers", "html", "frontend_evidence", "robots", "security_headers", "performance_baseline"],
  },
  {
    id: "worker-dns",
    type: "dns_tls",
    displayName: "Local Worker DNS/TLS Provider",
    endpoint: "http://127.0.0.1:8787/probe/dns-infrastructure",
    authMode: "none",
    secretRef: "",
    enabled: true,
    capabilityTags: ["dns", "doh", "ipv4", "ipv6", "cdn_hint", "protocol_reachability", "hsts", "ct_log", "subdomains", "org_dns"],
  },
  {
    id: "remote-worker-dns",
    type: "dns_tls",
    displayName: "Remote Worker DNS/TLS Provider",
    endpoint: "https://probe.9shi.cc/probe/dns-infrastructure",
    authMode: "api_key",
    secretRef: "",
    enabled: false,
    capabilityTags: ["dns", "doh", "ipv4", "ipv6", "cdn_hint", "protocol_reachability", "hsts", "ct_log", "subdomains", "org_dns"],
  },
  {
    id: "remote-worker-fetch",
    type: "remote_fetch",
    displayName: "Remote Worker Fetch Provider",
    endpoint: "https://probe.9shi.cc/probe/remote-fetch",
    authMode: "api_key",
    secretRef: "",
    enabled: false,
    capabilityTags: ["fetch", "headers", "html", "frontend_evidence", "robots", "security_headers", "performance_baseline"],
  },
  {
    id: "ai-classifier",
    type: "ai_classifier",
    displayName: "Local Worker AI Classifier Provider",
    endpoint: "http://127.0.0.1:8787/provider/ai/classifier",
    authMode: "api_key",
    secretRef: "",
    enabled: false,
    capabilityTags: ["technology_classification", "evidence_reasoning"],
  },
  {
    id: "pagespeed",
    type: "performance",
    displayName: "PageSpeed Provider",
    endpoint: "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
    authMode: "api_key",
    secretRef: "local:pagespeed-key",
    enabled: false,
    capabilityTags: ["lighthouse", "core_web_vitals"],
  },
];

export function createInitialState(): AppState {
  const draft = createTargetDraft("https://example.com");
  const run = createDraftRun(draft.url, DEFAULT_PROVIDERS);

  return {
    providers: DEFAULT_PROVIDERS,
    targets: [draft],
    runs: [run],
    activeRunId: run.id,
  };
}

export function createTargetDraft(url: string): TargetDraft {
  return {
    id: createId("target"),
    url,
    createdAt: new Date().toISOString(),
  };
}

export function createDraftRun(url: string, providers: ProviderConfig[]): Run {
  const normalizedTarget = normalizeTargetLabel(url);
  const records = runLayerProbeRegistry({
    target: url,
    normalizedTarget,
    snapshotAt: new Date().toISOString(),
    providers,
  });

  return {
    id: createId("run"),
    target: url,
    normalizedTarget,
    createdAt: new Date().toISOString(),
    source: "draft",
    records,
  };
}

export function createDemoRemoteFetchRun(url: string, providers: ProviderConfig[]): Run {
  return createRemoteFetchRun(url, providers, createDemoRemoteFetchResult(url), "provider");
}

export function createRemoteFetchRun(
  url: string,
  providers: ProviderConfig[],
  fetchResult: RemoteFetchResult,
  source: Run["source"] = "provider",
): Run {
  const normalizedTarget = normalizeTargetLabel(url);
  const snapshotAt = new Date().toISOString();
  const context = {
    target: url,
    normalizedTarget,
    snapshotAt,
    providers,
  };
  const contractRecords = runLayerProbeRegistry(context).filter(
    (record) =>
      record.layer !== 1 &&
      record.layer !== 3 &&
      record.layer !== 4 &&
      record.layer !== 6 &&
      record.layer !== 8 &&
      record.layer !== 10,
  );
  const cdnHeaderRecord = createCdnHeaderEvidenceRecord(context, [
    {
      url: fetchResult.final_url,
      scope: "main_response",
      headers: fetchResult.headers,
      source: fetchResult.source,
    },
  ]);
  const records = [
    ...(cdnHeaderRecord ? [cdnHeaderRecord] : []),
    ...createHttpLayerRecords(context, fetchResult),
    ...createFrontendLayerRecords(context, fetchResult),
    ...createApiLayerRecords(context, fetchResult),
    ...createAppFingerprintRecords(context, fetchResult),
    ...createSecurityHeaderRecords(context, fetchResult),
    ...contractRecords,
  ].sort((a, b) => a.layer - b.layer || a.probe.localeCompare(b.probe));

  return {
    id: createId("run"),
    target: url,
    normalizedTarget,
    createdAt: snapshotAt,
    source,
    records,
  };
}

export function createDnsInfrastructureRun(
  url: string,
  providers: ProviderConfig[],
  dnsResult: DnsInfrastructureResult,
  source: Run["source"] = "provider",
): Run {
  const normalizedTarget = normalizeTargetLabel(url);
  const snapshotAt = new Date().toISOString();
  const context = {
    target: url,
    normalizedTarget,
    snapshotAt,
    providers,
  };
  const contractRecords = runLayerProbeRegistry(context).filter((record) => record.layer !== 1);
  const records = [...createNetworkLayerRecords(context, dnsResult), ...contractRecords].sort(
    (a, b) => a.layer - b.layer || a.probe.localeCompare(b.probe),
  );

  return {
    id: createId("run"),
    target: url,
    normalizedTarget,
    createdAt: snapshotAt,
    source,
    records,
  };
}

export function createTlsCertificateRun(
  url: string,
  providers: ProviderConfig[],
  tlsResult: TlsCertificateResult,
  source: Run["source"] = "provider",
): Run {
  const normalizedTarget = normalizeTargetLabel(url);
  const snapshotAt = new Date().toISOString();
  const context = {
    target: url,
    normalizedTarget,
    snapshotAt,
    providers,
  };
  const contractRecords = runLayerProbeRegistry(context).filter((record) => record.layer !== 2);
  const records = [...createTlsLayerRecords(context, tlsResult), ...contractRecords].sort(
    (a, b) => a.layer - b.layer || a.probe.localeCompare(b.probe),
  );

  return {
    id: createId("run"),
    target: url,
    normalizedTarget,
    createdAt: snapshotAt,
    source,
    records,
  };
}

export function createPerformanceRun(
  url: string,
  providers: ProviderConfig[],
  performanceResult: PerformanceProviderResult,
  source: Run["source"] = "provider",
): Run {
  const normalizedTarget = normalizeTargetLabel(url);
  const snapshotAt = new Date().toISOString();
  const context = {
    target: url,
    normalizedTarget,
    snapshotAt,
    providers,
  };
  const contractRecords = runLayerProbeRegistry(context).filter((record) => record.layer !== 5);
  const records = [...createPerformanceLayerRecords(context, performanceResult), ...contractRecords].sort(
    (a, b) => a.layer - b.layer || a.probe.localeCompare(b.probe),
  );

  return {
    id: createId("run"),
    target: url,
    normalizedTarget,
    createdAt: snapshotAt,
    source,
    records,
  };
}

export function createBasicPerformanceRun(
  url: string,
  providers: ProviderConfig[],
  performanceResult: BasicPerformanceResult,
  source: Run["source"] = "provider",
): Run {
  const normalizedTarget = normalizeTargetLabel(url);
  const snapshotAt = new Date().toISOString();
  const context = {
    target: url,
    normalizedTarget,
    snapshotAt,
    providers,
  };
  const contractRecords = runLayerProbeRegistry(context).filter((record) => record.layer !== 5);
  const records = [...createBasicPerformanceLayerRecords(context, performanceResult), ...contractRecords].sort(
    (a, b) => a.layer - b.layer || a.probe.localeCompare(b.probe),
  );

  return {
    id: createId("run"),
    target: url,
    normalizedTarget,
    createdAt: snapshotAt,
    source,
    records,
  };
}

export function createSubdomainAttackSurfaceRun(
  url: string,
  providers: ProviderConfig[],
  subdomainResult: SubdomainAttackSurfaceResult,
  source: Run["source"] = "provider",
): Run {
  const normalizedTarget = normalizeTargetLabel(url);
  const snapshotAt = new Date().toISOString();
  const context = {
    target: url,
    normalizedTarget,
    snapshotAt,
    providers,
  };
  const contractRecords = runLayerProbeRegistry(context).filter((record) => record.layer !== 7);
  const records = [...createSubdomainLayerRecords(context, subdomainResult), ...contractRecords].sort(
    (a, b) => a.layer - b.layer || a.probe.localeCompare(b.probe),
  );

  return {
    id: createId("run"),
    target: url,
    normalizedTarget,
    createdAt: snapshotAt,
    source,
    records,
  };
}

export function createOrganizationIntelligenceRun(
  url: string,
  providers: ProviderConfig[],
  organizationResult: OrganizationIntelligenceResult,
  source: Run["source"] = "provider",
): Run {
  const normalizedTarget = normalizeTargetLabel(url);
  const snapshotAt = new Date().toISOString();
  const context = {
    target: url,
    normalizedTarget,
    snapshotAt,
    providers,
  };
  const contractRecords = runLayerProbeRegistry(context).filter((record) => record.layer !== 9);
  const records = [...createOrganizationLayerRecords(context, organizationResult), ...contractRecords].sort(
    (a, b) => a.layer - b.layer || a.probe.localeCompare(b.probe),
  );

  return {
    id: createId("run"),
    target: url,
    normalizedTarget,
    createdAt: snapshotAt,
    source,
    records,
  };
}

export function createAiClassifierRun(
  url: string,
  providers: ProviderConfig[],
  aiClassifierResult: WorkerAiClassifierResponse,
  source: Run["source"] = "provider",
): Run {
  const normalizedTarget = normalizeTargetLabel(url);
  const snapshotAt = new Date().toISOString();
  const context = {
    target: url,
    normalizedTarget,
    snapshotAt,
    providers,
  };
  const records = createAiClassifierRecords(context, aiClassifierResult).sort(
    (a, b) => a.layer - b.layer || a.probe.localeCompare(b.probe),
  );

  return {
    id: createId("run"),
    target: url,
    normalizedTarget,
    createdAt: snapshotAt,
    source,
    records,
  };
}

export function createImportedRun(records: SnapshotRecord[]): Run {
  const first = records[0];

  if (!first) {
    throw new Error("Snapshot import did not contain any records.");
  }

  const derivedRecords = createBrowserRuntimeDerivedRecords(records);
  const importedRecords = [...records, ...derivedRecords].sort((a, b) => a.layer - b.layer || a.probe.localeCompare(b.probe));

  return {
    id: createId("run"),
    target: first.target,
    normalizedTarget: first.normalized_target,
    createdAt: new Date().toISOString(),
    source: "import",
    records: importedRecords,
  };
}

export function mergeProviderRun(baseRun: Run, providerRun: Run): Run {
  const incomingRecords = providerRun.records.filter((record) => !isProviderContractRecord(record));
  const incomingLayers = new Set(incomingRecords.map((record) => record.layer));
  const incomingKeys = new Set(incomingRecords.map(createRecordMergeKey));
  const baseRecords = baseRun.records.filter((record) => {
    if (isProviderContractRecord(record) && incomingLayers.has(record.layer)) return false;
    return !incomingKeys.has(createRecordMergeKey(record));
  });
  const records = [...baseRecords, ...incomingRecords].sort((a, b) => a.layer - b.layer || a.probe.localeCompare(b.probe));

  return {
    ...baseRun,
    id: createId("run"),
    createdAt: providerRun.createdAt,
    source: "provider",
    records,
  };
}

function createRecordMergeKey(record: SnapshotRecord): string {
  return `${record.layer}:${record.probe}:${record.item}`;
}

export function summarizeRun(run: Run) {
  const counts: Record<SnapshotStatus, number> = {
    ok: 0,
    warning: 0,
    error: 0,
    skipped: 0,
  };

  for (const record of run.records) {
    counts[record.status] += 1;
  }

  const coveredLayers = new Set(run.records.filter(isCollectedRecord).map((record) => record.layer));
  const providerReadyLayers = new Set(
    run.records.filter((record) => getCoverageState(record) === "provider_configured").map((record) => record.layer),
  );

  return {
    counts,
    coveredLayerCount: coveredLayers.size,
    providerReadyLayerCount: providerReadyLayers.size,
    totalLayerCount: LAYERS.length,
    recordCount: run.records.length,
  };
}

export function normalizeImportedRecords(value: unknown): SnapshotRecord[] {
  const records = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.records) ? value.records : null;

  if (!records) {
    throw new Error("Import must be a SnapshotRecord array or an object with records.");
  }

  return records.map((record, index) => normalizeRecord(record, index));
}

function normalizeRecord(record: unknown, index: number): SnapshotRecord {
  if (!isRecord(record)) {
    throw new Error(`Record ${index} is not an object.`);
  }

  const required = ["target", "normalized_target", "snapshot_at", "probe", "layer", "item", "status", "risk"];
  for (const key of required) {
    if (!(key in record)) {
      throw new Error(`Record ${index} is missing ${key}.`);
    }
  }

  return record as SnapshotRecord;
}

function normalizeTargetLabel(value: string): string {
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return value.trim().toLowerCase() || "target";
  }
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCollectedRecord(record: SnapshotRecord): boolean {
  const coverageState = getCoverageState(record);
  if (coverageState === "provider_configured" || coverageState === "provider_required" || coverageState === "planned") {
    return false;
  }

  return record.status !== "skipped";
}

function isProviderContractRecord(record: SnapshotRecord): boolean {
  const coverageState = getCoverageState(record);
  return coverageState === "provider_configured" || coverageState === "provider_required" || coverageState === "planned";
}

function getCoverageState(record: SnapshotRecord): string | null {
  if (!isRecord(record.value)) return null;
  const value = record.value as Record<string, unknown>;
  return typeof value.coverage_state === "string" ? value.coverage_state : null;
}

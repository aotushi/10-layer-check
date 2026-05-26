import type { ProviderConfig, Run, SnapshotRecord } from "../core/types";
import { normalizeSiteScanProviderResults } from "../providers/results/normalize";
import type { AnalysisReport } from "./analysis";
import { createAnalysisReport } from "./analysis";
import type { ReportBrief } from "./brief";
import { createReportBrief } from "./brief";
import { renderAnalysisMarkdown, renderNarrativeMarkdown } from "./markdown";
import { createDefaultScanPolicy, type ScanPolicy } from "../scan/policy";
import { type ProbeStrategy } from "../scan/probe-strategy";

export type ScanExportArtifactInput = {
  id: string;
  target: string;
  normalizedTarget?: string;
  createdAt?: string;
  generatedAt?: string;
  source?: Run["source"];
  providers?: ProviderConfig[];
  scanStartEnvelope: unknown;
  asyncResultEnvelopes?: Record<string, unknown>;
  scanPolicy?: ScanPolicy;
};

export type ScanExportArtifact = {
  schema_version: "site-10-layer-scan-export-artifact/v0.1";
  generated_at: string;
  run: {
    id: string;
    target: string;
    normalized_target: string;
    created_at: string;
    source: Run["source"];
    record_count: number;
  };
  scan_policy: ScanPolicy;
  boundaries: {
    invokes_ai_provider: false;
    storage_persisted: false;
    frontend_state_mutated: false;
  };
  raw_inputs: {
    scan_start_envelope: unknown;
    async_result_envelopes: Record<string, unknown>;
  };
  records: SnapshotRecord[];
  analysis: AnalysisReport;
  brief: ReportBrief;
  markdown: {
    analysis: string;
    narrative: string;
  };
  probe_strategy?: ProbeStrategy;
};

export function createScanExportArtifact(input: ScanExportArtifactInput): ScanExportArtifact {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const normalizedTarget = input.normalizedTarget ?? normalizeTargetLabel(input.target);
  const asyncResultEnvelopes = input.asyncResultEnvelopes ?? {};
  const embeddedScanPolicy = readScanPolicy(input.scanStartEnvelope);
  const scanPolicy =
    input.scanPolicy ??
    embeddedScanPolicy ??
    createDefaultScanPolicy({
      target: input.target,
      normalizedTarget,
      requestedSyncProbes: readStringArray(input.scanStartEnvelope, "sync_probes"),
      requestedAsyncProviders: readStringArray(input.scanStartEnvelope, "async_providers"),
      createdAt,
    });
  const records = normalizeSiteScanProviderResults({
    target: input.target,
    normalizedTarget,
    snapshotAt: createdAt,
    providers: input.providers ?? [],
    scanStartEnvelope: input.scanStartEnvelope,
    asyncResultEnvelopes,
  });
  const run: Run = {
    id: input.id,
    target: input.target,
    normalizedTarget,
    createdAt,
    source: input.source ?? "provider",
    records,
  };
  const analysis = createAnalysisReport(run);
  const probe_strategy = readProbeStrategyFromEnvelope(input.scanStartEnvelope);
  const brief = createReportBrief(run, analysis, probe_strategy);

  return {
    schema_version: "site-10-layer-scan-export-artifact/v0.1",
    generated_at: generatedAt,
    run: {
      id: run.id,
      target: run.target,
      normalized_target: run.normalizedTarget,
      created_at: run.createdAt,
      source: run.source,
      record_count: records.length,
    },
    scan_policy: scanPolicy,
    boundaries: {
      invokes_ai_provider: false,
      storage_persisted: false,
      frontend_state_mutated: false,
    },
    raw_inputs: {
      scan_start_envelope: input.scanStartEnvelope,
      async_result_envelopes: asyncResultEnvelopes,
    },
    records,
    analysis,
    brief,
    markdown: {
      analysis: renderAnalysisMarkdown(analysis),
      narrative: renderNarrativeMarkdown(brief),
    },
    probe_strategy,
  };
}

function normalizeTargetLabel(value: string): string {
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return value.trim().toLowerCase() || "target";
  }
}

function readStringArray(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const entry = (value as Record<string, unknown>)[key];
  return Array.isArray(entry) ? entry.filter((item): item is string => typeof item === "string") : [];
}

function readProbeStrategyFromEnvelope(scanStartEnvelope: unknown): ProbeStrategy | undefined {
  const envelope = typeof scanStartEnvelope === "object" && scanStartEnvelope !== null
    ? (scanStartEnvelope as Record<string, unknown>)
    : null;
  if (!envelope) return undefined;
  const ps = envelope["probe_strategy"];
  if (!ps || typeof ps !== "object" || Array.isArray(ps)) return undefined;
  const record = ps as Record<string, unknown>;
  if (record["schema_version"] !== "site-10-layer-probe-strategy/v0.1") return undefined;
  return ps as ProbeStrategy;
}

function readScanPolicy(value: unknown): ScanPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const scanPolicy = (value as Record<string, unknown>).scan_policy;
  if (!scanPolicy || typeof scanPolicy !== "object" || Array.isArray(scanPolicy)) return null;
  return (scanPolicy as Record<string, unknown>).schema_version === "site-10-layer-scan-policy/v0.1"
    ? (scanPolicy as ScanPolicy)
    : null;
}

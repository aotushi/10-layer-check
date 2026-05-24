export type ProviderType =
  | "remote_fetch"
  | "browser_runtime"
  | "performance"
  | "dns_tls"
  | "manual_import"
  | "ai_classifier";

export type AuthMode = "none" | "api_key" | "bearer" | "custom_header";

export type SnapshotStatus = "ok" | "warning" | "error" | "skipped";

export type RiskLevel = "info" | "low" | "medium" | "high";

export type ProviderConfig = {
  id: string;
  type: ProviderType;
  displayName: string;
  endpoint: string;
  authMode: AuthMode;
  secretRef: string;
  enabled: boolean;
  capabilityTags: string[];
};

export type Evidence = {
  type: string;
  name?: string;
  value: unknown;
};

export type EvidenceConfidence = "confirmed" | "likely" | "possible" | "high" | "medium" | "low" | "none" | "unknown";

export type EvidenceConclusion = "confirmed" | "likely" | "possible" | "not_detected" | "not_collected" | "unknown";

export type EvidenceSignal = {
  type: string;
  name?: string;
  value: unknown;
  source?: string;
  evidence_refs?: string[];
};

export type EvidenceAssessment = {
  label: string;
  conclusion: EvidenceConclusion;
  confidence: EvidenceConfidence;
  signals: EvidenceSignal[];
  limitations: string[];
};

export type EvidenceOrigin =
  | "direct_observation"
  | "external_provider"
  | "static_heuristic"
  | "runtime_observation"
  | "user_supplied";

export type EvidenceRole = "raw" | "derived";

export type EvidenceMethod =
  | "fetch"
  | "doh"
  | "browser_runtime"
  | "static_parse"
  | "external_api"
  | "tls_socket"
  | "manual_import"
  | "provider_contract";

export type EvidenceMetadata = {
  origin: EvidenceOrigin;
  role: EvidenceRole;
  method: EvidenceMethod;
  limitations?: string[];
};

export type SnapshotRecord<TValue = unknown> = {
  target: string;
  normalized_target: string;
  snapshot_at: string;
  probe: string;
  layer: number;
  item: string;
  probe_type: string;
  source: string;
  status: SnapshotStatus;
  value: TValue;
  risk: {
    level: RiskLevel;
    summary: string;
  };
  evidence: Evidence[];
  evidence_metadata?: EvidenceMetadata;
  request?: {
    profile: string;
    headers: Record<string, string>;
  };
  browser?: {
    provider: string;
    headed: boolean;
    wait_ms: number;
    timeout_ms: number;
  };
  duration_ms?: number;
  error?: string;
};

export type Run = {
  id: string;
  target: string;
  normalizedTarget: string;
  createdAt: string;
  source: "draft" | "import" | "provider";
  records: SnapshotRecord[];
};

export type TargetDraft = {
  id: string;
  url: string;
  createdAt: string;
};

export type LayerDefinition = {
  layer: number;
  name: string;
  focus: string;
  preferredProviders: ProviderType[];
};

export type AppState = {
  providers: ProviderConfig[];
  targets: TargetDraft[];
  runs: Run[];
  activeRunId: string | null;
};

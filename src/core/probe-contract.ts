import type { ProviderConfig, ProviderType, SnapshotRecord } from "./types";

export type LayerProbeImplementationStatus = "implemented" | "provider_contract" | "planned";

export type LayerProbeContext = {
  target: string;
  normalizedTarget: string;
  snapshotAt: string;
  providers: ProviderConfig[];
};

export type LayerProbeDefinition = {
  id: string;
  layer: number;
  item: string;
  name: string;
  description: string;
  requiredProviderTypes: ProviderType[];
  implementationStatus: LayerProbeImplementationStatus;
  run(context: LayerProbeContext): SnapshotRecord[];
};

export type ProviderCoverageState = "collected" | "provider_configured" | "provider_required" | "planned";

export type ProbeContractValue = {
  coverage_state: ProviderCoverageState;
  implementation_status: LayerProbeImplementationStatus;
  required_provider_types: ProviderType[];
  configured_provider_ids: string[];
  next_step: string;
};

export function createProbeContractRecord(input: {
  context: LayerProbeContext;
  probe: Pick<LayerProbeDefinition, "id" | "layer" | "item" | "requiredProviderTypes" | "implementationStatus">;
  coverageState: ProviderCoverageState;
  summary: string;
  nextStep: string;
}): SnapshotRecord<ProbeContractValue> {
  const configuredProviders = input.context.providers.filter(
    (provider) => provider.enabled && input.probe.requiredProviderTypes.includes(provider.type),
  );

  return {
    target: input.context.target,
    normalized_target: input.context.normalizedTarget,
    snapshot_at: input.context.snapshotAt,
    probe: input.probe.id,
    layer: input.probe.layer,
    item: input.probe.item,
    probe_type: "provider_contract",
    source: "web_app_probe_registry",
    status: input.coverageState === "provider_required" || input.coverageState === "planned" ? "skipped" : "warning",
    value: {
      coverage_state: input.coverageState,
      implementation_status: input.probe.implementationStatus,
      required_provider_types: input.probe.requiredProviderTypes,
      configured_provider_ids: configuredProviders.map((provider) => provider.id),
      next_step: input.nextStep,
    },
    risk: {
      level: "info",
      summary: input.summary,
    },
    evidence: configuredProviders.map((provider) => ({
      type: "provider_config",
      name: provider.id,
      value: {
        type: provider.type,
        endpoint: provider.endpoint,
        enabled: provider.enabled,
      },
    })),
    evidence_metadata: {
      origin: "direct_observation",
      role: "derived",
      method: "provider_contract",
      limitations: [
        "Provider contract records describe configured capability only.",
        "They are not collected target evidence and must not be counted as layer coverage.",
      ],
    },
  };
}

export function resolveProviderCoverage(
  context: LayerProbeContext,
  requiredProviderTypes: ProviderType[],
): Exclude<ProviderCoverageState, "collected" | "planned"> {
  const hasProvider = context.providers.some((provider) => provider.enabled && requiredProviderTypes.includes(provider.type));
  return hasProvider ? "provider_configured" : "provider_required";
}

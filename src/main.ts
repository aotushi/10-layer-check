import "./styles.css";
import { LAYERS, getLayerDefinition } from "./core/layers";
import {
  createAiClassifierRun,
  createDraftRun,
  createDnsInfrastructureRun,
  createDemoRemoteFetchRun,
  createBasicPerformanceRun,
  createRemoteFetchRun,
  createSubdomainAttackSurfaceRun,
  createTlsCertificateRun,
  createImportedRun,
  createInitialState,
  createOrganizationIntelligenceRun,
  createTargetDraft,
  mergeProviderRun,
  normalizeImportedRecords,
  summarizeRun,
} from "./core/model";
import { clearState, loadState, saveState } from "./core/storage";
import { createAiClassifierContract } from "./providers/ai-classifier/contract";
import { callWorkerAiClassifierProvider } from "./providers/ai-classifier/client";
import {
  callDnsInfrastructureProvider,
  callOrganizationIntelligenceProvider,
  callSubdomainAttackSurfaceProvider,
  callTlsCertificateProvider,
} from "./providers/dns-tls/client";
import {
  getGitHubLiveTlsResult,
  getGitHubLiveTlsStatus,
  getGitHubLighthouseResult,
  getGitHubLighthouseStatus,
  getGitHubBrowserRuntimeResult,
  getGitHubBrowserRuntimeStatus,
  startGitHubLiveTlsProvider,
  startGitHubLighthouseProvider,
  startGitHubBrowserRuntimeProvider,
} from "./providers/github-actions/client";
import { callBasicPerformanceProvider } from "./providers/performance/client";
import { callRemoteFetchProvider } from "./providers/remote-fetch/client";
import { createAnalysisReport } from "./reporters/analysis";
import { createReportBrief } from "./reporters/brief";
import { renderAnalysisMarkdown, renderNarrativeMarkdown } from "./reporters/markdown";
import type { AppState, ProviderConfig, ProviderType, Run, SnapshotRecord } from "./core/types";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root was not found.");
}

const appRoot = app;

let state: AppState = loadState(createInitialState());
let selectedProviderId = state.providers[0]?.id ?? "";
let importMessage = "";
let runMessage = "";

render();

function render(): void {
  const activeRun = getActiveRun();

  appRoot.innerHTML = `
    <div class="app-shell">
      <aside class="side-panel">
        <div class="brand-block">
          <div class="product-mark">10</div>
          <div>
            <h1>Site Layer Check</h1>
            <p>Web app shell, no-user mode</p>
          </div>
        </div>

        <section class="panel-section">
          <div class="section-heading">
            <span>Targets</span>
            <span class="count-pill">${state.targets.length}</span>
          </div>
          <form id="target-form" class="target-form">
            <input name="target" type="url" placeholder="https://example.com" required />
            <button type="submit">Add run</button>
          </form>
          <div class="target-list">
            ${state.targets.map(renderTargetItem).join("")}
          </div>
        </section>

        <section class="panel-section">
          <div class="section-heading">
            <span>Import</span>
            <span class="muted">Snapshot JSON</span>
          </div>
          <label class="file-drop">
            <input id="snapshot-import" type="file" accept="application/json,.json" />
            <span>Import CLI or Actions snapshot</span>
          </label>
          ${importMessage ? `<p class="import-message">${escapeHtml(importMessage)}</p>` : ""}
        </section>

        <section class="panel-section">
          <div class="section-heading">
            <span>History</span>
            <span class="count-pill">${state.runs.length}</span>
          </div>
          <div class="run-list">
            ${state.runs.map((run) => renderRunItem(run, run.id === state.activeRunId)).join("")}
          </div>
        </section>

        <button id="reset-state" class="link-button" type="button">Reset local shell data</button>
      </aside>

      <main class="workspace">
        <header class="workspace-header">
          <div>
            <p class="eyebrow">Shared core first</p>
            <h2>${activeRun ? escapeHtml(activeRun.normalizedTarget) : "No active run"}</h2>
          </div>
          <div class="header-actions">
            <button id="run-worker-scan" type="button" ${activeRun ? "" : "disabled"}>Run worker scan</button>
            <button id="run-live-tls" type="button" ${activeRun ? "" : "disabled"}>Run live TLS</button>
            <button id="run-lighthouse" type="button" ${activeRun ? "" : "disabled"}>Run Lighthouse</button>
            <button id="run-browser-runtime" type="button" ${activeRun ? "" : "disabled"}>Run browser runtime</button>
            <button id="run-ai-classifier" type="button" ${activeRun ? "" : "disabled"}>Run AI classifier</button>
            <button id="run-performance" type="button" ${activeRun ? "" : "disabled"}>Run performance</button>
            <button id="run-remote-fetch" type="button" ${activeRun ? "" : "disabled"}>Run remote fetch</button>
            <button id="run-dns" type="button" ${activeRun ? "" : "disabled"}>Run DNS</button>
            <button id="run-tls" type="button" ${activeRun ? "" : "disabled"}>Run TLS</button>
            <button id="run-subdomains" type="button" ${activeRun ? "" : "disabled"}>Run subdomains</button>
            <button id="run-org" type="button" ${activeRun ? "" : "disabled"}>Run org</button>
            <button id="run-demo-fetch" type="button" ${activeRun ? "" : "disabled"}>Run demo fetch</button>
            <button id="copy-run-json" type="button" ${activeRun ? "" : "disabled"}>Copy run JSON</button>
            <button id="copy-analysis-json" type="button" ${activeRun ? "" : "disabled"}>Copy analysis JSON</button>
            <button id="copy-markdown-report" type="button" ${activeRun ? "" : "disabled"}>Copy markdown report</button>
            <button id="copy-narrative-report" type="button" ${activeRun ? "" : "disabled"}>Copy narrative report</button>
          </div>
        </header>

        ${activeRun ? renderRunOverview(activeRun) : renderEmptyState()}
        ${runMessage ? `<p class="run-message">${escapeHtml(runMessage)}</p>` : ""}

        <section class="content-grid">
          <div class="main-column">
            ${activeRun ? renderLayerReport(activeRun) : ""}
          </div>
          <aside class="right-column">
            ${renderProviderPanel()}
            ${renderArchitecturePanel()}
          </aside>
        </section>
      </main>
    </div>
  `;

  bindEvents();
}

function renderTargetItem(target: { id: string; url: string }): string {
  return `
    <button class="target-item" data-create-run="${escapeAttr(target.url)}" type="button">
      <span>${escapeHtml(target.url)}</span>
      <small>Create draft</small>
    </button>
  `;
}

function renderRunItem(run: Run, active: boolean): string {
  const summary = summarizeRun(run);
  return `
    <button class="run-item ${active ? "active" : ""}" data-run-id="${run.id}" type="button">
      <span>${escapeHtml(run.normalizedTarget)}</span>
      <small>${run.source} / ${summary.coveredLayerCount} collected / ${summary.providerReadyLayerCount} ready</small>
    </button>
  `;
}

function renderRunOverview(run: Run): string {
  const summary = summarizeRun(run);
  const coverage = Math.round((summary.coveredLayerCount / summary.totalLayerCount) * 100);

  return `
    <section class="overview-band">
      <div class="metric-block">
        <span class="metric-label">Coverage</span>
        <strong>${coverage}%</strong>
        <small>${summary.coveredLayerCount} collected / ${summary.providerReadyLayerCount} provider-ready</small>
      </div>
      <div class="metric-block">
        <span class="metric-label">Records</span>
        <strong>${summary.recordCount}</strong>
        <small>${run.source}</small>
      </div>
      <div class="metric-strip">
        ${renderStatusMetric("OK", summary.counts.ok, "ok")}
        ${renderStatusMetric("Warn", summary.counts.warning, "warning")}
        ${renderStatusMetric("Error", summary.counts.error, "error")}
        ${renderStatusMetric("Skipped", summary.counts.skipped, "skipped")}
      </div>
      <div class="run-meta">
        <span>Created</span>
        <strong>${formatDate(run.createdAt)}</strong>
        <span>Target</span>
        <strong>${escapeHtml(run.target)}</strong>
      </div>
    </section>
  `;
}

function renderStatusMetric(label: string, value: number, status: string): string {
  return `
    <div class="status-metric ${status}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderLayerReport(run: Run): string {
  return `
    <section class="report-section">
      <div class="section-title-row">
        <h3>10-layer report</h3>
        <span>${run.records.length} snapshot records</span>
      </div>
      <div class="layer-map">
        ${LAYERS.map((layer) => {
          const records = run.records.filter((record) => record.layer === layer.layer);
          const status = getLayerStatus(records);
          return `<span class="layer-dot ${status}" title="Layer ${layer.layer}: ${layer.name}">${layer.layer}</span>`;
        }).join("")}
      </div>
      <div class="layer-list">
        ${LAYERS.map((layer) => renderLayerBlock(run, layer.layer)).join("")}
      </div>
    </section>
  `;
}

function renderLayerBlock(run: Run, layer: number): string {
  const definition = getLayerDefinition(layer);
  const records = run.records.filter((record) => record.layer === layer);
  const status = getLayerStatus(records);

  return `
    <article class="layer-block">
      <div class="layer-head">
        <div class="layer-number">${definition.layer}</div>
        <div>
          <h4>${definition.name}</h4>
          <p>${definition.focus}</p>
        </div>
        <span class="status-chip ${status}">${status}</span>
      </div>
      <div class="provider-row">
        ${definition.preferredProviders.map((type) => `<span>${type}</span>`).join("")}
      </div>
      <div class="record-list">
        ${records.map(renderRecord).join("")}
      </div>
    </article>
  `;
}

function renderRecord(record: SnapshotRecord): string {
  return `
    <details class="record-card" ${record.status === "ok" || record.status === "warning" ? "open" : ""}>
      <summary>
        <span>${escapeHtml(record.probe)}</span>
        <span class="record-meta">${record.status} / ${record.risk.level}</span>
      </summary>
      <p>${escapeHtml(record.risk.summary)}</p>
      <dl>
        <div><dt>Item</dt><dd>${escapeHtml(record.item)}</dd></div>
        <div><dt>Source</dt><dd>${escapeHtml(record.source)}</dd></div>
        <div><dt>Type</dt><dd>${escapeHtml(record.probe_type)}</dd></div>
        <div><dt>At</dt><dd>${formatDate(record.snapshot_at)}</dd></div>
      </dl>
      <pre>${escapeHtml(JSON.stringify(record.value, null, 2))}</pre>
    </details>
  `;
}

function renderProviderPanel(): string {
  const selected = state.providers.find((provider) => provider.id === selectedProviderId) ?? state.providers[0];

  return `
    <section class="utility-panel">
      <div class="section-title-row">
        <h3>Provider config</h3>
        <span>local only</span>
      </div>
      <div class="provider-tabs">
        ${state.providers
          .map(
            (provider) => `
              <button class="${provider.id === selected?.id ? "active" : ""}" data-provider-id="${provider.id}" type="button">
                ${provider.displayName}
              </button>
            `,
          )
          .join("")}
      </div>
      ${selected ? renderProviderForm(selected) : ""}
    </section>
  `;
}

function renderProviderForm(provider: ProviderConfig): string {
  return `
    <form id="provider-form" class="provider-form">
      <input type="hidden" name="id" value="${provider.id}" />
      <label>
        Display name
        <input name="displayName" value="${escapeAttr(provider.displayName)}" />
      </label>
      <label>
        Type
        <select name="type">
          ${renderProviderTypeOptions(provider.type)}
        </select>
      </label>
      <label>
        Endpoint
        <input name="endpoint" value="${escapeAttr(provider.endpoint)}" />
      </label>
      <label>
        Auth mode
        <select name="authMode">
          ${["none", "api_key", "bearer", "custom_header"]
            .map((mode) => `<option value="${mode}" ${mode === provider.authMode ? "selected" : ""}>${mode}</option>`)
            .join("")}
        </select>
      </label>
      <label>
        Secret reference
        <input name="secretRef" value="${escapeAttr(provider.secretRef)}" placeholder="local:provider-key" />
      </label>
      <label class="toggle-row">
        <input name="enabled" type="checkbox" ${provider.enabled ? "checked" : ""} />
        Enabled
      </label>
      <button type="submit">Save provider</button>
    </form>
  `;
}

function renderProviderTypeOptions(activeType: ProviderType): string {
  const types: ProviderType[] = [
    "remote_fetch",
    "browser_runtime",
    "performance",
    "dns_tls",
    "manual_import",
    "ai_classifier",
  ];
  return types.map((type) => `<option value="${type}" ${type === activeType ? "selected" : ""}>${type}</option>`).join("");
}

function renderArchitecturePanel(): string {
  return `
    <section class="utility-panel">
      <div class="section-title-row">
        <h3>Product split</h3>
        <span>shared core</span>
      </div>
      <div class="architecture-list">
        <div><strong>Web App</strong><span>targets, providers, history, reports</span></div>
        <div><strong>Extension</strong><span>current tab context, same snapshot model</span></div>
        <div><strong>Remote Providers</strong><span>fetch, browser runtime, DNS, performance</span></div>
      </div>
    </section>
  `;
}

function renderEmptyState(): string {
  return `
    <section class="overview-band empty">
      <div>
        <strong>No active run</strong>
        <span>Add a target or import a snapshot JSON file.</span>
      </div>
    </section>
  `;
}

function bindEvents(): void {
  document.querySelector<HTMLFormElement>("#target-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    const form = new FormData(formElement);
    const target = String(form.get("target") ?? "").trim();
    if (!target) return;

    const draft = createTargetDraft(target);
    const run = createDraftRun(target, state.providers);
    state = {
      ...state,
      targets: [draft, ...state.targets],
      runs: [run, ...state.runs],
      activeRunId: run.id,
    };
    persistAndRender();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-create-run]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.createRun;
      if (!target) return;

      const run = createDraftRun(target, state.providers);
      state = { ...state, runs: [run, ...state.runs], activeRunId: run.id };
      persistAndRender();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state = { ...state, activeRunId: button.dataset.runId ?? null };
      persistAndRender();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-provider-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedProviderId = button.dataset.providerId ?? selectedProviderId;
      render();
    });
  });

  document.querySelector<HTMLFormElement>("#provider-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    const form = new FormData(formElement);
    const id = String(form.get("id"));

    state = {
      ...state,
      providers: state.providers.map((provider) =>
        provider.id === id
          ? {
              ...provider,
              displayName: String(form.get("displayName") ?? provider.displayName),
              type: String(form.get("type") ?? provider.type) as ProviderType,
              endpoint: String(form.get("endpoint") ?? ""),
              authMode: String(form.get("authMode") ?? provider.authMode) as ProviderConfig["authMode"],
              secretRef: String(form.get("secretRef") ?? ""),
              enabled: form.get("enabled") === "on",
            }
          : provider,
      ),
    };
    persistAndRender();
  });

  document.querySelector<HTMLInputElement>("#snapshot-import")?.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const records = normalizeImportedRecords(JSON.parse(raw));
      const run = createImportedRun(records);
      state = { ...state, runs: [run, ...state.runs], activeRunId: run.id };
      importMessage = `Imported ${records.length} records from ${file.name}.`;
      persistAndRender();
    } catch (error) {
      importMessage = error instanceof Error ? error.message : String(error);
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#copy-run-json")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;
    await navigator.clipboard.writeText(JSON.stringify(run, null, 2));
    runMessage = "Copied raw run JSON.";
    render();
  });

  document.querySelector<HTMLButtonElement>("#copy-analysis-json")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;
    const report = createAnalysisReport(run);
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    runMessage = "Copied analysis JSON.";
    render();
  });

  document.querySelector<HTMLButtonElement>("#copy-markdown-report")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;
    const report = createAnalysisReport(run);
    await navigator.clipboard.writeText(renderAnalysisMarkdown(report));
    runMessage = "Copied markdown report.";
    render();
  });

  document.querySelector<HTMLButtonElement>("#copy-narrative-report")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;
    const brief = createReportBrief(run);
    await navigator.clipboard.writeText(renderNarrativeMarkdown(brief));
    runMessage = "Copied narrative markdown report.";
    render();
  });

  document.querySelector<HTMLButtonElement>("#run-demo-fetch")?.addEventListener("click", () => {
    const run = getActiveRun();
    if (!run) return;

    const providerRun = createDemoRemoteFetchRun(run.target, state.providers);
    const mergedRun = mergeProviderRun(run, providerRun);
    state = { ...state, runs: [mergedRun, ...state.runs], activeRunId: mergedRun.id };
    persistAndRender();
  });

  document.querySelector<HTMLButtonElement>("#run-worker-scan")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;

    const dnsProvider = state.providers.find((item) => item.type === "dns_tls" && item.enabled);
    const fetchProvider = state.providers.find((item) => item.type === "remote_fetch" && item.enabled);
    const missingProviders = [
      ...(dnsProvider ? [] : ["dns_tls"]),
      ...(fetchProvider ? [] : ["remote_fetch"]),
    ];

    if (missingProviders.length > 0) {
      runMessage = `Missing enabled provider(s): ${missingProviders.join(", ")}.`;
      render();
      return;
    }

    if (!dnsProvider || !fetchProvider) return;

    const enabledDnsProvider = dnsProvider;
    const enabledFetchProvider = fetchProvider;
    let workingRun = run;
    const steps: Array<{ label: string; execute: () => Promise<Run> }> = [
      {
        label: "DNS infrastructure",
        execute: async () =>
          createDnsInfrastructureRun(
            workingRun.target,
            state.providers,
            await callDnsInfrastructureProvider({ provider: enabledDnsProvider, target: workingRun.target }),
          ),
      },
      {
        label: "TLS metadata",
        execute: async () =>
          createTlsCertificateRun(
            workingRun.target,
            state.providers,
            await callTlsCertificateProvider({ provider: enabledDnsProvider, target: workingRun.target }),
          ),
      },
      {
        label: "Subdomain attack surface",
        execute: async () =>
          createSubdomainAttackSurfaceRun(
            workingRun.target,
            state.providers,
            await callSubdomainAttackSurfaceProvider({ provider: enabledDnsProvider, target: workingRun.target }),
          ),
      },
      {
        label: "Organization intelligence",
        execute: async () =>
          createOrganizationIntelligenceRun(
            workingRun.target,
            state.providers,
            await callOrganizationIntelligenceProvider({ provider: enabledDnsProvider, target: workingRun.target }),
          ),
      },
      {
        label: "Remote fetch",
        execute: async () =>
          createRemoteFetchRun(
            workingRun.target,
            state.providers,
            await callRemoteFetchProvider({ provider: enabledFetchProvider, target: workingRun.target }),
          ),
      },
      {
        label: "Basic performance",
        execute: async () =>
          createBasicPerformanceRun(
            workingRun.target,
            state.providers,
            await callBasicPerformanceProvider({ provider: enabledFetchProvider, target: workingRun.target }),
          ),
      },
    ];

    try {
      for (const [index, step] of steps.entries()) {
        runMessage = `Worker scan ${index + 1}/${steps.length}: ${step.label}...`;
        render();

        const providerRun = await step.execute();
        workingRun = mergeProviderRun(workingRun, providerRun);
        state = { ...state, runs: [workingRun, ...state.runs], activeRunId: workingRun.id };
        saveState(state);
      }

      runMessage = `Worker scan completed for ${workingRun.normalizedTarget}.`;
      render();
    } catch (error) {
      runMessage = error instanceof Error ? error.message : String(error);
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#run-dns")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;

    const provider = state.providers.find((item) => item.type === "dns_tls" && item.enabled);
    if (!provider) {
      runMessage = "No enabled dns_tls provider is configured.";
      render();
      return;
    }

    runMessage = `Calling ${provider.displayName}...`;
    render();

    try {
      const dnsResult = await callDnsInfrastructureProvider({ provider, target: run.target });
      const providerRun = createDnsInfrastructureRun(run.target, state.providers, dnsResult);
      const mergedRun = mergeProviderRun(run, providerRun);
      state = { ...state, runs: [mergedRun, ...state.runs], activeRunId: mergedRun.id };
      runMessage = `DNS infrastructure completed through ${provider.displayName}.`;
      persistAndRender();
    } catch (error) {
      runMessage = error instanceof Error ? error.message : String(error);
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#run-live-tls")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;

    const provider = state.providers.find((item) => item.type === "remote_fetch" && item.enabled);
    if (!provider) {
      runMessage = "No enabled Worker provider is configured for GitHub Actions live TLS.";
      render();
      return;
    }

    try {
      runMessage = `Starting GitHub Actions live TLS through ${provider.displayName}...`;
      render();

      const started = await startGitHubLiveTlsProvider({ provider, target: run.target });
      let status = started.status;
      let conclusion = started.conclusion;

      for (let attempt = 1; attempt <= 24; attempt += 1) {
        if (status === "completed") break;
        runMessage = `GitHub live TLS ${status}; polling ${attempt}/24...`;
        render();
        await sleep(5_000);
        const statusResult = await getGitHubLiveTlsStatus({ provider, requestId: started.request_id });
        status = statusResult.status;
        conclusion = statusResult.conclusion;
      }

      if (status !== "completed") {
        runMessage = `GitHub live TLS is still ${status}. Request id: ${started.request_id}`;
        render();
        return;
      }

      if (conclusion !== "success") {
        runMessage = `GitHub live TLS completed with ${conclusion ?? "unknown"} for request ${started.request_id}.`;
        render();
        return;
      }

      const result = await getGitHubLiveTlsResult({ provider, requestId: started.request_id });
      const records = result.records ?? [];
      if (records.length === 0) {
        runMessage = result.error ?? "GitHub live TLS completed, but no records were returned.";
        render();
        return;
      }

      const providerRun = createImportedRun(records);
      const mergedRun = mergeProviderRun(run, providerRun);
      state = { ...state, runs: [mergedRun, ...state.runs], activeRunId: mergedRun.id };
      runMessage = `GitHub live TLS completed and merged ${records.length} record(s).`;
      persistAndRender();
    } catch (error) {
      runMessage = error instanceof Error ? error.message : String(error);
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#run-lighthouse")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;

    const provider = state.providers.find((item) => item.type === "remote_fetch" && item.enabled);
    if (!provider) {
      runMessage = "No enabled Worker provider is configured for GitHub Actions Lighthouse.";
      render();
      return;
    }

    try {
      runMessage = `Starting GitHub Actions Lighthouse through ${provider.displayName}...`;
      render();

      const started = await startGitHubLighthouseProvider({ provider, target: run.target, strategy: "mobile" });
      let status = started.status;
      let conclusion = started.conclusion;

      for (let attempt = 1; attempt <= 60; attempt += 1) {
        if (status === "completed") break;
        runMessage = `GitHub Lighthouse ${status}; polling ${attempt}/60...`;
        render();
        await sleep(10_000);
        const statusResult = await getGitHubLighthouseStatus({ provider, requestId: started.request_id });
        status = statusResult.status;
        conclusion = statusResult.conclusion;
      }

      if (status !== "completed") {
        runMessage = `GitHub Lighthouse is still ${status}. Request id: ${started.request_id}`;
        render();
        return;
      }

      if (conclusion !== "success") {
        runMessage = `GitHub Lighthouse completed with ${conclusion ?? "unknown"} for request ${started.request_id}.`;
        render();
        return;
      }

      const result = await getGitHubLighthouseResult({ provider, requestId: started.request_id });
      const records = result.records ?? [];
      if (records.length === 0) {
        runMessage = result.error ?? "GitHub Lighthouse completed, but no records were returned.";
        render();
        return;
      }

      const providerRun = createImportedRun(records);
      const mergedRun = mergeProviderRun(run, providerRun);
      state = { ...state, runs: [mergedRun, ...state.runs], activeRunId: mergedRun.id };
      runMessage = `GitHub Lighthouse completed and merged ${records.length} record(s).`;
      persistAndRender();
    } catch (error) {
      runMessage = error instanceof Error ? error.message : String(error);
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#run-browser-runtime")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;

    const provider = state.providers.find((item) => item.type === "browser_runtime" && item.enabled);
    if (!provider) {
      runMessage = "No enabled browser_runtime provider is configured.";
      render();
      return;
    }

    try {
      runMessage = `Starting GitHub Actions browser runtime through ${provider.displayName}...`;
      render();

      const started = await startGitHubBrowserRuntimeProvider({ provider, target: run.target });
      let status = started.status;
      let conclusion = started.conclusion;

      for (let attempt = 1; attempt <= 90; attempt += 1) {
        if (status === "completed") break;
        runMessage = `GitHub browser runtime ${status}; polling ${attempt}/90...`;
        render();
        await sleep(10_000);
        const statusResult = await getGitHubBrowserRuntimeStatus({ provider, requestId: started.request_id });
        status = statusResult.status;
        conclusion = statusResult.conclusion;
      }

      if (status !== "completed") {
        runMessage = `GitHub browser runtime is still ${status}. Request id: ${started.request_id}`;
        render();
        return;
      }

      if (conclusion !== "success") {
        runMessage = `GitHub browser runtime completed with ${conclusion ?? "unknown"} for request ${started.request_id}.`;
        render();
        return;
      }

      const result = await getGitHubBrowserRuntimeResult({ provider, requestId: started.request_id });
      const records = result.records ?? [];
      if (records.length === 0) {
        runMessage = result.error ?? "GitHub browser runtime completed, but no records were returned.";
        render();
        return;
      }

      const providerRun = createImportedRun(records);
      const mergedRun = mergeProviderRun(run, providerRun);
      state = { ...state, runs: [mergedRun, ...state.runs], activeRunId: mergedRun.id };
      runMessage = `GitHub browser runtime completed and merged ${providerRun.records.length} record(s).`;
      persistAndRender();
    } catch (error) {
      runMessage = error instanceof Error ? error.message : String(error);
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#run-ai-classifier")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;

    const provider = state.providers.find((item) => item.type === "ai_classifier" && item.enabled);
    if (!provider) {
      runMessage = "No enabled ai_classifier provider is configured.";
      render();
      return;
    }

    const contract = createAiClassifierContract(run);
    if (contract.input.evidence.length === 0) {
      runMessage = "No L4/L8 classifier input evidence is available. Run remote fetch or import browser/runtime evidence first.";
      render();
      return;
    }

    runMessage = `Calling ${provider.displayName}...`;
    render();

    try {
      const response = await callWorkerAiClassifierProvider({ provider, contract });
      const providerRun = createAiClassifierRun(run.target, state.providers, response);
      const mergedRun = mergeProviderRun(run, providerRun);
      state = { ...state, runs: [mergedRun, ...state.runs], activeRunId: mergedRun.id };
      runMessage = response.ok
        ? `AI classifier completed and merged ${providerRun.records.length} record(s).`
        : `AI classifier returned ${response.error_code}; merged status record only.`;
      persistAndRender();
    } catch (error) {
      runMessage = error instanceof Error ? error.message : String(error);
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#run-tls")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;

    const provider = state.providers.find((item) => item.type === "dns_tls" && item.enabled);
    if (!provider) {
      runMessage = "No enabled dns_tls provider is configured.";
      render();
      return;
    }

    runMessage = `Calling ${provider.displayName}...`;
    render();

    try {
      const tlsResult = await callTlsCertificateProvider({ provider, target: run.target });
      const providerRun = createTlsCertificateRun(run.target, state.providers, tlsResult);
      const mergedRun = mergeProviderRun(run, providerRun);
      state = { ...state, runs: [mergedRun, ...state.runs], activeRunId: mergedRun.id };
      runMessage = `TLS certificate completed through ${provider.displayName}.`;
      persistAndRender();
    } catch (error) {
      runMessage = error instanceof Error ? error.message : String(error);
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#run-subdomains")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;

    const provider = state.providers.find((item) => item.type === "dns_tls" && item.enabled);
    if (!provider) {
      runMessage = "No enabled dns_tls provider is configured.";
      render();
      return;
    }

    runMessage = `Calling ${provider.displayName}...`;
    render();

    try {
      const subdomainResult = await callSubdomainAttackSurfaceProvider({ provider, target: run.target });
      const providerRun = createSubdomainAttackSurfaceRun(run.target, state.providers, subdomainResult);
      const mergedRun = mergeProviderRun(run, providerRun);
      state = { ...state, runs: [mergedRun, ...state.runs], activeRunId: mergedRun.id };
      runMessage = `Subdomain attack surface completed through ${provider.displayName}.`;
      persistAndRender();
    } catch (error) {
      runMessage = error instanceof Error ? error.message : String(error);
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#run-org")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;

    const provider = state.providers.find((item) => item.type === "dns_tls" && item.enabled);
    if (!provider) {
      runMessage = "No enabled dns_tls provider is configured.";
      render();
      return;
    }

    runMessage = `Calling ${provider.displayName}...`;
    render();

    try {
      const organizationResult = await callOrganizationIntelligenceProvider({ provider, target: run.target });
      const providerRun = createOrganizationIntelligenceRun(run.target, state.providers, organizationResult);
      const mergedRun = mergeProviderRun(run, providerRun);
      state = { ...state, runs: [mergedRun, ...state.runs], activeRunId: mergedRun.id };
      runMessage = `Organization intelligence completed through ${provider.displayName}.`;
      persistAndRender();
    } catch (error) {
      runMessage = error instanceof Error ? error.message : String(error);
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#run-remote-fetch")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;

    const provider = state.providers.find((item) => item.type === "remote_fetch" && item.enabled);
    if (!provider) {
      runMessage = "No enabled remote_fetch provider is configured.";
      render();
      return;
    }

    runMessage = `Calling ${provider.displayName}...`;
    render();

    try {
      const fetchResult = await callRemoteFetchProvider({ provider, target: run.target });
      const providerRun = createRemoteFetchRun(run.target, state.providers, fetchResult);
      const mergedRun = mergeProviderRun(run, providerRun);
      state = { ...state, runs: [mergedRun, ...state.runs], activeRunId: mergedRun.id };
      runMessage = `Remote fetch completed through ${provider.displayName}.`;
      persistAndRender();
    } catch (error) {
      runMessage = error instanceof Error ? error.message : String(error);
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#run-performance")?.addEventListener("click", async () => {
    const run = getActiveRun();
    if (!run) return;

    const provider = state.providers.find((item) => item.type === "remote_fetch" && item.enabled);
    if (!provider) {
      runMessage = "No enabled remote_fetch provider is configured for basic performance.";
      render();
      return;
    }

    runMessage = `Calling ${provider.displayName} basic performance...`;
    render();

    try {
      const performanceResult = await callBasicPerformanceProvider({ provider, target: run.target });
      const providerRun = createBasicPerformanceRun(run.target, state.providers, performanceResult);
      const mergedRun = mergeProviderRun(run, providerRun);
      state = { ...state, runs: [mergedRun, ...state.runs], activeRunId: mergedRun.id };
      runMessage = `Basic performance completed through ${provider.displayName}.`;
      persistAndRender();
    } catch (error) {
      runMessage = error instanceof Error ? error.message : String(error);
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#reset-state")?.addEventListener("click", () => {
    clearState();
    state = createInitialState();
    selectedProviderId = state.providers[0]?.id ?? "";
    importMessage = "";
    runMessage = "";
    persistAndRender();
  });
}

function persistAndRender(): void {
  saveState(state);
  render();
}

function getActiveRun(): Run | null {
  return state.runs.find((run) => run.id === state.activeRunId) ?? state.runs[0] ?? null;
}

function getLayerStatus(records: SnapshotRecord[]): string {
  if (records.length === 0) return "skipped";
  if (records.some((record) => getCoverageState(record) === "provider_configured")) return "provider-ready";
  if (records.some((record) => record.status === "error")) return "error";
  if (records.some((record) => record.status === "warning")) return "warning";
  if (records.some((record) => record.status === "ok")) return "ok";
  return "skipped";
}

function getCoverageState(record: SnapshotRecord): string | null {
  if (typeof record.value !== "object" || record.value === null || Array.isArray(record.value)) return null;
  const value = record.value as Record<string, unknown>;
  return typeof value.coverage_state === "string" ? value.coverage_state : null;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

import type { Env } from "../env";
import { createAiNarrativeReportContract } from "../../src/providers/narrative-report/contract";
import { runAiNarrativeReportProvider } from "../services/ai-narrative-report";
import {
  collectSiteScanJob,
  createCallerOwnedSiteScanJobArtifact,
  createSiteScanJob,
  createSiteScanExport,
  createSiteScanStart,
  type ProbeRequest,
  type ScanOrchestratorDependencies,
  type SiteScanAsyncProvider,
  type SiteScanPerformanceOptions,
} from "../services/scan-orchestrator";
import { createStorageNotConfiguredResponse } from "../../src/scan/storage";
import type { ScanJob } from "../../src/scan/job";
import {
  cancelPersistedScanJob,
  collectPersistedScanJob,
  getPersistedAiNarrativeReport,
  getPersistedScanJob,
  getPersistedScanJobArtifact,
  persistScanJobEnvelope,
  pollPersistedScanJob,
  putPersistedAiNarrativeReport,
} from "../services/scan-storage";
import { createScanRunId } from "../http/request";
import { jsonResponse, markdownResponse } from "../http/response";
import { getScanHistoryByJobId, updateScanHistoryStatus, upsertScanHistory } from "../services/user-db";
import { executeSiteScanSyncProbe } from "./probes";
import type { AuthenticatedUser } from "./user";
import {
  githubBrowserRuntimeStart,
  githubLighthouseStart,
  githubLiveTlsStart,
} from "./github";
import {
  pageSpeedRun,
  webPageTestStart,
} from "./performance";

const scanOrchestratorDependencies: ScanOrchestratorDependencies<Env> = {
  executeSyncProbe: executeSiteScanSyncProbe,
  executeAsyncProvider: executeSiteScanAsyncProvider,
  createRunId: createScanRunId,
};

export async function handleScanRoute(
  pathname: string,
  env: Env,
  target: string,
  body: ProbeRequest,
  requestUrl: URL,
  authenticatedUser?: AuthenticatedUser | null,
): Promise<Response | null> {
  if (pathname === "/scan/site/start") {
    return jsonResponse(
      await createSiteScanStart({
        env,
        target,
        body,
        requestUrl,
        dependencies: scanOrchestratorDependencies,
      }),
    );
  }

  if (pathname === "/scan/site/export") {
    return jsonResponse(
      await createSiteScanExport({
        env,
        target,
        body,
        requestUrl,
        dependencies: scanOrchestratorDependencies,
      }),
    );
  }

  if (pathname === "/scan/site/report" || pathname === "/scan/site/report.md") {
    const artifact = await createSiteScanExport({
      env,
      target,
      body,
      requestUrl,
      dependencies: scanOrchestratorDependencies,
    });
    const aiResponse = await runAiNarrativeReportProvider(
      { contract: createAiNarrativeReportContract(artifact.brief) },
      env,
    );

    if (pathname.endsWith(".md")) {
      if (!aiResponse.ok) {
        return jsonResponse(
          {
            schema_version: "site-10-layer-scan-ai-report/v0.1",
            ok: false,
            generated_at: new Date().toISOString(),
            target: artifact.run.target,
            normalized_target: artifact.run.normalized_target,
            artifact,
            provider_error: aiResponse,
            boundaries: {
              invokes_ai_provider: false,
              deterministic_artifact_preserved: true,
              storage_persisted: false,
              frontend_state_mutated: false,
            },
          },
          aiResponse.status,
        );
      }

      return markdownResponse(
        aiResponse.result.markdown,
        `${artifact.run.normalized_target || "site"}-site-10-layer-ai-report.md`,
      );
    }

    return jsonResponse(
      {
        schema_version: "site-10-layer-scan-ai-report/v0.1",
        ok: aiResponse.ok,
        generated_at: new Date().toISOString(),
        target: artifact.run.target,
        normalized_target: artifact.run.normalized_target,
        artifact,
        ...(aiResponse.ok
          ? { ai_narrative_report: aiResponse.result }
          : { provider_error: aiResponse }),
        boundaries: {
          invokes_ai_provider: aiResponse.ok,
          deterministic_artifact_preserved: true,
          storage_persisted: false,
          frontend_state_mutated: false,
        },
      },
      aiResponse.ok ? 200 : aiResponse.status,
    );
  }

  if (pathname === "/scan/jobs") {
    const envelope = await createSiteScanJob({
      env,
      target,
      body,
      requestUrl,
      dependencies: scanOrchestratorDependencies,
    });
    await recordAuthenticatedScanHistory(env, authenticatedUser, envelope.job);

    return jsonResponse(
      await persistScanJobEnvelope({
        env,
        envelope,
      }),
    );
  }

  if (pathname === "/scan/jobs/collect") {
    return jsonResponse(await collectSiteScanJob({ body, env }));
  }

  if (pathname === "/scan/jobs/artifact") {
    return jsonResponse(await createCallerOwnedSiteScanJobArtifact({ body, env }));
  }

  if (isScanJobIdPostRoute(pathname)) {
    const id = parseScanJobId(pathname);
    if (!id) return jsonResponse(createStorageNotConfiguredResponse("job_store"), 503);
    const ownershipError = await requirePersistedScanJobOwnership(env, authenticatedUser, id);
    if (ownershipError) return ownershipError;

    if (pathname.endsWith("/report") || pathname.endsWith("/report.md")) {
      const artifactResult = await getPersistedScanJobArtifact(env, id);
      if (artifactResult.status !== 200) return jsonResponse(artifactResult.body, artifactResult.status);
      const artifact = artifactResult.body as Awaited<ReturnType<typeof createSiteScanExport>>;
      const artifactRef = readPersistedArtifactRef(artifactResult.body);
      const reportResult = await getOrCreatePersistedAiReport({
        env,
        id,
        artifact,
        artifactRef,
      });
      const aiResponse = reportResult.aiResponse;
      if (pathname.endsWith(".md")) {
        if (!aiResponse.ok) {
          return jsonResponse(
            {
              schema_version: "site-10-layer-persisted-scan-ai-report/v0.1",
              ok: false,
              generated_at: new Date().toISOString(),
              job_id: id,
              target: artifact.run.target,
              normalized_target: artifact.run.normalized_target,
              artifact,
              provider_error: aiResponse,
              boundaries: {
                invokes_ai_provider: false,
                deterministic_artifact_preserved: true,
                storage_persisted: true,
                frontend_state_mutated: false,
                ai_report_cache_hit: false,
              },
            },
            aiResponse.status,
          );
        }

        return markdownResponse(
          aiResponse.result.markdown,
          `${artifact.run.normalized_target || id}-site-10-layer-ai-report.md`,
        );
      }

      return jsonResponse(
        {
          schema_version: "site-10-layer-persisted-scan-ai-report/v0.1",
          ok: aiResponse.ok,
          generated_at: reportResult.generatedAt,
          job_id: id,
          target: artifact.run.target,
          normalized_target: artifact.run.normalized_target,
          artifact,
          ...(aiResponse.ok ? { ai_narrative_report: aiResponse.result } : { provider_error: aiResponse }),
          ai_report_cache: {
            hit: reportResult.cacheHit,
            artifact_ref: artifactRef,
          },
          boundaries: {
            invokes_ai_provider: aiResponse.ok && !reportResult.cacheHit,
            deterministic_artifact_preserved: true,
            storage_persisted: true,
            frontend_state_mutated: false,
            ai_report_cache_hit: reportResult.cacheHit,
          },
        },
        aiResponse.ok ? 200 : aiResponse.status,
      );
    }
    const result = pathname.endsWith("/cancel")
      ? await cancelPersistedScanJob(env, id)
      : pathname.endsWith("/poll")
        ? await pollPersistedScanJob({ env, id, requestUrl })
        : await collectPersistedScanJob({ env, id, body });
    await syncAuthenticatedScanHistoryStatus(env, authenticatedUser, result.body);
    return jsonResponse(result.body, result.status);
  }

  return null;
}

async function recordAuthenticatedScanHistory(
  env: Env,
  authenticatedUser: AuthenticatedUser | null | undefined,
  job: ScanJob,
): Promise<void> {
  if (!authenticatedUser || !env.SCAN_JOB_DB) return;

  await upsertScanHistory(env.SCAN_JOB_DB, {
    userId: authenticatedUser.id,
    jobId: job.id,
    target: job.normalized_target || job.target,
    status: job.status,
    createdAt: job.created_at,
    completedAt: job.completed_at,
  });
}

async function syncAuthenticatedScanHistoryStatus(
  env: Env,
  authenticatedUser: AuthenticatedUser | null | undefined,
  body: unknown,
): Promise<void> {
  if (!authenticatedUser || !env.SCAN_JOB_DB) return;
  const job = readScanJob(body);
  if (!job) return;

  await updateScanHistoryStatus(env.SCAN_JOB_DB, {
    userId: authenticatedUser.id,
    jobId: job.id,
    status: job.status,
    completedAt: job.completed_at,
  });
}

function readScanJob(value: unknown): ScanJob | null {
  if (!isRecord(value) || !isRecord(value.job)) return null;
  const job = value.job;
  if (typeof job.id !== "string" || typeof job.status !== "string") return null;
  return job as ScanJob;
}

async function getOrCreatePersistedAiReport(input: {
  env: Env;
  id: string;
  artifact: Awaited<ReturnType<typeof createSiteScanExport>>;
  artifactRef: string | null;
}): Promise<{
  aiResponse: Awaited<ReturnType<typeof runAiNarrativeReportProvider>>;
  cacheHit: boolean;
  generatedAt: string;
}> {
  const cached = await getPersistedAiNarrativeReport({
    env: input.env,
    id: input.id,
    artifactRef: input.artifactRef,
  });
  if (cached) {
    return {
      cacheHit: true,
      generatedAt: cached.generated_at,
      aiResponse: {
        ok: true,
        schema_version: "site-10-layer-ai-narrative-report-worker-response/v0.1",
        provider: "worker_ai_narrative_report",
        result: cached.result,
      },
    };
  }

  const generatedAt = new Date().toISOString();
  const aiResponse = await runAiNarrativeReportProvider(
    { contract: createAiNarrativeReportContract(input.artifact.brief) },
    input.env,
  );
  if (aiResponse.ok) {
    await putPersistedAiNarrativeReport({
      env: input.env,
      id: input.id,
      artifactRef: input.artifactRef,
      result: aiResponse.result,
      generatedAt,
    });
  }

  return {
    aiResponse,
    cacheHit: false,
    generatedAt,
  };
}

function readPersistedArtifactRef(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const persisted = isRecord(value.persisted) ? value.persisted : null;
  const artifactRef = persisted?.artifact_ref;
  return typeof artifactRef === "string" && artifactRef.length > 0 ? artifactRef : null;
}

async function requirePersistedScanJobOwnership(
  env: Env,
  authenticatedUser: AuthenticatedUser | null | undefined,
  jobId: string,
): Promise<Response | null> {
  if (!authenticatedUser) return null;
  if (!env.SCAN_JOB_DB) {
    return jsonResponse(
      {
        ok: false,
        code: "not_configured",
        message: "SCAN_JOB_DB is required for user-owned scan job access.",
      },
      503,
    );
  }

  const item = await getScanHistoryByJobId(env.SCAN_JOB_DB, {
    userId: authenticatedUser.id,
    jobId,
  });
  if (item) return null;

  return jsonResponse(
    {
      ok: false,
      code: "not_found",
      message: "Scan job was not found.",
    },
    404,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function handleScanGetRoute(
  pathname: string,
  env: Env,
  authenticatedUser?: AuthenticatedUser | null,
): Promise<Response | null> {
  if (!isScanJobIdGetRoute(pathname)) return null;

  const id = parseScanJobId(pathname);
  if (!id) return jsonResponse(createStorageNotConfiguredResponse(pathname.endsWith("/artifact") ? "artifact_store" : "job_store"), 503);
  const ownershipError = await requirePersistedScanJobOwnership(env, authenticatedUser, id);
  if (ownershipError) return ownershipError;

  const result = pathname.endsWith("/artifact")
    ? await getPersistedScanJobArtifact(env, id)
    : await getPersistedScanJob(env, id);
  return jsonResponse(result.body, result.status);
}

export function isScanJobIdRoute(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "scan" || parts[1] !== "jobs") return false;
  const id = parts[2];
  if (!id || id === "collect" || id === "artifact") return false;
  if (parts.length === 3) return true;
  if (
    parts.length === 4 &&
    (parts[3] === "collect" ||
      parts[3] === "cancel" ||
      parts[3] === "poll" ||
      parts[3] === "artifact" ||
      parts[3] === "report" ||
      parts[3] === "report.md")
  ) {
    return true;
  }
  return false;
}

export function isScanJobIdGetRoute(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  return isScanJobIdRoute(pathname) && (parts.length === 3 || parts[3] === "artifact");
}

export function isScanJobIdPostRoute(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  return (
    isScanJobIdRoute(pathname) &&
    parts.length === 4 &&
    (parts[3] === "collect" || parts[3] === "cancel" || parts[3] === "poll" || parts[3] === "report" || parts[3] === "report.md")
  );
}

function parseScanJobId(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const id = parts[2];
  return id ? decodeURIComponent(id) : null;
}

async function executeSiteScanAsyncProvider(
  env: Env,
  provider: SiteScanAsyncProvider,
  target: string,
  requestUrl: URL,
  options: SiteScanPerformanceOptions,
) {
  if (provider === "browser_runtime") return githubBrowserRuntimeStart(env, target);
  if (provider === "live_tls") return githubLiveTlsStart(env, target);
  if (provider === "lighthouse") return githubLighthouseStart(env, target, "mobile");
  if (provider === "pagespeed") return pageSpeedRun(env, target, options.strategy);
  return webPageTestStart(env, target, requestUrl, options.location);
}

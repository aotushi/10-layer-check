/**
 * 探测策略层（Probe Strategy Layer）
 *
 * 职责：
 * 1. inferSiteTypeHints — 从快探结果推断站点类型
 * 2. selectTargetedProbes — 根据站点类型过滤探针
 * 3. createProbeStrategy — 生成 ProbeStrategy（意图 + 跳过原因）
 *
 * 快探集合（Phase 1，固定运行）：dns_infrastructure, service_fingerprint, remote_fetch
 * 其余探针（Phase 2，按策略）：根据 SiteTypeHints 决定是否跳过
 */

export type SiteTypeHints = {
  is_spa: boolean;            // 检测到 SPA 框架特征
  is_cms: string | null;      // "wordpress" | "discourse" | "mintlify" | null
  is_api_service: boolean;    // 检测到 API 框架或路径
  is_static: boolean;         // 无 SPA / 无 API / 无 CMS 的纯静态页面
  confidence: "high" | "low"; // 依据 HTML 长度和 header 数量
};

export type ProbeManifestEntry = {
  probe: string;
  status: "run" | "skipped";
  intent: string;
  reason: string;
};

export type ProbeStrategy = {
  schema_version: "site-10-layer-probe-strategy/v0.1";
  site_type_hints: SiteTypeHints;
  probe_manifest: ProbeManifestEntry[];
};

/** Phase 1 快探，永远运行 */
export const FAST_PROBES = ["dns_infrastructure", "service_fingerprint", "remote_fetch"] as const;

/** 每个探针的采集意图说明（用于 AI 合约） */
export const PROBE_INTENTS: Record<string, string> = {
  dns_infrastructure: "DNS records, CDN provider, nameserver config, subdomain enumeration hints",
  tls_certificate: "TLS CT logs, issuer, SANs, HSTS signals",
  subdomain_attack_surface: "CT-discovered subdomains, bounded public reachability of ≤8 candidates",
  service_fingerprint: "HTTP response headers, framework signals, server software, CDN markers",
  public_host_fingerprint: "Application role hints, CMS markers, admin surface detection",
  public_security_details: "CORS headers, cookie attributes, public API error surfaces, CMS metadata paths",
  public_content_surface: "Public page snippets, open graph metadata, classification signals",
  public_content_detail: "Docs/blog/community content snippets, navigation structure hints",
  public_spa_metadata: "JS bundle paths, chunk names, route candidates from asset manifests",
  organization_intelligence: "RDAP registration, MX/TXT records, Wayback Machine archive signals",
  api_reachability: "API endpoint reachability (/v1/models, /health, /api/…), status and headers",
  remote_fetch: "Homepage HTML content, meta tags, X-Generator, inline analytics markers",
  performance_basic: "Page weight, TTFB, resource timing hints",
};

type FastProbeInputs = {
  service_fingerprint: unknown;
  remote_fetch: unknown;
};

/**
 * 从 Phase 1 快探结果推断站点类型。
 * 只使用 service_fingerprint 和 remote_fetch 的原始结果。
 */
export function inferSiteTypeHints(inputs: FastProbeInputs): SiteTypeHints {
  const sfResult = asRecord(inputs.service_fingerprint);
  const rfResult = asRecord(inputs.remote_fetch);
  const html = asString(rfResult?.html) ?? "";
  const frameworkLabels = extractFrameworkLabels(sfResult);

  // CMS 检测
  const isWordPress =
    frameworkLabels.some((l) => /wordpress/i.test(l)) ||
    /wp-content|wp-json|wp-includes/i.test(html);
  const isDiscourse =
    frameworkLabels.some((l) => /discourse/i.test(l)) ||
    /ember\.js.*discourse|Discourse\.SiteSettings/i.test(html);
  const isMintlify = /__mintlify|mintlify-content/i.test(html);
  const cms = isWordPress
    ? "wordpress"
    : isDiscourse
      ? "discourse"
      : isMintlify
        ? "mintlify"
        : null;

  // SPA 检测
  const isSpa =
    /__NEXT_DATA__|__nuxt|data-reactroot|ng-version="[^"]+"|data-svelte|__GATSBY|_app\.js/i.test(html) ||
    frameworkLabels.some((l) => /next\.js|nuxt|gatsby|astro|vite|remix/i.test(l));

  // API 服务检测（后端框架 header 或 HTML 中的 API 路由提示）
  const isApiService =
    frameworkLabels.some((l) => /fastapi|express|hono|flask|django|rails|spring|koa/i.test(l)) ||
    /["'](\/api\/|\/v1\/|\/graphql)["']/i.test(html);

  // 静态站点：无以上三类特征
  const isStatic = !isSpa && !isApiService && !cms;

  // 置信度：收到任何 HTML 内容，或有 header 框架信号
  const confidence = html.length > 0 || frameworkLabels.length > 0 ? "high" : "low";

  return { is_spa: isSpa, is_cms: cms, is_api_service: isApiService, is_static: isStatic, confidence };
}

/**
 * 根据站点类型从全探针列表中过滤出目标探针。
 * FAST_PROBES 已在 Phase 1 运行，此处仅处理剩余探针。
 *
 * 跳过规则（仅 confidence==="high" 时生效，避免误判）：
 * - public_spa_metadata：非 SPA 站点无需爬取 JS bundle 路由
 * - api_reachability：纯静态页面无 API 端点可达性检测价值
 */
export function selectTargetedProbes(
  hints: SiteTypeHints,
  requestedProbes: string[],
): { run: string[]; skipped: string[] } {
  const fastSet = new Set<string>(FAST_PROBES);
  const run: string[] = [...FAST_PROBES.filter((p) => requestedProbes.includes(p))];
  const skipped: string[] = [];

  for (const probe of requestedProbes) {
    if (fastSet.has(probe)) continue; // Phase 1 已运行
    if (hints.confidence === "high" && shouldSkipProbe(probe, hints)) {
      skipped.push(probe);
    } else {
      run.push(probe);
    }
  }

  return { run, skipped };
}

function shouldSkipProbe(probe: string, hints: SiteTypeHints): boolean {
  if (probe === "public_spa_metadata" && hints.is_static && !hints.is_spa) return true;
  if (probe === "api_reachability" && hints.is_static && !hints.is_api_service) return true;
  return false;
}

/**
 * 创建完整的 ProbeStrategy，包含每个探针的意图和运行状态。
 */
export function createProbeStrategy(
  hints: SiteTypeHints,
  runProbes: string[],
  skippedProbes: string[],
): ProbeStrategy {
  const manifest: ProbeManifestEntry[] = [
    ...runProbes.map((probe) => ({
      probe,
      status: "run" as const,
      intent: PROBE_INTENTS[probe] ?? "Collect bounded public evidence.",
      reason: "Selected by probe strategy.",
    })),
    ...skippedProbes.map((probe) => ({
      probe,
      status: "skipped" as const,
      intent: PROBE_INTENTS[probe] ?? "Collect bounded public evidence.",
      reason:
        probe === "public_spa_metadata"
          ? "Skipped: no SPA framework signals detected in Phase 1 (high confidence)."
          : probe === "api_reachability"
            ? "Skipped: no API service signals detected in Phase 1 (high confidence)."
            : "Skipped: not relevant for detected site type.",
    })),
  ];

  return {
    schema_version: "site-10-layer-probe-strategy/v0.1",
    site_type_hints: hints,
    probe_manifest: manifest,
  };
}

// ─── Probe Options ────────────────────────────────────────────────────────────

/**
 * 探针级别的配置选项，由探测策略层根据站点类型生成。
 * 键是探针名，值是透传给该探针的 options 对象。
 */
export type ProbeOptions = {
  public_security_details?: {
    /** api.* 子主机上要检查的 API 路径。
     *  空数组 = 跳过 API 端点检查；
     *  undefined = 使用探针内部默认（/health + /v1/models）。
     */
    api_paths?: string[];
  };
  api_reachability?: {
    /** 传入初始候选端点，用于补充从 HTML 中动态提取的结果。 */
    candidates?: Array<{ url: string; source: string; reason: string }>;
  };
};

/**
 * 根据站点类型推断各探针的配置选项。
 * 仅在 confidence==="high" 时生成覆盖；低置信度保留探针默认行为。
 *
 * api_paths 策略：
 * - is_static + !is_api_service → [] (不探测 API 端点)
 * - is_spa + !is_api_service   → ["/health"] (最小检查)
 * - is_api_service              → ["/health", "/api/status", "/v1/models"]
 * - 默认（含 CMS）             → 不覆盖（探针用自己的默认值）
 */
export function createProbeOptions(hints: SiteTypeHints): ProbeOptions {
  if (hints.confidence !== "high") return {};

  const opts: ProbeOptions = {};

  if (hints.is_static && !hints.is_api_service) {
    opts.public_security_details = { api_paths: [] };
  } else if (hints.is_spa && !hints.is_api_service) {
    opts.public_security_details = { api_paths: ["/health"] };
  } else if (hints.is_api_service) {
    opts.public_security_details = {
      api_paths: ["/health", "/api/status", "/v1/models"],
    };
  }

  return opts;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractFrameworkLabels(sfResult: Record<string, unknown> | null): string[] {
  if (!sfResult) return [];
  const checkedHosts = Array.isArray(sfResult.checked_hosts) ? sfResult.checked_hosts : [];
  return checkedHosts.flatMap((host: unknown) => {
    const h = asRecord(host);
    if (!h) return [];
    const hints = Array.isArray(h.service_hints) ? h.service_hints : [];
    return hints.flatMap((hint: unknown) => {
      const sh = asRecord(hint);
      return sh?.label ? [String(sh.label)] : [];
    });
  });
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

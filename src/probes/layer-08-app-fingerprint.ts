import type { LayerProbeContext } from "../core/probe-contract";
import type { Evidence, EvidenceAssessment, SnapshotRecord } from "../core/types";
import type { RemoteFetchResult } from "../providers/remote-fetch/types";

type FingerprintCategory =
  | "framework"
  | "cms"
  | "docs"
  | "forum"
  | "analytics"
  | "hosting"
  | "security"
  | "runtime"
  | "commerce"
  | "support";

type FingerprintMatch = {
  category: FingerprintCategory;
  name: string;
  confidence: "low" | "medium" | "high";
  evidence: string[];
};

type FingerprintRule = {
  category: FingerprintCategory;
  name: string;
  confidence: FingerprintMatch["confidence"];
  header?: Record<string, RegExp>;
  html?: RegExp[];
};

const RULES: FingerprintRule[] = [
  {
    category: "hosting",
    name: "Cloudflare",
    confidence: "high",
    header: {
      server: /cloudflare/i,
      "cf-ray": /.+/i,
    },
  },
  {
    category: "hosting",
    name: "Vercel",
    confidence: "high",
    header: {
      server: /vercel/i,
      "x-vercel-id": /.+/i,
    },
  },
  {
    category: "hosting",
    name: "Netlify",
    confidence: "high",
    header: {
      server: /netlify/i,
      "x-nf-request-id": /.+/i,
    },
  },
  {
    category: "framework",
    name: "Next.js",
    confidence: "high",
    html: [/\/_next\//i, /id=["']__next["']/i, /__NEXT_DATA__/i],
  },
  {
    category: "framework",
    name: "Nuxt",
    confidence: "high",
    html: [/\/_nuxt\//i, /data-n-head/i, /__NUXT__/i],
  },
  {
    category: "framework",
    name: "React",
    confidence: "medium",
    html: [/id=["']root["']/i, /data-reactroot/i, /react/i],
  },
  {
    category: "framework",
    name: "Vue",
    confidence: "medium",
    html: [/data-v-[a-z0-9-]+/i, /vue/i],
  },
  {
    category: "framework",
    name: "Astro",
    confidence: "high",
    html: [/data-astro/i, /astro-[a-z0-9-]+/i],
  },
  {
    category: "framework",
    name: "Svelte",
    confidence: "medium",
    html: [/data-svelte/i, /svelte/i],
  },
  {
    category: "cms",
    name: "WordPress",
    confidence: "high",
    html: [/wp-content/i, /wp-includes/i, /<meta[^>]+generator=["'][^"']*WordPress/i],
  },
  {
    category: "commerce",
    name: "Shopify",
    confidence: "high",
    html: [/cdn\.shopify\.com/i, /Shopify\.theme/i, /myshopify\.com/i],
  },
  {
    category: "cms",
    name: "Webflow",
    confidence: "high",
    html: [/webflow\.js/i, /data-wf-page/i, /data-wf-site/i],
  },
  {
    category: "forum",
    name: "Discourse",
    confidence: "high",
    header: {
      "x-discourse-route": /.+/i,
    },
    html: [/discourse/i],
  },
  {
    category: "docs",
    name: "Mintlify",
    confidence: "medium",
    html: [/mintlify/i, /mintlify-assets/i],
  },
  {
    category: "docs",
    name: "GitBook",
    confidence: "medium",
    html: [/gitbook/i],
  },
  {
    category: "analytics",
    name: "Google Analytics",
    confidence: "high",
    html: [/googletagmanager\.com/i, /google-analytics\.com/i, /gtag\(/i],
  },
  {
    category: "analytics",
    name: "Microsoft Clarity",
    confidence: "high",
    html: [/clarity\.ms/i],
  },
  {
    category: "support",
    name: "Intercom",
    confidence: "high",
    html: [/intercom/i, /widget\.intercom\.io/i],
  },
  {
    category: "support",
    name: "Zendesk",
    confidence: "high",
    html: [/zendesk/i, /zdassets\.com/i],
  },
  {
    category: "security",
    name: "Cloudflare Turnstile",
    confidence: "high",
    html: [/challenges\.cloudflare\.com\/turnstile/i],
  },
  {
    category: "runtime",
    name: "Express",
    confidence: "medium",
    header: {
      "x-powered-by": /express/i,
    },
  },
  {
    category: "runtime",
    name: "PHP",
    confidence: "medium",
    header: {
      "x-powered-by": /php/i,
    },
  },
];

export function createAppFingerprintRecords(
  context: LayerProbeContext,
  fetchResult: RemoteFetchResult,
): SnapshotRecord[] {
  const matches = matchFingerprints(fetchResult.headers, fetchResult.html);
  const evidence = buildEvidence(matches);

  return [
    {
      target: context.target,
      normalized_target: context.normalizedTarget,
      snapshot_at: context.snapshotAt,
      probe: "app_fingerprint_probe",
      layer: 8,
      item: "app_fingerprint",
      probe_type: "active_request",
      source: `${fetchResult.source} + app_fingerprint_rules`,
      status: "ok",
      value: {
        final_url: fetchResult.final_url,
        matches,
        fingerprint_candidates: matches,
        fingerprint_assessment: buildFingerprintAssessment(matches),
        categories: countBy(matches.map((match) => match.category)),
        response_hints: {
          server: getHeader(fetchResult, "server"),
          x_powered_by: getHeader(fetchResult, "x-powered-by"),
          via: getHeader(fetchResult, "via"),
          cf_cache_status: getHeader(fetchResult, "cf-cache-status"),
          x_vercel_id: getHeader(fetchResult, "x-vercel-id"),
        },
        ai_classifier_status: "not_invoked",
        ai_classifier_note:
          "Layer 8 can later consume Layer 4 ai_frontend_evidence_pack for evidence-driven model classification.",
      },
      risk: {
        level: "info",
        summary:
          matches.length === 0
            ? "No known application fingerprints matched the static response."
            : `Found ${matches.length} application fingerprint candidate(s): ${matches.map((match) => match.name).join(", ")}.`,
      },
      evidence,
      evidence_metadata: {
        origin: "static_heuristic",
        role: "derived",
        method: "static_parse",
        limitations: [
          "Application fingerprints are based on visible response headers and static HTML patterns.",
          "Absence of a match does not prove the technology is absent.",
          "AI report generation should use these matches as candidates and cite the matched evidence.",
        ],
      },
      duration_ms: fetchResult.duration_ms,
    },
  ];
}

function buildFingerprintAssessment(matches: FingerprintMatch[]): EvidenceAssessment {
  const highest = matches.some((match) => match.confidence === "high")
    ? "high"
    : matches.some((match) => match.confidence === "medium")
      ? "medium"
      : matches.some((match) => match.confidence === "low")
        ? "low"
        : "none";

  return {
    label: "Application fingerprint check",
    conclusion: matches.length > 0 ? "possible" : "not_detected",
    confidence: highest,
    signals: matches.map((match) => ({
      type: "application_fingerprint_candidate",
      name: match.name,
      value: {
        category: match.category,
        confidence: match.confidence,
        evidence: match.evidence,
      },
      source: "static_fingerprint_rule",
    })),
    limitations: [
      "Fingerprint matches are candidates based on static response headers and HTML patterns.",
      "Hidden server-side systems, runtime-loaded tools, and proxied vendors may not appear in static evidence.",
      "Absence of a fingerprint candidate does not prove absence of that technology.",
    ],
  };
}

function matchFingerprints(headers: Record<string, string>, html: string): FingerprintMatch[] {
  const matches: FingerprintMatch[] = [];

  for (const rule of RULES) {
    const evidence: string[] = [];

    for (const [headerName, pattern] of Object.entries(rule.header ?? {})) {
      const value = headers[headerName.toLowerCase()];
      if (value && pattern.test(value)) {
        evidence.push(`${headerName}: ${value}`);
      }
    }

    for (const pattern of rule.html ?? []) {
      if (pattern.test(html)) {
        evidence.push(`html matched ${pattern.toString()}`);
      }
    }

    if (evidence.length > 0) {
      matches.push({
        category: rule.category,
        name: rule.name,
        confidence: rule.confidence,
        evidence,
      });
    }
  }

  return dedupeMatches(matches);
}

function dedupeMatches(matches: FingerprintMatch[]): FingerprintMatch[] {
  const byName = new Map<string, FingerprintMatch>();

  for (const match of matches) {
    const existing = byName.get(match.name);
    if (!existing) {
      byName.set(match.name, { ...match, evidence: [...match.evidence] });
      continue;
    }

    existing.evidence.push(...match.evidence);
    existing.confidence = maxConfidence(existing.confidence, match.confidence);
  }

  return Array.from(byName.values());
}

function maxConfidence(
  current: FingerprintMatch["confidence"],
  next: FingerprintMatch["confidence"],
): FingerprintMatch["confidence"] {
  const rank = { low: 1, medium: 2, high: 3 };
  return rank[next] > rank[current] ? next : current;
}

function buildEvidence(matches: FingerprintMatch[]): Evidence[] {
  return matches.flatMap((match) =>
    match.evidence.map((item) => ({
      type: "fingerprint",
      name: match.name,
      value: {
        category: match.category,
        confidence: match.confidence,
        evidence: item,
      },
    })),
  );
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function getHeader(fetchResult: RemoteFetchResult, name: string): string | null {
  return fetchResult.headers[name.toLowerCase()] ?? null;
}

#!/usr/bin/env node
import tls from "node:tls";
import { writeFile } from "node:fs/promises";

const args = parseArgs(process.argv.slice(2));

if (!args.target) {
  console.error("Usage: npm run probe:tls -- https://example.com [--out snapshots/example-tls.json]");
  process.exit(1);
}

const startedAt = Date.now();
const snapshotAt = new Date().toISOString();
const targetUrl = normalizeUrl(args.target);
const url = new URL(targetUrl);
const port = Number(url.port || 443);

try {
  const tlsResult = await probeLiveCertificate(url.hostname, port);
  const record = createSnapshotRecord({
    target: targetUrl,
    normalizedTarget: url.hostname.toLowerCase(),
    snapshotAt,
    durationMs: Date.now() - startedAt,
    tlsResult,
  });
  const output = JSON.stringify({ records: [record] }, null, 2);

  if (args.out) {
    await writeFile(args.out, `${output}\n`, "utf8");
  } else {
    process.stdout.write(`${output}\n`);
  }
} catch (error) {
  const record = createErrorRecord({
    target: targetUrl,
    normalizedTarget: url.hostname.toLowerCase(),
    snapshotAt,
    durationMs: Date.now() - startedAt,
    error: error instanceof Error ? error.message : String(error),
  });
  const output = JSON.stringify({ records: [record] }, null, 2);

  if (args.out) {
    await writeFile(args.out, `${output}\n`, "utf8");
  } else {
    process.stdout.write(`${output}\n`);
  }

  process.exitCode = 2;
}

function parseArgs(values) {
  const result = { target: "", out: "" };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--out") {
      result.out = values[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (!result.target) result.target = value;
  }

  return result;
}

function normalizeUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

function probeLiveCertificate(host, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
        timeout: 15_000,
      },
      () => {
        const peerCertificate = socket.getPeerCertificate(true);
        const result = {
          host,
          port,
          authorized: socket.authorized,
          authorization_error: socket.authorizationError ? String(socket.authorizationError) : null,
          protocol: socket.getProtocol(),
          cipher: socket.getCipher(),
          certificate: normalizeCertificate(peerCertificate),
          chain: normalizeCertificateChain(peerCertificate),
        };
        socket.end();
        resolve(result);
      },
    );

    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("TLS socket timed out."));
    });
    socket.once("error", reject);
  });
}

function normalizeCertificate(cert) {
  if (!cert || Object.keys(cert).length === 0) return null;

  return {
    subject: cert.subject ?? null,
    issuer: cert.issuer ?? null,
    subject_alt_names: parseSubjectAltName(cert.subjectaltname),
    valid_from: cert.valid_from ?? null,
    valid_to: cert.valid_to ?? null,
    fingerprint256: cert.fingerprint256 ?? null,
    serial_number: cert.serialNumber ?? null,
    raw_subject_alt_name: cert.subjectaltname ?? null,
  };
}

function normalizeCertificateChain(cert) {
  const chain = [];
  const seen = new Set();
  let current = cert;

  while (current && Object.keys(current).length > 0) {
    const fingerprint = current.fingerprint256 ?? current.serialNumber ?? JSON.stringify(current.subject ?? {});
    if (seen.has(fingerprint)) break;
    seen.add(fingerprint);
    chain.push(normalizeCertificate(current));
    current = current.issuerCertificate;
  }

  return chain.filter(Boolean);
}

function parseSubjectAltName(value) {
  if (!value) return [];

  return value
    .split(/,\s*/)
    .map((item) => item.replace(/^DNS:/i, "").trim())
    .filter(Boolean);
}

function createSnapshotRecord(input) {
  const expiresAt = input.tlsResult.certificate?.valid_to ? Date.parse(input.tlsResult.certificate.valid_to) : null;
  const daysUntilExpiry = expiresAt ? Math.floor((expiresAt - Date.now()) / 86_400_000) : null;
  const expiryRisk =
    daysUntilExpiry === null
      ? { level: "medium", summary: "Live certificate was collected, but expiry could not be parsed." }
      : daysUntilExpiry < 0
        ? { level: "high", summary: `Live certificate expired ${Math.abs(daysUntilExpiry)} day(s) ago.` }
        : daysUntilExpiry <= 14
          ? { level: "high", summary: `Live certificate expires in ${daysUntilExpiry} day(s).` }
          : daysUntilExpiry <= 30
            ? { level: "medium", summary: `Live certificate expires in ${daysUntilExpiry} day(s).` }
            : { level: "info", summary: `Live certificate expires in ${daysUntilExpiry} day(s).` };

  const risk = !input.tlsResult.authorized
    ? {
        level: "medium",
        summary: `TLS certificate was collected, but Node did not authorize the chain: ${input.tlsResult.authorization_error ?? "unknown error"}.`,
      }
    : expiryRisk;

  return {
    target: input.target,
    normalized_target: input.normalizedTarget,
    snapshot_at: input.snapshotAt,
    probe: "tls_live_certificate_probe",
    layer: 2,
    item: "tls_live_certificate",
    probe_type: "node_tls",
    source: "node_tls_socket",
    status: risk.level === "high" || risk.level === "medium" ? "warning" : "ok",
    value: {
      host: input.tlsResult.host,
      port: input.tlsResult.port,
      authorized: input.tlsResult.authorized,
      authorization_error: input.tlsResult.authorization_error,
      protocol: input.tlsResult.protocol,
      cipher: input.tlsResult.cipher,
      certificate: input.tlsResult.certificate,
      chain: input.tlsResult.chain,
      days_until_expiry: daysUntilExpiry,
    },
    risk,
    evidence: [
      { type: "tls_protocol", value: input.tlsResult.protocol },
      { type: "tls_cipher", value: input.tlsResult.cipher },
      { type: "tls_certificate", name: "leaf", value: input.tlsResult.certificate },
      { type: "tls_certificate_chain", value: input.tlsResult.chain },
    ],
    evidence_metadata: {
      origin: "direct_observation",
      role: "raw",
      method: "tls_socket",
      limitations: [
        "This record is collected by Node.js TLS socket inspection, not Cloudflare Worker Fetch.",
        "The certificate reflects the probe runtime network path and SNI target at collection time.",
        "OCSP, revocation status, and multi-region certificate variance are not checked.",
      ],
    },
    duration_ms: input.durationMs,
  };
}

function createErrorRecord(input) {
  return {
    target: input.target,
    normalized_target: input.normalizedTarget,
    snapshot_at: input.snapshotAt,
    probe: "tls_live_certificate_probe",
    layer: 2,
    item: "tls_live_certificate",
    probe_type: "node_tls",
    source: "node_tls_socket",
    status: "error",
    value: {
      error: input.error,
    },
    risk: {
      level: "high",
      summary: `Live TLS certificate inspection failed: ${input.error}`,
    },
    evidence: [{ type: "error", value: input.error }],
    evidence_metadata: {
      origin: "direct_observation",
      role: "raw",
      method: "tls_socket",
      limitations: [
        "The probe failed before a live certificate could be collected.",
        "A failure may be caused by network policy, SNI mismatch, TLS version support, or target availability.",
      ],
    },
    duration_ms: input.durationMs,
    error: input.error,
  };
}

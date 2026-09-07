/**
 * Build Knowledge Base. Every successfully resolved error becomes a KnownError
 * so the system depends less on AI over time (section 20 of the spec).
 *
 * The seed data lives in knowledge/errors/known.json and is mirrored here so the
 * Worker can load it without a filesystem read. At runtime the service can also
 * merge freshly learned errors from the database.
 */

import type { KnownError } from "@apk-factory/types";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function errorHash(code: string, signature: string): string {
  return createHash("sha256").update(`${code}::${signature}`).digest("hex").slice(0, 16);
}

/** Normalize build logs into a short, comparable signature. */
export function signatureFromLogs(logs: string): string {
  const firstError = logs
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /error|failed|exception|cannot|unable/i.test(l));
  const code = extractErrorCode(logs);
  return `${code}:${firstError ?? logs.slice(0, 120)}`.slice(0, 200);
}

export function extractErrorCode(logs: string): string {
  const known = ["ERESOLVE", "GradleDaemon", "SDKNotFound", "ManifestMerge", "KeystoreMissing", "BUILD_FAILED", "Execution failed"];
  for (const k of known) if (logs.includes(k)) return k;
  const m = logs.match(/(E\d{4})/);
  return m ? m[1] : "UNKNOWN";
}

const SEED: KnownError[] = [
  {
    hash: errorHash("ERESOLVE", "react-native-dynamic"),
    code: "ERESOLVE",
    framework: "expo",
    version: "53",
    environment: "node20-java17",
    pattern: "react-native-dynamic",
    error: "ERESOLVE unable to resolve dependency tree: react-native-dynamic peer react@18 conflicts with react@19",
    solution: "Install with --legacy-peer-deps",
    patch: { level: 1, file: ".npmrc", target: "legacy-peer-deps", value: "true", description: "Set legacy-peer-deps=true in .npmrc", risk: "low" },
    successRate: 0.97,
    occurrences: 412,
    lastSeen: new Date().toISOString().slice(0, 10),
  },
  {
    hash: errorHash("GradleDaemon", "Could not start Gradle daemon"),
    code: "GradleDaemon",
    framework: "any",
    environment: "docker",
    pattern: "Could not start Gradle daemon",
    error: "Could not start Gradle daemon — insufficient memory or stale daemon",
    solution: "Disable daemon and increase heap: org.gradle.daemon=false",
    patch: { level: 1, file: "gradle.properties", target: "org.gradle.daemon", value: "false", description: "Disable Gradle daemon in CI", risk: "low" },
    successRate: 0.94,
    occurrences: 230,
    lastSeen: new Date().toISOString().slice(0, 10),
  },
  {
    hash: errorHash("SDKNotFound", "Android SDK not found"),
    code: "SDKNotFound",
    framework: "any",
    environment: "android",
    pattern: "Failed to find Build Tools|Android SDK not found|compileSdk",
    error: "Android SDK / Build Tools not found for required compileSdk",
    solution: "Use a prebuilt environment image that already contains the SDK (GHCR builder).",
    successRate: 0.99,
    occurrences: 980,
    lastSeen: new Date().toISOString().slice(0, 10),
  },
  {
    hash: errorHash("ManifestMerge", "Manifest merger failed"),
    code: "ManifestMerge",
    framework: "any",
    environment: "android",
    pattern: "Manifest merger failed",
    error: "Manifest merger failed: conflicting SDK or permissions",
    solution: "Align minSdkVersion across modules or add tools:replace in AndroidManifest.",
    successRate: 0.88,
    occurrences: 64,
    lastSeen: new Date().toISOString().slice(0, 10),
  },
  {
    hash: errorHash("KeystoreMissing", "Keystore file not found"),
    code: "KeystoreMissing",
    framework: "any",
    environment: "android",
    pattern: "Keystore file .* not found|RELEASE_STORE_FILE",
    error: "Production signing keystore is not configured.",
    solution: "Configure EAS credentials or provide a keystore via secrets. Build a debug APK meanwhile.",
    successRate: 0.7,
    occurrences: 150,
    lastSeen: new Date().toISOString().slice(0, 10),
  },
];

export class KnowledgeBase {
  private errors: Map<string, KnownError> = new Map();
  private byPattern: { re: RegExp; err: KnownError }[] = [];

  constructor(seed: KnownError[] = SEED, extraPath?: string) {
    for (const e of seed) this.index(e);
    if (extraPath) {
      try {
        const raw = JSON.parse(readFileSync(extraPath, "utf8"));
        for (const e of (raw.errors ?? []) as KnownError[]) this.index(e);
      } catch {
        // optional external KB
      }
    }
  }

  private index(e: KnownError) {
    this.errors.set(e.hash, e);
    this.byPattern.push({ re: new RegExp(e.pattern, "i"), err: e });
  }

  /** Learn a new resolution and persist it (in-memory + returns the record). */
  learn(record: Omit<KnownError, "occurrences" | "lastSeen"> & { occurrences?: number }): KnownError {
    const full: KnownError = {
      ...record,
      occurrences: record.occurrences ?? 1,
      lastSeen: new Date().toISOString().slice(0, 10),
    };
    this.index(full);
    return full;
  }

  /** Record a success/failure to tune successRate (exponential moving avg). */
  recordOutcome(hash: string, success: boolean) {
    const e = this.errors.get(hash);
    if (!e) return;
    const alpha = 0.2;
    e.successRate = Math.round((e.successRate * (1 - alpha) + (success ? 1 : 0) * alpha) * 1000) / 1000;
    e.occurrences += 1;
    e.lastSeen = new Date().toISOString().slice(0, 10);
  }

  lookup(code: string, logs: string): KnownError | null {
    const sig = signatureFromLogs(logs);
    const h = errorHash(code, sig);
    if (this.errors.has(h)) return this.errors.get(h)!;
    for (const { re, err } of this.byPattern) {
      if (re.test(logs) || re.test(code)) return err;
    }
    return null;
  }

  all(): KnownError[] {
    return [...this.errors.values()].sort((a, b) => b.occurrences - a.occurrences);
  }
}

/** Default seed loader path relative to repo root (for tooling). */
export function repoKnowledgePath(): string {
  return path.resolve(fileURLToPath(new URL("../../../../knowledge/errors/known.json", import.meta.url)));
}

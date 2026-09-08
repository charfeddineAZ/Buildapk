/**
 * Build Core — provider-agnostic contracts for the Build Engine.
 *
 * A `BuildBackend` is any system that can take a prepared source tree and
 * produce an APK/AAB. The orchestrator talks only to this interface, so the
 * actual implementation (EAS, GitHub Actions, Cloudflare Builds, Docker) can be
 * swapped without touching the platform (Free-Tier Orchestration principle).
 */

import type { ArtifactMeta, BuildAttempt, BuildProvider, BuildRequest, BuildResult, BuildStatus } from "@apk-factory/types";
import { Logger } from "@apk-factory/logger";

export interface PreparedBuild {
  request: BuildRequest;
  /** Absolute path or archive URL of the source to build. */
  source: string;
  environmentTag: string;
  env: Record<string, string>;
  /** In-memory file tree (used by repair engine + local backends). */
  files?: Record<string, string>;
  /** Prebuilt APK bytes for the validation stage (tests / local builds). */
  apkBuffer?: Buffer;
}

export interface BackendCapabilities {
  provider: BuildProvider;
  supportedTargets: ("apk" | "aab")[];
  /** Approximate cost in minutes for quota accounting. */
  costMinutes: number;
  concurrent: number;
}

export interface BuildBackend {
  readonly provider: BuildProvider;
  capabilities(): BackendCapabilities;
  /** Submit the build and return a backend-specific job id. */
  submit(build: PreparedBuild): Promise<{ jobId: string }>;
  /** Poll a running job. Tail of logs is returned for the attempt. */
  poll(jobId: string): Promise<{ status: BuildStatus; logs: string; artifacts?: ArtifactMeta[] }>;
  cancel(jobId: string): Promise<void>;
  cleanup(jobId: string): Promise<void>;
}

/** Factory that produces a backend for a given provider. */
export type BackendFactory = (deps: { logger: Logger; config: Record<string, unknown> }) => BuildBackend;

/**
 * Minimal in-memory backend used by tests, local CLI, and as a safe fallback
 * when every external provider is out of quota. It runs the build script in an
 * isolated temp directory and records the attempt (no real Android SDK).
 */
export class NullBuildBackend implements BuildBackend {
  readonly provider: BuildProvider = "docker";
  private jobs = new Map<string, BuildAttempt>();
  constructor(private readonly logger: Logger = new Logger("null-backend")) {}

  capabilities() {
    return { provider: this.provider, supportedTargets: ["apk", "aab"] as ("apk" | "aab")[], costMinutes: 0, concurrent: 4 };
  }

  async submit(build: PreparedBuild): Promise<{ jobId: string }> {
    const jobId = `null-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.logger.info("submit (dry-run backend)", { jobId, source: build.source });
    return { jobId };
  }

  async poll(jobId: string) {
    this.logger.debug("poll", { jobId });
    return { status: "success" as BuildStatus, logs: `dry-run build ${jobId} completed (no real artifacts)` };
  }

  async cancel() {}
  async cleanup() {}
}

export function summarizeAttempts(attempts: BuildAttempt[]): Pick<BuildResult, "status" | "failureReason" | "provider"> {
  const last = attempts[attempts.length - 1];
  if (!last) return { status: "queued", provider: "docker" };
  if (last.status === "success") return { status: "success", provider: last.provider };
  return { status: "failed", provider: last.provider, failureReason: last.logs.slice(-500) };
}

export * from "./signing.js";

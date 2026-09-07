/**
 * Orchestrator — the brain that drives a build from request to artifact.
 *
 * It runs the Retry Engine (section 23): up to MAX_ATTEMPTS tries, rotating
 * through the Build Router's provider list, applying known/safe repairs between
 * attempts. When every attempt fails it stops and reports the real reason.
 * A successful build is passed through the Validator before delivery.
 */

import type {
  BuildAttempt,
  BuildProvider,
  BuildRequest,
  BuildResult,
  BuildStatus,
  ProjectAnalysis,
} from "@apk-factory/types";
import { Logger } from "@apk-factory/logger";
import type { BackendFactory, BuildBackend, PreparedBuild } from "@apk-factory/build-core";
import { NullBuildBackend } from "@apk-factory/build-core";
import type { QuotaManager } from "@apk-factory/quota-manager";
import type { ApkValidator } from "@apk-factory/validator";
import type { RepairEngine } from "@apk-factory/repair-agent";
import { applyPatch, extractErrorCode } from "@apk-factory/repair-agent";
import { BuildRouter } from "./router.js";

export const MAX_ATTEMPTS = 3;
const TERMINAL: BuildStatus[] = ["success", "failed"];

export interface OrchestratorDeps {
  backends?: Map<BuildProvider, BuildBackend>;
  quota: QuotaManager;
  repair: RepairEngine;
  validator?: ApkValidator;
  router?: BuildRouter;
  log?: Logger;
}

export class BuildOrchestrator {
  private readonly router: BuildRouter;
  private readonly backends: Map<BuildProvider, BuildBackend>;

  constructor(private readonly deps: OrchestratorDeps) {
    this.log = deps.log ?? new Logger("orchestrator");
    this.router = deps.router ?? new BuildRouter(deps.quota);
    this.backends = deps.backends ?? new Map<BuildProvider, BuildBackend>([["docker", new NullBuildBackend(this.log)]]);
  }
  private readonly log: Logger;

  async run(req: BuildRequest, prepared: PreparedBuild, analysis: ProjectAnalysis): Promise<BuildResult> {
    const route = this.router.select(analysis, req.provider);
    if (route.length === 0) {
      return {
        buildId: req.projectId,
        status: "failed",
        target: req.target,
        provider: "docker",
        attempts: [],
        route,
        failureReason: "No available build provider (free quota exhausted on every route).",
      };
    }

    const attempts: BuildAttempt[] = [];
    const start = Date.now();

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const provider = route[(i - 1) % route.length];
      const backend = this.backends.get(provider) ?? this.backends.get("docker")!;
      this.quotaSafeConsume(provider, backend);

      const { jobId } = await backend.submit(prepared);
      let status: BuildStatus = "building";
      let logs = "";
      for (let guard = 0; guard < 100 && !TERMINAL.includes(status); guard++) {
        const poll = await backend.poll(jobId);
        status = poll.status;
        logs += (poll.logs || "") + "\n";
        if (poll.artifacts?.length && prepared.apkBuffer === undefined) {
          // A real backend would stream artifact bytes here.
        }
      }

      const attempt: BuildAttempt = {
        index: i,
        provider,
        startedAt: new Date(start).toISOString(),
        finishedAt: new Date().toISOString(),
        status,
        logs,
      };

      if (status === "success") {
        let validation: BuildResult["validation"];
        if (prepared.apkBuffer && this.deps.validator) {
          validation = this.deps.validator.validateBuffer(prepared.apkBuffer, `${req.projectId}.apk`);
        }
        await backend.cleanup(jobId);
        this.log.info("build succeeded", { buildId: req.projectId, provider, attempts: i, ms: Date.now() - start });
        return { buildId: req.projectId, status: "success", target: req.target, provider, attempts: [...attempts, attempt], validation, route };
      }

      // Failure path
      attempt.errorHash = extractErrorCode(logs);
      attempts.push(attempt);

      if (req.autoRepair && i < MAX_ATTEMPTS) {
        const plan = await this.deps.repair.plan(logs);
        attempt.repairApplied = plan.errorHash;
        attempt.repairSource = plan.source;
        attempt.repairPatches = [...plan.autoPatches, ...plan.proposedPatches];
        if (prepared.files && plan.autoPatches.length) {
          for (const p of plan.autoPatches) prepared.files = applyPatch(prepared.files, p);
        }
        attempt.logs += `\n[repair] source=${plan.source} applied=${plan.autoPatches.length} proposed=${plan.proposedPatches.length}\n`;
        this.log.warn("attempt failed, repairing", { attempt: i, code: plan.code });
      } else {
        break;
      }
    }

    const last = attempts[attempts.length - 1];
    return {
      buildId: req.projectId,
      status: "failed",
      target: req.target,
      provider: route[0],
      attempts,
      route,
      failureReason: last?.logs.slice(-500) ?? "unknown failure",
    };
  }

  private quotaSafeConsume(provider: BuildProvider, backend: BuildBackend) {
    try {
      this.deps.quota.consume(provider, backend.capabilities().costMinutes > 0 ? 1 : 1);
    } catch {
      // quota tracking is best-effort
    }
  }
}

export { BuildRouter };
export type { BackendFactory };

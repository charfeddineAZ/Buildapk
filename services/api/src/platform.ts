/**
 * Platform — wires every service behind one facade used by the API gateway.
 * This is where the architecture becomes a single working product:
 *   GitHub repo (files) → Analyzer → Health Report
 *                      → Orchestrator (Router + Retry + Repair)
 *                      → Validator → Artifacts → Notifications
 */

import type { BuildResult, BuildTarget, ProjectAnalysis } from "@apk-factory/types";
import { Logger } from "@apk-factory/logger";
import { MemoryRepoSource, ProjectAnalyzer } from "@apk-factory/analyzer";
import { BuildOrchestrator, BuildRouter } from "@apk-factory/orchestrator";
import { QuotaManager } from "@apk-factory/quota-manager";
import { KnowledgeBase, AiRouter, RepairEngine } from "@apk-factory/repair-agent";
import { ApkValidator } from "@apk-factory/validator";
import { ConsoleChannel, NotificationService } from "@apk-factory/notification-service";
import { AuditService, type AuditEntry } from "./audit.js";
import { UsageService } from "@apk-factory/quota-manager";
import { GithubClient } from "@apk-factory/github";
import { RepairBranchService } from "@apk-factory/repair-agent";
import { InMemoryStore, type Store, type UserAccount, type Project } from "./store.js";

export interface PlatformDeps {
  store: Store;
  analyzer: ProjectAnalyzer;
  orchestrator: BuildOrchestrator;
  quota: QuotaManager;
  repair: RepairEngine;
  validator: ApkValidator;
  notify: NotificationService;
  log: Logger;
  github?: GithubClient;
  repairBranch?: RepairBranchService;
  audit?: AuditService;
  usage?: UsageService;
}

export class Platform {
  constructor(private readonly d: PlatformDeps) {}

  async ensureUser(profile: { googleId: string; email: string; name: string; avatar?: string }): Promise<UserAccount> {
    const existing = await this.d.store.users.byGoogle(profile.googleId);
    if (existing) return existing;
    const user: UserAccount = {
      id: `usr_${crypto.randomUUID().slice(0, 8)}`,
      ...profile,
      createdAt: new Date().toISOString(),
      settings: {},
    };
    this.d.store.users.put(user);
    this.d.notify.publish({ event: "build.queued", projectId: user.id, message: `Welcome ${user.name}` });
    this.d.audit?.record({ action: "auth.google", user: user.id, result: "success" });
    return user;
  }

  async analyzeRepo(input: { repositoryId: string; repoName: string; org: string; files: Record<string, string> }): Promise<{ project: Project; analysis: ProjectAnalysis }> {
    const existing = await this.d.store.projects.byRepo(input.repositoryId);
    const analysis = await this.d.analyzer.analyze(new MemoryRepoSource(input.files), {
      repositoryId: input.repositoryId,
      repoName: input.repoName,
      org: input.org,
    });
    const project: Project = existing ?? {
      id: `prj_${crypto.randomUUID().slice(0, 8)}`,
      repositoryId: input.repositoryId,
      repoName: input.repoName,
      org: input.org,
      files: input.files,
      createdAt: new Date().toISOString(),
      autoBuild: false,
    };
    project.files = input.files;
    project.analysis = analysis;
    await this.d.store.projects.put(project);
    this.d.audit?.record({ action: "project.analyze", projectId: project.id, result: "success" });
    return { project, analysis };
  }

  async startBuild(projectId: string, opts: { target?: BuildTarget; autoRepair?: boolean; createFixPr?: boolean; triggeredBy?: "manual" | "webhook-push" | "webhook-release" | "schedule" } = {}): Promise<BuildResult> {
    const project = await this.d.store.projects.get(projectId);
    if (!project || !project.analysis) throw new Error("project not analyzed");
    const target = opts.target ?? "apk";
    const req = {
      projectId,
      repositoryId: project.repositoryId,
      target,
      environmentTag: project.analysis.compatibleEnvironments[0] ?? "ghcr.io/charfeddineaz/apk-android-builder:latest",
      autoRepair: opts.autoRepair ?? true,
      createFixPr: opts.createFixPr ?? false,
      triggeredBy: opts.triggeredBy ?? "manual",
    };
    const prepared = { request: req, source: `/repos/${project.repositoryId}`, environmentTag: req.environmentTag, env: {}, files: project.files };
    this.d.audit?.record({ action: "build.start", projectId, result: "success" });
    this.d.notify.publish({ event: "build.started", projectId, message: `Building ${target} for ${project.repoName}` });
    const result = await this.d.orchestrator.run(req, prepared, project.analysis);
    this.d.audit?.record({ action: "build.finish", projectId, result: result.status === "success" ? "success" : "failure" });

    // Auto Fix PR (section 22): if enabled and the build applied repairs, open a
    // review-ready PR on an isolated branch instead of editing main.
    if (opts.createFixPr && this.d.github && this.d.repairBranch && project.repositoryId.includes("/")) {
      const patches = result.attempts.flatMap((a) => a.repairPatches ?? []);
      if (patches.length) {
        const [owner, repo] = project.repositoryId.split("/");
        try {
          const pr = await this.d.repairBranch.createFixPullRequest({
            repositoryId: project.repositoryId,
            owner,
            repo,
            baseBranch: "main",
            buildId: result.buildId,
            files: project.files,
            patches,
            title: `APK Factory: auto-fix build issues (${result.buildId})`,
          });
          result.fixPrUrl = pr.prUrl;
          this.d.audit?.record({ action: "pr.created", projectId, result: "success" });
          await this.d.notify.publish({ event: "pr.created", projectId, buildId: result.buildId, message: `Fix PR #${pr.prNumber}: ${pr.prUrl}` });
        } catch (e) {
          this.d.log.warn("auto PR creation failed", { error: String(e) });
        }
      }
    }

    await this.d.store.builds.put({ id: result.buildId, projectId, result, createdAt: new Date().toISOString() });
    await this.d.notify.publish({
      event: result.status === "success" ? "build.success" : "build.failed",
      projectId,
      buildId: result.buildId,
      message: result.status === "success" ? "Build successful" : `Build failed: ${result.failureReason?.slice(0, 80)}`,
    });
    return result;
  }

  async getBuild(id: string) {
    return this.d.store.builds.get(id);
  }

  getAuditLogs(limit = 100): AuditEntry[] {
    return this.d.audit?.list(limit) ?? [];
  }

  getUsageSummary() {
    return this.d.usage?.summary() ?? [];
  }

  getQuotaStatus() {
    return this.d.quota.all();
  }

  async listProjects() {
    return this.d.store.projects.list();
  }
}

export interface PlatformEnv {
  MASTER_SECRET?: string;
  CF_ACCOUNT_ID?: string;
  CF_AI_TOKEN?: string;
  OPENAI_API_KEY?: string;
  WEBHOOK_URL?: string;
  GITHUB_TOKEN?: string;
}

export function createPlatform(env: PlatformEnv = {}, store: Store = new InMemoryStore()): Platform {
  const log = new Logger("platform");
  const quota = new QuotaManager();
  const repair = new RepairEngine(new KnowledgeBase(), new AiRouter({ workersAi: env.CF_ACCOUNT_ID ? { accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_AI_TOKEN ?? "" } : undefined, openAi: env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : undefined }));
  const notify = new NotificationService([new ConsoleChannel(log.child("notify"))]);
  if (env.WEBHOOK_URL) notify.add({ name: "webhook", send: async (p) => { try { await fetch(env.WEBHOOK_URL!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }); } catch { /* ignore */ } } });
  const orchestrator = new BuildOrchestrator({ quota, repair, validator: new ApkValidator(log.child("validator")), router: new BuildRouter(quota), log: log.child("orchestrator") });
  const github = env.GITHUB_TOKEN ? new GithubClient(env.GITHUB_TOKEN) : undefined;
  const repairBranch = github ? new RepairBranchService(github, log.child("repair-branch")) : undefined;
  const audit = new AuditService(log.child("audit"));
  const usage = new UsageService();
  quota.onConsume = (provider, amount, unit) => usage.record(provider, amount, unit);
  return new Platform({
    store,
    analyzer: new ProjectAnalyzer(log.child("analyzer")),
    orchestrator,
    quota,
    repair,
    validator: new ApkValidator(log.child("validator")),
    notify,
    log,
    github,
    repairBranch,
    audit,
    usage,
  });
}

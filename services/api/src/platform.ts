/**
 * Platform — wires every service behind one facade used by the API gateway.
 * This is where the architecture becomes a single working product:
 *   GitHub repo (files) → Analyzer → Health Report
 *                      → Orchestrator (Router + Retry + Repair)
 *                      → Validator → Artifacts (R2, signed URLs) → Notifications
 *
 * Zero-Manual-Config additions: sessions, real GitHub OAuth, secrets manager,
 * automatic release signing, setup wizard/status and repair diff previews.
 */

import type { ArtifactMeta, BuildResult, BuildTarget, ConnectedAccount, PatchProposal, ProjectAnalysis } from "@apk-factory/types";
import { Logger } from "@apk-factory/logger";
import { MemoryRepoSource, ProjectAnalyzer } from "@apk-factory/analyzer";
import { BuildOrchestrator, BuildRouter } from "@apk-factory/orchestrator";
import { QuotaManager, UsageService } from "@apk-factory/quota-manager";
import { KnowledgeBase, AiRouter, RepairEngine, RepairBranchService, previewPatches, type RepairPreview } from "@apk-factory/repair-agent";
import { ApkValidator } from "@apk-factory/validator";
import { ConsoleChannel, NotificationService } from "@apk-factory/notification-service";
import { GithubClient } from "@apk-factory/github";
import { TokenVault } from "@apk-factory/security";
import { SigningService, type PreparedBuild, type SigningStatus } from "@apk-factory/build-core";
import { AuditService, type AuditEntry } from "./audit.js";
import { InMemoryStore, type Store, type UserAccount, type Project } from "./store.js";
import { SupabaseStore } from "./store-supabase.js";
import { ArtifactService, ArtifactSigner, MemoryArtifactStore, R2ArtifactStore, type R2Like } from "./storage.js";
import { SessionService, type SessionPayload } from "./session.js";
import { GithubOAuth } from "./oauth-github.js";
import { SecretsService, KNOWN_SECRETS, type SecretScope, type SecretView } from "./secrets.js";
import { platformStatus, userChecklist, connectionsView, probeGithub, verifyGithubSignature, type PlatformStatus, type UserChecklist, type ConnectionView, type SetupEnv } from "./setup.js";

export const PLATFORM_VERSION = "1.1.0";

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
  artifacts?: ArtifactService;
  session?: SessionService;
  githubOAuth?: GithubOAuth;
  secrets?: SecretsService;
  signing?: SigningService;
  vault?: TokenVault;
  env?: SetupEnv;
}

export class Platform {
  constructor(readonly d: PlatformDeps) {}

  // ── Auth / sessions ──────────────────────────────────────────────────────

  async ensureUser(profile: { googleId: string; email: string; name: string; avatar?: string }): Promise<UserAccount> {
    const existing = await this.d.store.users.byGoogle(profile.googleId);
    if (existing) return existing;
    const user: UserAccount = {
      id: `usr_${crypto.randomUUID().slice(0, 8)}`,
      ...profile,
      createdAt: new Date().toISOString(),
      settings: {},
    };
    await this.d.store.users.put(user);
    this.d.notify.publish({ event: "build.queued", projectId: user.id, message: `Welcome ${user.name}` });
    this.d.audit?.record({ action: "auth.google", user: user.id, result: "success" });
    return user;
  }

  async issueSession(user: UserAccount, provider: SessionPayload["provider"]): Promise<string | undefined> {
    return this.d.session?.issue({ sub: user.id, email: user.email, name: user.name, avatar: user.avatar, provider });
  }

  async currentUser(request: Request): Promise<(SessionPayload & { account?: UserAccount }) | undefined> {
    if (!this.d.session) return undefined;
    const payload = await this.d.session.verify(SessionService.bearer(request));
    if (!payload) return undefined;
    return { ...payload, account: await this.d.store.users.get(payload.sub) };
  }

  githubOAuthAvailable(): boolean {
    return Boolean(this.d.githubOAuth?.configured && this.d.session);
  }

  async githubStart(mode: "read" | "write", next = "/dashboard", existingUserId?: string): Promise<string> {
    if (!this.d.githubOAuth?.configured || !this.d.session) throw new Error("GitHub OAuth is not configured (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)");
    const state = await this.d.session.issueState({ next, mode, ...(existingUserId ? { uid: existingUserId } : {}) });
    return this.d.githubOAuth.authorizeUrl(state, mode);
  }

  /** OAuth callback: exchange code → GitHub user → platform user + sealed token → session. */
  async githubCallback(code: string, state: string): Promise<{ redirect: string }> {
    const oauth = this.d.githubOAuth;
    if (!oauth?.configured || !this.d.session || !this.d.secrets) throw new Error("GitHub OAuth is not configured");
    const st = await this.d.session.verifyState(state);
    if (!st) return { redirect: oauth.errorRedirect("Invalid or expired OAuth state — please try again.") };
    try {
      const tok = await oauth.exchangeCode(code);
      const gh = await oauth.fetchUser(tok.accessToken);
      let user: UserAccount | undefined = st.uid ? await this.d.store.users.get(st.uid) : undefined;
      if (!user) {
        user = await this.ensureUser({ googleId: `github:${gh.id}`, email: gh.email ?? `${gh.login}@users.noreply.github.com`, name: gh.name ?? gh.login, avatar: gh.avatarUrl });
      }
      await this.d.secrets.set("connection", user.id, "GITHUB_OAUTH_TOKEN", tok.accessToken, { login: gh.login, scope: tok.scope });
      const account: ConnectedAccount = { provider: "github", userId: user.id, externalId: String(gh.id), email: gh.email ?? undefined, scopes: tok.scope.split(",").filter(Boolean), connectedAt: new Date().toISOString(), status: "connected" };
      await this.d.store.accounts.put(account);
      this.d.audit?.record({ action: "connection.github", user: user.id, provider: "github", result: "success", detail: gh.login });
      const session = await this.d.session.issue({ sub: user.id, email: user.email, name: user.name, avatar: user.avatar, provider: "github" });
      return { redirect: oauth.successRedirect(session, st.next || "/dashboard") };
    } catch (e) {
      this.d.log.warn("github oauth failed", { error: String(e) });
      this.d.audit?.record({ action: "connection.github", provider: "github", result: "failure", detail: String(e).slice(0, 120) });
      return { redirect: oauth.errorRedirect("GitHub sign-in failed") };
    }
  }

  /** GitHub client for a user: OAuth token → pasted GITHUB_TOKEN secret → platform token. */
  private async githubFor(userId?: string): Promise<GithubClient | undefined> {
    if (userId && this.d.secrets) {
      const oauthTok = await this.d.secrets.value("connection", userId, "GITHUB_OAUTH_TOKEN");
      if (oauthTok) return new GithubClient(oauthTok, undefined, this.d.log.child("github"));
      const pat = await this.d.secrets.value("user", userId, "GITHUB_TOKEN");
      if (pat) return new GithubClient(pat, undefined, this.d.log.child("github"));
    }
    return this.d.github;
  }

  async disconnect(userId: string, provider: ConnectedAccount["provider"]): Promise<void> {
    await this.d.store.accounts.remove(userId, provider);
    if (provider === "github") await this.d.secrets?.delete("connection", userId, "GITHUB_OAUTH_TOKEN");
    this.d.audit?.record({ action: "connection.disconnect", user: userId, provider, result: "success" });
  }

  // ── Setup wizard / status / connections ──────────────────────────────────

  status(): PlatformStatus {
    return platformStatus(this.d.env ?? {}, PLATFORM_VERSION);
  }

  async connections(userId?: string, probe = false): Promise<ConnectionView[]> {
    const accounts = userId ? await this.d.store.accounts.list(userId) : [];
    const user = userId ? await this.d.store.users.get(userId) : undefined;
    const probes: Parameters<typeof connectionsView>[0]["probes"] = {};
    if (probe && userId && this.d.secrets) {
      const tok = await this.d.secrets.value("connection", userId, "GITHUB_OAUTH_TOKEN");
      if (tok) probes.github = await probeGithub(tok);
    }
    return connectionsView({
      user: user ? { id: user.id, provider: user.googleId.startsWith("github:") ? "github" : "google", email: user.email, name: user.name } : undefined,
      accounts,
      githubOauthAvailable: this.githubOAuthAvailable(),
      secrets: this.d.secrets ?? new SecretsService(new TokenVault("ephemeral-secret-0123456789")),
      probes,
    });
  }

  async checklist(userId?: string): Promise<UserChecklist> {
    const projects = (await this.d.store.projects.list()).filter((p) => !userId || !p.userId || p.userId === userId);
    let builds = 0;
    let signingReady = false;
    for (const p of projects) {
      builds += (await this.d.store.builds.listByProject(p.id)).length;
      if (!signingReady && this.d.signing) signingReady = (await this.d.signing.status(p.id)).keystoreReady;
    }
    const accounts = userId ? await this.d.store.accounts.list(userId) : [];
    const sec = this.d.secrets;
    return userChecklist({
      signedIn: Boolean(userId),
      githubConnected: accounts.some((a) => a.provider === "github") || Boolean(userId && sec && (await sec.has("user", userId, "GITHUB_TOKEN"))),
      githubOauthAvailable: this.githubOAuthAvailable(),
      projects: projects.length,
      builds,
      hasExpoToken: Boolean(userId && sec && (await sec.has("user", userId, "EXPO_TOKEN"))),
      hasPlayServiceAccount: Boolean(userId && sec && (await sec.has("user", userId, "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"))),
      signingReady,
    });
  }

  // ── Secrets ──────────────────────────────────────────────────────────────

  private secretsOrThrow(): SecretsService {
    if (!this.d.secrets) throw new Error("Secrets manager disabled: set MASTER_SECRET");
    return this.d.secrets;
  }

  async listSecrets(scope: SecretScope, ownerId: string): Promise<{ secrets: SecretView[]; known: typeof KNOWN_SECRETS }> {
    const known = Object.fromEntries(Object.entries(KNOWN_SECRETS).map(([k, v]) => [k, { label: v.label, provider: v.provider, hint: v.hint }])) as typeof KNOWN_SECRETS;
    return { secrets: await this.secretsOrThrow().list(scope, ownerId), known };
  }

  async setSecret(scope: SecretScope, ownerId: string, name: string, value: string, actor?: string): Promise<SecretView> {
    const v = await this.secretsOrThrow().set(scope, ownerId, name, value);
    this.d.audit?.record({ action: "secret.set", user: actor, projectId: scope === "project" ? ownerId : undefined, result: "success", detail: name });
    return v;
  }

  async deleteSecret(scope: SecretScope, ownerId: string, name: string, actor?: string): Promise<void> {
    await this.secretsOrThrow().delete(scope, ownerId, name);
    this.d.audit?.record({ action: "secret.delete", user: actor, result: "success", detail: name });
  }

  // ── Signing ──────────────────────────────────────────────────────────────

  private signingOrThrow(): SigningService {
    if (!this.d.signing) throw new Error("Signing service disabled: set MASTER_SECRET");
    return this.d.signing;
  }

  async signingStatus(projectId: string): Promise<SigningStatus & { gradleBlock: string }> {
    const svc = this.signingOrThrow();
    const st = await svc.status(projectId);
    return { ...st, gradleBlock: svc.gradleSnippet(projectId).gradleBlock };
  }

  async ensureSigning(projectId: string, actor?: string): Promise<SigningStatus> {
    const project = await this.d.store.projects.get(projectId);
    if (!project) throw new Error("project not found");
    const st = await this.signingOrThrow().ensure(projectId, { repoName: project.repoName, org: project.org });
    this.d.audit?.record({ action: "signing.ensure", user: actor, projectId, result: "success" });
    return st;
  }

  async rotateSigning(projectId: string, actor?: string): Promise<SigningStatus> {
    const st = await this.signingOrThrow().rotate(projectId);
    this.d.audit?.record({ action: "signing.rotate", user: actor, projectId, result: "success" });
    return st;
  }

  /** Builder callback: persist the keystore generated on the first build. */
  async storeKeystore(projectId: string, keystoreBase64: string, certSha256?: string): Promise<SigningStatus> {
    const st = await this.signingOrThrow().storeKeystore(projectId, keystoreBase64, certSha256);
    this.d.audit?.record({ action: "signing.keystore.stored", projectId, result: "success" });
    return st;
  }

  async exportKeystore(projectId: string, actor?: string): Promise<Buffer | null> {
    const buf = await this.signingOrThrow().exportKeystore(projectId);
    this.d.audit?.record({ action: "signing.keystore.export", user: actor, projectId, result: buf ? "success" : "failure" });
    return buf;
  }

  // ── Projects / analysis ──────────────────────────────────────────────────

  async analyzeRepo(input: { repositoryId: string; repoName: string; org: string; files: Record<string, string>; userId?: string; ref?: string }): Promise<{ project: Project; analysis: ProjectAnalysis }> {
    const existing = await this.d.store.projects.byRepo(input.repositoryId);
    const analysis = await this.d.analyzer.analyze(new MemoryRepoSource(input.files), {
      repositoryId: input.repositoryId,
      repoName: input.repoName,
      org: input.org,
    });
    const project: Project = existing ?? {
      id: `prj_${crypto.randomUUID().slice(0, 8)}`,
      userId: input.userId,
      repositoryId: input.repositoryId,
      repoName: input.repoName,
      org: input.org,
      files: input.files,
      createdAt: new Date().toISOString(),
      autoBuild: false,
    };
    project.files = input.files;
    project.analysis = analysis;
    if (input.ref) project.ref = input.ref;
    if (!project.userId && input.userId) project.userId = input.userId;
    await this.d.store.projects.put(project);
    // Zero-config: every project gets sealed signing credentials immediately.
    if (this.d.signing) await this.d.signing.ensure(project.id, { repoName: project.repoName, org: project.org }).catch(() => undefined);
    this.d.audit?.record({ action: "project.analyze", user: input.userId, projectId: project.id, result: "success" });
    return { project, analysis };
  }

  /** Import a repository straight from GitHub (owner/repo or URL) using the user's token. */
  async importFromGithub(input: { repo: string; ref?: string; userId?: string }): Promise<{ project: Project; analysis: ProjectAnalysis }> {
    const m = input.repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").match(/^([^/\s]+)\/([^/\s]+)/);
    if (!m) throw new Error("expected owner/repo or a github.com URL");
    const [, owner, repo] = m;
    const gh = await this.githubFor(input.userId);
    if (!gh) throw new Error("GitHub is not connected — connect GitHub or add a GITHUB_TOKEN secret first");
    const snap = await gh.fetchAnalysisSnapshot(owner, repo, input.ref);
    if (!Object.keys(snap.files).length) throw new Error("no manifest files found in repository (package.json / app.json / build.gradle / pubspec.yaml)");
    return this.analyzeRepo({ repositoryId: `${owner}/${repo}`, repoName: repo, org: owner, files: snap.files, userId: input.userId, ref: snap.ref });
  }

  async listGithubRepos(userId?: string): Promise<{ fullName: string; defaultBranch: string; private: boolean }[]> {
    const gh = await this.githubFor(userId);
    if (!gh) throw new Error("GitHub is not connected");
    return gh.listRepositories();
  }

  /** §22 — diff preview of the fixes the platform would apply (nothing is written). */
  async previewRepairs(projectId: string, patches?: PatchProposal[]): Promise<RepairPreview & { source: "suggestions" | "build" | "custom" }> {
    const project = await this.d.store.projects.get(projectId);
    if (!project || !project.analysis) throw new Error("project not analyzed");
    if (patches?.length) return { ...previewPatches(project.files, patches), source: "custom" };
    const fromSuggestions = project.analysis.suggestions.map((s) => s.patch).filter((p): p is PatchProposal => Boolean(p));
    if (fromSuggestions.length) return { ...previewPatches(project.files, fromSuggestions), source: "suggestions" };
    const builds = await this.d.store.builds.listByProject(projectId);
    const last = builds[builds.length - 1];
    const fromBuild = last?.result.attempts.flatMap((a) => a.repairPatches ?? []) ?? [];
    return { ...previewPatches(project.files, fromBuild), source: "build" };
  }

  /** Apply approved patches to the project snapshot (local copy) and re-analyze. */
  async applyRepairs(projectId: string, patches: PatchProposal[], actor?: string): Promise<{ project: Project; analysis: ProjectAnalysis; applied: number }> {
    const project = await this.d.store.projects.get(projectId);
    if (!project) throw new Error("project not found");
    const { previews } = previewPatches(project.files, patches);
    const applicable = previews.filter((p) => p.kind === "file" && p.diff);
    let files = { ...project.files };
    for (const p of applicable) files[p.file] = p.after;
    const out = await this.analyzeRepo({ repositoryId: project.repositoryId, repoName: project.repoName, org: project.org, files, userId: project.userId, ref: project.ref });
    this.d.audit?.record({ action: "repair.apply", user: actor, projectId, result: "success", detail: `${applicable.length} patch(es)` });
    return { ...out, applied: applicable.length };
  }

  // ── Builds ───────────────────────────────────────────────────────────────

  async startBuild(projectId: string, opts: { target?: BuildTarget; autoRepair?: boolean; createFixPr?: boolean; triggeredBy?: "manual" | "webhook-push" | "webhook-release" | "schedule"; userId?: string } = {}): Promise<BuildResult> {
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
    // Zero-config env: user/project secrets + sealed signing credentials (never logged).
    const userId = opts.userId ?? project.userId;
    const env: Record<string, string> = {
      ...(this.d.secrets ? await this.d.secrets.envFor(userId, projectId) : {}),
      ...(this.d.signing ? await this.d.signing.buildEnv(projectId) : {}),
    };
    const prepared: PreparedBuild = { request: req, source: `/repos/${project.repositoryId}`, environmentTag: req.environmentTag, env, files: project.files };
    this.d.audit?.record({ action: "build.start", user: userId, projectId, result: "success" });
    this.d.notify.publish({ event: "build.started", projectId, message: `Building ${target} for ${project.repoName}` });
    const result = await this.d.orchestrator.run(req, prepared, project.analysis);
    result.buildId = `bld_${crypto.randomUUID().slice(0, 8)}`;
    this.d.audit?.record({ action: "build.finish", projectId, result: result.status === "success" ? "success" : "failure" });

    // Artifacts (§27): persist logs/report (+ APK bytes when a real backend produced them) and hand out signed URLs.
    if (this.d.artifacts) {
      try {
        const uploads: Parameters<ArtifactService["storeAll"]>[2] = [
          { type: "logs", name: "build.log", bytes: new TextEncoder().encode(result.attempts.map((a) => `# attempt ${a.index} (${a.provider}) → ${a.status}\n${a.logs}`).join("\n")) },
          { type: "report", name: "report.json", bytes: new TextEncoder().encode(JSON.stringify({ analysis: project.analysis, validation: result.validation, route: result.route }, null, 2)) },
        ];
        if (result.status === "success" && prepared.apkBuffer) uploads.unshift({ type: target === "aab" ? "aab" : "apk", name: `${project.repoName}-release.${target === "aab" ? "aab" : "apk"}`, bytes: new Uint8Array(prepared.apkBuffer) });
        const metas: ArtifactMeta[] = await this.d.artifacts.storeAll(projectId, result.buildId, uploads);
        result.artifacts = [...(result.artifacts ?? []), ...metas];
      } catch (e) {
        this.d.log.warn("artifact upload failed", { error: String(e) });
      }
    }

    // Auto Fix PR (section 22): if enabled and the build applied repairs, open a
    // review-ready PR on an isolated branch instead of editing main.
    const github = await this.githubFor(userId);
    const repairBranch = github ? (github === this.d.github && this.d.repairBranch ? this.d.repairBranch : new RepairBranchService(github, this.d.log.child("repair-branch"))) : undefined;
    if (opts.createFixPr && github && repairBranch && project.repositoryId.includes("/")) {
      const patches = result.attempts.flatMap((a) => a.repairPatches ?? []);
      if (patches.length) {
        const [owner, repo] = project.repositoryId.split("/");
        try {
          const pr = await repairBranch.createFixPullRequest({
            repositoryId: project.repositoryId,
            owner,
            repo,
            baseBranch: project.ref ?? "main",
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

  async listBuilds(projectId: string) {
    return this.d.store.builds.listByProject(projectId);
  }

  /** Serve an artifact for a signed URL. */
  async serveArtifact(key: string, exp: number, sig: string): Promise<Response> {
    if (!this.d.artifacts) return new Response(JSON.stringify({ error: "artifact storage disabled" }), { status: 503, headers: { "content-type": "application/json" } });
    return this.d.artifacts.serve(key, exp, sig);
  }

  async refreshArtifact(key: string) {
    if (!this.d.artifacts) throw new Error("artifact storage disabled");
    return this.d.artifacts.refresh(key);
  }

  async verifyWebhook(rawBody: string, signature: string | null): Promise<boolean> {
    const secret = this.d.env?.GITHUB_WEBHOOK_SECRET;
    if (!secret) return true; // dev mode: unsigned accepted (status() flags this)
    return verifyGithubSignature(secret, rawBody, signature);
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

  async listProjects(userId?: string) {
    const all = await this.d.store.projects.list();
    return userId ? all.filter((p) => !p.userId || p.userId === userId) : all;
  }
}

export interface PlatformEnv extends SetupEnv {
  MASTER_SECRET?: string;
  CF_ACCOUNT_ID?: string;
  CF_AI_TOKEN?: string;
  OPENAI_API_KEY?: string;
  WEBHOOK_URL?: string;
  GITHUB_TOKEN?: string;
  /** R2 bucket binding (wrangler.toml [[r2_buckets]] binding = "ARTIFACTS"). */
  ARTIFACTS?: R2Like;
}

export function createPlatform(env: PlatformEnv = {}, store?: Store): Platform {
  const log = new Logger("platform");
  const resolvedStore: Store = store ?? (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) : new InMemoryStore());
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

  // Security-dependent services need a real master secret (dev falls back to a local one).
  const masterSecret = env.MASTER_SECRET && env.MASTER_SECRET.length >= 16 ? env.MASTER_SECRET : env.ENVIRONMENT === "production" ? undefined : "local-dev-secret-change-me";
  const vault = masterSecret ? new TokenVault(masterSecret) : undefined;
  const session = masterSecret ? new SessionService(masterSecret) : undefined;
  const secrets = vault ? new SecretsService(vault, resolvedStore.secrets) : undefined;
  const signing = vault ? new SigningService(vault, resolvedStore.signing) : undefined;
  const apiPublic = env.API_PUBLIC_URL || "http://localhost:8787";
  const artifacts = masterSecret ? new ArtifactService(env.ARTIFACTS ? new R2ArtifactStore(env.ARTIFACTS) : new MemoryArtifactStore(), new ArtifactSigner(masterSecret, apiPublic)) : undefined;
  const githubOAuth = env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
    ? new GithubOAuth({ clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, redirectUri: `${apiPublic.replace(/\/$/, "")}/auth/github/callback`, webOrigin: env.WEB_ORIGIN || "http://localhost:3000" })
    : undefined;

  return new Platform({
    store: resolvedStore,
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
    artifacts,
    session,
    githubOAuth,
    secrets,
    signing,
    vault,
    env,
  });
}

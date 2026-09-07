import { describe, it, expect } from "vitest";
import { BuildRouter, BuildOrchestrator, MAX_ATTEMPTS } from "./index.js";
import type { BuildBackend, PreparedBuild } from "@apk-factory/build-core";
import { NullBuildBackend } from "@apk-factory/build-core";
import { QuotaManager } from "@apk-factory/quota-manager";
import { KnowledgeBase, AiRouter, RepairEngine } from "@apk-factory/repair-agent";
import type { BuildProvider, BuildRequest, ProjectAnalysis } from "@apk-factory/types";

class FlakyBackend implements BuildBackend {
  constructor(public readonly provider: BuildProvider, private failsLeft: number) {}
  capabilities() { return { provider: this.provider, supportedTargets: ["apk"] as ("apk")[], costMinutes: 1, concurrent: 1 }; }
  async submit() { return { jobId: `j-${this.provider}` }; }
  async poll() {
    if (this.failsLeft > 0) { this.failsLeft--; return { status: "failed" as const, logs: "npm error ERESOLVE react-native-dynamic peer conflict" }; }
    return { status: "success" as const, logs: "build ok" };
  }
  cancel() {}
  cleanup() {}
}

const EXPO_ANALYSIS: ProjectAnalysis = {
  repositoryId: "r", detectedAt: "", frameworks: [], primaryFramework: "expo", language: "typescript",
  versions: {}, nodeRequirement: { min: "20", recommended: "20" }, nativeModules: [], dependencies: [],
  architecture: "standard", signing: { configured: false, production: false, debug: true }, permissions: [],
  assets: { valid: true, appIcon: true, adaptiveIcon: true, splash: true, missing: [] },
  issues: [], suggestions: [], score: { buildReadiness: 100, dependencies: 100, android: 100, security: 100, assets: 100, signing: 100, compatibility: 100, overall: 100 },
  compatibleEnvironments: ["x"],
};

const req = (over: Partial<BuildRequest> = {}): BuildRequest => ({
  projectId: "p1", repositoryId: "r", target: "apk", environmentTag: "x", autoRepair: false,
  createFixPr: false, triggeredBy: "manual", ...over,
});

const prepared = (): PreparedBuild => ({ request: req(), source: "/tmp/x", environmentTag: "x", env: {} });

function makeOrchestrator(quota: QuotaManager, backends?: Map<BuildProvider, BuildBackend>) {
  const repair = new RepairEngine(new KnowledgeBase(), new AiRouter());
  return new BuildOrchestrator({ quota, repair, backends, router: new BuildRouter(quota) });
}

describe("BuildRouter", () => {
  it("orders providers by framework when quota is available", () => {
    const r = new BuildRouter(new QuotaManager());
    expect(r.select(EXPO_ANALYSIS)).toEqual(["eas", "github-actions", "cloudflare-builds"]);
  });

  it("returns empty when the forced provider is out of quota", () => {
    const q = new QuotaManager({ eas: { provider: "eas", plan: "free", remaining: 0, unit: "builds", resetsAt: new Date().toISOString() } });
    const r = new BuildRouter(q);
    expect(r.select(EXPO_ANALYSIS, "eas")).toEqual([]);
  });
});

describe("BuildOrchestrator", () => {
  it("succeeds on the first attempt", async () => {
    const o = makeOrchestrator(new QuotaManager(), new Map([["eas", new NullBuildBackend()]]));
    const res = await o.run(req(), prepared(), EXPO_ANALYSIS);
    expect(res.status).toBe("success");
    expect(res.attempts).toHaveLength(1);
  });

  it("retries and applies a known repair after a failure", async () => {
    const q = new QuotaManager({ "github-actions": { provider: "github-actions", plan: "free", remaining: 0, unit: "minutes", resetsAt: new Date().toISOString() }, "cloudflare-builds": { provider: "cloudflare-builds", plan: "free", remaining: 0, unit: "minutes", resetsAt: new Date().toISOString() } });
    const o = makeOrchestrator(q, new Map<BuildProvider, BuildBackend>([["eas", new FlakyBackend("eas", 1)]]));
    const res = await o.run(req({ autoRepair: true }), prepared(), EXPO_ANALYSIS);
    expect(res.status).toBe("success");
    expect(res.attempts).toHaveLength(2);
    expect(res.attempts[0].repairApplied).toBeTruthy();
  });

  it("stops after MAX_ATTEMPTS and reports the real reason", async () => {
    const q = new QuotaManager({ "github-actions": { provider: "github-actions", plan: "free", remaining: 0, unit: "minutes", resetsAt: new Date().toISOString() }, "cloudflare-builds": { provider: "cloudflare-builds", plan: "free", remaining: 0, unit: "minutes", resetsAt: new Date().toISOString() } });
    const o = makeOrchestrator(q, new Map<BuildProvider, BuildBackend>([["eas", new FlakyBackend("eas", 99)]]));
    const res = await o.run(req({ autoRepair: true }), prepared(), EXPO_ANALYSIS);
    expect(res.status).toBe("failed");
    expect(res.attempts).toHaveLength(MAX_ATTEMPTS);
    expect(res.failureReason).toContain("ERESOLVE");
  });

  it("fails fast when no provider has quota", async () => {
    const q = new QuotaManager({
      eas: { provider: "eas", plan: "free", remaining: 0, unit: "builds", resetsAt: new Date().toISOString() },
      "github-actions": { provider: "github-actions", plan: "free", remaining: 0, unit: "minutes", resetsAt: new Date().toISOString() },
      "cloudflare-builds": { provider: "cloudflare-builds", plan: "free", remaining: 0, unit: "minutes", resetsAt: new Date().toISOString() },
    });
    const o = makeOrchestrator(q);
    const res = await o.run(req(), prepared(), EXPO_ANALYSIS);
    expect(res.status).toBe("failed");
    expect(res.failureReason).toContain("No available build provider");
  });

  it("builds an iOS target (validation skipped, target recorded)", async () => {
    const o = makeOrchestrator(new QuotaManager(), new Map([["eas", new NullBuildBackend()]]));
    const res = await o.run(req({ target: "ios" }), prepared(), EXPO_ANALYSIS);
    expect(res.status).toBe("success");
    expect(res.target).toBe("ios");
    expect(res.validation).toBeUndefined();
  });
});

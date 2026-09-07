import { describe, it, expect } from "vitest";
import { KnowledgeBase, errorHash, signatureFromLogs, extractErrorCode, AiRouter, MockAiProvider, RepairEngine, applyPatch } from "./index.js";

describe("KnowledgeBase", () => {
  it("matches a known ERESOLVE error via pattern", () => {
    const kb = new KnowledgeBase();
    const logs = "npm error ERESOLVE unable to resolve dependency tree for react-native-dynamic";
    const known = kb.lookup(extractErrorCode(logs), logs);
    expect(known?.code).toBe("ERESOLVE");
    expect(known?.patch?.file).toBe(".npmrc");
  });

  it("computes a stable error hash", () => {
    expect(errorHash("ERESOLVE", "x")).toHaveLength(16);
    expect(signatureFromLogs("line1\nerror: boom\nline3")).toContain("boom");
  });

  it("learns and records outcomes", () => {
    const kb = new KnowledgeBase();
    const e = kb.learn({ hash: "h1", code: "X", framework: "any", environment: "x", pattern: "boom", error: "boom", solution: "fix", successRate: 0.5 });
    expect(kb.all().some((x) => x.hash === "h1")).toBe(true);
    const before = e.successRate;
    kb.recordOutcome("h1", true);
    expect(kb.all().find((x) => x.hash === "h1")!.successRate).toBeGreaterThanOrEqual(before);
  });
});

describe("AiRouter", () => {
  it("routes to mock provider when no credentials", async () => {
    const r = new AiRouter();
    const c = await r.classify("some logs");
    expect(c.provider).toBe("mock");
  });
});

describe("RepairEngine", () => {
  it("returns an auto patch for a known low-risk error", async () => {
    const engine = new RepairEngine(new KnowledgeBase(), new AiRouter());
    const plan = await engine.plan("ERESOLVE react-native-dynamic peer conflict");
    expect(plan.source).toBe("knowledge");
    expect(plan.autoPatches.length).toBe(1);
    expect(plan.autoPatches[0].file).toBe(".npmrc");
  });

  it("routes unknown errors to AI as a proposed (level 3) patch", async () => {
    const engine = new RepairEngine(new KnowledgeBase(), new AiRouter());
    const plan = await engine.plan("totally novel crash xyz");
    expect(plan.source).toBe("ai");
    expect(plan.proposedPatches[0].level).toBe(3);
  });
});

describe("applyPatch", () => {
  it("adds legacy-peer-deps to .npmrc", () => {
    const out = applyPatch({}, { level: 1, file: ".npmrc", target: "legacy-peer-deps", value: "true", description: "x", risk: "low" });
    expect(out[".npmrc"]).toContain("legacy-peer-deps=true");
  });

  it("sets expo.android.package in app.json", () => {
    const out = applyPatch({ "app.json": JSON.stringify({ expo: { name: "x" } }) }, {
      level: 2, file: "app.json", target: "expo.android.package", value: "com.x.y", description: "x", risk: "low",
    });
    expect(JSON.parse(out["app.json"]).expo.android.package).toBe("com.x.y");
  });

  it("sets applicationId in android/build.gradle", () => {
    const out = applyPatch({ "android/build.gradle": "android {" }, {
      level: 2, file: "android/build.gradle", target: "applicationId", value: "com.x.y", description: "x", risk: "low",
    });
    expect(out["android/build.gradle"]).toContain('applicationId "com.x.y"');
  });
});

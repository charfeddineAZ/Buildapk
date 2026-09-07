import { describe, it, expect } from "vitest";
import { MemoryRepoSource, ProjectAnalyzer } from "./index.js";
import { resolveCompatibility } from "./compatibility.js";
import { computeScores } from "./score.js";

const EXPO_FIXTURE: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "CPAAutomator",
    dependencies: {
      expo: "^53.0.0",
      "expo-router": "~4.0.0",
      react: "19.0.0",
      "react-native": "0.79.3",
      "react-native-dynamic": "1.2.0",
    },
  }),
  "app.json": JSON.stringify({
    expo: {
      name: "CPAAutomator",
      icon: "./assets/icon.png",
      android: { permissions: ["INTERNET"], minSdkVersion: 24, targetSdkVersion: 35 },
    },
  }),
  "assets/icon.png": "binary",
  "assets/splash.png": "binary",
};

describe("ProjectAnalyzer", () => {
  it("detects an Expo project and its toolchain", async () => {
    const a = new ProjectAnalyzer();
    const r = await a.analyze(new MemoryRepoSource(EXPO_FIXTURE), {
      repositoryId: "repo_1",
      repoName: "CPAAutomator",
      org: "charfeddine",
    });
    expect(r.primaryFramework).toBe("expo");
    expect(r.versions.expo).toContain("53");
    expect(r.versions.react).toBe("19.0.0");
    expect(r.compatibleEnvironments[0]).toContain("sdk53");
  });

  it("flags a required android package issue and suggests a safe fix", async () => {
    const a = new ProjectAnalyzer();
    const r = await a.analyze(new MemoryRepoSource(EXPO_FIXTURE), { repositoryId: "repo_1", repoName: "CPAAutomator", org: "charfeddine" });
    const required = r.issues.filter((i) => i.severity === "required");
    expect(required.map((i) => i.id)).toContain("android-package-missing");
    const sugg = r.suggestions.find((s) => s.id === "fix-android-package");
    expect(sugg?.recommendedValue).toBe("com.charfeddine.cpaautomator");
    expect(sugg?.patch?.level).toBe(2);
  });

  it("detects a React 19 peer-dependency conflict and offers legacy-peer-deps", async () => {
    const a = new ProjectAnalyzer();
    const r = await a.analyze(new MemoryRepoSource(EXPO_FIXTURE), { repositoryId: "repo_1", repoName: "CPAAutomator" });
    const conflict = r.issues.find((i) => i.id === "dependency-conflict");
    expect(conflict?.severity).toBe("recommended");
    const sugg = r.suggestions.find((s) => s.id === "fix-peer-deps");
    expect(sugg?.patch?.file).toBe(".npmrc");
    expect(sugg?.patch?.value).toBe("true");
  });

  it("recommends production signing when no EAS production profile exists", async () => {
    const a = new ProjectAnalyzer();
    const r = await a.analyze(new MemoryRepoSource(EXPO_FIXTURE), { repositoryId: "repo_1" });
    const signing = r.issues.find((i) => i.id === "production-signing");
    expect(signing?.severity).toBe("recommended");
    expect(signing?.autoFixable).toBe(false);
  });

  it("produces a score where blockers cap build readiness", async () => {
    const a = new ProjectAnalyzer();
    const r = await a.analyze(new MemoryRepoSource(EXPO_FIXTURE), { repositoryId: "repo_1", repoName: "CPAAutomator" });
    expect(r.score.overall).toBeGreaterThan(0);
    expect(r.score.overall).toBeLessThanOrEqual(100);
    // required blocker => build readiness reduced
    expect(r.score.buildReadiness).toBeLessThan(100);
  });

  it("reports a clean project as good when package + signing are present", async () => {
    const clean: Record<string, string> = {
      "package.json": JSON.stringify({ name: "ok", dependencies: { expo: "^53.0.0", react: "19.0.0", "react-native": "0.79.3" } }),
      "app.json": JSON.stringify({ expo: { name: "ok", android: { package: "com.x.ok", minSdkVersion: 24, targetSdkVersion: 35 } } }),
      "eas.json": JSON.stringify({ build: { production: {} } }),
    };
    const a = new ProjectAnalyzer();
    const r = await a.analyze(new MemoryRepoSource(clean), { repositoryId: "repo_2" });
    expect(r.issues.find((i) => i.id === "android-package-missing")).toBeUndefined();
    expect(r.signing.production).toBe(true);
  });
});

describe("Compatibility matrix", () => {
  it("maps Expo 53 to Node 20 / Java 17 / SDK 35", () => {
    const m = resolveCompatibility("expo", { expo: "53.0.0" }, {});
    expect(m.node).toBe("20");
    expect(m.java).toBe("17");
    expect(m.androidSdk).toBe(35);
  });
  it("falls back to a sane image for unknown frameworks", () => {
    const m = resolveCompatibility("unknown", {}, {});
    expect(m.recommendedImage).toContain("apk-android-builder");
  });
});

describe("Scoring", () => {
  it("gives full build readiness with no issues", () => {
    const s = computeScores({
      issues: [], peerConflicts: 0, deprecated: 0, androidConfigured: true,
      androidPackageSet: true, minSdkSet: true, targetSdkSet: true,
      signing: { configured: true, production: true }, secretFindings: 0,
      assetsValid: true, environmentFound: true,
    });
    expect(s.buildReadiness).toBe(100);
    expect(s.overall).toBe(100);
  });
});

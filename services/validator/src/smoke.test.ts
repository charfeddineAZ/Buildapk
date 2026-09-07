import { describe, it, expect } from "vitest";
import { planSmokeTest, staticSmokeTest } from "./smoke.js";
import type { ApkValidation } from "@apk-factory/types";

const V: ApkValidation = {
  valid: true, fileExists: true, abis: ["arm64-v8a"], permissions: ["android.permission.INTERNET"],
  signing: { signed: true, v1: true, v2: true, v3: false },
  fileSizeBytes: 12345, sha256: "abc", warnings: [], errors: [],
  packageName: "com.x.y", versionCode: 1, versionName: "1.0", minSdk: 24, targetSdk: 34,
};

describe("smoke test", () => {
  it("plans install/launch steps", () => {
    const { steps, estimatedSeconds } = planSmokeTest(V);
    expect(steps.map((s) => s.name)).toEqual(["install", "launch", "main-activity", "permissions"]);
    expect(estimatedSeconds).toBeGreaterThan(0);
  });

  it("passes static smoke for a valid signed APK", () => {
    const r = staticSmokeTest(V);
    expect(r.passed).toBe(true);
  });

  it("fails static smoke for an unsigned APK", () => {
    const bad: ApkValidation = { ...V, signing: { signed: false, v1: false, v2: false, v3: false }, valid: false, errors: ["unsigned"] };
    expect(staticSmokeTest(bad).passed).toBe(false);
  });
});

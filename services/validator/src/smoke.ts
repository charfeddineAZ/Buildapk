/**
 * Smoke test planner (section 25). A Gradle "BUILD SUCCESSFUL" does not mean the
 * app launches, so before delivery we plan (and statically evaluate) a real
 * install/launch smoke test on an emulator:
 *   install → launch → main activity → permissions → no immediate crash.
 *
 * The full run needs an emulator/device; `staticSmokeTest` gives a fast,
 * code-free check from the validation result so the pipeline can gate delivery.
 */

import type { ApkValidation } from "@apk-factory/types";

export interface SmokeStep {
  name: string;
  command: string;
  expects: string;
}

export function planSmokeTest(v: ApkValidation): { steps: SmokeStep[]; estimatedSeconds: number } {
  const pkg = v.packageName ?? "com.example.app";
  const steps: SmokeStep[] = [
    { name: "install", command: `adb install -r app.apk`, expects: "Success" },
    { name: "launch", command: `adb shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, expects: "no crash" },
    { name: "main-activity", command: `adb shell dumpsys activity | grep ${pkg}`, expects: "resumed" },
    { name: "permissions", command: `adb shell dumpsys package ${pkg} | grep permission`, expects: `${v.permissions.length} granted` },
  ];
  return { steps, estimatedSeconds: 25 };
}

export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function staticSmokeTest(v: ApkValidation): { passed: boolean; checks: SmokeCheck[] } {
  const checks: SmokeCheck[] = [
    { name: "apk-valid", ok: v.valid, detail: v.valid ? "APK structure valid" : v.errors.join("; ") },
    { name: "package-present", ok: Boolean(v.packageName), detail: v.packageName ?? "missing package" },
    { name: "min-sdk-acceptable", ok: (v.minSdk ?? 0) >= 21, detail: `minSdk=${v.minSdk}` },
    { name: "has-code", ok: v.abis.length >= 0 && v.fileSizeBytes > 0, detail: `${v.fileSizeBytes} bytes` },
    { name: "signing", ok: v.signing.signed, detail: v.signing.signed ? `signed (v1:${v.signing.v1} v2:${v.signing.v2})` : "unsigned" },
  ];
  return { passed: checks.every((c) => c.ok), checks };
}

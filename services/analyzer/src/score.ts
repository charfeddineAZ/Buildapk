/**
 * Project scoring — turns raw findings into the 0..100 scores shown in the
 * Dashboard and the "no build before you fix" gate.
 */

import type { IssueSeverity, ProjectScore } from "@apk-factory/types";

export interface ScoreInput {
  issues: { severity: IssueSeverity; autoFixable: boolean }[];
  peerConflicts: number;
  deprecated: number;
  androidConfigured: boolean;
  androidPackageSet: boolean;
  minSdkSet: boolean;
  targetSdkSet: boolean;
  signing: { configured: boolean; production: boolean };
  secretFindings: number;
  assetsValid: boolean;
  environmentFound: boolean;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const wavg = (parts: [number, number][]) => {
  const total = parts.reduce((s, [, w]) => s + w, 0);
  const sum = parts.reduce((s, [v, w]) => s + v * w, 0);
  return clamp(total ? sum / total : 0);
};

export function computeScores(i: ScoreInput): ProjectScore {
  const required = i.issues.filter((x) => x.severity === "required").length;
  const recommended = i.issues.filter((x) => x.severity === "recommended").length;
  const optional = i.issues.filter((x) => x.severity === "optional").length;

  // Build readiness: blockers dominate; safe auto-fixable issues reduce less.
  const autoFixableRequired = i.issues.filter((x) => x.severity === "required" && x.autoFixable).length;
  const buildReadiness = clamp(100 - (required - autoFixableRequired) * 35 - recommended * 8 - optional * 2);

  const dependencies = clamp(100 - i.peerConflicts * 18 - i.deprecated * 8);

  let android = 100;
  if (!i.androidConfigured) android -= 40;
  if (!i.androidPackageSet) android -= 25;
  if (!i.minSdkSet) android -= 10;
  if (!i.targetSdkSet) android -= 10;
  android = clamp(android);

  const security = clamp(100 - i.secretFindings * 30);

  const assets = i.assetsValid ? 100 : 50;

  const signing = !i.signing.configured ? 30 : i.signing.production ? 100 : 60;

  const compatibility = i.environmentFound ? 100 : 65;

  const overall = wavg([
    [buildReadiness, 30],
    [dependencies, 20],
    [android, 20],
    [security, 10],
    [assets, 5],
    [signing, 5],
    [compatibility, 10],
  ]);

  return {
    buildReadiness,
    dependencies,
    android,
    security,
    assets,
    signing,
    compatibility,
    overall,
  };
}

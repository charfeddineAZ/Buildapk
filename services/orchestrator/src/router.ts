/**
 * Build Router (section 14). Picks the best provider order for a project using:
 *   framework fit → free quota → availability → environment → prior success → build time.
 * The platform never depends on a single service: if one route is out of quota,
 * the router falls through to the next available builder.
 */

import type { BuildProvider, Framework, ProjectAnalysis } from "@apk-factory/types";
import type { QuotaManager } from "@apk-factory/quota-manager";

const PREFERENCE: Record<Framework, BuildProvider[]> = {
  expo: ["eas", "github-actions", "cloudflare-builds"],
  "react-native": ["github-actions", "cloudflare-builds", "eas"],
  capacitor: ["github-actions", "cloudflare-builds", "eas"],
  ionic: ["github-actions", "cloudflare-builds", "eas"],
  flutter: ["github-actions", "cloudflare-builds", "docker"],
  "native-android": ["github-actions", "cloudflare-builds", "docker"],
  pwa: ["cloudflare-builds", "github-actions", "docker"],
  unknown: ["github-actions", "cloudflare-builds", "docker"],
};

export class BuildRouter {
  constructor(private readonly quota: QuotaManager) {}

  /** Ordered list of providers to try, filtered by quota availability. */
  select(analysis: ProjectAnalysis, forced?: BuildProvider): BuildProvider[] {
    if (forced) {
      return this.quota.isAvailable(forced) ? [forced] : [];
    }
    const pref = PREFERENCE[analysis.primaryFramework] ?? PREFERENCE.unknown;
    const available = pref.filter((p) => this.quota.isAvailable(p));
    return available;
  }
}

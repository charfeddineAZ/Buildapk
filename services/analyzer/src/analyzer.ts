/**
 * Project Analyzer — the most important layer.
 *
 * It never executes project code. It only reads manifest files (package.json,
 * app.json, gradle files, pubspec.yaml, ...) to build a ProjectHealth report,
 * a compatibility matrix and a list of categorized issues + suggestions.
 */

import type {
  AssetReport,
  DependencyInfo,
  DetectedFramework,
  Framework,
  ProjectAnalysis,
  ProjectIssue,
  ProjectScore,
  ProjectSuggestion,
  PatchProposal,
} from "@apk-factory/types";
import { Logger } from "@apk-factory/logger";
import { scanDangerousPermissions } from "@apk-factory/security";
import { detectFrameworks, primaryFramework, readPackageJson, type PkgJson } from "./detect.js";
import { resolveCompatibility } from "./compatibility.js";
import { computeScores, type ScoreInput } from "./score.js";
import type { RepoSource } from "./repo-source.js";

export interface AnalyzeOptions {
  repositoryId: string;
  repoName?: string;
  org?: string; // used to suggest a default android package name
}

/** Packages historically requiring --legacy-peer-deps on React 19. */
const KNOWN_LEGACY_PEER_DEPS = new Set([
  "react-native-dynamic",
  "react-native-reanimated",
  "react-native-gesture-handler",
  "react-native-screens",
]);

function major(v: string | undefined): number {
  if (!v) return 0;
  const m = v.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

interface AppJson {
  expo?: {
    name?: string;
    icon?: string;
    splash?: { image?: string };
    android?: {
      package?: string;
      adaptiveIcon?: { foregroundImage?: string; backgroundImage?: string };
      permissions?: string[];
      minSdkVersion?: number;
      targetSdkVersion?: number;
    };
  };
}

function parseAppJson(raw: string | null): AppJson {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as AppJson;
  } catch {
    return {};
  }
}

async function readGradleConfig(repo: RepoSource): Promise<{
  applicationId?: string;
  minSdk?: number;
  targetSdk?: number;
  compileSdk?: number;
}> {
  const gradlePath = (await repo.exists("android/build.gradle")) ? "android/build.gradle" : "build.gradle";
  const raw = await repo.readText(gradlePath);
  if (!raw) return {};
  const num = (re: RegExp) => {
    const m = raw.match(re);
    return m ? parseInt(m[1], 10) : undefined;
  };
  return {
    applicationId: raw.match(/applicationId\s+["']([^"']+)["']/)?.[1],
    minSdk: num(/minSdk\s*=\s*(\d+)/) ?? num(/minSdkVersion\s+(\d+)/),
    targetSdk: num(/targetSdk\s*=\s*(\d+)/) ?? num(/targetSdkVersion\s+(\d+)/),
    compileSdk: num(/compileSdk\s*=\s*(\d+)/) ?? num(/compileSdkVersion\s+(\d+)/),
  };
}

async function readEasProfiles(repo: RepoSource): Promise<{ hasProduction: boolean }> {
  const raw = await repo.readText("eas.json");
  if (!raw) return { hasProduction: false };
  try {
    const eas = JSON.parse(raw) as { build?: Record<string, unknown> };
    return { hasProduction: Boolean(eas.build && (eas.build.production || eas.build["production-*"])) };
  } catch {
    return { hasProduction: false };
  }
}

export class ProjectAnalyzer {
  constructor(private readonly log: Logger = new Logger("analyzer")) {}

  async analyze(repo: RepoSource, opts: AnalyzeOptions): Promise<ProjectAnalysis> {
    const t0 = Date.now();
    const { frameworks, language, pkg } = await detectFrameworks(repo);
    const primary = primaryFramework(frameworks);

    const appJsonRaw = (await repo.readText("app.json")) ?? (await repo.readText("app.config.json"));
    const appJson = parseAppJson(appJsonRaw);
    const gradle = await readGradleConfig(repo);
    const eas = await readEasProfiles(repo);

    const deps = collectDependencies(pkg);
    const nativeModules = deps
      .map((d) => d.name)
      .filter((n) => n.startsWith("react-native-") || n.startsWith("expo-"))
      .filter((n) => !["expo", "expo-router", "expo-status-bar", "expo-constants"].includes(n));

    const expoVersion = pkg.dependencies?.expo ?? pkg.devDependencies?.expo;
    const rnVersion = pkg.dependencies?.["react-native"];
    const reactVersion = pkg.dependencies?.react ?? pkg.devDependencies?.react;

    const matrix = resolveCompatibility(primary, {
      framework: expoVersion ?? rnVersion,
      expo: expoVersion,
      reactNative: rnVersion,
    }, pkg);

    // Android identity
    const androidPackage = appJson.expo?.android?.package ?? gradle.applicationId;
    const minSdkSet = Boolean(appJson.expo?.android?.minSdkVersion ?? gradle.minSdk);
    const targetSdkSet = Boolean(appJson.expo?.android?.targetSdkVersion ?? gradle.targetSdk);
    const androidConfigured = primary === "expo" ? Boolean(androidPackage) : Boolean(gradle.applicationId);

    // Dependency conflicts (peer)
    const reactMajor = major(reactVersion);
    const peerConflicts = deps.filter(
      (d) => KNOWN_LEGACY_PEER_DEPS.has(d.name) && reactMajor >= 19,
    ).length;
    const deprecated = deps.filter((d) => d.deprecated).length;

    // Assets
    const assets: AssetReport = {
      appIcon: Boolean(appJson.expo?.icon) || (await repo.exists("assets/icon.png")),
      adaptiveIcon: Boolean(appJson.expo?.android?.adaptiveIcon?.foregroundImage),
      splash: Boolean(appJson.expo?.splash?.image) || (await repo.exists("assets/splash.png")),
      valid: false,
      missing: [],
    };
    if (!assets.appIcon) assets.missing.push("app icon");
    if (!assets.adaptiveIcon) assets.missing.push("adaptive icon");
    if (!assets.splash) assets.missing.push("splash");
    assets.valid = assets.missing.length === 0;

    // Signing
    const signing = {
      configured: eas.hasProduction || Boolean(gradle.applicationId),
      production: eas.hasProduction,
      debug: true,
    };

    // Permissions
    const permissions = appJson.expo?.android?.permissions ?? [];

    // Issues + suggestions
    const issues: ProjectIssue[] = [];
    const suggestions: ProjectSuggestion[] = [];
    this.collectIssues(opts, {
      primary, androidPackage, minSdkSet, targetSdkSet, androidConfigured,
      peerConflicts, deprecated, assets, signing, permissions, reactMajor, deps,
    }, issues, suggestions);

    // Security: secrets scan on manifest/config files only (never send to AI).
    const secretFiles = ["app.json", "app.config.js", "app.config.ts", ".env", ".env.example", "google-services.json"];
    let secretFindings = 0;
    for (const f of secretFiles) {
      const c = await repo.readText(f);
      if (c && /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i.test(c)) {
        secretFindings++;
      }
    }

    // Security (§26): flag dangerous / over-privileged Android permissions.
    const danger = scanDangerousPermissions(permissions, permissions.length);
    const highRisk = danger.filter((d) => d.risk === "high");
    if (highRisk.length > 0) {
      issues.push({
        id: "dangerous-permissions",
        severity: "recommended",
        category: "security",
        title: `Dangerous permissions requested (${highRisk.length})`,
        description: highRisk.map((d) => `${d.permission}: ${d.reason}`).join("; "),
        autoFixable: false,
      });
    }

    const scoreInput: ScoreInput = {
      issues,
      peerConflicts,
      deprecated,
      androidConfigured,
      androidPackageSet: Boolean(androidPackage),
      minSdkSet,
      targetSdkSet,
      signing,
      secretFindings,
      assetsValid: assets.valid,
      environmentFound: Boolean(matrix.recommendedImage),
    };
    const score: ProjectScore = computeScores(scoreInput);

    this.log.info("analysis complete", { repositoryId: opts.repositoryId, primary, ms: Date.now() - t0, overall: score.overall });

    return {
      repositoryId: opts.repositoryId,
      detectedAt: new Date().toISOString(),
      frameworks,
      primaryFramework: primary,
      language,
      versions: {
        framework: expoVersion ?? rnVersion,
        expo: expoVersion,
        reactNative: rnVersion,
        react: reactVersion,
        gradle: matrix.gradle,
        kotlin: matrix.kotlin,
      },
      nodeRequirement: { min: matrix.node, recommended: matrix.node },
      androidRequirement: {
        minSdk: matrix.androidSdk - 4,
        targetSdk: matrix.androidSdk,
        compileSdk: matrix.androidSdk,
        buildTools: matrix.buildTools,
        java: matrix.java,
        gradle: matrix.gradle,
        kotlin: matrix.kotlin,
      },
      nativeModules,
      dependencies: deps,
      architecture: pkg.name && (await repo.exists("pnpm-workspace.yaml") || await repo.exists("turbo.json")) ? "monorepo" : "standard",
      signing,
      permissions,
      assets,
      issues,
      suggestions,
      score,
      compatibleEnvironments: [matrix.recommendedImage],
    };
  }

  private collectIssues(
    opts: AnalyzeOptions,
    ctx: {
      primary: Framework; androidPackage?: string; minSdkSet: boolean; targetSdkSet: boolean;
      androidConfigured: boolean; peerConflicts: number; deprecated: number;
      assets: AssetReport; signing: { configured: boolean; production: boolean }; permissions: string[];
      reactMajor: number; deps: DependencyInfo[];
    },
    issues: ProjectIssue[],
    suggestions: ProjectSuggestion[],
  ) {
    const suggestedPackage = `com.${(opts.org ?? "appfactory").toLowerCase()}.${slug(opts.repoName ?? "app")}`;

    if (!ctx.androidPackage) {
      const patch: PatchProposal = ctx.primary === "expo"
        ? { level: 2, file: "app.json", target: "expo.android.package", value: suggestedPackage, description: `Set android package to ${suggestedPackage}`, risk: "low" }
        : { level: 2, file: "android/build.gradle", target: "applicationId", value: suggestedPackage, description: `Set applicationId to ${suggestedPackage}`, risk: "low" };
      issues.push({
        id: "android-package-missing", severity: "required", category: "android-package",
        title: "Android package name missing",
        description: "Required for Android application identity (applicationId).",
        autoFixable: true,
      });
      suggestions.push({
        id: "fix-android-package", severity: "required", title: "Android package name missing",
        recommendedValue: suggestedPackage,
        reason: "Required for Android application identity.", patch,
      });
    }

    if (ctx.peerConflicts > 0) {
      const patch: PatchProposal = { level: 1, file: ".npmrc", target: "legacy-peer-deps", value: "true", description: "Install with legacy-peer-deps to bypass ERESOLVE conflicts", risk: "low" };
      issues.push({
        id: "dependency-conflict", severity: "recommended", category: "dependencies",
        title: `Dependency conflict (${ctx.peerConflicts})`,
        description: "A dependency is incompatible with the installed React version and may fail install with ERESOLVE.",
        autoFixable: true,
      });
      suggestions.push({
        id: "fix-peer-deps", severity: "recommended", title: "Dependency conflict detected",
        recommendedValue: "legacy-peer-deps",
        reason: "Use --legacy-peer-deps during installation to resolve peer conflicts.", patch,
      });
    }

    if (!ctx.signing.production) {
      issues.push({
        id: "production-signing", severity: "recommended", category: "signing",
        title: "Production signing not configured",
        description: "You can build a debug APK, but production distribution (Play Store) requires signing credentials.",
        autoFixable: false,
      });
      suggestions.push({
        id: "configure-signing", severity: "recommended", title: "Production signing not configured",
        reason: "Production distribution requires a signing key. Configure EAS credentials or upload a keystore.",
      });
    }

    if (!ctx.assets.valid) {
      issues.push({
        id: "assets-missing", severity: "recommended", category: "assets",
        title: `Missing assets: ${ctx.assets.missing.join(", ")}`,
        description: "Adaptive icons and splash improve store acceptance and device compatibility.",
        autoFixable: false,
      });
    }

    if (ctx.deprecated > 0) {
      issues.push({
        id: "deprecated-deps", severity: "optional", category: "dependencies",
        title: `${ctx.deprecated} deprecated dependencies`,
        description: "Deprecated packages may break on future SDK upgrades.",
        autoFixable: false,
      });
    }

    // Positive signals → "good"
    if (ctx.androidPackage) {
      issues.push({ id: "android-package-ok", severity: "good", category: "android-package", title: "Android package configured", description: ctx.androidPackage, autoFixable: false });
    }
    if (ctx.minSdkSet && ctx.targetSdkSet) {
      issues.push({ id: "android-sdk-ok", severity: "good", category: "android", title: "Android SDK levels set", description: `min/target SDK configured`, autoFixable: false });
    }
    if (ctx.assets.valid) {
      issues.push({ id: "assets-ok", severity: "good", category: "assets", title: "Assets valid", description: "All required assets present", autoFixable: false });
    }
  }
}

function slug(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 40);
}

function collectDependencies(pkg: PkgJson): DependencyInfo[] {
  const out: DependencyInfo[] = [];
  const push = (record: Record<string, string> | undefined, type: "dependency" | "devDependency") => {
    if (!record) return;
    for (const [name, version] of Object.entries(record)) out.push({ name, version, type });
  };
  push(pkg.dependencies, "dependency");
  push(pkg.devDependencies, "devDependency");
  return out;
}

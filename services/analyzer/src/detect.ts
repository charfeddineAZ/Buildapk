/**
 * Framework / language detection. Reads only the manifest files that identify
 * a project type — never executes any project code (Sandbox principle).
 */

import type { DetectedFramework, Framework, Language } from "@apk-factory/types";
import type { RepoSource } from "./repo-source.js";

export interface PkgJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  scripts?: Record<string, string>;
}

export async function readPackageJson(repo: RepoSource): Promise<{ pkg: PkgJson; raw: string } | null> {
  const raw = await repo.readText("package.json");
  if (!raw) return null;
  try {
    return { pkg: JSON.parse(raw) as PkgJson, raw };
  } catch {
    return { pkg: {}, raw };
  }
}

export async function detectFrameworks(repo: RepoSource): Promise<{
  frameworks: DetectedFramework[];
  language: Language;
  pkg: PkgJson;
}> {
  const frameworks: DetectedFramework[] = [];
  const pkgResult = await readPackageJson(repo);
  const pkg = pkgResult?.pkg ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (name: string) => Boolean(deps[name]);
  const hasAny = (...names: string[]) => names.some(has);

  // Flutter
  if (await repo.exists("pubspec.yaml")) {
    frameworks.push({ framework: "flutter", confidence: 1, evidence: ["pubspec.yaml"] });
  }

  // Expo
  if (has("expo") || has("expo-router") || (await repo.exists("app.json")) || (await repo.exists("app.config.js")) || (await repo.exists("app.config.ts"))) {
    const evidence = ["expo in dependencies"];
    if (has("expo-router")) evidence.push("expo-router");
    if (await repo.exists("app.json")) evidence.push("app.json");
    if (await repo.exists("app.config.js")) evidence.push("app.config.js");
    if (await repo.exists("app.config.ts")) evidence.push("app.config.ts");
    frameworks.push({ framework: "expo", confidence: has("expo") ? 0.98 : 0.8, evidence });
  }

  // Capacitor
  if (hasAny("capacitor", "@capacitor/core")) {
    frameworks.push({ framework: "capacitor", confidence: 0.95, evidence: ["@capacitor/core"] });
  }

  // Ionic (capacitor-based but distinct)
  if (hasAny("@ionic/react", "@ionic/angular", "@ionic/vue", "@ionic/core")) {
    frameworks.push({ framework: "ionic", confidence: 0.9, evidence: ["@ionic/*"] });
  }

  // React Native (bare)
  if (has("react-native") && !has("expo")) {
    frameworks.push({ framework: "react-native", confidence: 0.95, evidence: ["react-native"] });
  } else if (has("react-native") && has("expo")) {
    // expo already added; RN is present underneath
    frameworks.push({ framework: "react-native", confidence: 0.6, evidence: ["react-native (via expo)"] });
  }

  // Native Android
  const hasGradle = (await repo.exists("build.gradle")) || (await repo.exists("build.gradle.kts"));
  const hasSettings = (await repo.exists("settings.gradle")) || (await repo.exists("settings.gradle.kts"));
  const hasAndroidDir = await repo.exists("android");
  const hasGradlew = (await repo.exists("gradlew")) || (await repo.exists("gradlew.bat"));
  if (hasGradle && (hasAndroidDir || hasGradlew || hasSettings)) {
    frameworks.push({
      framework: "native-android",
      confidence: 0.95,
      evidence: ["build.gradle", hasAndroidDir ? "android/" : "", hasGradlew ? "gradlew" : ""].filter(Boolean),
    });
  }

  // PWA / Web
  if (hasAny("vite", "webpack", "@vue/cli-service")) {
    const manifest = await repo.readText("manifest.webmanifest");
    const indexHtml = await repo.readText("index.html");
    if ((manifest || indexHtml?.includes('rel="manifest"')) && !frameworks.some((f) => f.framework === "capacitor")) {
      frameworks.push({ framework: "pwa", confidence: 0.8, evidence: ["manifest.webmanifest"] });
    }
  }

  if (frameworks.length === 0) {
    frameworks.push({ framework: "unknown", confidence: 1, evidence: ["no known manifest detected"] });
  }

  // Language
  let language: Language = "unknown";
  if (await repo.exists("tsconfig.json")) language = "typescript";
  else if (hasAny("typescript", "@types/react")) language = "typescript";
  else if (pkg.name) language = "javascript";
  if (await repo.exists("pubspec.yaml")) language = "dart";
  if (frameworks.some((f) => f.framework === "native-android") && (await repo.exists("android/build.gradle"))) {
    language = "kotlin";
  }

  return { frameworks, language, pkg };
}

export function primaryFramework(frameworks: DetectedFramework[]): Framework {
  return [...frameworks].sort((a, b) => b.confidence - a.confidence)[0].framework;
}

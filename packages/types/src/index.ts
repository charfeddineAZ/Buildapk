/**
 * Shared domain types for the Cloud APK Factory.
 * These types are the contract between the Web client, the API gateway,
 * and every backend service (analyzer, orchestrator, repair-agent, ...).
 */

// ──────────────────────────────────────────────────────────────────────────
// Frameworks & project detection
// ──────────────────────────────────────────────────────────────────────────

export type Framework =
  | "expo"
  | "react-native"
  | "capacitor"
  | "ionic"
  | "flutter"
  | "native-android"
  | "pwa"
  | "unknown";

export type Language = "javascript" | "typescript" | "kotlin" | "java" | "dart" | "unknown";

export interface DetectedFramework {
  framework: Framework;
  /** Raw confidence 0..1 */
  confidence: number;
  /** Evidence files that led to the detection */
  evidence: string[];
}

export interface NodeRequirement {
  min: string; // e.g. "18.0.0"
  recommended: string; // e.g. "20.0.0"
}

export interface AndroidRequirement {
  minSdk: number;
  targetSdk: number;
  compileSdk: number;
  buildTools: string;
  java: string; // e.g. "17"
  gradle: string; // e.g. "8.6"
  kotlin?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Analysis
// ──────────────────────────────────────────────────────────────────────────

export type IssueSeverity = "required" | "recommended" | "optional" | "good";

export type IssueCategory =
  | "framework"
  | "react-native"
  | "android"
  | "dependencies"
  | "signing"
  | "android-package"
  | "assets"
  | "build-config"
  | "security";

export interface ProjectIssue {
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  title: string;
  description: string;
  /** True when the platform can auto-apply a safe fix. */
  autoFixable: boolean;
}

export interface ProjectSuggestion {
  id: string;
  severity: IssueSeverity;
  title: string;
  recommendedValue?: string;
  reason: string;
  /** Stable patch payload understood by the repair engine (level 2/3). */
  patch?: PatchProposal;
}

export interface PatchProposal {
  level: 0 | 1 | 2 | 3;
  file: string;
  /** JSON-path / field to set, or "raw" for full file rewrite. */
  target: string;
  value: unknown;
  description: string;
  risk: "none" | "low" | "medium" | "high";
}

export interface ProjectAnalysis {
  repositoryId: string;
  detectedAt: string; // ISO
  frameworks: DetectedFramework[];
  primaryFramework: Framework;
  language: Language;
  versions: {
    framework?: string;
    reactNative?: string;
    react?: string;
    expo?: string;
    android?: string;
    gradle?: string;
    kotlin?: string;
  };
  nodeRequirement: NodeRequirement;
  androidRequirement?: AndroidRequirement;
  nativeModules: string[];
  dependencies: DependencyInfo[];
  architecture: "standard" | "monorepo" | "unknown";
  signing: { configured: boolean; production: boolean; debug: boolean };
  permissions: string[];
  assets: AssetReport;
  issues: ProjectIssue[];
  suggestions: ProjectSuggestion[];
  score: ProjectScore;
  compatibleEnvironments: string[]; // image tags, e.g. ghcr.io/.../apk-expo-builder:sdk53
}

export interface DependencyInfo {
  name: string;
  version: string;
  type: "dependency" | "devDependency";
  peerConflict?: boolean;
  deprecated?: boolean;
}

export interface AssetReport {
  valid: boolean;
  appIcon: boolean;
  adaptiveIcon: boolean;
  splash: boolean;
  missing: string[];
}

export interface ProjectScore {
  buildReadiness: number; // 0..100
  dependencies: number;
  android: number;
  security: number;
  assets: number;
  signing: number;
  compatibility: number;
  overall: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Compatibility matrix
// ──────────────────────────────────────────────────────────────────────────

export interface CompatibilityMatrix {
  framework: Framework;
  node: string;
  java: string;
  gradle: string;
  androidSdk: number;
  buildTools: string;
  kotlin?: string;
  expo?: string;
  reactNative?: string;
  recommendedImage: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Build pipeline
// ──────────────────────────────────────────────────────────────────────────

export type BuildProvider = "eas" | "github-actions" | "cloudflare-builds" | "docker";

export type BuildTarget = "apk" | "aab" | "both" | "ios";

export type BuildStatus =
  | "queued"
  | "analyzing"
  | "building"
  | "validating"
  | "repairing"
  | "success"
  | "failed";

export interface BuildRequest {
  projectId: string;
  repositoryId: string;
  target: BuildTarget;
  provider?: BuildProvider; // auto if omitted
  environmentTag: string;
  autoRepair: boolean;
  createFixPr: boolean;
  triggeredBy: "manual" | "webhook-push" | "webhook-release" | "schedule";
}

export interface BuildAttempt {
  index: number; // 1-based
  provider: BuildProvider;
  startedAt: string;
  finishedAt?: string;
  status: BuildStatus;
  logs: string;
  errorHash?: string;
  repairApplied?: string;
  repairPatches?: PatchProposal[];
  repairSource?: "knowledge" | "ai" | "none";
}

export interface BuildResult {
  buildId: string;
  status: BuildStatus;
  target: BuildTarget;
  provider: BuildProvider;
  attempts: BuildAttempt[];
  artifacts?: ArtifactMeta[];
  validation?: ApkValidation;
  score?: number;
  failureReason?: string;
  /** URL of the Auto Fix PR, when createFixPr was enabled and repairs applied. */
  fixPrUrl?: string;
  /** Provider order that was tried, for transparency. */
  route?: BuildProvider[];
}

export interface ArtifactMeta {
  type: "apk" | "aab" | "logs" | "report" | "mapping";
  name: string;
  sizeBytes: number;
  sha256: string;
  url: string; // temporary, signed
  expiresAt: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────────────────────────────────

export interface ApkValidation {
  valid: boolean;
  fileExists: boolean;
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  minSdk?: number;
  targetSdk?: number;
  abis: string[];
  permissions: string[];
  signing: { signed: boolean; v1: boolean; v2: boolean; v3: boolean; sha256?: string };
  fileSizeBytes: number;
  sha256: string;
  warnings: string[];
  errors: string[];
}

// ──────────────────────────────────────────────────────────────────────────
// Connections / accounts
// ──────────────────────────────────────────────────────────────────────────

export type Provider = "google" | "github" | "expo" | "cloudflare" | "supabase" | "google-play";

export interface ConnectedAccount {
  provider: Provider;
  /** Owning platform user (undefined for legacy rows). */
  userId?: string;
  externalId: string;
  email?: string;
  scopes: string[];
  connectedAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  status: "connected" | "expired" | "revoked";
}

// ──────────────────────────────────────────────────────────────────────────
// Knowledge base
// ──────────────────────────────────────────────────────────────────────────

export interface KnownError {
  hash: string;
  code: string; // e.g. ERESOLVE
  framework: Framework | "any";
  version?: string;
  environment: string;
  pattern: string; // regex / keyword
  error: string;
  solution: string;
  patch?: PatchProposal;
  successRate: number;
  occurrences: number;
  lastSeen: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Quota
// ──────────────────────────────────────────────────────────────────────────

export interface ProviderQuota {
  provider: BuildProvider | "ai" | "eas";
  plan: string;
  remaining: number; // builds or minutes
  unit: "builds" | "minutes";
  resetsAt: string;
  available: boolean;
}

/**
 * Web client for the API Gateway (Cloudflare Worker). Base URL comes from
 * NEXT_PUBLIC_API_URL so the same build works on Cloudflare Workers/Pages.
 * The session token lives in localStorage and travels as a Bearer header.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
const TOKEN_KEY = "apkf.session";

export const session = {
  get(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.dispatchEvent(new Event("apkf:session"));
  },
  clear() {
    window.localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event("apkf:session"));
  },
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = session.get();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try { message = (await res.json()).error ?? message; } catch { /* ignore */ }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export interface AnalysisFile {
  [path: string]: string;
}

export interface Capability { id: string; label: string; health: "ok" | "warn" | "missing"; detail: string; fix?: string; requires: string[] }
export interface PlatformStatus { environment: string; version: string; ready: boolean; mode: string; capabilities: Capability[]; checkedAt: string }
export interface ChecklistStep { id: string; title: string; done: boolean; optional: boolean; hint: string; action?: { label: string; href: string } }
export interface Checklist { complete: boolean; progress: number; steps: ChecklistStep[] }
export interface Connection { provider: string; label: string; status: "connected" | "not-connected" | "unavailable" | "expired"; method: string; scopes: string[]; account?: string; connectedAt?: string; lastCheckedAt?: string; detail: string; action?: { label: string; href?: string; secret?: string } }
export interface SecretView { id: string; scope: string; ownerId: string; name: string; preview: string; createdAt: string; updatedAt: string; lastUsedAt?: string; meta: Record<string, string> }
export interface SigningStatus { projectId: string; configured: boolean; keyAlias: string; keystorePath: string; dname: string; keystoreReady: boolean; keystoreSha256?: string; certSha256?: string; createdAt?: string; rotatedAt?: string; keystoreStoredAt?: string; mode: "auto" | "none"; gradleBlock?: string }
export interface PatchPreview { file: string; kind: "file" | "advisory"; level: number; risk: string; description: string; requiresApproval: boolean; isNew: boolean; before: string; after: string; diff: string; additions: number; deletions: number; patch: any }
export interface RepairPreview { source: string; previews: PatchPreview[]; summary: { files: number; additions: number; deletions: number; autoApplicable: number; requiresApproval: number; advisory: number } }

export const api = {
  health: () => req<{ ok: boolean; version: string }>("/health"),
  // auth
  authGoogle: (profile: { googleId: string; email: string; name: string; avatar?: string }) =>
    req<{ user: any; token?: string }>("/auth/google", { method: "POST", body: JSON.stringify(profile) }),
  me: () => req<{ user: any; provider: string }>("/auth/me"),
  githubStartUrl: (mode: "read" | "write" = "read", next = "/dashboard") => {
    const q = new URLSearchParams({ mode, next });
    const t = session.get();
    if (t) q.set("token", t);
    return `${API_BASE}/auth/github/start?${q}`;
  },
  // setup
  setupStatus: () => req<PlatformStatus>("/setup/status"),
  checklist: () => req<Checklist>("/setup/checklist"),
  // connections
  connections: (probe = false) => req<{ connections: Connection[]; githubOAuth: boolean }>(`/connections${probe ? "?probe=1" : ""}`),
  disconnect: (provider: string) => req<{ ok: boolean }>(`/connections/${provider}`, { method: "DELETE" }),
  githubRepos: () => req<{ repos: { fullName: string; defaultBranch: string; private: boolean }[] }>("/github/repos"),
  // secrets
  listSecrets: (scope: "user" | "project", projectId?: string) =>
    req<{ secrets: SecretView[]; known: Record<string, { label: string; provider: string; hint: string }> }>(scope === "user" ? "/secrets/user" : `/secrets/project/${projectId}`),
  setSecret: (scope: "user" | "project", name: string, value: string, projectId?: string) =>
    req<{ secret: SecretView }>(scope === "user" ? `/secrets/user/${name}` : `/secrets/project/${projectId}/${name}`, { method: "PUT", body: JSON.stringify({ value }) }),
  deleteSecret: (scope: "user" | "project", name: string, projectId?: string) =>
    req<{ ok: boolean }>(scope === "user" ? `/secrets/user/${name}` : `/secrets/project/${projectId}/${name}`, { method: "DELETE" }),
  // projects
  analyze: (input: { repositoryId: string; repoName: string; org: string; files: AnalysisFile }) =>
    req<{ projectId: string; analysis: any }>("/projects/analyze", { method: "POST", body: JSON.stringify(input) }),
  importRepo: (repo: string, ref?: string) => req<{ projectId: string; ref: string; analysis: any }>("/projects/import", { method: "POST", body: JSON.stringify({ repo, ref }) }),
  listProjects: () => req<{ projects: any[] }>("/projects"),
  getProject: (id: string) => req<{ project: any; analysis: any }>(`/projects/${id}`),
  build: (projectId: string, opts: { target?: string; autoRepair?: boolean; createFixPr?: boolean } = {}) =>
    req<{ result: any }>(`/projects/${projectId}/build`, { method: "POST", body: JSON.stringify(opts) }),
  builds: (projectId: string) => req<{ builds: any[] }>(`/projects/${projectId}/builds`),
  getBuild: (buildId: string) => req<{ build: any }>(`/builds/${buildId}`),
  // §22 repairs
  previewRepairs: (projectId: string, patches?: any[]) =>
    patches ? req<RepairPreview>(`/projects/${projectId}/repairs/preview`, { method: "POST", body: JSON.stringify({ patches }) }) : req<RepairPreview>(`/projects/${projectId}/repairs/preview`),
  applyRepairs: (projectId: string, patches: any[]) => req<{ projectId: string; applied: number; analysis: any }>(`/projects/${projectId}/repairs/apply`, { method: "POST", body: JSON.stringify({ patches }) }),
  // signing
  signing: (projectId: string) => req<{ signing: SigningStatus }>(`/projects/${projectId}/signing`),
  ensureSigning: (projectId: string) => req<{ signing: SigningStatus }>(`/projects/${projectId}/signing/ensure`, { method: "POST" }),
  rotateSigning: (projectId: string) => req<{ signing: SigningStatus }>(`/projects/${projectId}/signing/rotate`, { method: "POST", body: JSON.stringify({ confirm: "ROTATE" }) }),
  exportKeystoreUrl: (projectId: string) => `${API_BASE}/projects/${projectId}/signing/export`,
  // misc
  usage: () => req<{ usage: any[]; quotas: any[] }>("/usage"),
  audit: () => req<{ entries: any[] }>("/audit"),
  refreshArtifact: (key: string) => req<{ url: string; expiresAt: string }>("/artifacts/refresh", { method: "POST", body: JSON.stringify({ key }) }),
};

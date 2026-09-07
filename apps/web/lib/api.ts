/**
 * Web client for the API Gateway (Cloudflare Worker). Base URL comes from
 * NEXT_PUBLIC_API_URL so the same build works on Cloudflare Pages.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface AnalysisFile {
  [path: string]: string;
}

export const api = {
  health: () => req<{ ok: boolean }>("/health"),
  authGoogle: (profile: { googleId: string; email: string; name: string; avatar?: string }) =>
    req<{ user: any }>("/auth/google", { method: "POST", body: JSON.stringify(profile) }),
  connections: () => req<{ connections: { provider: string; status: string }[] }>("/connections"),
  analyze: (input: { repositoryId: string; repoName: string; org: string; files: AnalysisFile }) =>
    req<{ projectId: string; analysis: any }>("/projects/analyze", { method: "POST", body: JSON.stringify(input) }),
  listProjects: () => req<{ projects: any[] }>("/projects"),
  build: (projectId: string, opts: { target?: string; autoRepair?: boolean } = {}) =>
    req<{ result: any }>(`/projects/${projectId}/build`, { method: "POST", body: JSON.stringify(opts) }),
  getBuild: (buildId: string) => req<{ build: any }>(`/builds/${buildId}`),
};

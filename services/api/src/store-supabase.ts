/**
 * Supabase-backed Store implementation (production). Uses the Supabase REST
 * (PostgREST) API over fetch so no extra SDK dependency is required. Swap the
 * InMemoryStore for this in `createPlatform` once env vars are set.
 *
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...
 */

import type { BuildResult, ConnectedAccount, ProjectAnalysis } from "@apk-factory/types";
import type { Project, StoredBuild, Store, UserAccount } from "./store.js";

export class SupabaseStore implements Store {
  constructor(private readonly url: string, private readonly key: string) {}

  private headers() {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "content-type": "application/json",
    };
  }

  private async rpc<T>(table: string, method: string, body?: unknown, query = ""): Promise<T> {
    const res = await fetch(`${this.url}/rest/v1/${table}${query}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`supabase ${table} ${method} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  users = {
    get: async (id: string) => (await this.rpc<UserAccount[]>("users", "GET", undefined, `?id=eq.${id}&limit=1`))[0],
    put: async (u: UserAccount) => { await this.rpc("users", "POST", u); },
    byGoogle: async (g: string) => (await this.rpc<UserAccount[]>("users", "GET", undefined, `?google_id=eq.${g}&limit=1`))[0],
  };
  accounts = {
    list: async (userId: string) => this.rpc<ConnectedAccount[]>("connected_accounts", "GET", undefined, `?user_id=eq.${userId}`),
    put: async (a: ConnectedAccount) => { await this.rpc("connected_accounts", "POST", a); },
  };
  projects = {
    get: async (id: string) => (await this.rpc<Project[]>("projects", "GET", undefined, `?id=eq.${id}&limit=1`))[0],
    byRepo: async (repoId: string) => (await this.rpc<Project[]>("projects", "GET", undefined, `?repository_id=eq.${repoId}&limit=1`))[0],
    list: async () => this.rpc<Project[]>("projects", "GET"),
    put: async (p: Project) => {
      const exists = await this.rpc<Project[]>("projects", "GET", undefined, `?id=eq.${p.id}&limit=1`);
      if (exists.length) await this.rpc("projects", "PATCH", p, `?id=eq.${p.id}`);
      else await this.rpc("projects", "POST", p);
    },
  };
  builds = {
    get: async (id: string) => (await this.rpc<StoredBuild[]>("builds", "GET", undefined, `?id=eq.${id}&limit=1`))[0],
    listByProject: async (projectId: string) => this.rpc<StoredBuild[]>("builds", "GET", undefined, `?project_id=eq.${projectId}`),
    put: async (b: StoredBuild) => {
      await this.rpc("builds", "POST", b);
      // Persist attempts + artifacts alongside the build row.
      for (const a of b.result.attempts) await this.rpc("build_attempts", "POST", { build_id: b.id, attempt_index: a.index, provider: a.provider, status: a.status, error_hash: a.errorHash, repair_applied: a.repairApplied });
      if (b.result.artifacts) for (const art of b.result.artifacts) await this.rpc("artifacts", "POST", { build_id: b.id, ...art });
    },
  };
}

export type { UserAccount, Project, StoredBuild, ProjectAnalysis, BuildResult };

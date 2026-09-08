/**
 * Supabase-backed Store implementation (production). Uses the Supabase REST
 * (PostgREST) API over fetch so no extra SDK dependency is required. Swap the
 * InMemoryStore for this in `createPlatform` once env vars are set.
 *
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...
 */

import type { BuildResult, ConnectedAccount, ProjectAnalysis } from "@apk-factory/types";
import type { SigningRecord, SigningStore } from "@apk-factory/build-core";
import type { SecretRecord, SecretScope, SecretStore } from "./secrets.js";
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
    const text = await res.text();
    if (!text) return (method === "GET" ? [] : {}) as T;
    return JSON.parse(text) as T;
  }

  users = {
    get: async (id: string) => (await this.rpc<UserAccount[]>("users", "GET", undefined, `?id=eq.${id}&limit=1`))[0],
    put: async (u: UserAccount) => { await this.rpc("users", "POST", u); },
    byGoogle: async (g: string) => (await this.rpc<UserAccount[]>("users", "GET", undefined, `?google_id=eq.${g}&limit=1`))[0],
  };
  accounts = {
    list: async (userId: string) => this.rpc<ConnectedAccount[]>("connected_accounts", "GET", undefined, `?user_id=eq.${userId}`),
    put: async (a: ConnectedAccount) => {
      await this.rpc("connected_accounts", "DELETE", undefined, `?user_id=eq.${a.userId}&provider=eq.${a.provider}`);
      await this.rpc("connected_accounts", "POST", { user_id: a.userId, provider: a.provider, external_id: a.externalId, email: a.email, scopes: a.scopes, status: a.status, connected_at: a.connectedAt, expires_at: a.expiresAt });
    },
    remove: async (userId: string, provider: ConnectedAccount["provider"]) => { await this.rpc("connected_accounts", "DELETE", undefined, `?user_id=eq.${userId}&provider=eq.${provider}`); },
  };
  // Sealed signing credentials (database/migrations/0002_zero_config.sql).
  signing: SigningStore = {
    get: async (projectId: string) => (await this.rpc<{ record: SigningRecord }[]>("project_signing", "GET", undefined, `?project_id=eq.${projectId}&limit=1`))[0]?.record,
    put: async (r: SigningRecord) => {
      await this.rpc("project_signing", "DELETE", undefined, `?project_id=eq.${r.projectId}`);
      await this.rpc("project_signing", "POST", { project_id: r.projectId, record: r, updated_at: new Date().toISOString() });
    },
    delete: async (projectId: string) => { await this.rpc("project_signing", "DELETE", undefined, `?project_id=eq.${projectId}`); },
  };
  // Sealed secrets (values are AES-256-GCM envelopes; the DB never sees plaintext).
  secrets: SecretStore = {
    list: async (scope: SecretScope, ownerId: string) => this.rpc<SecretRecord[]>("secrets", "GET", undefined, `?scope=eq.${scope}&owner_id=eq.${ownerId}`).then((rows) => rows.map(fromSecretRow)),
    get: async (scope: SecretScope, ownerId: string, name: string) => (await this.rpc<any[]>("secrets", "GET", undefined, `?scope=eq.${scope}&owner_id=eq.${ownerId}&name=eq.${name}&limit=1`)).map(fromSecretRow)[0],
    put: async (r: SecretRecord) => {
      await this.rpc("secrets", "DELETE", undefined, `?scope=eq.${r.scope}&owner_id=eq.${r.ownerId}&name=eq.${r.name}`);
      await this.rpc("secrets", "POST", { id: r.id, scope: r.scope, owner_id: r.ownerId, name: r.name, sealed: r.sealed, meta: r.meta, created_at: r.createdAt, updated_at: r.updatedAt, last_used_at: r.lastUsedAt });
    },
    delete: async (scope: SecretScope, ownerId: string, name: string) => { await this.rpc("secrets", "DELETE", undefined, `?scope=eq.${scope}&owner_id=eq.${ownerId}&name=eq.${name}`); },
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

function fromSecretRow(row: any): SecretRecord {
  return { id: row.id, scope: row.scope, ownerId: row.owner_id ?? row.ownerId, name: row.name, sealed: row.sealed, meta: row.meta ?? {}, createdAt: row.created_at ?? row.createdAt, updatedAt: row.updated_at ?? row.updatedAt, lastUsedAt: row.last_used_at ?? row.lastUsedAt };
}

export type { UserAccount, Project, StoredBuild, ProjectAnalysis, BuildResult };

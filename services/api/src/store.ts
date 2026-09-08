/**
 * Persistence abstraction. The platform talks only to this interface, so the
 * same API runs on an in-memory store (dev/tests) or a SupabaseStore (prod).
 * This mirrors the database schema in database/migrations.
 */

import type { BuildResult, ConnectedAccount, ProjectAnalysis } from "@apk-factory/types";
import type { SigningRecord, SigningStore } from "@apk-factory/build-core";
import type { SecretRecord, SecretScope, SecretStore } from "./secrets.js";

export interface UserAccount {
  id: string;
  /** Google subject, or `github:<id>` for GitHub-first sign-ins. */
  googleId: string;
  email: string;
  name: string;
  avatar?: string;
  createdAt: string;
  settings: Record<string, unknown>;
}

export interface Project {
  id: string;
  /** Owning user (undefined for legacy/demo projects). */
  userId?: string;
  repositoryId: string;
  repoName: string;
  org: string;
  /** Git ref the snapshot was taken from (default branch). */
  ref?: string;
  files: Record<string, string>;
  analysis?: ProjectAnalysis;
  createdAt: string;
  autoBuild: boolean;
}

export interface StoredBuild {
  id: string;
  projectId: string;
  result: BuildResult;
  createdAt: string;
}

export interface Store {
  users: { get(id: string): Promise<UserAccount | undefined>; put(u: UserAccount): Promise<void>; byGoogle(googleId: string): Promise<UserAccount | undefined> };
  accounts: { list(userId: string): Promise<ConnectedAccount[]>; put(a: ConnectedAccount): Promise<void>; remove(userId: string, provider: ConnectedAccount["provider"]): Promise<void> };
  projects: { get(id: string): Promise<Project | undefined>; byRepo(repoId: string): Promise<Project | undefined>; list(): Promise<Project[]>; put(p: Project): Promise<void> };
  builds: { get(id: string): Promise<StoredBuild | undefined>; listByProject(projectId: string): Promise<StoredBuild[]>; put(b: StoredBuild): Promise<void> };
  signing: SigningStore;
  secrets: SecretStore;
}

const uid = (p: string) => `${p}_${crypto.randomUUID().slice(0, 8)}`;

export class InMemoryStore implements Store {
  private usersMap = new Map<string, UserAccount>();
  private usersByGoogle = new Map<string, string>();
  private accountsMap = new Map<string, ConnectedAccount[]>();
  private projectsMap = new Map<string, Project>();
  private projectsByRepo = new Map<string, string>();
  private buildsMap = new Map<string, StoredBuild>();

  users = {
    get: async (id: string) => this.usersMap.get(id),
    put: async (u: UserAccount) => { this.usersMap.set(u.id, u); this.usersByGoogle.set(u.googleId, u.id); },
    byGoogle: async (g: string) => { const id = this.usersByGoogle.get(g); return id ? this.usersMap.get(id) : undefined; },
  };
  private signingMap = new Map<string, SigningRecord>();
  private secretsMap = new Map<string, SecretRecord>();

  accounts = {
    list: async (userId: string) => this.accountsMap.get(userId) ?? [],
    put: async (a: ConnectedAccount) => {
      const owner = a.userId ?? a.externalId;
      const cur = (this.accountsMap.get(owner) ?? []).filter((x) => x.provider !== a.provider);
      cur.push(a);
      this.accountsMap.set(owner, cur);
    },
    remove: async (userId: string, provider: ConnectedAccount["provider"]) => {
      this.accountsMap.set(userId, (this.accountsMap.get(userId) ?? []).filter((x) => x.provider !== provider));
    },
  };
  signing: SigningStore = {
    get: async (projectId: string) => this.signingMap.get(projectId),
    put: async (r: SigningRecord) => { this.signingMap.set(r.projectId, r); },
    delete: async (projectId: string) => { this.signingMap.delete(projectId); },
  };
  secrets: SecretStore = {
    list: async (scope: SecretScope, ownerId: string) => [...this.secretsMap.values()].filter((r) => r.scope === scope && r.ownerId === ownerId),
    get: async (scope: SecretScope, ownerId: string, name: string) => this.secretsMap.get(`${scope}:${ownerId}:${name}`),
    put: async (r: SecretRecord) => { this.secretsMap.set(`${r.scope}:${r.ownerId}:${r.name}`, r); },
    delete: async (scope: SecretScope, ownerId: string, name: string) => { this.secretsMap.delete(`${scope}:${ownerId}:${name}`); },
  };
  projects = {
    get: async (id: string) => this.projectsMap.get(id),
    byRepo: async (repoId: string) => { const id = this.projectsByRepo.get(repoId); return id ? this.projectsMap.get(id) : undefined; },
    list: async () => [...this.projectsMap.values()],
    put: async (p: Project) => { this.projectsMap.set(p.id, p); this.projectsByRepo.set(p.repositoryId, p.id); },
  };
  builds = {
    get: async (id: string) => this.buildsMap.get(id),
    listByProject: async (projectId: string) => [...this.buildsMap.values()].filter((b) => b.projectId === projectId),
    put: async (b: StoredBuild) => { this.buildsMap.set(b.id, b); },
  };

  static newId(p: string) { return uid(p); }
}

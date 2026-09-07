/**
 * Persistence abstraction. The platform talks only to this interface, so the
 * same API runs on an in-memory store (dev/tests) or a SupabaseStore (prod).
 * This mirrors the database schema in database/migrations.
 */

import type { BuildResult, ConnectedAccount, ProjectAnalysis } from "@apk-factory/types";

export interface UserAccount {
  id: string;
  googleId: string;
  email: string;
  name: string;
  avatar?: string;
  createdAt: string;
  settings: Record<string, unknown>;
}

export interface Project {
  id: string;
  repositoryId: string;
  repoName: string;
  org: string;
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
  accounts: { list(userId: string): Promise<ConnectedAccount[]>; put(a: ConnectedAccount): Promise<void> };
  projects: { get(id: string): Promise<Project | undefined>; byRepo(repoId: string): Promise<Project | undefined>; list(): Promise<Project[]>; put(p: Project): Promise<void> };
  builds: { get(id: string): Promise<StoredBuild | undefined>; listByProject(projectId: string): Promise<StoredBuild[]>; put(b: StoredBuild): Promise<void> };
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
  accounts = {
    list: async (userId: string) => this.accountsMap.get(userId) ?? [],
    put: async (a: ConnectedAccount) => { const cur = this.accountsMap.get(a.externalId) ?? []; cur.push(a); this.accountsMap.set(a.externalId, cur); },
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

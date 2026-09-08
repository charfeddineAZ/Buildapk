/**
 * GitHub integration (section 5/30). A fine-grained REST client used by the
 * Cloud Factory to: select repositories, open Auto Fix PRs (section 22),
 * register webhooks and dispatch the GitHub Actions build route (section 16).
 *
 * Uses the installation token (short-lived) — never the user's PAT. All calls
 * go through fetch so no SDK dependency is required.
 */

import { Logger } from "@apk-factory/logger";

export interface GithubRepo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

/** Manifest / config files that drive the analysis (kept small on purpose). */
export const ANALYSIS_FILE_RE = /(^|\/)(package\.json|app\.json|app\.config\.(js|ts|mjs)|eas\.json|capacitor\.config\.(json|ts|js)|ionic\.config\.json|pubspec\.yaml|settings\.gradle(\.kts)?|build\.gradle(\.kts)?|gradle\.properties|gradle-wrapper\.properties|AndroidManifest\.xml|\.npmrc|\.nvmrc|\.node-version|tsconfig\.json|metro\.config\.js|babel\.config\.js|pnpm-workspace\.yaml|turbo\.json|manifest\.webmanifest|index\.html)$/;
export const ASSET_FILE_RE = /^(assets|android\/app\/src\/main\/res)\/.*\.(png|jpg|jpeg|webp|svg)$/i;

export class GithubClient {
  constructor(
    private readonly token: string,
    private readonly base = "https://api.github.com",
    private readonly log: Logger = new Logger("github"),
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...extra,
    };
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return {} as T;
    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  async listRepositories(installationId?: number): Promise<GithubRepo[]> {
    const path = installationId ? `/user/installations/${installationId}/repositories` : `/user/repos?per_page=100`;
    const data = await this.req<any | { repositories?: any[] }>("GET", path);
    const list = Array.isArray(data) ? data : (data.repositories ?? []);
    return list.map((r: any) => ({ fullName: r.full_name, defaultBranch: r.default_branch, private: r.private }));
  }

  /** Authenticated user (used after OAuth to label the connection). */
  async me(): Promise<{ id: number; login: string; name: string | null; avatarUrl: string }> {
    const u = await this.req<{ id: number; login: string; name: string | null; avatar_url: string }>("GET", "/user");
    return { id: u.id, login: u.login, name: u.name, avatarUrl: u.avatar_url };
  }

  /** Recursive tree listing of a ref (paths only, no contents). */
  async listTree(owner: string, repo: string, ref: string): Promise<{ path: string; type: "blob" | "tree"; size?: number; sha: string }[]> {
    const r = await this.req<{ tree: { path: string; type: "blob" | "tree"; size?: number; sha: string }[]; truncated?: boolean }>("GET", `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (r.truncated) this.log.warn("tree listing truncated", { repo: `${owner}/${repo}` });
    return r.tree;
  }

  /** Raw text content of a file at a ref. Returns null for 404. */
  async getFileText(owner: string, repo: string, path: string, ref: string): Promise<string | null> {
    const res = await fetch(`${this.base}/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`, {
      headers: this.headers({ Accept: "application/vnd.github.raw+json" }),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub GET contents/${path} → ${res.status}`);
    return res.text();
  }

  /**
   * Snapshot of the manifest files the Analyzer needs (§32: never the whole
   * repo, never executed). Binary assets are listed with a placeholder so the
   * asset checks work without downloading images.
   */
  async fetchAnalysisSnapshot(owner: string, repo: string, ref?: string): Promise<{ ref: string; files: Record<string, string> }> {
    const branch = ref ?? (await this.getDefaultBranch(owner, repo));
    const tree = await this.listTree(owner, repo, branch);
    const files: Record<string, string> = {};
    const wanted = tree.filter((t) => t.type === "blob" && ANALYSIS_FILE_RE.test(t.path) && (t.size ?? 0) < 512_000).slice(0, 60);
    const texts = await Promise.all(wanted.map((t) => this.getFileText(owner, repo, t.path, branch).catch(() => null)));
    wanted.forEach((t, i) => { if (texts[i] !== null) files[t.path] = texts[i] as string; });
    for (const t of tree) if (t.type === "blob" && ASSET_FILE_RE.test(t.path)) files[t.path] = `<binary ${t.size ?? 0} bytes>`;
    return { ref: branch, files };
  }

  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const r = await this.req<{ default_branch: string }>("GET", `/repos/${owner}/${repo}`);
    return r.default_branch;
  }

  async getRefSha(owner: string, repo: string, ref: string): Promise<string> {
    const r = await this.req<{ object?: { sha?: string }; sha?: string }>("GET", `/repos/${owner}/${repo}/git/ref/${ref}`);
    return (r.object?.sha ?? r.sha) as string;
  }

  async createRef(owner: string, repo: string, ref: string, sha: string): Promise<void> {
    await this.req("POST", `/repos/${owner}/${repo}/git/refs`, { ref: `refs/${ref}`, sha });
  }

  async updateRef(owner: string, repo: string, ref: string, sha: string, force = true): Promise<void> {
    await this.req("PATCH", `/repos/${owner}/${repo}/git/refs/${ref}`, { sha, force });
  }

  async createBlob(owner: string, repo: string, content: string): Promise<string> {
    const r = await this.req<{ sha: string }>("POST", `/repos/${owner}/${repo}/git/blobs`, { content, encoding: "utf-8" });
    return r.sha;
  }

  async createTree(owner: string, repo: string, baseTree: string, entries: { path: string; mode: "100644" | "100755"; type: "blob"; sha: string }[]): Promise<string> {
    const r = await this.req<{ sha: string }>("POST", `/repos/${owner}/${repo}/git/trees`, { base_tree: baseTree, tree: entries });
    return r.sha;
  }

  async createCommit(owner: string, repo: string, message: string, tree: string, parents: string[]): Promise<string> {
    const r = await this.req<{ sha: string }>("POST", `/repos/${owner}/${repo}/git/commits`, { message, tree, parents });
    return r.sha;
  }

  /** Commit a set of file changes onto a new branch derived from baseSha. */
  async commitFiles(owner: string, repo: string, branch: string, baseSha: string, message: string, files: { path: string; content: string }[]): Promise<string> {
    const blobs = await Promise.all(files.map((f) => this.createBlob(owner, repo, f.content)));
    const entries = files.map((f, i) => ({ path: f.path, mode: "100644" as const, type: "blob" as const, sha: blobs[i] }));
    const tree = await this.createTree(owner, repo, baseSha, entries);
    const commit = await this.createCommit(owner, repo, message, tree, [baseSha]);
    await this.createRef(owner, repo, `heads/${branch}`, commit).catch(async () => {
      await this.updateRef(owner, repo, `heads/${branch}`, commit);
    });
    return commit;
  }

  async createPullRequest(owner: string, repo: string, head: string, base: string, title: string, body: string): Promise<{ number: number; htmlUrl: string }> {
    const r = await this.req<{ number: number; html_url: string }>("POST", `/repos/${owner}/${repo}/pulls`, { head, base, title, body });
    this.log.info("pull request opened", { repo: `${owner}/${repo}`, number: r.number });
    return { number: r.number, htmlUrl: r.html_url };
  }

  async createWebhook(owner: string, repo: string, url: string, secret: string): Promise<void> {
    await this.req("POST", `/repos/${owner}/${repo}/hooks`, {
      name: "web",
      active: true,
      events: ["push", "release"],
      config: { url, secret, content_type: "json" },
    });
  }

  async dispatchWorkflow(owner: string, repo: string, workflowId: string, ref: string, inputs: Record<string, string> = {}): Promise<void> {
    await this.req("POST", `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, { ref, inputs });
  }
}

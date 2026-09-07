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

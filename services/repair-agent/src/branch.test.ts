import { describe, it, expect } from "vitest";
import { RepairBranchService } from "./branch.js";
import type { GithubClient } from "@apk-factory/github";

class FakeGithub implements Partial<GithubClient> {
  calls: any[] = [];
  async getRefSha() { return "baseSHA"; }
  async commitFiles(owner: string, repo: string, branch: string, baseSha: string, message: string, files: { path: string; content: string }[]) {
    this.calls.push({ owner, repo, branch, baseSha, message, files });
    return "commitSHA";
  }
  async createPullRequest(owner: string, repo: string, head: string, base: string, title: string, body: string) {
    this.calls.push({ owner, repo, head, base, title, body });
    return { number: 42, htmlUrl: `https://github.com/${owner}/${repo}/pull/42` };
  }
}

describe("RepairBranchService", () => {
  it("creates an isolated fix branch + PR and never touches main", async () => {
    const fake = new FakeGithub() as unknown as GithubClient;
    const svc = new RepairBranchService(fake);
    const res = await svc.createFixPullRequest({
      repositoryId: "charfeddineAZ/CPAAutomator",
      owner: "charfeddineAZ",
      repo: "CPAAutomator",
      baseBranch: "main",
      buildId: "prj_abc123",
      files: { "app.json": JSON.stringify({ expo: { name: "x" } }), ".npmrc": "" },
      patches: [
        { level: 2, file: "app.json", target: "expo.android.package", value: "com.x.y", description: "x", risk: "low" },
        { level: 1, file: ".npmrc", target: "legacy-peer-deps", value: "true", description: "x", risk: "low" },
      ],
    });
    expect(res.branch).toMatch(/^apk-factory\/fix-/);
    expect(res.prNumber).toBe(42);
    expect(res.changedFiles).toEqual(expect.arrayContaining(["app.json", ".npmrc"]));
    // safe patches applied: app.json gets package, .npmrc gets legacy-peer-deps
    const commitCall = (fake as any).calls.find((c: any) => c.files);
    const appJson = commitCall.files.find((f: any) => f.path === "app.json");
    expect(JSON.parse(appJson.content).expo.android.package).toBe("com.x.y");
    expect(commitCall.files.find((f: any) => f.path === ".npmrc").content).toContain("legacy-peer-deps=true");
  });

  it("excludes high-risk patches and refuses to commit when nothing safe remains", async () => {
    const fake = new FakeGithub() as unknown as GithubClient;
    const svc = new RepairBranchService(fake);
    await expect(
      svc.createFixPullRequest({
        repositoryId: "me/app",
        owner: "me",
        repo: "app",
        baseBranch: "main",
        buildId: "prj_z9",
        files: { "src/App.tsx": "export default null" },
        patches: [{ level: 3, file: "src/App.tsx", target: "raw", value: "export default 1", description: "risky", risk: "high" }],
      }),
    ).rejects.toThrow(/no safe patches/i);
  });
});

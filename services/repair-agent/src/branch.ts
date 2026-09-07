/**
 * Repair Branch service (section 22). When Auto Fix / Create Fix PR is enabled,
 * safe patches are applied to an isolated branch (never main), committed, and a
 * Pull Request is opened for human review. Unsafe (high-risk / level 3) patches
 * are left as proposals and excluded from the automatic commit.
 */

import type { PatchProposal } from "@apk-factory/types";
import { Logger } from "@apk-factory/logger";
import type { GithubClient } from "@apk-factory/github";
import { applyPatch } from "./repair-engine.js";

export interface FixPrInput {
  repositoryId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  buildId: string;
  files: Record<string, string>;
  patches: PatchProposal[];
  title?: string;
  body?: string;
}

export interface FixPrResult {
  branch: string;
  commit: string;
  prNumber: number;
  prUrl: string;
  changedFiles: string[];
}

export class RepairBranchService {
  constructor(private readonly github: GithubClient, private readonly log: Logger = new Logger("repair-branch")) {}

  branchName(repositoryId: string, buildId: string): string {
    const repo = repositoryId.replace(/[^a-z0-9]/gi, "-").slice(-24);
    const id = buildId.replace(/[^a-z0-9]/gi, "").slice(-6);
    return `apk-factory/fix-${repo}-${id}`;
  }

  /** Apply only safe patches (risk !== "high") to a file tree. */
  applySafe(files: Record<string, string>, patches: PatchProposal[]): { files: Record<string, string>; applied: PatchProposal[] } {
    let f = { ...files };
    const applied: PatchProposal[] = [];
    for (const p of patches) {
      if (p.risk === "high") continue;
      f = applyPatch(f, p);
      applied.push(p);
    }
    return { files: f, applied };
  }

  async createFixPullRequest(input: FixPrInput): Promise<FixPrResult> {
    const branch = this.branchName(input.repositoryId, input.buildId);
    const { files: patched, applied } = this.applySafe(input.files, input.patches);

    const changed: { path: string; content: string }[] = [];
    for (const [path, content] of Object.entries(patched)) {
      if (input.files[path] !== content) changed.push({ path, content });
    }
    if (changed.length === 0) throw new Error("no safe patches to apply");

    const baseSha = await this.github.getRefSha(input.owner, input.repo, `heads/${input.baseBranch}`);
    const commit = await this.github.commitFiles(input.owner, input.repo, branch, baseSha, `fix: auto-applied ${applied.length} safe build fix(es)`, changed);
    const pr = await this.github.createPullRequest(
      input.owner,
      input.repo,
      branch,
      input.baseBranch,
      input.title ?? `APK Factory: auto-fix build issues`,
      input.body ?? `Automated fixes applied by Cloud APK Factory (${applied.map((p) => p.file).join(", ")}).`,
    );
    this.log.info("fix PR created", { branch, pr: pr.number });
    return { branch, commit, prNumber: pr.number, prUrl: pr.htmlUrl, changedFiles: changed.map((c) => c.path) };
  }
}

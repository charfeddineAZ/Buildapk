/**
 * Repair diff preview (section 22 — "never edit main blindly").
 *
 * Before any patch is applied (locally, or on an isolated fix branch) the user
 * must be able to see exactly what will change. This module turns a list of
 * PatchProposal into per-file unified diffs computed against the project's
 * in-memory file tree. It is pure: nothing is written anywhere.
 */

import type { PatchProposal } from "@apk-factory/types";
import { applyPatch } from "./repair-engine.js";

export type DiffLineType = "context" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface PatchPreview {
  /** Path of the file that changes. For advisory patches this is the label. */
  file: string;
  kind: "file" | "advisory";
  level: PatchProposal["level"];
  risk: PatchProposal["risk"];
  description: string;
  /** Level 2/3 or high-risk patches need explicit approval (section 21/22). */
  requiresApproval: boolean;
  /** True when the file does not exist yet in the repository. */
  isNew: boolean;
  before: string;
  after: string;
  diff: string;
  additions: number;
  deletions: number;
  patch: PatchProposal;
}

export interface PreviewSummary {
  files: number;
  additions: number;
  deletions: number;
  autoApplicable: number;
  requiresApproval: number;
  advisory: number;
}

export interface RepairPreview {
  previews: PatchPreview[];
  summary: PreviewSummary;
}

const MAX_LCS_LINES = 4000;

/** Line-level LCS diff. Falls back to full replace for very large inputs. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.length ? before.split("\n") : [];
  const b = after.length ? after.split("\n") : [];
  if (a.length + b.length > MAX_LCS_LINES) {
    return [
      ...a.map((text, i) => ({ type: "del" as const, text, oldNo: i + 1 })),
      ...b.map((text, i) => ({ type: "add" as const, text, newNo: i + 1 })),
    ];
  }
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:], b[j:]
  const dp: Uint32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "context", text: a[i], oldNo: i + 1, newNo: j + 1 });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i], oldNo: i + 1 });
      i++;
    } else {
      out.push({ type: "add", text: b[j], newNo: j + 1 });
      j++;
    }
  }
  while (i < n) { out.push({ type: "del", text: a[i], oldNo: i + 1 }); i++; }
  while (j < m) { out.push({ type: "add", text: b[j], newNo: j + 1 }); j++; }
  return out;
}

/** Render a unified diff (git style) with `context` lines around each change. */
export function unifiedDiff(path: string, before: string, after: string, context = 3): string {
  if (before === after) return "";
  const lines = diffLines(before, after);
  const header = [`--- ${before.length ? `a/${path}` : "/dev/null"}`, `+++ ${after.length ? `b/${path}` : "/dev/null"}`];

  // Group changed lines into hunks with `context` lines of padding.
  const changed = lines.map((l) => l.type !== "context");
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let k = 0; k < lines.length; k++) {
    if (!changed[k]) continue;
    for (let c = Math.max(0, k - context); c <= Math.min(lines.length - 1, k + context); c++) keep[c] = true;
  }

  const hunks: string[] = [];
  let k = 0;
  while (k < lines.length) {
    if (!keep[k]) { k++; continue; }
    const start = k;
    while (k < lines.length && keep[k]) k++;
    const slice = lines.slice(start, k);
    const oldStart = slice.find((l) => l.oldNo !== undefined)?.oldNo ?? (slice[0].newNo ?? 1);
    const newStart = slice.find((l) => l.newNo !== undefined)?.newNo ?? (slice[0].oldNo ?? 1);
    const oldLen = slice.filter((l) => l.type !== "add").length;
    const newLen = slice.filter((l) => l.type !== "del").length;
    hunks.push(`@@ -${oldLen ? oldStart : 0},${oldLen} +${newLen ? newStart : 0},${newLen} @@`);
    for (const l of slice) hunks.push((l.type === "add" ? "+" : l.type === "del" ? "-" : " ") + l.text);
  }
  return [...header, ...hunks].join("\n") + "\n";
}

export function requiresApproval(p: PatchProposal): boolean {
  return p.level >= 2 || p.risk === "high" || p.risk === "medium";
}

/**
 * Compute the preview for a set of patches against `files`. Patches are applied
 * cumulatively (in order) so a later patch sees the effect of an earlier one on
 * the same file — exactly what the Repair Engine would do.
 */
export function previewPatches(files: Record<string, string>, patches: PatchProposal[]): RepairPreview {
  const previews: PatchPreview[] = [];
  let current = { ...files };
  for (const patch of patches) {
    const advisory = patch.target === "manual";
    if (advisory) {
      previews.push({
        file: patch.file,
        kind: "advisory",
        level: patch.level,
        risk: patch.risk,
        description: patch.description,
        requiresApproval: true,
        isNew: false,
        before: "",
        after: String(patch.value ?? ""),
        diff: "",
        additions: 0,
        deletions: 0,
        patch,
      });
      continue;
    }
    const before = current[patch.file] ?? "";
    const next = applyPatch(current, patch);
    const after = next[patch.file] ?? "";
    const diff = unifiedDiff(patch.file, before, after);
    const lines = diffLines(before, after);
    previews.push({
      file: patch.file,
      kind: "file",
      level: patch.level,
      risk: patch.risk,
      description: patch.description,
      requiresApproval: requiresApproval(patch),
      isNew: !(patch.file in current),
      before,
      after,
      diff,
      additions: lines.filter((l) => l.type === "add").length,
      deletions: lines.filter((l) => l.type === "del").length,
      patch,
    });
    current = next;
  }
  const fileSet = new Set(previews.filter((p) => p.kind === "file" && p.diff).map((p) => p.file));
  const summary: PreviewSummary = {
    files: fileSet.size,
    additions: previews.reduce((s, p) => s + p.additions, 0),
    deletions: previews.reduce((s, p) => s + p.deletions, 0),
    autoApplicable: previews.filter((p) => p.kind === "file" && !p.requiresApproval).length,
    requiresApproval: previews.filter((p) => p.kind === "file" && p.requiresApproval).length,
    advisory: previews.filter((p) => p.kind === "advisory").length,
  };
  return { previews, summary };
}

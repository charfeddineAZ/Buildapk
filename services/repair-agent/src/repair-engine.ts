/**
 * Repair Engine — four levels (section 21 of the spec).
 *   Level 0  Environment   (Java/Node/SDK/PATH)         auto
 *   Level 1  Dependencies   (npm/Gradle/Expo/Kotlin)    auto if known
 *   Level 2  Configuration  (app.json/eas.json/Manifest) shown to user
 *   Level 3  Source code    (JS/TS/Java/Kotlin/XML)      AI proposal + approval
 *
 * Known errors are applied from the Knowledge Base; unknown errors are routed
 * to the AI Router. Source-level (level 3) and config (level 2) patches are
 * returned as proposals that require user approval and are applied on a branch
 * (never main). Level 0/1 (low-risk) patches are auto-applied.
 */

import type { PatchProposal } from "@apk-factory/types";
import { Logger } from "@apk-factory/logger";
import { extractErrorCode, KnowledgeBase, signatureFromLogs } from "./knowledge.js";
import type { AiRouter } from "./ai-router.js";

export interface RepairPlan {
  errorHash: string;
  code: string;
  source: "knowledge" | "ai" | "none";
  summary: string;
  autoPatches: PatchProposal[]; // level 0/1, applied without approval
  proposedPatches: PatchProposal[]; // level 2/3, require approval
  confidence: number;
}

export class RepairEngine {
  constructor(
    private readonly kb: KnowledgeBase,
    private readonly ai: AiRouter,
    private readonly log: Logger = new Logger("repair"),
  ) {}

  async plan(logs: string): Promise<RepairPlan> {
    const code = extractErrorCode(logs);
    const sig = signatureFromLogs(logs);
    const hash = `${code}:${sig}`.length > 0 ? code + ":" + sig.slice(0, 16) : code;
    const known = this.kb.lookup(code, logs);

    if (known) {
      this.log.info("known error matched", { code, hash: known.hash });
      const patch = known.patch;
      const auto = patch && patch.level <= 1 ? [patch] : [];
      const proposed = patch && patch.level >= 2 ? [patch] : [];
      if (!patch) {
        proposed.push({
          level: 2,
          file: "build.config",
          target: "manual",
          value: known.solution,
          description: known.solution,
          risk: "medium",
        });
      }
      return {
        errorHash: known.hash,
        code,
        source: "knowledge",
        summary: known.solution,
        autoPatches: auto,
        proposedPatches: proposed,
        confidence: known.successRate,
      };
    }

    // Unknown → AI diagnosis
    this.log.warn("unknown error, routing to AI", { code });
    const diagnosis = await this.ai.analyze(logs);
    return {
      errorHash: hash,
      code,
      source: "ai",
      summary: diagnosis.text,
      autoPatches: [],
      proposedPatches: [
        {
          level: 3,
          file: "ai-proposal",
          target: "manual",
          value: diagnosis.text,
          description: "AI-suggested repair — requires review and approval.",
          risk: "medium",
        },
      ],
      confidence: 0.5,
    };
  }
}

/**
 * Apply a patch to an in-memory file tree. Pure: returns a new tree.
 * Supports the patch shapes emitted by the Knowledge Base.
 */
export function applyPatch(files: Record<string, string>, patch: PatchProposal): Record<string, string> {
  const next = { ...files };
  const setLine = (key: string, value: string) => {
    const existing = next[patch.file] ?? "";
    const re = new RegExp(`^${escapeRe(key)}\\s*=.*$`, "m");
    if (re.test(existing)) next[patch.file] = existing.replace(re, `${key}=${value}`);
    else next[patch.file] = existing + (existing && !existing.endsWith("\n") ? "\n" : "") + `${key}=${value}\n`;
  };

  switch (patch.file) {
    case ".npmrc":
      setLine("legacy-peer-deps", String(patch.value));
      break;
    case "gradle.properties":
      setLine(String(patch.target), String(patch.value));
      break;
    case "app.json": {
      const json = safeJson(next[patch.file] ?? "{}");
      setDeep(json, patch.target, patch.value);
      next[patch.file] = JSON.stringify(json, null, 2);
      break;
    }
    case "android/build.gradle": {
      const existing = next[patch.file] ?? "android {";
      const re = /applicationId\s+["'][^"']+["']/;
      const replacement = `applicationId "${patch.value}"`;
      next[patch.file] = re.test(existing) ? existing.replace(re, replacement) : `${existing}\n    ${replacement}`;
      break;
    }
    default:
      // raw rewrite
      next[patch.file] = String(patch.value);
  }
  return next;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeJson(s: string): Record<string, any> {
  try { return JSON.parse(s); } catch { return {}; }
}

function setDeep(obj: Record<string, any>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = cur[parts[i]] ?? {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

import { describe, it, expect } from "vitest";
import { diffLines, previewPatches, unifiedDiff } from "./diff.js";

describe("diff preview (§22)", () => {
  it("computes a line diff with context/add/del", () => {
    const d = diffLines("a\nb\nc", "a\nB\nc\nd");
    expect(d.map((l) => l.type + ":" + l.text)).toEqual(["context:a", "del:b", "add:B", "context:c", "add:d"]);
  });

  it("renders a unified diff with hunk headers", () => {
    const u = unifiedDiff("gradle.properties", "org.gradle.jvmargs=-Xmx2g\n", "org.gradle.jvmargs=-Xmx2g\norg.gradle.daemon=false\n");
    expect(u).toContain("--- a/gradle.properties");
    expect(u).toContain("+++ b/gradle.properties");
    expect(u).toContain("@@ ");
    expect(u).toContain("+org.gradle.daemon=false");
    expect(u).not.toContain("-org.gradle.jvmargs");
  });

  it("returns empty diff when nothing changes", () => {
    expect(unifiedDiff("x", "same", "same")).toBe("");
  });

  it("marks new files with /dev/null", () => {
    const u = unifiedDiff(".npmrc", "", "legacy-peer-deps=true\n");
    expect(u.startsWith("--- /dev/null")).toBe(true);
  });

  it("previews patches cumulatively and classifies approval", () => {
    const files = { "app.json": JSON.stringify({ expo: { name: "x" } }) };
    const { previews, summary } = previewPatches(files, [
      { level: 1, file: ".npmrc", target: "legacy-peer-deps", value: "true", description: "peer deps", risk: "low" },
      { level: 2, file: "app.json", target: "expo.android.package", value: "com.x.y", description: "package", risk: "low" },
      { level: 3, file: "ai-proposal", target: "manual", value: "Upgrade RN", description: "AI proposal", risk: "medium" },
    ]);
    expect(previews).toHaveLength(3);
    expect(previews[0].isNew).toBe(true);
    expect(previews[0].requiresApproval).toBe(false);
    expect(previews[0].diff).toContain("+legacy-peer-deps=true");
    expect(previews[1].requiresApproval).toBe(true);
    expect(previews[1].after).toContain("com.x.y");
    expect(previews[2].kind).toBe("advisory");
    expect(summary).toMatchObject({ files: 2, autoApplicable: 1, requiresApproval: 1, advisory: 1 });
    expect(summary.additions).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import { scanForSecrets, scanDangerousPermissions } from "./index.js";

describe("scanDangerousPermissions", () => {
  it("flags high-risk permissions", () => {
    const f = scanDangerousPermissions(["android.permission.READ_SMS", "android.permission.INTERNET"]);
    expect(f.find((x) => x.permission === "android.permission.READ_SMS")?.risk).toBe("high");
  });

  it("warns on an over-broad permission surface", () => {
    const perms = Array.from({ length: 10 }, (_, i) => `android.permission.FOO${i}`);
    const f = scanDangerousPermissions(perms, perms.length);
    expect(f.some((x) => x.permission === "(aggregate)")).toBe(true);
  });
});

describe("scanForSecrets", () => {
  it("detects a hardcoded API key and never returns it", () => {
    const r = scanForSecrets([{ path: ".env", content: 'API_KEY="AKIA1234567890ABCDEFGH"' }]);
    expect(r.detected).toBe(true);
    expect(r.findings[0].preview).not.toContain("AKIA1234567890ABCDEFGH");
    expect(r.findings[0].preview).toContain("***");
  });

  it("ignores normal files", () => {
    expect(scanForSecrets([{ path: "app.ts", content: "const x = 1;" }]).detected).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { AuditService } from "./audit.js";
import { UsageService } from "@apk-factory/quota-manager";

describe("AuditService", () => {
  it("records and lists entries newest-first", () => {
    const a = new AuditService();
    a.record({ action: "auth.google", user: "u1", result: "success" });
    a.record({ action: "build.start", projectId: "p1", result: "success" });
    const list = a.list();
    expect(list).toHaveLength(2);
    expect(list[0].action).toBe("build.start");
    expect(list[0].id).toBeTruthy();
  });
});

describe("UsageService", () => {
  it("summarizes consumed quota per provider", () => {
    const u = new UsageService();
    u.record("eas", 1, "builds");
    u.record("eas", 1, "builds");
    u.record("github-actions", 5, "minutes");
    const s = u.summary();
    expect(s.find((x) => x.provider === "eas")?.consumed).toBe(2);
    expect(s.find((x) => x.provider === "github-actions")?.consumed).toBe(5);
  });
});

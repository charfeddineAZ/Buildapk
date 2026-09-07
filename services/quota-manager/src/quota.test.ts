import { describe, it, expect } from "vitest";
import { QuotaManager } from "./index.js";

describe("QuotaManager", () => {
  it("seeds free-tier defaults", () => {
    const q = new QuotaManager();
    expect(q.get("eas").remaining).toBe(15);
    expect(q.isAvailable("github-actions")).toBe(true);
  });

  it("consumes and flips availability at zero", () => {
    const q = new QuotaManager({ eas: { provider: "eas", plan: "free", remaining: 2, unit: "builds", resetsAt: new Date().toISOString() } });
    q.consume("eas");
    q.consume("eas");
    expect(q.get("eas").remaining).toBe(0);
    expect(q.isAvailable("eas")).toBe(false);
  });

  it("treats unlimited providers as always available", () => {
    const q = new QuotaManager();
    q.consume("docker", 1000);
    expect(q.isAvailable("docker")).toBe(true);
  });

  it("picks the first available route", () => {
    const q = new QuotaManager({ eas: { provider: "eas", plan: "free", remaining: 0, unit: "builds", resetsAt: new Date().toISOString() } });
    expect(q.pickFreeRoute(["eas", "github-actions"])).toBe("github-actions");
  });
});

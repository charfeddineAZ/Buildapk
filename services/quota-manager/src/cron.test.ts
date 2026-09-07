import { describe, it, expect } from "vitest";
import { matchesCron, nextRun, parseCron, describeSchedule } from "./cron.js";

describe("cron", () => {
  it("parses fields", () => {
    const c = parseCron("*/15 9-17 * * 1-5");
    expect(c.minute).toEqual([0, 15, 30, 45]);
    expect(c.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(c.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it("matches a daily midnight schedule", () => {
    const expr = "0 0 * * *";
    expect(matchesCron(expr, new Date(Date.UTC(2026, 0, 1, 0, 0)))).toBe(true);
    expect(matchesCron(expr, new Date(Date.UTC(2026, 0, 1, 0, 1)))).toBe(false);
  });

  it("computes the next run", () => {
    const expr = "30 6 * * *"; // 06:30 daily
    const from = new Date(Date.UTC(2026, 0, 1, 6, 0));
    const next = nextRun(expr, from);
    expect(next?.getUTCHours()).toBe(6);
    expect(next?.getUTCMinutes()).toBe(30);
  });

  it("describes a schedule", () => {
    expect(describeSchedule("0 0 1 * *")).toContain("dom[1]");
  });
});

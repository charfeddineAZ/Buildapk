import { describe, it, expect } from "vitest";
import { bumpVersion, versionPatch } from "./version.js";

describe("bumpVersion", () => {
  it("increments versionCode and bumps semantic patch", () => {
    const v = bumpVersion("1.2.3", 7);
    expect(v.versionCode).toBe(8);
    expect(v.versionName).toBe("1.2.4");
  });

  it("rolls over patch and minor", () => {
    expect(bumpVersion("1.99.99", 1).versionName).toBe("2.0.0");
  });

  it("falls back to a build suffix for non-semver", () => {
    const v = bumpVersion("custom", 3);
    expect(v.versionCode).toBe(4);
    expect(v.versionName.startsWith("custom+")).toBe(true);
  });

  it("produces an Expo version patch", () => {
    const p = versionPatch("1.2.4", 8);
    expect(p.file).toBe("app.json");
    expect(p.target).toBe("expo.version");
  });
});

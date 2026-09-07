import { describe, it, expect } from "vitest";
import { handle } from "./index.js";

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "CPAAutomator",
    dependencies: { expo: "^53.0.0", react: "19.0.0", "react-native": "0.79.3", "react-native-dynamic": "1.2.0" },
  }),
  "app.json": JSON.stringify({ expo: { name: "CPAAutomator", icon: "./assets/icon.png", android: { minSdkVersion: 24, targetSdkVersion: 35 } } }),
  "assets/icon.png": "bin",
};

const ENV = {};

async function asJson(res: Response) {
  return { status: res.status, body: await res.json() };
}

describe("API gateway", () => {
  it("health check", async () => {
    const r = await handle(new Request("https://x/health"), ENV as any, {});
    const { body } = await asJson(r);
    expect(body.ok).toBe(true);
  });

  it("auth + analyze + build end to end", async () => {
    const auth = await handle(new Request("https://x/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ googleId: "g1", email: "a@b.co", name: "Tester" }) }), ENV as any, {});
    expect((await asJson(auth)).body.user.id).toBeTruthy();

    const analyze = await handle(new Request("https://x/projects/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryId: "charfeddineAZ/CPAAutomator", repoName: "CPAAutomator", org: "charfeddine", files: FILES }) }), ENV as any, {});
    const { body: a } = await asJson(analyze);
    expect(a.analysis.primaryFramework).toBe("expo");
    expect(a.analysis.issues.some((i: any) => i.id === "android-package-missing")).toBe(true);
    const projectId = a.projectId;

    const build = await handle(new Request(`https://x/projects/${projectId}/build`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: "apk" }) }), ENV as any, {});
    const { body: b } = await asJson(build);
    expect(b.result.status).toBe("success");
    expect(b.result.attempts).toHaveLength(1);

    const get = await handle(new Request(`https://x/builds/${b.result.buildId}`), ENV as any, {});
    expect((await asJson(get)).status).toBe(200);
  });

  it("triggers a build via GitHub webhook on main", async () => {
    // first register the project
    await handle(new Request("https://x/projects/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryId: "me/app", repoName: "app", org: "me", files: FILES }) }), ENV as any, {});
    const hook = await handle(new Request("https://x/webhooks/github", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "me/app" } }) }), ENV as any, {});
    const { body } = await asJson(hook);
    expect(body.triggered).toBe(true);
    expect(body.build.status).toBe("success");
  });

  it("exposes audit log and usage after actions", async () => {
    await handle(new Request("https://x/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ googleId: "g2", email: "b@c.co", name: "T2" }) }), ENV as any, {});
    await handle(new Request("https://x/projects/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryId: "me/app2", repoName: "app2", org: "me", files: FILES }) }), ENV as any, {});
    const audit = await handle(new Request("https://x/audit"), ENV as any, {});
    const auditBody = await asJson(audit);
    expect(auditBody.body.entries.some((e: any) => e.action === "auth.google")).toBe(true);
    const usage = await handle(new Request("https://x/usage"), ENV as any, {});
    const usageBody = await asJson(usage);
    expect(Array.isArray(usageBody.body.quotas)).toBe(true);
  });
});

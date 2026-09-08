import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handle } from "./index.js";
import { platformStatus, userChecklist, verifyGithubSignature } from "./setup.js";
import { SessionService } from "./session.js";

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "CPAAutomator", dependencies: { expo: "^53.0.0", react: "19.0.0", "react-native": "0.79.3", "react-native-dynamic": "1.2.0" } }),
  "app.json": JSON.stringify({ expo: { name: "CPAAutomator", icon: "./assets/icon.png", android: { minSdkVersion: 24, targetSdkVersion: 35 } } }),
  "assets/icon.png": "bin",
};

// Each test suite gets its own env object → its own Platform (WeakMap cache in index.ts).
const mkEnv = (extra: Record<string, unknown> = {}) => ({ MASTER_SECRET: "unit-test-master-secret-0123456789", API_PUBLIC_URL: "https://api.test", WEB_ORIGIN: "https://web.test", ...extra });

const J = { "content-type": "application/json" };
async function call(env: any, path: string, init: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = { ...J, ...(init.headers as any) };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await handle(new Request(`https://api.test${path}`, { ...init, headers }), env, {});
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, headers: res.headers, body: ct.includes("json") ? await res.json() : await res.text() };
}

async function login(env: any) {
  const r = await call(env, "/auth/google", { method: "POST", body: JSON.stringify({ googleId: "g-zero", email: "z@x.co", name: "Zero" }) });
  return r.body.token as string;
}

describe("sessions", () => {
  it("issues a bearer session on login and resolves /auth/me", async () => {
    const env = mkEnv();
    const token = await login(env);
    expect(token.split(".")).toHaveLength(2);
    const me = await call(env, "/auth/me", {}, token);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("z@x.co");
    expect((await call(env, "/auth/me", {}, token + "x")).status).toBe(401);
  });

  it("SessionService rejects tampered/expired tokens and validates OAuth state", async () => {
    const s = new SessionService("unit-test-master-secret-0123456789", 1);
    const t = await s.issue({ sub: "u", provider: "demo" });
    expect((await s.verify(t))?.sub).toBe("u");
    expect(await s.verify(t, Date.now() + 5000)).toBeNull();
    const st = await s.issueState({ next: "/x" });
    expect((await s.verifyState(st))?.next).toBe("/x");
    expect(await s.verifyState(st.slice(0, -2) + "zz")).toBeNull();
  });
});

describe("setup wizard", () => {
  it("reports platform status with remediation for missing capabilities", async () => {
    const st = platformStatus({ ENVIRONMENT: "production" });
    expect(st.ready).toBe(false);
    const vault = st.capabilities.find((c) => c.id === "vault")!;
    expect(vault.health).toBe("missing");
    expect(vault.fix).toContain("wrangler secret put MASTER_SECRET");
    const ok = platformStatus({ ENVIRONMENT: "production", MASTER_SECRET: "x".repeat(32), ARTIFACTS: {}, SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k", GITHUB_CLIENT_ID: "a", GITHUB_CLIENT_SECRET: "b", API_PUBLIC_URL: "https://api" });
    expect(ok.ready).toBe(true);
  });

  it("builds a per-user checklist with progress", () => {
    const c = userChecklist({ signedIn: true, githubConnected: true, githubOauthAvailable: true, projects: 1, builds: 0, hasExpoToken: false, hasPlayServiceAccount: false, signingReady: false });
    expect(c.complete).toBe(false);
    expect(c.progress).toBe(75);
    expect(c.steps.find((s) => s.id === "build")?.done).toBe(false);
  });

  it("exposes /setup/status and /setup/checklist over HTTP", async () => {
    const env = mkEnv();
    const st = await call(env, "/setup/status");
    expect(st.body.mode).toBe("development");
    const token = await login(env);
    const cl = await call(env, "/setup/checklist", {}, token);
    expect(cl.body.steps.find((s: any) => s.id === "signin").done).toBe(true);
  });
});

describe("connections + secrets", () => {
  it("lists connections and reflects stored secrets (masked)", async () => {
    const env = mkEnv();
    const token = await login(env);
    let c = await call(env, "/connections", {}, token);
    expect(c.body.githubOAuth).toBe(false);
    expect(c.body.connections.find((x: any) => x.provider === "github").status).toBe("unavailable");
    expect(c.body.connections.find((x: any) => x.provider === "expo").status).toBe("not-connected");

    const put = await call(env, "/secrets/user/EXPO_TOKEN", { method: "PUT", body: JSON.stringify({ value: "expo_abcdefghijklmnopqrstuvwxyz0123456789" }) }, token);
    expect(put.status).toBe(200);
    expect(put.body.secret.preview).not.toContain("abcdefghijklmnop");
    const list = await call(env, "/secrets/user", {}, token);
    expect(list.body.secrets.map((s: any) => s.name)).toEqual(["EXPO_TOKEN"]);
    expect(JSON.stringify(list.body)).not.toContain("expo_abcdefghijklmnopqrstuvwxyz");

    c = await call(env, "/connections", {}, token);
    expect(c.body.connections.find((x: any) => x.provider === "expo").status).toBe("connected");

    // validation + auth
    expect((await call(env, "/secrets/user/GITHUB_TOKEN", { method: "PUT", body: JSON.stringify({ value: "not-a-token-at-all" }) }, token)).status).toBe(500);
    expect((await call(env, "/secrets/user", {})).status).toBe(401);
    expect((await call(env, "/secrets/user/EXPO_TOKEN", { method: "DELETE" }, token)).body.ok).toBe(true);
    expect((await call(env, "/secrets/user", {}, token)).body.secrets).toHaveLength(0);
  });

  it("injects user + project secrets and signing env into the build", async () => {
    const env = mkEnv();
    const token = await login(env);
    const a = await call(env, "/projects/analyze", { method: "POST", body: JSON.stringify({ repositoryId: "me/app", repoName: "app", org: "me", files: FILES }) }, token);
    const pid = a.body.projectId;
    await call(env, "/secrets/user/EXPO_TOKEN", { method: "PUT", body: JSON.stringify({ value: "expo_abcdefghijklmnopqrstuvwxyz0123456789" }) }, token);
    await call(env, `/secrets/project/${pid}/MY_VAR`, { method: "PUT", body: JSON.stringify({ value: "hello" }) }, token);

    // Spy on the orchestrator to capture the env that would reach the container.
    const { createPlatform } = await import("./platform.js");
    const platform = createPlatform(env as any);
    const spy = vi.spyOn(platform.d.orchestrator, "run");
    const tk = (await platform.ensureUser({ googleId: "g-env", email: "e@x.co", name: "E" }));
    const { project } = await platform.analyzeRepo({ repositoryId: "me/env", repoName: "env", org: "me", files: FILES, userId: tk.id });
    await platform.setSecret("user", tk.id, "EXPO_TOKEN", "expo_abcdefghijklmnopqrstuvwxyz0123456789");
    await platform.setSecret("project", project.id, "MY_VAR", "hello");
    await platform.startBuild(project.id, { userId: tk.id });
    const prepared = spy.mock.calls[0][1];
    expect(prepared.env.EXPO_TOKEN).toBe("expo_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(prepared.env.MY_VAR).toBe("hello");
    expect(prepared.env.UPLOAD_STORE_PASSWORD).toBeTruthy();
    expect(prepared.env.UPLOAD_KEY_ALIAS).toBe("apkfactory");
  });
});

describe("signing endpoints", () => {
  it("auto-provisions signing on analyze, stores keystore from builder, exports and rotates", async () => {
    const env = mkEnv();
    const token = await login(env);
    const a = await call(env, "/projects/analyze", { method: "POST", body: JSON.stringify({ repositoryId: "me/sign", repoName: "sign", org: "me", files: FILES }) }, token);
    const pid = a.body.projectId;
    let s = await call(env, `/projects/${pid}/signing`);
    expect(s.body.signing.configured).toBe(true);
    expect(s.body.signing.keystoreReady).toBe(false);
    expect(s.body.signing.gradleBlock).toContain("signingConfigs");
    expect(JSON.stringify(s.body)).not.toMatch(/PASSWORD":"[^<]/);

    const ks = Buffer.alloc(200, 9).toString("base64");
    s = await call(env, `/projects/${pid}/signing/keystore`, { method: "POST", body: JSON.stringify({ keystoreBase64: ks, certSha256: "AB:CD" }) });
    expect(s.body.signing.keystoreReady).toBe(true);
    const exp = await handle(new Request(`https://api.test/projects/${pid}/signing/export`, { headers: { authorization: `Bearer ${token}` } }), env as any, {});
    expect(exp.status).toBe(200);
    expect(Buffer.from(await exp.arrayBuffer()).toString("base64")).toBe(ks);
    expect((await call(env, `/projects/${pid}/signing/rotate`, { method: "POST", body: "{}" }, token)).status).toBe(400);
    s = await call(env, `/projects/${pid}/signing/rotate`, { method: "POST", body: JSON.stringify({ confirm: "ROTATE" }) }, token);
    expect(s.body.signing.keystoreReady).toBe(false);
    expect(s.body.signing.rotatedAt).toBeTruthy();
  });
});

describe("repair preview (§22)", () => {
  it("previews suggested fixes as diffs and applies approved ones", async () => {
    const env = mkEnv();
    const a = await call(env, "/projects/analyze", { method: "POST", body: JSON.stringify({ repositoryId: "me/prev", repoName: "prev", org: "me", files: FILES }) });
    const pid = a.body.projectId;
    expect(a.body.analysis.issues.some((i: any) => i.id === "android-package-missing")).toBe(true);
    const p = await call(env, `/projects/${pid}/repairs/preview`);
    expect(p.body.source).toBe("suggestions");
    expect(p.body.previews.length).toBeGreaterThan(0);
    const pkg = p.body.previews.find((x: any) => x.file === "app.json");
    expect(pkg.diff).toContain("+++ b/app.json");
    expect(pkg.diff).toContain("\"package\"");
    expect(p.body.summary.files).toBeGreaterThan(0);

    const approved = p.body.previews.filter((x: any) => x.kind === "file").map((x: any) => x.patch);
    const ap = await call(env, `/projects/${pid}/repairs/apply`, { method: "POST", body: JSON.stringify({ patches: approved }) });
    expect(ap.body.applied).toBe(approved.length);
    expect(ap.body.analysis.issues.some((i: any) => i.id === "android-package-missing")).toBe(false);
    expect(ap.body.analysis.score.overall).toBeGreaterThan(a.body.analysis.score.overall);
  });
});

describe("artifacts", () => {
  it("stores build logs/report and serves them via signed URLs", async () => {
    const env = mkEnv();
    const a = await call(env, "/projects/analyze", { method: "POST", body: JSON.stringify({ repositoryId: "me/art", repoName: "art", org: "me", files: FILES }) });
    const b = await call(env, `/projects/${a.body.projectId}/build`, { method: "POST", body: JSON.stringify({ target: "apk" }) });
    const arts = b.body.result.artifacts as any[];
    expect(arts.map((x) => x.type).sort()).toEqual(["logs", "report"]);
    const logs = arts.find((x) => x.type === "logs");
    const u = new URL(logs.url);
    expect(u.origin).toBe("https://api.test");
    const res = await handle(new Request(logs.url), env as any, {});
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("attempt 1");
    // tampered signature → 403
    u.searchParams.set("sig", "nope");
    expect((await handle(new Request(u.toString()), env as any, {})).status).toBe(403);
    // refresh
    const key = decodeURIComponent(new URL(logs.url).pathname.replace("/artifacts/", ""));
    const r = await call(env, "/artifacts/refresh", { method: "POST", body: JSON.stringify({ key }) });
    expect(r.body.url).toContain("/artifacts/");
  });
});

describe("webhooks", () => {
  it("verifies X-Hub-Signature-256 when a secret is configured", async () => {
    const secret = "hooksecret";
    const body = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "me/app" } });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await verifyGithubSignature(secret, body, `sha256=${mac}`)).toBe(true);
    expect(await verifyGithubSignature(secret, body, `sha256=${"0".repeat(64)}`)).toBe(false);

    const env = mkEnv({ GITHUB_WEBHOOK_SECRET: secret });
    await call(env, "/projects/analyze", { method: "POST", body: JSON.stringify({ repositoryId: "me/app", repoName: "app", org: "me", files: FILES }) });
    expect((await call(env, "/webhooks/github", { method: "POST", body })).status).toBe(401);
    const ok = await call(env, "/webhooks/github", { method: "POST", body, headers: { "x-hub-signature-256": `sha256=${mac}`, "x-github-event": "push" } });
    expect(ok.body.triggered).toBe(true);
    const ping = await call(env, "/webhooks/github", { method: "POST", body: "{}", headers: { "x-hub-signature-256": `sha256=${"0".repeat(64)}`, "x-github-event": "ping" } });
    expect(ping.status).toBe(401);
  });
});

describe("GitHub OAuth (mocked GitHub)", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: any, init: any) => {
      const url = String(input);
      if (url.startsWith("https://github.com/login/oauth/access_token")) {
        const b = JSON.parse(init.body);
        return new Response(JSON.stringify(b.code === "good" ? { access_token: "gho_testtoken1234567890", scope: "read:user,public_repo,workflow", token_type: "bearer" } : { error: "bad_verification_code" }), { status: 200, headers: J });
      }
      if (url === "https://api.github.com/user") return new Response(JSON.stringify({ id: 42, login: "octo", name: "Octo Cat", email: null, avatar_url: "https://a/x.png" }), { status: 200, headers: J });
      if (url === "https://api.github.com/user/emails") return new Response(JSON.stringify([{ email: "octo@github.com", primary: true, verified: true }]), { status: 200, headers: J });
      if (url.startsWith("https://api.github.com/user/repos")) return new Response(JSON.stringify([{ full_name: "octo/app", default_branch: "main", private: false }]), { status: 200, headers: J });
      if (url.includes("/git/trees/")) return new Response(JSON.stringify({ tree: [{ path: "package.json", type: "blob", size: 100, sha: "1" }, { path: "app.json", type: "blob", size: 100, sha: "2" }, { path: "assets/icon.png", type: "blob", size: 5000, sha: "3" }, { path: "yarn.lock", type: "blob", size: 900000, sha: "4" }] }), { status: 200, headers: J });
      if (url.includes("/repos/octo/app") && url.includes("/contents/")) {
        const p = decodeURIComponent(url.split("/contents/")[1].split("?")[0]);
        return new Response(FILES[p] ?? "", { status: FILES[p] ? 200 : 404 });
      }
      if (url.endsWith("/repos/octo/app")) return new Response(JSON.stringify({ default_branch: "main" }), { status: 200, headers: J });
      return realFetch(input, init);
    }) as any;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("start → callback → session, sealed token, connection; then imports a repo", async () => {
    const env = mkEnv({ GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret" });
    const st = await call(env, "/setup/status");
    expect(st.body.capabilities.find((c: any) => c.id === "github-oauth").health).toBe("ok");

    const start = await handle(new Request("https://api.test/auth/github/start?next=/dashboard"), env as any, {});
    expect(start.status).toBe(302);
    const authz = new URL(start.headers.get("location")!);
    expect(authz.origin + authz.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(authz.searchParams.get("redirect_uri")).toBe("https://api.test/auth/github/callback");
    expect(authz.searchParams.get("scope")).toContain("public_repo");
    expect(authz.searchParams.get("scope")).not.toContain(" repo");
    const state = authz.searchParams.get("state")!;

    // bad state → error redirect
    const bad = await handle(new Request(`https://api.test/auth/github/callback?code=good&state=${state}x`), env as any, {});
    expect(new URL(bad.headers.get("location")!).searchParams.get("error")).toContain("state");

    const cb = await handle(new Request(`https://api.test/auth/github/callback?code=good&state=${state}`), env as any, {});
    expect(cb.status).toBe(302);
    const to = new URL(cb.headers.get("location")!);
    expect(to.origin).toBe("https://web.test");
    expect(to.pathname).toBe("/auth/callback");
    const token = decodeURIComponent(to.hash.replace("#token=", ""));

    const me = await call(env, "/auth/me", {}, token);
    expect(me.body.user.email).toBe("octo@github.com");
    expect(me.body.provider).toBe("github");

    const conns = await call(env, "/connections", {}, token);
    const gh = conns.body.connections.find((c: any) => c.provider === "github");
    expect(gh.status).toBe("connected");
    expect(gh.scopes).toContain("public_repo");
    // token never leaks
    expect(JSON.stringify(conns.body)).not.toContain("gho_");
    expect(JSON.stringify((await call(env, "/audit")).body)).not.toContain("gho_");

    const repos = await call(env, "/github/repos", {}, token);
    expect(repos.body.repos[0].fullName).toBe("octo/app");

    const imp = await call(env, "/projects/import", { method: "POST", body: JSON.stringify({ repo: "https://github.com/octo/app" }) }, token);
    expect(imp.status).toBe(200);
    expect(imp.body.ref).toBe("main");
    expect(imp.body.analysis.primaryFramework).toBe("expo");
    expect(imp.body.analysis.assets.appIcon).toBe(true);

    const cl = await call(env, "/setup/checklist", {}, token);
    expect(cl.body.steps.find((s: any) => s.id === "github").done).toBe(true);
    expect(cl.body.steps.find((s: any) => s.id === "repo").done).toBe(true);

    await call(env, "/connections/github", { method: "DELETE" }, token);
    expect((await call(env, "/connections", {}, token)).body.connections.find((c: any) => c.provider === "github").status).toBe("not-connected");
  });

  it("returns 503 for /auth/github/start when OAuth is not configured", async () => {
    const env = mkEnv();
    expect((await call(env, "/auth/github/start")).status).toBe(503);
  });
});

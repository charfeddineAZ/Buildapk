/**
 * HTTP router for the API Gateway (Cloudflare Worker). Stateless: each request
 * is mapped to a Platform method. CORS is open for the web/PWA client; the
 * session travels as `Authorization: Bearer <token>`.
 */

import type { Platform } from "./platform.js";
import type { SecretScope } from "./secrets.js";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-hub-signature-256,x-github-event",
  "access-control-expose-headers": "content-disposition,x-artifact-sha256",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...CORS } });

const redirect = (location: string) => new Response(null, { status: 302, headers: { location, ...CORS } });

async function readJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

export async function handleRequest(platform: Platform, request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;
  const me = await platform.currentUser(request).catch(() => undefined);
  const uid = me?.sub;
  const requireUser = () => { if (!uid) throw new HttpError(401, "sign in required"); return uid; };

  try {
    if (method === "GET" && (path === "/health" || path === "/")) return json({ ok: true, ts: Date.now(), version: platform.status().version });

    // ── Setup wizard / status ────────────────────────────────────────────
    if (method === "GET" && path === "/setup/status") return json(platform.status());
    if (method === "GET" && path === "/setup/checklist") return json(await platform.checklist(uid));

    // ── Auth ─────────────────────────────────────────────────────────────
    if (method === "POST" && path === "/auth/google") {
      const body = await readJson(request);
      if (!body.googleId || !body.email) return json({ error: "googleId and email are required" }, 400);
      const user = await platform.ensureUser(body);
      const token = await platform.issueSession(user, body.googleId === "demo" ? "demo" : "google");
      return json({ user, token });
    }
    if (method === "GET" && path === "/auth/me") {
      if (!me) return json({ user: null }, 401);
      return json({ user: me.account ?? { id: me.sub, email: me.email, name: me.name, avatar: me.avatar }, provider: me.provider, exp: me.exp });
    }
    if (method === "GET" && path === "/auth/github/start") {
      if (!platform.githubOAuthAvailable()) return json({ error: "GitHub OAuth is not configured on this deployment", setup: "/setup/status" }, 503);
      const mode = url.searchParams.get("mode") === "write" ? "write" : "read";
      const next = url.searchParams.get("next") ?? "/dashboard";
      // Allow linking GitHub to an existing session passed as ?token= (browser navigations can't set headers).
      const linkUid = uid ?? (await platform.currentUser(new Request(request.url, { headers: { authorization: `Bearer ${url.searchParams.get("token") ?? ""}` } })))?.sub;
      return redirect(await platform.githubStart(mode, next, linkUid));
    }
    if (method === "GET" && path === "/auth/github/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) return json({ error: "missing code/state" }, 400);
      const { redirect: to } = await platform.githubCallback(code, state);
      return redirect(to);
    }

    // ── Connections ──────────────────────────────────────────────────────
    if (method === "GET" && path === "/connections") {
      const probe = url.searchParams.get("probe") === "1";
      return json({ connections: await platform.connections(uid, probe), githubOAuth: platform.githubOAuthAvailable() });
    }
    const disc = path.match(/^\/connections\/([a-z-]+)$/);
    if (method === "DELETE" && disc) {
      await platform.disconnect(requireUser(), disc[1] as any);
      return json({ ok: true });
    }
    if (method === "GET" && path === "/github/repos") {
      return json({ repos: await platform.listGithubRepos(uid) });
    }

    // ── Secrets ──────────────────────────────────────────────────────────
    const secretsMatch = path.match(/^\/secrets\/(user|project)(?:\/([^/]+))?(?:\/([A-Z][A-Z0-9_]+))?$/);
    if (secretsMatch) {
      const scope = secretsMatch[1] as SecretScope;
      const ownerId = scope === "user" ? requireUser() : secretsMatch[2];
      const name = scope === "user" ? secretsMatch[2] : secretsMatch[3];
      if (!ownerId) return json({ error: "project id required" }, 400);
      if (method === "GET" && !name) return json(await platform.listSecrets(scope, ownerId));
      if (method === "PUT" && name) {
        const body = await readJson(request);
        if (typeof body.value !== "string") return json({ error: "value is required" }, 400);
        return json({ secret: await platform.setSecret(scope, ownerId, name, body.value, uid) });
      }
      if (method === "DELETE" && name) {
        await platform.deleteSecret(scope, ownerId, name, uid);
        return json({ ok: true });
      }
    }

    // ── Audit / usage ────────────────────────────────────────────────────
    if (method === "GET" && path === "/audit") return json({ entries: platform.getAuditLogs() });
    if (method === "GET" && path === "/usage") return json({ usage: platform.getUsageSummary(), quotas: platform.getQuotaStatus() });

    // ── Projects ─────────────────────────────────────────────────────────
    if (method === "POST" && path === "/projects/analyze") {
      const body = await readJson(request);
      if (!body.files || !body.repositoryId) return json({ error: "repositoryId and files are required" }, 400);
      const { project, analysis } = await platform.analyzeRepo({ ...body, userId: uid });
      return json({ projectId: project.id, analysis });
    }
    if (method === "POST" && path === "/projects/import") {
      const body = await readJson(request);
      if (!body.repo) return json({ error: "repo (owner/name or URL) is required" }, 400);
      const { project, analysis } = await platform.importFromGithub({ repo: body.repo, ref: body.ref, userId: uid });
      return json({ projectId: project.id, ref: project.ref, analysis });
    }
    if (method === "GET" && path === "/projects") {
      const projects = (await platform.listProjects(uid)).map((p) => ({
        id: p.id,
        repoName: p.repoName,
        org: p.org,
        repositoryId: p.repositoryId,
        ref: p.ref,
        score: p.analysis?.score.overall,
        framework: p.analysis?.primaryFramework,
        issues: p.analysis?.issues.filter((i) => i.severity === "required" || i.severity === "recommended").length ?? 0,
      }));
      return json({ projects });
    }

    const projMatch = path.match(/^\/projects\/([^/]+)$/);
    if (method === "GET" && projMatch) {
      const p = (await platform.listProjects()).find((x) => x.id === projMatch[1]);
      if (!p) return json({ error: "not found" }, 404);
      return json({ project: p, analysis: p.analysis });
    }

    const buildMatch = path.match(/^\/projects\/([^/]+)\/build$/);
    if (method === "POST" && buildMatch) {
      const body = await readJson(request);
      const result = await platform.startBuild(buildMatch[1], { ...body, userId: uid });
      return json({ result });
    }
    const buildsList = path.match(/^\/projects\/([^/]+)\/builds$/);
    if (method === "GET" && buildsList) return json({ builds: await platform.listBuilds(buildsList[1]) });

    // §22 — repair preview + approval
    const previewMatch = path.match(/^\/projects\/([^/]+)\/repairs\/preview$/);
    if (previewMatch && (method === "GET" || method === "POST")) {
      const body = method === "POST" ? await readJson(request) : {};
      return json(await platform.previewRepairs(previewMatch[1], Array.isArray(body.patches) ? body.patches : undefined));
    }
    const applyMatch = path.match(/^\/projects\/([^/]+)\/repairs\/apply$/);
    if (method === "POST" && applyMatch) {
      const body = await readJson(request);
      if (!Array.isArray(body.patches) || !body.patches.length) return json({ error: "patches[] required" }, 400);
      const r = await platform.applyRepairs(applyMatch[1], body.patches, uid);
      return json({ projectId: r.project.id, applied: r.applied, analysis: r.analysis });
    }

    // Signing
    const signMatch = path.match(/^\/projects\/([^/]+)\/signing(?:\/(ensure|rotate|keystore|export))?$/);
    if (signMatch) {
      const [, projectId, action] = signMatch;
      if (method === "GET" && !action) return json({ signing: await platform.signingStatus(projectId) });
      if (method === "POST" && action === "ensure") return json({ signing: await platform.ensureSigning(projectId, uid) });
      if (method === "POST" && action === "rotate") {
        const body = await readJson(request);
        if (body.confirm !== "ROTATE") return json({ error: "confirm:\"ROTATE\" required — rotating the key breaks in-place updates for existing installs" }, 400);
        return json({ signing: await platform.rotateSigning(projectId, uid) });
      }
      if (method === "POST" && action === "keystore") {
        const body = await readJson(request);
        if (typeof body.keystoreBase64 !== "string") return json({ error: "keystoreBase64 required" }, 400);
        return json({ signing: await platform.storeKeystore(projectId, body.keystoreBase64, body.certSha256) });
      }
      if (method === "GET" && action === "export") {
        requireUser();
        const buf = await platform.exportKeystore(projectId, uid);
        if (!buf) return json({ error: "no keystore stored yet" }, 404);
        return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${projectId}-release.keystore"`, ...CORS } });
      }
    }

    // ── Builds / artifacts ───────────────────────────────────────────────
    const buildGet = path.match(/^\/builds\/([^/]+)$/);
    if (method === "GET" && buildGet) {
      const b = await platform.getBuild(buildGet[1]);
      if (!b) return json({ error: "not found" }, 404);
      return json({ build: b });
    }
    const logsGet = path.match(/^\/builds\/([^/]+)\/logs$/);
    if (method === "GET" && logsGet) {
      const b = await platform.getBuild(logsGet[1]);
      if (!b) return json({ error: "not found" }, 404);
      return new Response(b.result.attempts.map((a) => a.logs).join("\n───\n"), { status: 200, headers: { "content-type": "text/plain", ...CORS } });
    }
    if (method === "GET" && path.startsWith("/artifacts/")) {
      const key = decodeURIComponent(path.slice("/artifacts/".length));
      const res = await platform.serveArtifact(key, Number(url.searchParams.get("exp")), url.searchParams.get("sig") ?? "");
      for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
      return res;
    }
    if (method === "POST" && path === "/artifacts/refresh") {
      const body = await readJson(request);
      if (!body.key) return json({ error: "key required" }, 400);
      return json(await platform.refreshArtifact(body.key));
    }

    // ── Webhooks ─────────────────────────────────────────────────────────
    if (method === "POST" && path === "/webhooks/github") {
      const raw = await request.text();
      if (!(await platform.verifyWebhook(raw, request.headers.get("x-hub-signature-256")))) return json({ error: "invalid signature" }, 401);
      let body: any = {};
      try { body = JSON.parse(raw); } catch { /* empty */ }
      const event = request.headers.get("x-github-event") ?? (body.release ? "release" : "push");
      if (event === "ping") return json({ ok: true, zen: body.zen });
      const repo = body?.repository?.full_name as string | undefined;
      const ref = (body?.ref as string) ?? "";
      const project = (await platform.listProjects()).find((p) => p.repositoryId === repo);
      if (!project) return json({ triggered: false, reason: "unknown repository" });
      const defaultBranch = project.ref ?? body?.repository?.default_branch ?? "main";
      if (event === "push" && !ref.endsWith(`/${defaultBranch}`)) return json({ triggered: false, reason: `not ${defaultBranch} branch` });
      if (event === "release" && body.action !== "published") return json({ triggered: false, reason: "release not published" });
      const result = await platform.startBuild(project.id, { triggeredBy: event === "release" ? "webhook-release" : "webhook-push", target: event === "release" ? "aab" : "apk" });
      return json({ triggered: true, build: result });
    }

    return json({ error: "not found", path }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

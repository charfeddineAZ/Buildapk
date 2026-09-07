/**
 * HTTP router for the API Gateway (Cloudflare Worker). Stateless: each request
 * is mapped to a Platform method. CORS is open for the web/PWA client.
 */

import type { Platform } from "./platform.js";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });

const CORS: HeadersInit = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};

async function readJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

export async function handleRequest(platform: Platform, request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  try {
    if (method === "GET" && path === "/health") return json({ ok: true, ts: Date.now() });

    if (method === "POST" && path === "/auth/google") {
      const body = await readJson(request);
      const user = await platform.ensureUser(body);
      return json({ user });
    }

    if (method === "GET" && path === "/connections") {
      return json({
        connections: [
          { provider: "google", status: "connected" },
          { provider: "github", status: "connected" },
          { provider: "expo", status: "connected" },
          { provider: "cloudflare", status: "connected" },
        ],
      });
    }

    if (method === "GET" && path === "/audit") {
      return json({ entries: platform.getAuditLogs() });
    }

    if (method === "GET" && path === "/usage") {
      return json({ usage: platform.getUsageSummary(), quotas: platform.getQuotaStatus() });
    }

    if (method === "POST" && path === "/projects/analyze") {
      const body = await readJson(request);
      if (!body.files || !body.repositoryId) return json({ error: "repositoryId and files are required" }, 400);
      const { project, analysis } = await platform.analyzeRepo(body);
      return json({ projectId: project.id, analysis });
    }

    if (method === "GET" && path === "/projects") {
      const projects = (await platform.listProjects()).map((p) => ({
        id: p.id,
        repoName: p.repoName,
        org: p.org,
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
      const result = await platform.startBuild(buildMatch[1], body);
      return json({ result });
    }

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

    if (method === "POST" && path === "/webhooks/github") {
      const body = await readJson(request);
      const repo = body?.repository?.full_name as string | undefined;
      const ref = (body?.ref as string) ?? "";
      const project = (await platform.listProjects()).find((p) => p.repositoryId === repo);
      if (!project) return json({ triggered: false, reason: "unknown repository" });
      if (!ref.endsWith("main")) return json({ triggered: false, reason: "not main branch" });
      const result = await platform.startBuild(project.id, { triggeredBy: "webhook-push" });
      return json({ triggered: true, build: result });
    }

    return json({ error: "not found", path }, 404);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
}

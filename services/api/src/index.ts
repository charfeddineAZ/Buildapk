/**
 * Cloudflare Worker entrypoint for the API Gateway.
 *
 *   - In production this module is deployed as a Worker; `fetch` is the handler.
 *   - Locally you can run it with `npm run dev:api` (a tiny Node adapter that
 *     forwards HTTP requests to the same handler).
 */

import { createPlatform, type PlatformEnv } from "./platform.js";
import { handleRequest } from "./router.js";

export interface Env extends PlatformEnv {
  [key: string]: unknown;
}

const platformCache = new WeakMap<object, ReturnType<typeof createPlatform>>();

export async function handle(request: Request, env: Env, _ctx: unknown): Promise<Response> {
  let platform = platformCache.get(env);
  if (!platform) {
    platform = createPlatform(env as PlatformEnv);
    platformCache.set(env, platform);
  }
  return handleRequest(platform, request);
}

export default {
  fetch: handle,
};

// ── Local dev adapter (not used by the Worker runtime) ──────────────────────
import { createServer } from "node:http";

if (process.env.NODE_ENV !== "production" && import.meta.url === `file://${process.argv[1]}`) {
  // Load .dev.vars (same file wrangler uses) so local dev == Worker config.
  try {
    const { readFileSync } = await import("node:fs");
    for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined && m[2] !== "") process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .dev.vars — fine */ }
  const PORT = Number(process.env.PORT ?? 8787);
  const devEnv: Env = { ENVIRONMENT: "development", MASTER_SECRET: "local-dev-secret-change-me", API_PUBLIC_URL: `http://localhost:${PORT}`, WEB_ORIGIN: "http://localhost:3000", ...(process.env as Record<string, string>) };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = `http://localhost:${PORT}${req.url}`;
    const response = await handle(
      new Request(url, { method: req.method, headers: req.headers as any, body: body.length ? body : undefined }),
      devEnv,
      {},
    );
    const buf = Buffer.from(await response.arrayBuffer());
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(response.status, headers);
    res.end(buf);
  });
  server.listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}`));
}

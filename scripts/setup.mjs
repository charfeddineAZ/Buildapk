#!/usr/bin/env node
/**
 * Zero-Manual-Config setup wizard (operator side).
 *
 *   npm run setup            → interactive: creates R2 bucket + KV namespace,
 *                              writes wrangler.toml vars, pushes secrets,
 *                              deploys API + web, prints the OAuth callback URL.
 *   npm run setup -- --check → non-interactive audit (CI friendly).
 *
 * Idempotent: re-running only fills what is missing. Never prints secret values.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname;
const CHECK = process.argv.includes("--check");
const YES = process.argv.includes("--yes");
const rl = createInterface({ input: process.stdin, output: process.stdout });
const c = { g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` };
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: "pipe", encoding: "utf8", ...opts }).trim();
const tryStr = (cmd) => { try { return sh(cmd); } catch { return null; } };
const ask = async (q, def = "") => { if (YES || CHECK) return def; const a = (await rl.question(`${q}${def ? c.d(` [${def}]`) : ""}: `)).trim(); return a || def; };
const askSecret = async (q) => { if (CHECK) return ""; process.stdout.write(`${q}: `); const a = await new Promise((res) => { let s = ""; process.stdin.setRawMode?.(true); process.stdin.resume(); process.stdin.on("data", function h(ch) { const k = ch.toString(); if (k === "\r" || k === "\n") { process.stdin.setRawMode?.(false); process.stdin.removeListener("data", h); process.stdout.write("\n"); res(s); } else if (k === "\u0003") process.exit(1); else if (k === "\u007f") s = s.slice(0, -1); else s += k; }); }); return a.trim(); };
const wrangler = (args) => spawnSync("npx", ["wrangler", ...args], { cwd: ROOT, stdio: "inherit" }).status === 0;

console.log(c.b("\n🚀 Cloud APK Factory — setup wizard\n"));

// 1. Preconditions ─────────────────────────────────────────────────────────
const who = tryStr("npx wrangler whoami 2>/dev/null");
if (!who || /not authenticated/i.test(who)) {
  console.log(c.y("You are not logged in to Cloudflare."));
  if (CHECK) process.exit(1);
  wrangler(["login"]);
}
const accountId = (tryStr("npx wrangler whoami 2>/dev/null") ?? "").match(/([0-9a-f]{32})/)?.[1] ?? "";
console.log(`${c.g("✓")} Cloudflare account ${c.d(accountId || "(unknown id)")}`);

// 2. wrangler.toml vars ────────────────────────────────────────────────────
const tomlPath = `${ROOT}wrangler.toml`;
let toml = readFileSync(tomlPath, "utf8");
const getVar = (k) => toml.match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m"))?.[1] ?? "";
const setVar = (k, v) => { toml = toml.replace(new RegExp(`^${k}\\s*=\\s*"[^"]*"`, "m"), `${k} = "${v}"`); };
const sub = (tryStr("npx wrangler whoami 2>/dev/null") ?? "").match(/([a-z0-9-]+)\.workers\.dev/)?.[1] ?? "";
const defaultApi = sub ? `https://cloud-apk-factory-api.${sub}.workers.dev` : getVar("API_PUBLIC_URL");
const defaultWeb = sub ? `https://cloud-apk-factory-web.${sub}.workers.dev` : getVar("WEB_ORIGIN");
const apiUrl = getVar("API_PUBLIC_URL").includes("<your-subdomain>") ? await ask("Public URL of the API Worker", defaultApi) : getVar("API_PUBLIC_URL");
const webUrl = getVar("WEB_ORIGIN").includes("<your-subdomain>") ? await ask("Public URL of the web app", defaultWeb) : getVar("WEB_ORIGIN");
if (!CHECK) { setVar("API_PUBLIC_URL", apiUrl); setVar("WEB_ORIGIN", webUrl); if (accountId && !getVar("CF_ACCOUNT_ID")) setVar("CF_ACCOUNT_ID", accountId); }
const webToml = `${ROOT}apps/web/wrangler.jsonc`;
if (!CHECK && existsSync(webToml)) writeFileSync(webToml, readFileSync(webToml, "utf8").replace(/"NEXT_PUBLIC_API_URL":\s*"[^"]*"/, `"NEXT_PUBLIC_API_URL": "${apiUrl}"`));
console.log(`${c.g("✓")} API_PUBLIC_URL=${apiUrl}\n${c.g("✓")} WEB_ORIGIN=${webUrl}`);

// 3. R2 + KV ───────────────────────────────────────────────────────────────
const buckets = tryStr("npx wrangler r2 bucket list 2>/dev/null") ?? "";
if (!/apk-factory-artifacts/.test(buckets)) { console.log(c.y("• R2 bucket apk-factory-artifacts missing")); if (!CHECK) wrangler(["r2", "bucket", "create", "apk-factory-artifacts"]); } else console.log(`${c.g("✓")} R2 bucket apk-factory-artifacts`);
if (getVar("id") === "replace-with-kv-id" || /replace-with-kv-id/.test(toml)) {
  console.log(c.y("• KV namespace CACHE missing"));
  if (!CHECK) {
    const out = tryStr("npx wrangler kv namespace create CACHE 2>&1") ?? "";
    const id = out.match(/id\s*=\s*"([0-9a-f]{32})"/)?.[1] ?? out.match(/([0-9a-f]{32})/)?.[1];
    if (id) { toml = toml.replace(/id = "replace-with-kv-id"/, `id = "${id}"`); console.log(`${c.g("✓")} KV namespace ${id}`); } else console.log(c.r("  could not create KV namespace — set the id manually in wrangler.toml"));
  }
} else console.log(`${c.g("✓")} KV namespace configured`);
if (!CHECK) writeFileSync(tomlPath, toml);

// 4. Secrets ───────────────────────────────────────────────────────────────
const existing = new Set(((tryStr("npx wrangler secret list --format json 2>/dev/null") ?? "[]").match(/"name":\s*"([A-Z0-9_]+)"/g) ?? []).map((m) => m.match(/"([A-Z0-9_]+)"$/)[1]));
const putSecret = (name, value) => spawnSync("npx", ["wrangler", "secret", "put", name], { cwd: ROOT, input: value, stdio: ["pipe", "inherit", "inherit"] }).status === 0;
const SECRETS = [
  { name: "MASTER_SECRET", required: true, gen: () => randomBytes(32).toString("base64"), hint: "generated automatically" },
  { name: "GITHUB_WEBHOOK_SECRET", required: false, gen: () => randomBytes(20).toString("hex"), hint: "generated automatically" },
  { name: "GITHUB_CLIENT_ID", required: true, hint: `github.com/settings/developers → New OAuth App → callback ${apiUrl}/auth/github/callback` },
  { name: "GITHUB_CLIENT_SECRET", required: true, hint: "from the same OAuth App" },
  { name: "SUPABASE_URL", required: false, hint: "https://xxxx.supabase.co (run database/migrations/*.sql first)" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: false, hint: "Supabase → Settings → API" },
  { name: "CF_AI_TOKEN", required: false, hint: "Workers AI token (optional)" },
  { name: "OPENAI_API_KEY", required: false, hint: "optional strong AI tier" },
  { name: "WEBHOOK_URL", required: false, hint: "Slack/Discord webhook (optional)" },
];
for (const s of SECRETS) {
  if (existing.has(s.name)) { console.log(`${c.g("✓")} secret ${s.name}`); continue; }
  console.log(`${s.required ? c.r("✗") : c.y("•")} secret ${s.name} ${c.d(`— ${s.hint}`)}`);
  if (CHECK) continue;
  if (s.gen) { if (putSecret(s.name, s.gen())) console.log(`${c.g("✓")} ${s.name} generated + stored`); continue; }
  const v = await askSecret(`  paste ${s.name}${s.required ? "" : " (enter to skip)"}`);
  if (v) putSecret(s.name, v);
}

// 5. Deploy ────────────────────────────────────────────────────────────────
if (!CHECK && (await ask("Deploy API + web now? (y/n)", "y")).toLowerCase().startsWith("y")) {
  console.log(c.b("\n→ Deploying API Worker"));
  wrangler(["deploy"]);
  console.log(c.b("\n→ Building + deploying web Worker (OpenNext)"));
  spawnSync("npm", ["run", "deploy"], { cwd: `${ROOT}apps/web`, stdio: "inherit", env: { ...process.env, NEXT_PUBLIC_API_URL: apiUrl } });
}

// 6. Verify ────────────────────────────────────────────────────────────────
try {
  const res = await fetch(`${apiUrl}/setup/status`);
  const st = await res.json();
  console.log(c.b(`\nPlatform status (${st.mode}, v${st.version}) — ${st.ready ? c.g("READY") : c.y("needs attention")}`));
  for (const cap of st.capabilities) console.log(`  ${cap.health === "ok" ? c.g("✓") : cap.health === "warn" ? c.y("•") : c.r("✗")} ${cap.label} ${c.d(cap.detail)}${cap.fix ? `\n      ${c.d(cap.fix)}` : ""}`);
} catch { console.log(c.d(`\n(API not reachable yet at ${apiUrl} — deploy first, then re-run npm run setup -- --check)`)); }

console.log(c.b("\nGitHub OAuth App callback URL: ") + `${apiUrl}/auth/github/callback`);
console.log(c.b("GitHub webhook URL:            ") + `${apiUrl}/webhooks/github  (content-type json, events push+release)`);
console.log(c.b("Open the web app:              ") + `${webUrl}/setup\n`);
rl.close();

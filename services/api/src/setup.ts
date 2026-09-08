/**
 * Setup Wizard + Platform Status (Zero-Manual-Config).
 *
 * The goal: a fresh deploy must be usable without hand-editing config files.
 * This module answers three questions the wizard UI asks:
 *
 *   1. `status()`      — which platform-level capabilities are live right now
 *                        (vault, storage, DB, OAuth, AI, notifications, builders)
 *                        and what exactly is missing, with the exact command to fix it.
 *   2. `checklist(user)` — per-user onboarding steps (login → connect GitHub →
 *                        add repo → optional Expo/Play secrets → first build).
 *   3. `probe(provider)` — live connectivity check for a connection using the
 *                        stored (sealed) token, so "Connected" means it actually works.
 *
 * Nothing here reveals secret values — only presence/validity.
 */

import type { ConnectedAccount } from "@apk-factory/types";
import type { SecretsService } from "./secrets.js";

export type Health = "ok" | "warn" | "missing";

export interface CapabilityStatus {
  id: string;
  label: string;
  health: Health;
  detail: string;
  /** Exact remediation (CLI command / dashboard path) when not ok. */
  fix?: string;
  /** Names of env vars / bindings that drive this capability (never values). */
  requires: string[];
}

export interface PlatformStatus {
  environment: string;
  version: string;
  ready: boolean;
  mode: "production" | "development";
  capabilities: CapabilityStatus[];
  checkedAt: string;
}

export interface SetupEnv {
  ENVIRONMENT?: string;
  MASTER_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CF_ACCOUNT_ID?: string;
  CF_AI_TOKEN?: string;
  OPENAI_API_KEY?: string;
  WEBHOOK_URL?: string;
  GITHUB_TOKEN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  API_PUBLIC_URL?: string;
  WEB_ORIGIN?: string;
  ARTIFACTS?: unknown;
  CACHE?: unknown;
}

const has = (v: unknown) => typeof v === "string" ? v.trim().length > 0 : Boolean(v);

export function platformStatus(env: SetupEnv, version = "1.1.0"): PlatformStatus {
  const prod = (env.ENVIRONMENT ?? "development") === "production";
  const caps: CapabilityStatus[] = [];

  const masterOk = has(env.MASTER_SECRET) && String(env.MASTER_SECRET).length >= 16 && env.MASTER_SECRET !== "local-dev-secret-change-me";
  caps.push({
    id: "vault", label: "Token Vault (AES-256-GCM)", requires: ["MASTER_SECRET"],
    health: masterOk ? "ok" : has(env.MASTER_SECRET) ? "warn" : "missing",
    detail: masterOk ? "Master key present; secrets and keystores are sealed at rest." : has(env.MASTER_SECRET) ? "Using a weak/default master secret — fine for local dev only." : "No master secret: secrets, sessions and signing are disabled.",
    fix: masterOk ? undefined : "openssl rand -base64 32 | npx wrangler secret put MASTER_SECRET",
  });

  caps.push({
    id: "storage", label: "Artifact storage (R2)", requires: ["ARTIFACTS binding"],
    health: has(env.ARTIFACTS) ? "ok" : prod ? "missing" : "warn",
    detail: has(env.ARTIFACTS) ? "R2 bucket bound; APK/AAB delivered via signed temporary URLs." : "No R2 binding — artifacts are kept in memory (lost on restart).",
    fix: has(env.ARTIFACTS) ? undefined : "npx wrangler r2 bucket create apk-factory-artifacts  (binding ARTIFACTS is already in wrangler.toml)",
  });

  const dbOk = has(env.SUPABASE_URL) && has(env.SUPABASE_SERVICE_ROLE_KEY);
  caps.push({
    id: "database", label: "Database (Supabase/Postgres)", requires: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    health: dbOk ? "ok" : prod ? "missing" : "warn",
    detail: dbOk ? "Persistent store enabled." : "In-memory store — projects/builds reset on every deploy.",
    fix: dbOk ? undefined : "Create a Supabase project, run database/migrations/0001_init.sql, then: npx wrangler secret put SUPABASE_URL && npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY",
  });

  const ghOauth = has(env.GITHUB_CLIENT_ID) && has(env.GITHUB_CLIENT_SECRET);
  caps.push({
    id: "github-oauth", label: "GitHub login (OAuth)", requires: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "API_PUBLIC_URL", "WEB_ORIGIN"],
    health: ghOauth && has(env.API_PUBLIC_URL) ? "ok" : ghOauth ? "warn" : "missing",
    detail: ghOauth ? (has(env.API_PUBLIC_URL) ? "Users can sign in with GitHub and pick repositories." : "OAuth credentials set but API_PUBLIC_URL missing — callback URL cannot be built.") : "GitHub OAuth not configured — only the demo login is available.",
    fix: ghOauth && has(env.API_PUBLIC_URL) ? undefined : "github.com/settings/developers → New OAuth App (callback = <API_PUBLIC_URL>/auth/github/callback), then wrangler secret put GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET, and set API_PUBLIC_URL + WEB_ORIGIN in wrangler.toml [vars]",
  });

  caps.push({
    id: "github-webhook", label: "GitHub webhooks (auto-build on push)", requires: ["GITHUB_WEBHOOK_SECRET"],
    health: has(env.GITHUB_WEBHOOK_SECRET) ? "ok" : "warn",
    detail: has(env.GITHUB_WEBHOOK_SECRET) ? "Webhook signatures are verified (HMAC-SHA256)." : "Webhook secret missing — push events are accepted unsigned (dev only).",
    fix: has(env.GITHUB_WEBHOOK_SECRET) ? undefined : "openssl rand -hex 20 | npx wrangler secret put GITHUB_WEBHOOK_SECRET",
  });

  const aiTiers = [has(env.CF_ACCOUNT_ID) && has(env.CF_AI_TOKEN) ? "Workers AI" : null, has(env.OPENAI_API_KEY) ? "OpenAI" : null].filter(Boolean);
  caps.push({
    id: "ai", label: "AI Router (repair agent)", requires: ["CF_ACCOUNT_ID + CF_AI_TOKEN", "OPENAI_API_KEY (optional)"],
    health: aiTiers.length ? "ok" : "warn",
    detail: aiTiers.length ? `Tiers available: ${aiTiers.join(", ")}. Known errors are still fixed from the Knowledge Base first.` : "No AI provider — unknown errors get Knowledge-Base fixes only.",
    fix: aiTiers.length ? undefined : "npx wrangler secret put CF_AI_TOKEN (Workers AI, free tier) — CF_ACCOUNT_ID goes in wrangler.toml [vars]",
  });

  caps.push({
    id: "notifications", label: "Notifications", requires: ["WEBHOOK_URL (optional)"],
    health: has(env.WEBHOOK_URL) ? "ok" : "warn",
    detail: has(env.WEBHOOK_URL) ? "Build events are POSTed to your webhook (Slack/Discord/…)." : "Console notifications only.",
    fix: has(env.WEBHOOK_URL) ? undefined : "npx wrangler secret put WEBHOOK_URL",
  });

  caps.push({
    id: "cache", label: "KV cache", requires: ["CACHE binding"],
    health: has(env.CACHE) ? "ok" : "warn",
    detail: has(env.CACHE) ? "Analysis cache enabled." : "No KV namespace — every analysis is recomputed.",
    fix: has(env.CACHE) ? undefined : "npx wrangler kv namespace create CACHE → paste id into wrangler.toml",
  });

  const required = caps.filter((c) => ["vault", "storage", "database", "github-oauth"].includes(c.id));
  const ready = prod ? required.every((c) => c.health === "ok") : caps.every((c) => c.health !== "missing" || c.id === "github-oauth");
  return { environment: env.ENVIRONMENT ?? "development", version, ready, mode: prod ? "production" : "development", capabilities: caps, checkedAt: new Date().toISOString() };
}

// ── Per-user onboarding checklist ─────────────────────────────────────────

export interface ChecklistStep {
  id: string;
  title: string;
  done: boolean;
  optional: boolean;
  hint: string;
  action?: { label: string; href: string };
}

export interface UserChecklist {
  complete: boolean;
  progress: number; // 0..100 across required steps
  steps: ChecklistStep[];
}

export interface ChecklistInput {
  signedIn: boolean;
  githubConnected: boolean;
  githubOauthAvailable: boolean;
  projects: number;
  builds: number;
  hasExpoToken: boolean;
  hasPlayServiceAccount: boolean;
  signingReady: boolean;
}

export function userChecklist(i: ChecklistInput): UserChecklist {
  const steps: ChecklistStep[] = [
    { id: "signin", title: "Sign in", done: i.signedIn, optional: false, hint: "Google or GitHub — no password stored by us.", action: { label: "Sign in", href: "/" } },
    { id: "github", title: "Connect GitHub", done: i.githubConnected, optional: false, hint: i.githubOauthAvailable ? "Read-only access to pick repositories; write access is asked only for Auto-Fix PRs." : "GitHub OAuth is not configured on this deployment yet — an admin must finish the platform setup.", action: { label: "Connect", href: "/connections" } },
    { id: "repo", title: "Add your first repository", done: i.projects > 0, optional: false, hint: "We only read manifest files (package.json, app.json, gradle) — never run your code.", action: { label: "Add repository", href: "/dashboard" } },
    { id: "signing", title: "Automatic release signing", done: i.signingReady, optional: true, hint: "A keystore is generated on your first build and sealed in the vault — nothing to upload.", action: { label: "View", href: "/settings/signing" } },
    { id: "expo", title: "Expo token (EAS route)", done: i.hasExpoToken, optional: true, hint: "Only needed if you want EAS builds; GitHub Actions route works without it.", action: { label: "Add secret", href: "/settings/secrets" } },
    { id: "play", title: "Play Console service account", done: i.hasPlayServiceAccount, optional: true, hint: "Enables one-click upload of AABs to the internal track.", action: { label: "Add secret", href: "/settings/secrets" } },
    { id: "build", title: "Run your first build", done: i.builds > 0, optional: false, hint: "Analyze → fix → build → download. Usually under 15 minutes.", action: { label: "Go to projects", href: "/dashboard" } },
  ];
  const req = steps.filter((s) => !s.optional);
  const doneReq = req.filter((s) => s.done).length;
  return { complete: doneReq === req.length, progress: Math.round((doneReq / req.length) * 100), steps };
}

// ── Connection registry ────────────────────────────────────────────────────

export type ConnectionProvider = "google" | "github" | "expo" | "cloudflare" | "google-play";

export interface ConnectionView {
  provider: ConnectionProvider;
  label: string;
  status: "connected" | "not-connected" | "unavailable" | "expired";
  method: "oauth" | "token" | "platform";
  scopes: string[];
  account?: string;
  connectedAt?: string;
  lastCheckedAt?: string;
  detail: string;
  /** What the user should do to connect (when not connected). */
  action?: { label: string; href?: string; secret?: string };
}

export interface ConnectionsInput {
  user?: { id: string; provider: string; email?: string; name?: string };
  accounts: ConnectedAccount[];
  githubOauthAvailable: boolean;
  secrets: SecretsService;
  probes?: Partial<Record<ConnectionProvider, { ok: boolean; detail: string; account?: string; checkedAt: string }>>;
}

export async function connectionsView(i: ConnectionsInput): Promise<ConnectionView[]> {
  const uid = i.user?.id;
  const gh = i.accounts.find((a) => a.provider === "github");
  const ghProbe = i.probes?.github;
  const expoToken = uid ? await i.secrets.has("user", uid, "EXPO_TOKEN") : false;
  const cfToken = uid ? await i.secrets.has("user", uid, "CF_API_TOKEN") : false;
  const playSa = uid ? await i.secrets.has("user", uid, "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON") : false;

  return [
    {
      provider: "google", label: "Google", method: "oauth", scopes: ["openid", "email", "profile"],
      status: i.user ? "connected" : "not-connected",
      account: i.user?.email,
      detail: i.user ? `Signed in as ${i.user.name ?? i.user.email ?? i.user.id} via ${i.user.provider}.` : "Sign in to start.",
      action: i.user ? undefined : { label: "Sign in", href: "/" },
    },
    {
      provider: "github", label: "GitHub", method: "oauth", scopes: gh?.scopes ?? ["read:user", "public_repo", "workflow"],
      status: gh ? (ghProbe && !ghProbe.ok ? "expired" : "connected") : i.githubOauthAvailable ? "not-connected" : "unavailable",
      account: ghProbe?.account ?? gh?.email ?? gh?.externalId,
      connectedAt: gh?.connectedAt,
      lastCheckedAt: ghProbe?.checkedAt,
      detail: gh ? (ghProbe?.detail ?? "Repositories, Actions dispatch, Auto-Fix PRs.") : i.githubOauthAvailable ? "Connect to list your repositories and trigger GitHub Actions builds." : "GitHub OAuth is not configured on this deployment (see Setup → Platform status).",
      action: gh ? undefined : i.githubOauthAvailable ? { label: "Connect GitHub", href: "/auth/github/start" } : { label: "Paste a token instead", secret: "GITHUB_TOKEN" },
    },
    {
      provider: "expo", label: "Expo (EAS)", method: "token", scopes: ["builds", "credentials"],
      status: expoToken ? "connected" : "not-connected",
      detail: expoToken ? "EAS build route available." : "Optional — add an Expo access token to enable the EAS route.",
      action: expoToken ? undefined : { label: "Add EXPO_TOKEN", secret: "EXPO_TOKEN" },
    },
    {
      provider: "cloudflare", label: "Cloudflare", method: "platform", scopes: ["workers", "r2"],
      status: cfToken ? "connected" : "connected",
      detail: cfToken ? "Personal API token stored for Cloudflare Builds." : "Provided by the platform (Workers + R2). Add your own token only for Cloudflare Builds on your account.",
      action: cfToken ? undefined : { label: "Add CF_API_TOKEN (optional)", secret: "CF_API_TOKEN" },
    },
    {
      provider: "google-play", label: "Google Play Console", method: "token", scopes: ["androidpublisher"],
      status: playSa ? "connected" : "not-connected",
      detail: playSa ? "AABs can be uploaded to the internal track." : "Optional — service account JSON enables one-click Play uploads.",
      action: playSa ? undefined : { label: "Add service account", secret: "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON" },
    },
  ];
}

/** Live check that a stored GitHub token still works (used by Connections → "Test"). */
export async function probeGithub(token: string, apiBase = "https://api.github.com"): Promise<{ ok: boolean; detail: string; account?: string; checkedAt: string }> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(`${apiBase}/user`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "cloud-apk-factory" } });
    if (res.status === 401) return { ok: false, detail: "Token rejected (revoked or expired) — reconnect GitHub.", checkedAt };
    if (!res.ok) return { ok: false, detail: `GitHub API responded ${res.status}.`, checkedAt };
    const u = (await res.json()) as { login: string };
    const scopes = res.headers.get("x-oauth-scopes") ?? "";
    return { ok: true, detail: `Token valid${scopes ? ` (scopes: ${scopes})` : ""}.`, account: u.login, checkedAt };
  } catch (e) {
    return { ok: false, detail: `Network error: ${String(e instanceof Error ? e.message : e)}`, checkedAt };
  }
}

/** Verify `X-Hub-Signature-256` for GitHub webhooks (HMAC-SHA256 over raw body). */
export async function verifyGithubSignature(secret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7).toLowerCase();
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

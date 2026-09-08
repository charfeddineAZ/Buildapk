/**
 * Secrets Manager (section 6 + Zero-Manual-Config).
 *
 * User/project-scoped secrets (EXPO_TOKEN, Play service account JSON, custom
 * build env vars, connected-account OAuth tokens). Every value is sealed with
 * the TokenVault (AES-256-GCM) before it reaches the Store; the API only ever
 * returns masked previews. Values are decrypted exclusively when a build is
 * prepared (`envFor()`), and they are never forwarded to the AI router.
 */

import { TokenVault } from "@apk-factory/security";

export type SecretScope = "user" | "project" | "connection";

export interface SecretRecord {
  id: string;
  scope: SecretScope;
  /** user id, project id, or provider name (for connection tokens) */
  ownerId: string;
  name: string; // ENV-style, e.g. EXPO_TOKEN
  sealed: string; // JSON envelope
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  /** Free-form, non-secret hints for the UI (e.g. scopes, expiry). */
  meta: Record<string, string>;
}

export interface SecretView {
  id: string;
  scope: SecretScope;
  ownerId: string;
  name: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  meta: Record<string, string>;
}

export interface SecretStore {
  list(scope: SecretScope, ownerId: string): Promise<SecretRecord[]>;
  get(scope: SecretScope, ownerId: string, name: string): Promise<SecretRecord | undefined>;
  put(rec: SecretRecord): Promise<void>;
  delete(scope: SecretScope, ownerId: string, name: string): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  private m = new Map<string, SecretRecord>();
  private key(scope: SecretScope, ownerId: string, name: string) { return `${scope}:${ownerId}:${name}`; }
  async list(scope: SecretScope, ownerId: string) { return [...this.m.values()].filter((r) => r.scope === scope && r.ownerId === ownerId); }
  async get(scope: SecretScope, ownerId: string, name: string) { return this.m.get(this.key(scope, ownerId, name)); }
  async put(rec: SecretRecord) { this.m.set(this.key(rec.scope, rec.ownerId, rec.name), rec); }
  async delete(scope: SecretScope, ownerId: string, name: string) { this.m.delete(this.key(scope, ownerId, name)); }
}

export const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Well-known secrets the wizard knows how to explain and validate. */
export const KNOWN_SECRETS: Record<string, { label: string; provider: string; hint: string; validate?: (v: string) => string | null }> = {
  EXPO_TOKEN: { label: "Expo access token", provider: "expo", hint: "expo.dev → Account settings → Access tokens", validate: (v) => (v.length < 20 ? "token looks too short" : null) },
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: { label: "Play Console service account", provider: "google-play", hint: "Play Console → API access → service account JSON key", validate: (v) => { try { const j = JSON.parse(v); return j.type === "service_account" && j.private_key ? null : "not a service account JSON"; } catch { return "invalid JSON"; } } },
  CF_API_TOKEN: { label: "Cloudflare API token", provider: "cloudflare", hint: "dash.cloudflare.com → My Profile → API Tokens (Workers + R2 scopes)" },
  GITHUB_TOKEN: { label: "GitHub token", provider: "github", hint: "Prefer 'Connect GitHub' (OAuth). Fine-grained PAT with contents:read + actions:write works too.", validate: (v) => (/^(gh[pousr]_|github_pat_)/.test(v) ? null : "does not look like a GitHub token") },
  OPENAI_API_KEY: { label: "OpenAI API key", provider: "ai", hint: "Optional — used only by the strong tier of the AI router." },
};

export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 3)}…${value.slice(-3)} (${value.length} chars)`;
}

export class SecretsService {
  constructor(private readonly vault: TokenVault, private readonly store: SecretStore = new MemorySecretStore()) {}

  private view(rec: SecretRecord, value?: string): SecretView {
    const preview = value !== undefined ? maskSecret(value) : maskSecret(this.reveal(rec));
    return { id: rec.id, scope: rec.scope, ownerId: rec.ownerId, name: rec.name, preview, createdAt: rec.createdAt, updatedAt: rec.updatedAt, lastUsedAt: rec.lastUsedAt, meta: rec.meta };
  }

  private reveal(rec: SecretRecord): string {
    return this.vault.decrypt(JSON.parse(rec.sealed));
  }

  async set(scope: SecretScope, ownerId: string, name: string, value: string, meta: Record<string, string> = {}): Promise<SecretView> {
    if (!SECRET_NAME_RE.test(name)) throw new Error("secret name must be UPPER_SNAKE_CASE (2–64 chars)");
    if (!value || value.length > 64_000) throw new Error("secret value is empty or too large");
    const known = KNOWN_SECRETS[name];
    const problem = known?.validate?.(value.trim());
    if (problem) throw new Error(`${name}: ${problem}`);
    const existing = await this.store.get(scope, ownerId, name);
    const now = new Date().toISOString();
    const rec: SecretRecord = {
      id: existing?.id ?? `sec_${crypto.randomUUID().slice(0, 8)}`,
      scope,
      ownerId,
      name,
      sealed: JSON.stringify(this.vault.encrypt(value.trim())),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      meta: { ...(existing?.meta ?? {}), ...meta, ...(known ? { provider: known.provider } : {}) },
    };
    await this.store.put(rec);
    return this.view(rec, value.trim());
  }

  async list(scope: SecretScope, ownerId: string): Promise<SecretView[]> {
    return (await this.store.list(scope, ownerId)).map((r) => this.view(r));
  }

  async has(scope: SecretScope, ownerId: string, name: string): Promise<boolean> {
    return Boolean(await this.store.get(scope, ownerId, name));
  }

  async delete(scope: SecretScope, ownerId: string, name: string): Promise<void> {
    await this.store.delete(scope, ownerId, name);
  }

  /** Decrypt a single secret for internal use (never returned by the API). */
  async value(scope: SecretScope, ownerId: string, name: string): Promise<string | undefined> {
    const rec = await this.store.get(scope, ownerId, name);
    if (!rec) return undefined;
    rec.lastUsedAt = new Date().toISOString();
    await this.store.put(rec);
    return this.reveal(rec);
  }

  /**
   * Environment for a build: user-level secrets first, project-level override.
   * Connection tokens are exposed under their conventional names.
   */
  async envFor(userId: string | undefined, projectId: string): Promise<Record<string, string>> {
    const env: Record<string, string> = {};
    if (userId) {
      for (const r of await this.store.list("user", userId)) env[r.name] = this.reveal(r);
      const gh = await this.store.get("connection", userId, "GITHUB_OAUTH_TOKEN");
      if (gh) env.GITHUB_TOKEN = env.GITHUB_TOKEN ?? this.reveal(gh);
    }
    for (const r of await this.store.list("project", projectId)) env[r.name] = this.reveal(r);
    return env;
  }
}

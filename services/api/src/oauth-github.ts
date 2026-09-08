/**
 * Real GitHub OAuth (section 3/5) — Authorization Code flow via fetch.
 *
 *   GET  /auth/github/start      → 302 to github.com/login/oauth/authorize
 *   GET  /auth/github/callback   → exchange code → user → session → redirect to web
 *
 * Works with both an OAuth App (client id/secret) and a GitHub App's OAuth
 * credentials. The access token is sealed in the TokenVault before it is stored
 * (never plaintext, section 6). Only the minimal scopes required to read repos
 * and dispatch builds are requested; `repo` (write) is requested only when the
 * user explicitly enables Auto Fix PR.
 */

export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Absolute callback URL registered on the OAuth App. */
  redirectUri: string;
  /** Where to send the browser after login (web app). */
  webOrigin: string;
  apiBase?: string;
  oauthBase?: string;
}

export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string;
}

export const GITHUB_SCOPES = {
  read: ["read:user", "user:email", "public_repo", "workflow"],
  write: ["read:user", "user:email", "repo", "workflow"],
} as const;

export class GithubOAuth {
  private readonly apiBase: string;
  private readonly oauthBase: string;

  constructor(private readonly cfg: GithubOAuthConfig) {
    this.apiBase = cfg.apiBase ?? "https://api.github.com";
    this.oauthBase = cfg.oauthBase ?? "https://github.com/login/oauth";
  }

  get configured(): boolean {
    return Boolean(this.cfg.clientId && this.cfg.clientSecret && this.cfg.redirectUri);
  }

  authorizeUrl(state: string, mode: "read" | "write" = "read"): string {
    const u = new URL(`${this.oauthBase}/authorize`);
    u.searchParams.set("client_id", this.cfg.clientId);
    u.searchParams.set("redirect_uri", this.cfg.redirectUri);
    u.searchParams.set("scope", GITHUB_SCOPES[mode].join(" "));
    u.searchParams.set("state", state);
    u.searchParams.set("allow_signup", "true");
    return u.toString();
  }

  async exchangeCode(code: string): Promise<{ accessToken: string; scope: string; tokenType: string }> {
    const res = await fetch(`${this.oauthBase}/access_token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, code, redirect_uri: this.cfg.redirectUri }),
    });
    if (!res.ok) throw new Error(`github token exchange failed: ${res.status}`);
    const data = (await res.json()) as { access_token?: string; scope?: string; token_type?: string; error?: string; error_description?: string };
    if (!data.access_token) throw new Error(`github oauth error: ${data.error_description ?? data.error ?? "no access_token"}`);
    return { accessToken: data.access_token, scope: data.scope ?? "", tokenType: data.token_type ?? "bearer" };
  }

  async fetchUser(accessToken: string): Promise<GithubUser> {
    const headers = { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "user-agent": "cloud-apk-factory", "x-github-api-version": "2022-11-28" };
    const res = await fetch(`${this.apiBase}/user`, { headers });
    if (!res.ok) throw new Error(`github /user failed: ${res.status}`);
    const u = (await res.json()) as { id: number; login: string; name: string | null; email: string | null; avatar_url: string };
    let email = u.email;
    if (!email) {
      const er = await fetch(`${this.apiBase}/user/emails`, { headers });
      if (er.ok) {
        const emails = (await er.json()) as { email: string; primary: boolean; verified: boolean }[];
        email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
      }
    }
    return { id: u.id, login: u.login, name: u.name, email, avatarUrl: u.avatar_url };
  }

  /** Redirect target on the web app after a successful login. */
  successRedirect(sessionToken: string, next = "/dashboard"): string {
    const u = new URL("/auth/callback", this.cfg.webOrigin);
    u.searchParams.set("next", next);
    u.hash = `token=${encodeURIComponent(sessionToken)}`; // fragment never hits server logs
    return u.toString();
  }

  errorRedirect(message: string): string {
    const u = new URL("/", this.cfg.webOrigin);
    u.searchParams.set("error", message.slice(0, 120));
    return u.toString();
  }
}

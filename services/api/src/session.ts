/**
 * Stateless sessions + OAuth state tokens.
 *
 * A session is `base64url(payload).base64url(hmac)`; the HMAC key is derived
 * from MASTER_SECRET so no session table is needed. Tokens are sent by the web
 * client as `Authorization: Bearer <token>` (works cross-origin, no third-party
 * cookie problems between the web Worker and the API Worker).
 */

export interface SessionPayload {
  sub: string; // user id
  email?: string;
  name?: string;
  avatar?: string;
  provider: "google" | "github" | "demo";
  iat: number;
  exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export class SessionService {
  private keyPromise: Promise<CryptoKey>;

  constructor(secret: string, private readonly ttlSeconds = 7 * 86400) {
    if (!secret || secret.length < 16) throw new Error("SessionService requires a secret of at least 16 characters");
    this.keyPromise = crypto.subtle.importKey("raw", enc.encode(`${secret}:session`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  }

  private async mac(data: string): Promise<string> {
    const key = await this.keyPromise;
    return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
  }

  async issue(p: Omit<SessionPayload, "iat" | "exp">, ttlSeconds = this.ttlSeconds): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: SessionPayload = { ...p, iat: now, exp: now + ttlSeconds };
    const body = b64url(enc.encode(JSON.stringify(payload)));
    return `${body}.${await this.mac(body)}`;
  }

  async verify(token: string | null | undefined, now = Date.now()): Promise<SessionPayload | null> {
    if (!token) return null;
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = await this.mac(body);
    if (expected.length !== sig.length) return null;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff !== 0) return null;
    try {
      const payload = JSON.parse(dec.decode(unb64url(body))) as SessionPayload;
      if (!payload.exp || payload.exp * 1000 < now) return null;
      return payload;
    } catch {
      return null;
    }
  }

  /** Short-lived signed OAuth `state` (CSRF protection) — 10 minutes. */
  async issueState(extra: Record<string, string> = {}): Promise<string> {
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
    const body = b64url(enc.encode(JSON.stringify({ n: nonce, t: Date.now(), ...extra })));
    return `${body}.${await this.mac(`state:${body}`)}`;
  }

  async verifyState(state: string | null, maxAgeMs = 10 * 60_000): Promise<Record<string, string> | null> {
    if (!state) return null;
    const [body, sig] = state.split(".");
    if (!body || !sig) return null;
    const expected = await this.mac(`state:${body}`);
    if (expected !== sig) return null;
    try {
      const data = JSON.parse(dec.decode(unb64url(body))) as Record<string, string> & { t: number };
      if (Date.now() - Number(data.t) > maxAgeMs) return null;
      return data;
    } catch {
      return null;
    }
  }

  static bearer(request: Request): string | null {
    const h = request.headers.get("authorization") ?? "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : null;
  }
}

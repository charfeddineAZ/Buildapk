/**
 * Artifact Storage (section 27). Objects (APK/AAB/logs/reports) are stored in
 * Cloudflare R2 and delivered through short-lived, HMAC-signed URLs served by
 * the API gateway (`GET /artifacts/:key?exp=…&sig=…`). No public bucket, no
 * long-lived links.
 *
 * Two implementations behind one interface:
 *   - R2ArtifactStore     — wraps the Worker `R2Bucket` binding (production)
 *   - MemoryArtifactStore — in-memory map (dev/tests)
 *
 * The signing scheme uses Web Crypto (HMAC-SHA256) so it runs identically in
 * Workers and Node.
 */

import type { ArtifactMeta } from "@apk-factory/types";

/** Minimal structural subset of the Workers `R2Bucket` type we rely on. */
export interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream | null; arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string }; size: number; customMetadata?: Record<string, string> } | null>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects: { key: string; size: number; uploaded: Date; customMetadata?: Record<string, string> }[] }>;
}

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
  sha256: string;
  uploadedAt: string;
  metadata: Record<string, string>;
}

export interface ArtifactStore {
  put(key: string, bytes: Uint8Array, contentType: string, metadata?: Record<string, string>): Promise<StoredObject>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string; metadata: Record<string, string> } | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<StoredObject[]>;
}

const CONTENT_TYPES: Record<ArtifactMeta["type"], string> = {
  apk: "application/vnd.android.package-archive",
  aab: "application/octet-stream",
  logs: "text/plain; charset=utf-8",
  report: "application/json",
  mapping: "text/plain; charset=utf-8",
};

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class MemoryArtifactStore implements ArtifactStore {
  private objects = new Map<string, { bytes: Uint8Array; obj: StoredObject }>();

  async put(key: string, bytes: Uint8Array, contentType: string, metadata: Record<string, string> = {}): Promise<StoredObject> {
    const sha256 = await sha256Hex(bytes);
    const obj: StoredObject = { key, size: bytes.byteLength, contentType, sha256, uploadedAt: new Date().toISOString(), metadata: { ...metadata, sha256 } };
    this.objects.set(key, { bytes, obj });
    return obj;
  }
  async get(key: string) {
    const e = this.objects.get(key);
    return e ? { bytes: e.bytes, contentType: e.obj.contentType, metadata: e.obj.metadata } : null;
  }
  async delete(key: string) { this.objects.delete(key); }
  async list(prefix: string) { return [...this.objects.values()].filter((e) => e.obj.key.startsWith(prefix)).map((e) => e.obj); }
}

export class R2ArtifactStore implements ArtifactStore {
  constructor(private readonly bucket: R2Like) {}

  async put(key: string, bytes: Uint8Array, contentType: string, metadata: Record<string, string> = {}): Promise<StoredObject> {
    const sha256 = await sha256Hex(bytes);
    const customMetadata = { ...metadata, sha256 };
    await this.bucket.put(key, bytes, { httpMetadata: { contentType }, customMetadata });
    return { key, size: bytes.byteLength, contentType, sha256, uploadedAt: new Date().toISOString(), metadata: customMetadata };
  }
  async get(key: string) {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return { bytes: new Uint8Array(await obj.arrayBuffer()), contentType: obj.httpMetadata?.contentType ?? "application/octet-stream", metadata: obj.customMetadata ?? {} };
  }
  async delete(key: string) { await this.bucket.delete(key); }
  async list(prefix: string) {
    const r = await this.bucket.list({ prefix, limit: 1000 });
    return r.objects.map((o) => ({ key: o.key, size: o.size, contentType: "application/octet-stream", sha256: o.customMetadata?.sha256 ?? "", uploadedAt: o.uploaded.toISOString(), metadata: o.customMetadata ?? {} }));
  }
}

// ── Signed URLs ─────────────────────────────────────────────────────────────

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function b64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class ArtifactSigner {
  constructor(private readonly secret: string, private readonly publicBase: string) {
    if (!secret || secret.length < 16) throw new Error("ArtifactSigner requires a secret of at least 16 characters");
  }

  private async sign(key: string, exp: number): Promise<string> {
    const k = await hmacKey(this.secret);
    const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${key}\n${exp}`));
    return b64url(mac);
  }

  /** Temporary URL valid for `ttlSeconds` (default 1h, max 24h). */
  async signedUrl(key: string, ttlSeconds = 3600): Promise<{ url: string; expiresAt: string }> {
    const ttl = Math.min(Math.max(60, ttlSeconds), 86400);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const sig = await this.sign(key, exp);
    const url = `${this.publicBase.replace(/\/$/, "")}/artifacts/${key.split("/").map(encodeURIComponent).join("/")}?exp=${exp}&sig=${sig}`;
    return { url, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async verify(key: string, exp: number, sig: string, now = Date.now()): Promise<boolean> {
    if (!Number.isFinite(exp) || exp * 1000 < now) return false;
    const expected = await this.sign(key, exp);
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
  }
}

// ── Artifact service (glue) ────────────────────────────────────────────────

export interface ArtifactUpload {
  type: ArtifactMeta["type"];
  name: string;
  bytes: Uint8Array;
}

export class ArtifactService {
  constructor(private readonly store: ArtifactStore, private readonly signer: ArtifactSigner, private readonly ttlSeconds = 3600) {}

  keyFor(projectId: string, buildId: string, name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `projects/${projectId}/builds/${buildId}/${safe}`;
  }

  async store_(projectId: string, buildId: string, upload: ArtifactUpload): Promise<ArtifactMeta> {
    const key = this.keyFor(projectId, buildId, upload.name);
    const obj = await this.store.put(key, upload.bytes, CONTENT_TYPES[upload.type], { projectId, buildId, type: upload.type });
    const { url, expiresAt } = await this.signer.signedUrl(key, this.ttlSeconds);
    return { type: upload.type, name: upload.name, sizeBytes: obj.size, sha256: obj.sha256, url, expiresAt };
  }

  /** Store every artifact for a build and return signed metadata. */
  async storeAll(projectId: string, buildId: string, uploads: ArtifactUpload[]): Promise<ArtifactMeta[]> {
    const out: ArtifactMeta[] = [];
    for (const u of uploads) out.push(await this.store_(projectId, buildId, u));
    return out;
  }

  /** Re-sign an existing artifact (e.g. when a link in the dashboard expired). */
  async refresh(key: string): Promise<{ url: string; expiresAt: string }> {
    return this.signer.signedUrl(key, this.ttlSeconds);
  }

  /** Serve an object for `GET /artifacts/:key?exp&sig`. */
  async serve(key: string, exp: number, sig: string): Promise<Response> {
    if (!(await this.signer.verify(key, exp, sig))) {
      return new Response(JSON.stringify({ error: "link expired or invalid" }), { status: 403, headers: { "content-type": "application/json" } });
    }
    const obj = await this.store.get(key);
    if (!obj) return new Response(JSON.stringify({ error: "artifact not found" }), { status: 404, headers: { "content-type": "application/json" } });
    const filename = key.split("/").pop() ?? "artifact";
    return new Response(obj.bytes as BodyInit, {
      status: 200,
      headers: {
        "content-type": obj.contentType,
        "content-length": String(obj.bytes.byteLength),
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-artifact-sha256": obj.metadata.sha256 ?? "",
      },
    });
  }

  /** Retention (§31): delete objects older than `maxAgeDays` under a prefix. */
  async purgeOlderThan(prefix: string, maxAgeDays: number, now = Date.now()): Promise<string[]> {
    const cutoff = now - maxAgeDays * 86400_000;
    const removed: string[] = [];
    for (const o of await this.store.list(prefix)) {
      if (new Date(o.uploadedAt).getTime() < cutoff) {
        await this.store.delete(o.key);
        removed.push(o.key);
      }
    }
    return removed;
  }
}

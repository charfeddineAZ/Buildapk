import { describe, it, expect } from "vitest";
import { ArtifactService, ArtifactSigner, MemoryArtifactStore, R2ArtifactStore, type R2Like } from "./storage.js";

const SECRET = "unit-test-artifact-secret-0123456789";

describe("ArtifactSigner", () => {
  it("issues and verifies temporary signed URLs", async () => {
    const s = new ArtifactSigner(SECRET, "https://api.example.com");
    const { url, expiresAt } = await s.signedUrl("projects/p/builds/b/app.apk", 600);
    const u = new URL(url);
    expect(u.pathname).toBe("/artifacts/projects/p/builds/b/app.apk");
    const exp = Number(u.searchParams.get("exp"));
    const sig = u.searchParams.get("sig")!;
    expect(new Date(expiresAt).getTime()).toBe(exp * 1000);
    expect(await s.verify("projects/p/builds/b/app.apk", exp, sig)).toBe(true);
    // tampered key or expired
    expect(await s.verify("projects/p/builds/b/other.apk", exp, sig)).toBe(false);
    expect(await s.verify("projects/p/builds/b/app.apk", exp, sig, (exp + 1) * 1000)).toBe(false);
  });

  it("clamps the TTL to 24h", async () => {
    const s = new ArtifactSigner(SECRET, "https://api.example.com");
    const { expiresAt } = await s.signedUrl("k", 10 * 86400);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(86400_000 + 2000);
  });
});

describe("ArtifactService", () => {
  it("stores artifacts, returns metadata with sha256 and serves them via signed URL", async () => {
    const svc = new ArtifactService(new MemoryArtifactStore(), new ArtifactSigner(SECRET, "https://api.example.com"));
    const bytes = new TextEncoder().encode("PK\u0003\u0004fake-apk");
    const [meta] = await svc.storeAll("prj_1", "bld_1", [{ type: "apk", name: "app-release.apk", bytes }]);
    expect(meta.sizeBytes).toBe(bytes.byteLength);
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    const u = new URL(meta.url);
    const key = decodeURIComponent(u.pathname.replace("/artifacts/", ""));
    const res = await svc.serve(key, Number(u.searchParams.get("exp")), u.searchParams.get("sig")!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("android.package-archive");
    expect(res.headers.get("x-artifact-sha256")).toBe(meta.sha256);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("rejects invalid signatures and missing objects", async () => {
    const svc = new ArtifactService(new MemoryArtifactStore(), new ArtifactSigner(SECRET, "https://api.example.com"));
    expect((await svc.serve("x", Math.floor(Date.now() / 1000) + 60, "bad")).status).toBe(403);
    const { url } = await svc.refresh("projects/none/builds/none/none.apk");
    const u = new URL(url);
    expect((await svc.serve("projects/none/builds/none/none.apk", Number(u.searchParams.get("exp")), u.searchParams.get("sig")!)).status).toBe(404);
  });

  it("purges old artifacts (retention)", async () => {
    const store = new MemoryArtifactStore();
    const svc = new ArtifactService(store, new ArtifactSigner(SECRET, "https://api.example.com"));
    const old = await store.put("projects/p/builds/old/app.apk", new Uint8Array([1]), "application/octet-stream");
    (old as any).uploadedAt = new Date(Date.now() - 40 * 86400_000).toISOString();
    await store.put("projects/p/builds/new/app.apk", new Uint8Array([2]), "application/octet-stream");
    const removed = await svc.purgeOlderThan("projects/p/", 30);
    expect(removed).toEqual(["projects/p/builds/old/app.apk"]);
    expect(await store.get("projects/p/builds/new/app.apk")).not.toBeNull();
  });
});

describe("R2ArtifactStore", () => {
  it("talks to an R2-like bucket binding", async () => {
    const objects = new Map<string, any>();
    const bucket: R2Like = {
      async put(key, value, options) { objects.set(key, { value, options }); },
      async get(key) {
        const o = objects.get(key);
        if (!o) return null;
        const bytes = o.value as Uint8Array;
        return { body: null, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), httpMetadata: o.options?.httpMetadata, size: bytes.byteLength, customMetadata: o.options?.customMetadata };
      },
      async delete(key) { for (const k of Array.isArray(key) ? key : [key]) objects.delete(k); },
      async list({ prefix = "" } = {}) { return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, size: 1, uploaded: new Date(), customMetadata: objects.get(k).options?.customMetadata })) }; },
    };
    const store = new R2ArtifactStore(bucket);
    const meta = await store.put("a/b.apk", new Uint8Array([1, 2, 3]), "application/octet-stream", { projectId: "p" });
    expect(meta.sha256).toHaveLength(64);
    expect(objects.get("a/b.apk").options.customMetadata.sha256).toBe(meta.sha256);
    const got = await store.get("a/b.apk");
    expect([...got!.bytes]).toEqual([1, 2, 3]);
    expect((await store.list("a/")).map((o) => o.key)).toEqual(["a/b.apk"]);
    await store.delete("a/b.apk");
    expect(await store.get("a/b.apk")).toBeNull();
  });
});

import { describe, it, expect, vi } from "vitest";
import { PlayStoreClient } from "./deploy.js";

describe("PlayStoreClient", () => {
  it("creates an edit, uploads a bundle and commits to a track", async () => {
    const calls: any[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string, init: any) => {
      calls.push({ url, method: init.method, body: init.body });
      if (url.endsWith("/edits") && init.method === "POST") return new Response(JSON.stringify({ id: "edit1" }), { status: 200 });
      if (url.includes("/bundles")) return new Response(JSON.stringify({ versionCode: 99 }), { status: 200 });
      if (url.includes("/tracks/internal")) return new Response("{}", { status: 200 });
      if (url.includes(":commit")) return new Response("{}", { status: 200 });
      return new Response("{}", { status: 200 });
    });

    const client = new PlayStoreClient("tok", "com.x.y");
    const vc = await client.publish(Buffer.from("aab-bytes"), "internal");
    expect(vc).toBe(99);
    expect(calls.some((c) => c.url.includes("/edits") && c.method === "POST")).toBe(true);
    expect(calls.some((c) => c.url.includes("/bundles") && c.method === "POST")).toBe(true);
    expect(calls.some((c) => c.url.includes(":commit"))).toBe(true);
  });
});

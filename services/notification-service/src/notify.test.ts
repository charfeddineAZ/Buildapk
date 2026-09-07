import { describe, it, expect, vi } from "vitest";
import { NotificationService, ConsoleChannel, WebhookChannel, EmailChannel } from "./index.js";
import { Logger } from "@apk-factory/logger";

describe("NotificationService", () => {
  it("fans out to all channels", async () => {
    const sent: string[] = [];
    const svc = new NotificationService([
      new ConsoleChannel(new Logger("t")),
      { name: "fake", send: async (p) => { sent.push(p.event); } } as any,
    ]);
    await svc.publish({ event: "build.success", projectId: "p1", message: "done" });
    expect(sent).toContain("build.success");
  });

  it("webhook channel posts a payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as any).fetch = fetchMock;
    const ch = new WebhookChannel("https://example.com/hook", new Logger("t"));
    await ch.send({ event: "build.failed", projectId: "p1", message: "x", at: new Date().toISOString() });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("email channel records intent", async () => {
    const ch = new EmailChannel("noreply@apk-factory.dev", new Logger("t"));
    await expect(ch.send({ event: "pr.created", projectId: "p1", message: "pr", at: new Date().toISOString() })).resolves.toBeUndefined();
  });
});

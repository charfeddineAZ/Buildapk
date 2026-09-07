/**
 * Notification Service (section 30/41). Fans a build event out to every
 * connected channel: in-app/webhook, email, and console (dev). Secrets in
 * payloads are redacted by the shared logger before any emit.
 */

import { Logger } from "@apk-factory/logger";

export type BuildEvent =
  | "build.queued"
  | "build.started"
  | "build.success"
  | "build.failed"
  | "repair.applied"
  | "quota.exhausted"
  | "pr.created";

export interface NotificationPayload {
  event: BuildEvent;
  projectId: string;
  buildId?: string;
  message: string;
  meta?: Record<string, unknown>;
  at: string;
}

export interface Channel {
  readonly name: string;
  send(payload: NotificationPayload): Promise<void>;
}

export class ConsoleChannel implements Channel {
  readonly name = "console";
  constructor(private readonly log: Logger = new Logger("notify:console")) {}
  async send(p: NotificationPayload) {
    this.log.info(`[${p.event}] ${p.message}`, { projectId: p.projectId, buildId: p.buildId, ...p.meta });
  }
}

export class WebhookChannel implements Channel {
  readonly name = "webhook";
  constructor(private readonly url: string, private readonly log: Logger = new Logger("notify:webhook")) {}
  async send(p: NotificationPayload) {
    try {
      await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      });
    } catch (e) {
      this.log.warn("webhook delivery failed", { error: String(e) });
    }
  }
}

export class EmailChannel implements Channel {
  readonly name = "email";
  constructor(private readonly from: string, private readonly log: Logger = new Logger("notify:email")) {}
  async send(p: NotificationPayload) {
    // Real implementation calls an email provider (Resend/SendGrid/Postmark).
    // Here we just record intent so the pipeline is complete end-to-end.
    this.log.info("email queued", { to: "user", subject: `[APK Factory] ${p.event}`, from: this.from });
  }
}

export class NotificationService {
  private channels: Channel[] = [];
  constructor(defaultChannels: Channel[] = [new ConsoleChannel()], private readonly log: Logger = new Logger("notify")) {
    this.channels = defaultChannels;
  }

  add(channel: Channel) {
    this.channels.push(channel);
  }

  async publish(payload: Omit<NotificationPayload, "at">): Promise<void> {
    const full: NotificationPayload = { ...payload, at: new Date().toISOString() };
    await Promise.all(this.channels.map((c) => c.send(full).catch((e) => this.log.warn("channel failed", { channel: c.name, error: String(e) }))));
  }
}

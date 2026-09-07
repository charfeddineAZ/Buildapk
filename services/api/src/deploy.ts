/**
 * Google Play Store distribution (stage 8). Talks to the Play Developer API v3
 * via fetch: open an edit, upload an AAB, assign it to a track, commit. No SDK
 * dependency. Credentials (access token + package name) come from secrets.
 */

import { Logger } from "@apk-factory/logger";

const BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

export class PlayStoreClient {
  constructor(
    private readonly accessToken: string,
    private readonly packageName: string,
    private readonly log: Logger = new Logger("play-store"),
  ) {}

  private url(path: string) {
    return `${BASE}/${this.packageName}${path}`;
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.accessToken}`, "content-type": "application/json", ...extra };
  }

  async createEdit(): Promise<string> {
    const res = await fetch(this.url("/edits"), { method: "POST", headers: this.headers() });
    if (!res.ok) throw new Error(`createEdit ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { id: string }).id;
  }

  async uploadBundle(editId: string, aab: Buffer, _filename = "app.aab"): Promise<number> {
    const res = await fetch(this.url(`/edits/${editId}/bundles?uploadType=media`), {
      method: "POST",
      headers: this.headers({ "content-type": "application/octet-stream" }),
      body: new Uint8Array(aab),
    });
    if (!res.ok) throw new Error(`uploadBundle ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { versionCode: number }).versionCode;
  }

  async assignTrack(editId: string, track: string, versionCodes: number[]): Promise<void> {
    await fetch(this.url(`/edits/${editId}/tracks/${track}`), {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ track, releases: [{ status: "completed", versionCodes }] }),
    });
  }

  async commit(editId: string): Promise<void> {
    const res = await fetch(this.url(`/edits/${editId}:commit`), { method: "POST", headers: this.headers() });
    if (!res.ok) throw new Error(`commit ${res.status}: ${await res.text()}`);
    this.log.info("play store edit committed", { packageName: this.packageName, editId });
  }

  /** End-to-end: upload an AAB to a track (e.g. "internal"). */
  async publish(aab: Buffer, track = "internal"): Promise<number> {
    const editId = await this.createEdit();
    const versionCode = await this.uploadBundle(editId, aab);
    await this.assignTrack(editId, track, [versionCode]);
    await this.commit(editId);
    return versionCode;
  }
}

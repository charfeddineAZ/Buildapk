/**
 * Auto signing (stage 8 / §44). Produces the Gradle `signingConfigs.release`
 * block and the matching `gradle.properties` entries, and can generate a
 * keystore via the JDK `keytool` when available. The keystore bytes and the
 * passwords are sealed in the TokenVault (AES-256-GCM) so they are never stored
 * as plaintext (section 6).
 *
 * Zero-manual-config flow (`SigningService`):
 *   1. `ensure(projectId)` — mint per-project passwords/alias/DN (idempotent).
 *   2. `buildEnv(projectId)` — env injected into the build container
 *      (UPLOAD_STORE_PASSWORD, UPLOAD_KEY_PASSWORD, UPLOAD_KEY_ALIAS, and
 *      KEYSTORE_BASE64 once a keystore exists).
 *   3. The builder (`builders/common/sign.sh`) generates the keystore with
 *      `keytool` on the first build and POSTs it back; `storeKeystore()` seals
 *      it so every later build signs with the *same* key (required for app
 *      updates on Play / sideload).
 */

import { TokenVault } from "@apk-factory/security";
import { randomBytes } from "node:crypto";

export interface SigningConfig {
  keystorePath: string;
  keyAlias: string;
  storePassword: string; // reference name; real value injected from vault at build time
  keyPassword: string;
  gradleBlock: string;
  gradleProperties: Record<string, string>;
}

export function generateSigningConfig(opts: { alias?: string; keystore?: string; org?: string } = {}): SigningConfig {
  const keyAlias = opts.alias ?? "apkfactory";
  const keystorePath = opts.keystore ?? "release.keystore";
  const gradleBlock = `android {
  signingConfigs {
    release {
      storeFile file("${keystorePath}")
      storePassword System.getenv("UPLOAD_STORE_PASSWORD") ?: project.findProperty("UPLOAD_STORE_PASSWORD")
      keyAlias "${keyAlias}"
      keyPassword System.getenv("UPLOAD_KEY_PASSWORD") ?: project.findProperty("UPLOAD_KEY_PASSWORD")
    }
  }
  buildTypes.release.signingConfig = signingConfigs.release
}`;
  return {
    keystorePath,
    keyAlias,
    storePassword: "UPLOAD_STORE_PASSWORD",
    keyPassword: "UPLOAD_KEY_PASSWORD",
    gradleBlock,
    gradleProperties: {
      UPLOAD_STORE_PASSWORD: "<from-vault>",
      UPLOAD_KEY_PASSWORD: "<from-vault>",
      UPLOAD_KEY_ALIAS: keyAlias,
    },
  };
}

/** Generate a keystore with keytool. Best-effort: returns reason if unavailable. */
export async function createKeystore(
  cfg: SigningConfig,
  dname: string,
  validityDays = 10000,
  keytool = "keytool",
  passwords: { storePassword: string; keyPassword: string } = { storePassword: "tmp", keyPassword: "tmp" },
): Promise<{ created: boolean; reason?: string }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    await run(keytool, [
      "-genkeypair", "-v", "-keystore", cfg.keystorePath, "-alias", cfg.keyAlias,
      "-keyalg", "RSA", "-keysize", "2048", "-validity", String(validityDays),
      "-dname", dname,
      "-storepass", passwords.storePassword, "-keypass", passwords.keyPassword,
    ]);
    return { created: true };
  } catch (e) {
    return { created: false, reason: String(e instanceof Error ? e.message : e) };
  }
}

/** Seal/unseal keystore bytes in the TokenVault. */
export function sealKeystore(vault: TokenVault, keystoreBytes: Buffer): string {
  return JSON.stringify(vault.encrypt(keystoreBytes.toString("base64")));
}

export function unsealKeystore(vault: TokenVault, sealed: string): Buffer {
  const env = JSON.parse(sealed);
  return Buffer.from(vault.decrypt(env), "base64");
}

// ── Zero-manual-config signing service ─────────────────────────────────────

/** Persisted (sealed) signing credentials for one project. */
export interface SigningRecord {
  projectId: string;
  keyAlias: string;
  keystorePath: string;
  dname: string;
  /** Sealed JSON {storePassword,keyPassword} */
  sealedPasswords: string;
  /** Sealed keystore bytes (base64) — present after the first successful build. */
  sealedKeystore?: string;
  keystoreSha256?: string;
  /** SHA-256 of the signing certificate as reported by the builder / validator. */
  certSha256?: string;
  createdAt: string;
  rotatedAt?: string;
  keystoreStoredAt?: string;
}

/** Public, non-secret view for the UI. */
export interface SigningStatus {
  projectId: string;
  configured: boolean;
  keyAlias: string;
  keystorePath: string;
  dname: string;
  keystoreReady: boolean;
  keystoreSha256?: string;
  certSha256?: string;
  createdAt?: string;
  rotatedAt?: string;
  keystoreStoredAt?: string;
  mode: "auto" | "none";
}

export interface SigningStore {
  get(projectId: string): Promise<SigningRecord | undefined>;
  put(rec: SigningRecord): Promise<void>;
  delete(projectId: string): Promise<void>;
}

export class MemorySigningStore implements SigningStore {
  private m = new Map<string, SigningRecord>();
  async get(id: string) { return this.m.get(id); }
  async put(r: SigningRecord) { this.m.set(r.projectId, r); }
  async delete(id: string) { this.m.delete(id); }
}

export function strongPassword(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** Build a sane X.500 DN from repo/org (letters, digits, dots, dashes only). */
export function distinguishedName(repoName: string, org: string): string {
  const clean = (s: string, fallback: string) => (s.replace(/[^A-Za-z0-9._ -]/g, "").trim() || fallback).slice(0, 64);
  return `CN=${clean(repoName, "app")}, OU=Cloud APK Factory, O=${clean(org, "apkfactory")}, C=US`;
}

export class SigningService {
  constructor(private readonly vault: TokenVault, private readonly store: SigningStore = new MemorySigningStore()) {}

  private seal(obj: unknown): string { return JSON.stringify(this.vault.encrypt(JSON.stringify(obj))); }
  private unseal<T>(sealed: string): T { return JSON.parse(this.vault.decrypt(JSON.parse(sealed))) as T; }

  /** Create credentials for a project if they don't exist yet. Idempotent. */
  async ensure(projectId: string, opts: { repoName?: string; org?: string; alias?: string } = {}): Promise<SigningStatus> {
    const existing = await this.store.get(projectId);
    if (existing) return this.toStatus(existing);
    const rec: SigningRecord = {
      projectId,
      keyAlias: opts.alias ?? "apkfactory",
      keystorePath: "release.keystore",
      dname: distinguishedName(opts.repoName ?? projectId, opts.org ?? "apkfactory"),
      sealedPasswords: this.seal({ storePassword: strongPassword(), keyPassword: strongPassword() }),
      createdAt: new Date().toISOString(),
    };
    await this.store.put(rec);
    return this.toStatus(rec);
  }

  async status(projectId: string): Promise<SigningStatus> {
    const rec = await this.store.get(projectId);
    return rec ? this.toStatus(rec) : { projectId, configured: false, keyAlias: "", keystorePath: "", dname: "", keystoreReady: false, mode: "none" };
  }

  /**
   * Rotate credentials. WARNING: a new key means existing installs cannot be
   * updated in place — the UI must ask for explicit confirmation.
   */
  async rotate(projectId: string): Promise<SigningStatus> {
    const rec = await this.store.get(projectId);
    if (!rec) throw new Error("signing not configured");
    const next: SigningRecord = {
      ...rec,
      sealedPasswords: this.seal({ storePassword: strongPassword(), keyPassword: strongPassword() }),
      sealedKeystore: undefined,
      keystoreSha256: undefined,
      certSha256: undefined,
      keystoreStoredAt: undefined,
      rotatedAt: new Date().toISOString(),
    };
    await this.store.put(next);
    return this.toStatus(next);
  }

  /** Env vars injected into the build container. Never logged. */
  async buildEnv(projectId: string): Promise<Record<string, string>> {
    const rec = await this.store.get(projectId);
    if (!rec) return {};
    const pw = this.unseal<{ storePassword: string; keyPassword: string }>(rec.sealedPasswords);
    const env: Record<string, string> = {
      UPLOAD_STORE_PASSWORD: pw.storePassword,
      UPLOAD_KEY_PASSWORD: pw.keyPassword,
      UPLOAD_KEY_ALIAS: rec.keyAlias,
      UPLOAD_KEYSTORE_PATH: rec.keystorePath,
      UPLOAD_KEY_DNAME: rec.dname,
    };
    if (rec.sealedKeystore) env.KEYSTORE_BASE64 = this.unseal<string>(rec.sealedKeystore);
    return env;
  }

  /** Called by the builder after generating the keystore on the first build. */
  async storeKeystore(projectId: string, keystoreBase64: string, certSha256?: string): Promise<SigningStatus> {
    const rec = await this.store.get(projectId);
    if (!rec) throw new Error("signing not configured");
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(keystoreBase64) || keystoreBase64.length < 64) throw new Error("invalid keystore payload");
    if (rec.sealedKeystore) throw new Error("keystore already stored; rotate first to replace it");
    const bytes = Buffer.from(keystoreBase64.replace(/\s+/g, ""), "base64");
    const { createHash } = await import("node:crypto");
    const next: SigningRecord = {
      ...rec,
      sealedKeystore: this.seal(bytes.toString("base64")),
      keystoreSha256: createHash("sha256").update(bytes).digest("hex"),
      certSha256,
      keystoreStoredAt: new Date().toISOString(),
    };
    await this.store.put(next);
    return this.toStatus(next);
  }

  /** Decrypted keystore bytes (for export by the owner). */
  async exportKeystore(projectId: string): Promise<Buffer | null> {
    const rec = await this.store.get(projectId);
    if (!rec?.sealedKeystore) return null;
    return Buffer.from(this.unseal<string>(rec.sealedKeystore), "base64");
  }

  gradleSnippet(projectId: string, rec?: SigningRecord): SigningConfig {
    return generateSigningConfig({ alias: rec?.keyAlias, keystore: rec?.keystorePath });
  }

  private toStatus(rec: SigningRecord): SigningStatus {
    return {
      projectId: rec.projectId,
      configured: true,
      keyAlias: rec.keyAlias,
      keystorePath: rec.keystorePath,
      dname: rec.dname,
      keystoreReady: Boolean(rec.sealedKeystore),
      keystoreSha256: rec.keystoreSha256,
      certSha256: rec.certSha256,
      createdAt: rec.createdAt,
      rotatedAt: rec.rotatedAt,
      keystoreStoredAt: rec.keystoreStoredAt,
      mode: "auto",
    };
  }
}

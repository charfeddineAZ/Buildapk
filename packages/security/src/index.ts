/**
 * Token Vault — encrypts OAuth/API tokens at rest so they are never stored
 * as plaintext. Uses AES-256-GCM with a scrypt-derived key and an HMAC for
 * integrity. Only the Worker runtime holding the master key can decrypt.
 *
 * Secrets are NEVER sent to the AI router.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const SALT_LEN = 16;
const TAG_LEN = 16;

export interface EncryptedEnvelope {
  v: 1;
  iv: string; // base64
  salt: string; // base64
  tag: string; // base64
  data: string; // base64 ciphertext
  mac: string; // base64 HMAC of iv|data
}

export class TokenVault {
  private readonly key: Buffer;
  private readonly macKey: Buffer;

  constructor(masterSecret: string) {
    if (!masterSecret || masterSecret.length < 16) {
      throw new Error("TokenVault requires a master secret of at least 16 characters");
    }
    const derive = (purpose: string) => {
      const salt = createHash("sha256").update(`${masterSecret}:${purpose}`).digest();
      return scryptSync(masterSecret, salt, 32);
    };
    this.key = derive("cipher");
    this.macKey = derive("mac");
  }

  encrypt(plaintext: string): EncryptedEnvelope {
    const salt = randomBytes(SALT_LEN);
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const mac = createHmac("sha256", this.macKey)
      .update(Buffer.concat([iv, data]))
      .digest();
    return {
      v: 1,
      iv: iv.toString("base64"),
      salt: salt.toString("base64"),
      tag: tag.toString("base64"),
      data: data.toString("base64"),
      mac: mac.toString("base64"),
    };
  }

  decrypt(env: EncryptedEnvelope): string {
    const iv = Buffer.from(env.iv, "base64");
    const data = Buffer.from(env.data, "base64");
    const mac = Buffer.from(env.mac, "base64");
    const expectedMac = createHmac("sha256", this.macKey)
      .update(Buffer.concat([iv, data]))
      .digest();
    if (!timingSafeEqual(mac, expectedMac)) {
      throw new Error("TokenVault: integrity check failed (tampered envelope)");
    }
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Detect hard-coded secrets in source before they ever reach the AI router. */
export interface SecretScanResult {
  detected: boolean;
  findings: SecretFinding[];
}

export interface SecretFinding {
  type: string;
  file: string;
  line: number;
  /** Masked preview, never the full secret. */
  preview: string;
  recommendation: string;
}

const SECRET_PATTERNS: { type: string; re: RegExp }[] = [
  { type: "AWS Access Key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: "Google API Key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { type: "Private Key", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { type: "Slack Token", re: /\bxox[baprs]-[0-9A-Za-z\-]{10,}\b/g },
  { type: "Generic API Key", re: /(?:api[_-]?key|apikey|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/gi },
  { type: "JWT", re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g },
];

export function scanForSecrets(files: { path: string; content: string }[]): SecretScanResult {
  const findings: SecretFinding[] = [];
  for (const f of files) {
    const lines = f.content.split("\n");
    lines.forEach((line, idx) => {
      for (const { type, re } of SECRET_PATTERNS) {
        re.lastIndex = 0;
        if (re.test(line)) {
          const trimmed = line.trim().slice(0, 80);
          findings.push({
            type,
            file: f.path,
            line: idx + 1,
            preview: trimmed.replace(/(key|secret|token|password)=.+/gi, "$1=***").slice(0, 60),
            recommendation: "Move secret to environment variables or a secret store; rotate if exposed.",
          });
        }
      }
    });
  }
  return { detected: findings.length > 0, findings };
}

/** Android permissions considered sensitive for the pre-delivery scan (§26). */
export const DANGEROUS_PERMISSIONS = [
  "android.permission.READ_SMS",
  "android.permission.SEND_SMS",
  "android.permission.READ_CONTACTS",
  "android.permission.READ_PHONE_STATE",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.REQUEST_INSTALL_PACKAGES",
  "android.permission.USE_BIOMETRIC",
];

export interface PermissionFinding {
  permission: string;
  risk: "high" | "medium" | "low";
  reason: string;
}

const HIGH_RISK = new Set([
  "android.permission.READ_SMS",
  "android.permission.SEND_SMS",
  "android.permission.READ_CONTACTS",
  "android.permission.READ_PHONE_STATE",
  "android.permission.SYSTEM_ALERT_WINDOW",
]);

/** Flag dangerous / over-privileged Android permissions before delivery (§26). */
export function scanDangerousPermissions(permissions: string[], requestedCount?: number): PermissionFinding[] {
  const findings: PermissionFinding[] = [];
  for (const p of permissions) {
    if (DANGEROUS_PERMISSIONS.includes(p)) {
      const risk = HIGH_RISK.has(p) ? "high" : "medium";
      findings.push({ permission: p, risk, reason: `Sensitive permission (${risk} risk) — ensure it is justified and declared in store listing.` });
    }
  }
  if (requestedCount !== undefined && requestedCount > 8) {
    findings.push({ permission: "(aggregate)", risk: "low", reason: `App requests ${requestedCount} permissions — review for least-privilege.` });
  }
  return findings;
}

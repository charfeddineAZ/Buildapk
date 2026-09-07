/**
 * Auto signing (stage 8). Produces the Gradle `signingConfigs.release` block and
 * the matching `gradle.properties` entries, and can generate a keystore via the
 * JDK `keytool` when available. The keystore bytes are sealed in the TokenVault
 * (AES-256-GCM) so they are never stored as plaintext (section 6).
 */

import { TokenVault } from "@apk-factory/security";

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
): Promise<{ created: boolean; reason?: string }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    await run(keytool, [
      "-genkeypair", "-v", "-keystore", cfg.keystorePath, "-alias", cfg.keyAlias,
      "-keyalg", "RSA", "-keysize", "2048", "-validity", String(validityDays),
      "-dname", dname,
      "-storepass", "tmp", "-keypass", "tmp",
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

import { describe, it, expect } from "vitest";
import { generateSigningConfig, createKeystore, sealKeystore, unsealKeystore } from "./signing.js";
import { TokenVault } from "@apk-factory/security";

describe("signing", () => {
  it("generates a Gradle signingConfigs.release block", () => {
    const cfg = generateSigningConfig({ alias: "myapp" });
    expect(cfg.gradleBlock).toContain("signingConfigs");
    expect(cfg.gradleBlock).toContain("keyAlias \"myapp\"");
    expect(cfg.gradleProperties.UPLOAD_KEY_ALIAS).toBe("myapp");
  });

  it("creates a keystore when keytool is available (graceful when not)", async () => {
    const cfg = generateSigningConfig();
    const r = await createKeystore(cfg, "CN=Test, O=ApkFactory", 10000, "keytool-nonexistent-bin");
    expect(r.created).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("seals and unseals keystore bytes via the TokenVault", () => {
    const vault = new TokenVault("test-master-secret-123456");
    const bytes = Buffer.from("fake-keystore-bytes");
    const sealed = sealKeystore(vault, bytes);
    expect(sealed).not.toContain("fake-keystore-bytes");
    expect(unsealKeystore(vault, sealed).toString()).toBe("fake-keystore-bytes");
  });
});

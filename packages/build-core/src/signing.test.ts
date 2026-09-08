import { describe, it, expect } from "vitest";
import { generateSigningConfig, createKeystore, sealKeystore, unsealKeystore, SigningService } from "./signing.js";
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

describe("SigningService (zero-manual-config)", () => {
  const vault = new TokenVault("test-master-secret-123456");

  it("mints sealed per-project credentials idempotently", async () => {
    const svc = new SigningService(vault);
    const a = await svc.ensure("prj_1", { repoName: "CPA Automator!", org: "charfeddine" });
    const b = await svc.ensure("prj_1");
    expect(a.configured).toBe(true);
    expect(a.keystoreReady).toBe(false);
    expect(a.dname).toBe("CN=CPA Automator, OU=Cloud APK Factory, O=charfeddine, C=US");
    expect(b.createdAt).toBe(a.createdAt);
    const env = await svc.buildEnv("prj_1");
    expect(env.UPLOAD_STORE_PASSWORD).toHaveLength(32);
    expect(env.UPLOAD_KEY_PASSWORD).not.toBe(env.UPLOAD_STORE_PASSWORD);
    expect(env.UPLOAD_KEY_ALIAS).toBe("apkfactory");
    expect(env.KEYSTORE_BASE64).toBeUndefined();
  });

  it("stores the keystore from the first build and reuses it afterwards", async () => {
    const svc = new SigningService(vault);
    await svc.ensure("prj_2");
    const ks = Buffer.alloc(128, 7).toString("base64");
    const st = await svc.storeKeystore("prj_2", ks, "AA:BB");
    expect(st.keystoreReady).toBe(true);
    expect(st.keystoreSha256).toHaveLength(64);
    expect(st.certSha256).toBe("AA:BB");
    expect((await svc.buildEnv("prj_2")).KEYSTORE_BASE64).toBe(ks);
    await expect(svc.storeKeystore("prj_2", ks)).rejects.toThrow(/rotate/);
    expect((await svc.exportKeystore("prj_2"))!.equals(Buffer.from(ks, "base64"))).toBe(true);
  });

  it("rotate drops the old keystore and mints new passwords", async () => {
    const svc = new SigningService(vault);
    await svc.ensure("prj_3");
    const before = await svc.buildEnv("prj_3");
    await svc.storeKeystore("prj_3", Buffer.alloc(100, 1).toString("base64"));
    const st = await svc.rotate("prj_3");
    expect(st.keystoreReady).toBe(false);
    expect(st.rotatedAt).toBeTruthy();
    const after = await svc.buildEnv("prj_3");
    expect(after.UPLOAD_STORE_PASSWORD).not.toBe(before.UPLOAD_STORE_PASSWORD);
    expect(after.KEYSTORE_BASE64).toBeUndefined();
  });

  it("returns an empty env and a 'none' status for unconfigured projects", async () => {
    const svc = new SigningService(vault);
    expect(await svc.buildEnv("nope")).toEqual({});
    expect((await svc.status("nope")).mode).toBe("none");
  });
});

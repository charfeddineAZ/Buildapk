import { describe, it, expect } from "vitest";
import { ApkValidator, readZipEntries, parseManifestAscii } from "./index.js";

// Tiny store-method ZIP writer (no deps) used to build a fake APK for tests.
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zipEntry(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8); // store
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBuf, data]);
}

function buildFakeApk(): Buffer {
  const manifest = Buffer.from(
    `<?xml version="1.0"?>\n<manifest package="com.example.test" android:versionCode="7" android:versionName="1.2.0" android:minSdkVersion="21" android:targetSdkVersion="34">\n  <uses-permission android:name="android.permission.INTERNET"/>\n  <uses-permission android:name="android.permission.CAMERA"/>\n</manifest>`,
  );
  const parts = [
    zipEntry("AndroidManifest.xml", manifest),
    zipEntry("classes.dex", Buffer.from("dex\n")),
    zipEntry("resources.arsc", Buffer.from("arsc")),
    zipEntry("lib/armeabi-v7a/libapp.so", Buffer.from("so")),
    zipEntry("lib/arm64-v8a/libapp.so", Buffer.from("so")),
    zipEntry("META-INF/CERT.RSA", Buffer.from("rsa")),
    zipEntry("META-INF/CERT.SF", Buffer.from("sf")),
    zipEntry("META-INF/SIG", Buffer.from("APK Sig Block 42")),
  ];
  return Buffer.concat(parts);
}

describe("ApkValidator", () => {
  it("reads zip entries from a store zip", () => {
    const buf = buildFakeApk();
    const names = readZipEntries(buf).map((e) => e.name);
    expect(names).toContain("AndroidManifest.xml");
    expect(names).toContain("classes.dex");
  });

  it("validates a well-formed signed APK", () => {
    const v = new ApkValidator();
    const r = v.validateBuffer(buildFakeApk(), "app.apk");
    expect(r.valid).toBe(true);
    expect(r.packageName).toBe("com.example.test");
    expect(r.versionCode).toBe(7);
    expect(r.versionName).toBe("1.2.0");
    expect(r.minSdk).toBe(21);
    expect(r.targetSdk).toBe(34);
    expect(r.abis).toEqual(expect.arrayContaining(["armeabi-v7a", "arm64-v8a"]));
    expect(r.permissions).toEqual(expect.arrayContaining(["android.permission.INTERNET", "android.permission.CAMERA"]));
    expect(r.signing.signed).toBe(true);
    expect(r.signing.v1).toBe(true);
    expect(r.signing.v2).toBe(true);
    expect(r.sha256).toHaveLength(64);
  });

  it("rejects a non-zip file", () => {
    const v = new ApkValidator();
    const r = v.validateBuffer(Buffer.from("hello"), "x.txt");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("Not a valid ZIP/APK file");
  });

  it("flags a missing manifest", () => {
    const v = new ApkValidator();
    const buf = zipEntry("classes.dex", Buffer.from("dex"));
    const r = v.validateBuffer(buf, "broken.apk");
    expect(r.errors).toContain("Missing AndroidManifest.xml");
  });

  it("extracts manifest via ascii fallback", () => {
    const m = parseManifestAscii(Buffer.from('<manifest package="com.x.y" android:minSdkVersion="19">'));
    expect(m.packageName).toBe("com.x.y");
    expect(m.minSdk).toBe(19);
  });
});

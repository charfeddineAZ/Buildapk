/**
 * APK Validator (section 24). A Gradle "BUILD SUCCESSFUL" does NOT mean the app
 * works, so before delivery we inspect the produced artifact:
 *   - file integrity (exists, size, SHA-256)
 *   - ZIP structure & required entries (classes.dex, resources.arsc, ...)
 *   - ABIs from lib/<abi>/
 *   - signing (v1 via META-INF, v2/v3 via APK Signing Block magic)
 *   - manifest (package, versionCode/Name, min/target SDK, permissions)
 *
 * Manifest parsing tries the binary AXML format first, then falls back to an
 * ASCII scan (a real aapt-produced manifest still embeds readable strings).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Logger } from "@apk-factory/logger";
import type { ApkValidation } from "@apk-factory/types";

const PK_LOCAL = 0x04034b50;

interface ZipEntry {
  name: string;
  compressed: number;
  uncompressed: number;
  method: number;
  data: Buffer;
}

export function readZipEntries(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let off = 0;
  while (off + 4 <= buffer.length) {
    const sig = buffer.readUInt32LE(off);
    if (sig !== PK_LOCAL) break;
    const method = buffer.readUInt16LE(off + 8);
    const compressed = buffer.readUInt32LE(off + 18);
    const uncompressed = buffer.readUInt32LE(off + 22);
    const nameLen = buffer.readUInt16LE(off + 26);
    const extraLen = buffer.readUInt16LE(off + 28);
    const name = buffer.toString("utf8", off + 30, off + 30 + nameLen);
    const dataStart = off + 30 + nameLen + extraLen;
    const data = buffer.subarray(dataStart, dataStart + compressed);
    entries.push({ name, compressed, uncompressed, method, data: Buffer.from(data) });
    // advance past this entry's data to the next local header
    off = dataStart + compressed;
  }
  return entries;
}

/** Best-effort binary AXML parser (AndroidManifest.xml). Returns null on failure. */
export function parseAxmlManifest(buf: Buffer): Partial<ApkValidation> | null {
  try {
    if (buf.readUInt16LE(0) !== 0x0003) return null; // RES_XML_TYPE
    const strings = readStringPool(buf);
    if (!strings) return null;
    const result: Partial<ApkValidation> = { permissions: [] };
    const attrIds = [0x0101021b, 0x0101021c, 0x0101021d, 0x0101020c, 0x01010270];
    // Walk attribute chunks (type 0x0102) inside the buffer.
    for (let i = 8; i + 20 <= buf.length; i += 4) {
      if (buf.readUInt16LE(i) !== 0x0102) continue; // RES_XML_START_ELEMENT / ATTR
      // attribute chunk: chunkType(2)=0x0102, size(2), ... then attrs[]
      const attrCount = buf.readUInt16LE(i + 20); // after namespace, name, ...
      // element header: type(2), headerSize(2), size(4), ns(4), name(4)
      const nameIdx = buf.readUInt32LE(i + 8);
      const elemName = strings[nameIdx] ?? "";
      if (elemName === "manifest") {
        for (let a = 0; a < attrCount; a++) {
          const base = i + 28 + a * 20;
          const resId = buf.readUInt32LE(base + 4);
          const type = buf.readUInt16LE(base + 14);
          const data = buf.readUInt32LE(base + 16);
          if (resId === attrIds[0]) result.packageName = strings[data] ?? String(data);
          if (resId === attrIds[1]) result.versionCode = data;
          if (resId === attrIds[2]) result.versionName = strings[data] ?? String(data);
          if (resId === attrIds[3]) result.minSdk = data;
          if (resId === attrIds[4]) result.targetSdk = data;
        }
      }
      if (elemName === "uses-permission") {
        const base = i + 28;
        const resId = buf.readUInt32LE(base + 4);
        if (resId === 0x01010003) (result.permissions as string[]).push(strings[buf.readUInt32LE(base + 16)] ?? "");
      }
    }
    return result;
  } catch {
    return null;
  }
}

function readStringPool(buf: Buffer): string[] | null {
  try {
    if (buf.readUInt16LE(0) !== 0x0001) return null; // RES_STRING_POOL_TYPE
    const count = buf.readUInt32LE(8);
    const stringsStart = buf.readUInt32LE(16);
    const offsets: number[] = [];
    for (let i = 0; i < count; i++) offsets.push(buf.readUInt32LE(20 + i * 4));
    const out: string[] = [];
    for (const o of offsets) {
      const p = stringsStart + o;
      const u16len = buf.readUInt16LE(p);
      const u8len = buf.readUInt8(p + 2);
      out.push(buf.toString("utf8", p + 3, p + 3 + u8len).replace(/\0/g, ""));
      void u16len;
    }
    return out;
  } catch {
    return null;
  }
}

/** Fallback: recover manifest facts from readable ASCII (works for plaintext manifests). */
export function parseManifestAscii(buf: Buffer): Partial<ApkValidation> {
  const text = buf.toString("latin1");
  const pkg = text.match(/[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}/i)?.[0];
  const minSdk = text.match(/minSdkVersion["'=:\s]+(\d+)/i)?.[1];
  const targetSdk = text.match(/targetSdkVersion["'=:\s]+(\d+)/i)?.[1];
  const versionCode = text.match(/versionCode["'=:\s]+(\d+)/i)?.[1];
  const versionName = text.match(/versionName["'=:\s]+"?([\d.]+)"?/i)?.[1];
  const permissions = [...text.matchAll(/uses-permission[^>]*?name=["']([^"']+)["']/gi)].map((m) => m[1]);
  return {
    packageName: pkg,
    minSdk: minSdk ? parseInt(minSdk, 10) : undefined,
    targetSdk: targetSdk ? parseInt(targetSdk, 10) : undefined,
    versionCode: versionCode ? parseInt(versionCode, 10) : undefined,
    versionName,
    permissions,
  };
}

export class ApkValidator {
  constructor(private readonly log: Logger = new Logger("validator")) {}

  async validateFile(path: string): Promise<ApkValidation> {
    const buf = readFileSync(path);
    return this.validateBuffer(buf, path);
  }

  validateBuffer(buffer: Buffer, filename = "app.apk"): ApkValidation {
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const result: ApkValidation = {
      valid: false,
      fileExists: true,
      abis: [],
      permissions: [],
      signing: { signed: false, v1: false, v2: false, v3: false },
      fileSizeBytes: buffer.length,
      sha256,
      warnings: [],
      errors: [],
    };

    if (!buffer.subarray(0, 2).equals(Buffer.from("PK"))) {
      result.errors.push("Not a valid ZIP/APK file");
      return result;
    }

    let entries: ZipEntry[] = [];
    try {
      entries = readZipEntries(buffer);
    } catch (e) {
      result.errors.push("Failed to read ZIP entries");
      this.log.warn("zip read failed", { filename, error: String(e) });
      return result;
    }

    const names = entries.map((e) => e.name);
    const manifest = entries.find((e) => e.name === "AndroidManifest.xml");
    if (!names.includes("classes.dex")) result.warnings.push("No classes.dex (likely not an application)");
    if (!names.includes("resources.arsc")) result.warnings.push("Missing resources.arsc");
    if (!manifest) result.errors.push("Missing AndroidManifest.xml");

    // ABIs
    const abiSet = new Set<string>();
    for (const n of names) {
      const m = n.match(/^lib\/([^/]+)\/.*/);
      if (m) abiSet.add(m[1]);
    }
    result.abis = [...abiSet];
    if (result.abis.length === 0) result.warnings.push("No native libraries (universal/ABI-none)");

    // Signing
    const hasV1 = names.some((n) => /^META-INF\/.*\.(RSA|DSA|EC)$/.test(n)) && names.some((n) => /^META-INF\/.*\.SF$/.test(n));
    const hasV2V3 = buffer.includes(Buffer.from("APK Sig Block 42"));
    result.signing.v1 = hasV1;
    result.signing.v2 = hasV2V3;
    result.signing.v3 = hasV2V3;
    result.signing.signed = hasV1 || hasV2V3;
    if (!result.signing.signed) result.warnings.push("APK is not signed");

    // Manifest
    if (manifest) {
      let parsed: Partial<ApkValidation> | null = null;
      try { parsed = parseAxmlManifest(manifest.data); } catch { parsed = null; }
      const ascii = parseManifestAscii(manifest.data);
      const merged: Partial<ApkValidation> = { ...ascii, ...(parsed ?? {}) };
      result.packageName = merged.packageName;
      result.versionCode = merged.versionCode;
      result.versionName = merged.versionName;
      result.minSdk = merged.minSdk;
      result.targetSdk = merged.targetSdk;
      if (merged.permissions) result.permissions = merged.permissions as string[];
      if (!result.packageName) result.warnings.push("Could not extract package name from manifest");
      if (!result.minSdk) result.warnings.push("Could not extract minSdkVersion");
    }

    result.valid = result.errors.length === 0;
    this.log.info("apk validated", { filename, valid: result.valid, sha256: sha256.slice(0, 12), abis: result.abis.join(",") });
    return result;
  }
}

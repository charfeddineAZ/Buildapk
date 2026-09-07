/**
 * Compatibility Engine — maps a detected project to the exact toolchain it
 * needs, then resolves the prebuilt environment image that already contains it.
 */

import type { CompatibilityMatrix, Framework } from "@apk-factory/types";
import type { PkgJson } from "./detect.js";

const REGISTRY = "ghcr.io/charfeddineaz";

/** Known Expo SDK → toolchain map. Mirrors Expo's published requirements. */
const EXPO_MATRIX: Record<string, Partial<CompatibilityMatrix>> = {
  "53": { node: "20", java: "17", gradle: "8.6", androidSdk: 35, buildTools: "35.0.0", kotlin: "1.9.24", expo: "53" },
  "52": { node: "20", java: "17", gradle: "8.6", androidSdk: 35, buildTools: "35.0.0", kotlin: "1.9.24", expo: "52" },
  "51": { node: "18", java: "17", gradle: "8.6", androidSdk: 34, buildTools: "34.0.0", kotlin: "1.9.22", expo: "51" },
  "50": { node: "18", java: "17", gradle: "8.3", androidSdk: 34, buildTools: "34.0.0", kotlin: "1.9.22", expo: "50" },
};

const RN_MATRIX: Record<string, Partial<CompatibilityMatrix>> = {
  "0.79": { node: "20", java: "17", gradle: "8.6", androidSdk: 35, buildTools: "35.0.0", kotlin: "1.9.24", reactNative: "0.79" },
  "0.78": { node: "20", java: "17", gradle: "8.6", androidSdk: 35, buildTools: "35.0.0", kotlin: "1.9.22", reactNative: "0.78" },
  "0.74": { node: "18", java: "17", gradle: "8.6", androidSdk: 34, buildTools: "34.0.0", kotlin: "1.9.22", reactNative: "0.74" },
};

const FLUTTER_MATRIX: Record<string, Partial<CompatibilityMatrix>> = {
  "3.2": { node: "20", java: "17", gradle: "8.6", androidSdk: 34, buildTools: "34.0.0", kotlin: "1.9.22" },
  default: { node: "20", java: "17", gradle: "8.6", androidSdk: 35, buildTools: "35.0.0", kotlin: "1.9.24" },
};

/** Best-effort match of "x.y.z" to a known "x.y" key. */
function matchVersionTable(versions: string[], table: Record<string, Partial<CompatibilityMatrix>>): Partial<CompatibilityMatrix> | null {
  for (const v of versions) {
    const minor = v.split(".").slice(0, 2).join(".");
    if (table[minor]) return table[minor];
    const major = v.split(".")[0];
    if (table[major]) return table[major];
  }
  return null;
}

export function resolveCompatibility(
  primary: Framework,
  versions: { framework?: string; expo?: string; reactNative?: string; flutter?: string },
  pkg: PkgJson,
): CompatibilityMatrix {
  let base: Partial<CompatibilityMatrix> = {};
  let recommendedImage = `${REGISTRY}/apk-android-builder:latest`;

  if (primary === "expo" || versions.expo) {
    const map = matchVersionTable([versions.expo ?? versions.framework ?? "53"], EXPO_MATRIX) ?? EXPO_MATRIX["53"];
    base = { ...map, framework: "expo" };
    const sdk = base.expo ?? "53";
    recommendedImage = `${REGISTRY}/apk-expo-builder:sdk${sdk}`;
  } else if (primary === "react-native" || versions.reactNative) {
    const map = matchVersionTable([versions.reactNative ?? versions.framework ?? "0.79"], RN_MATRIX) ?? RN_MATRIX["0.79"];
    base = { ...map, framework: "react-native" };
    recommendedImage = `${REGISTRY}/apk-react-native-builder:rn${base.reactNative}`;
  } else if (primary === "flutter" || versions.flutter) {
    const map = matchVersionTable([versions.flutter ?? "3.2"], FLUTTER_MATRIX) ?? FLUTTER_MATRIX.default;
    base = { ...map, framework: "flutter" };
    recommendedImage = `${REGISTRY}/apk-flutter-builder:latest`;
  } else if (primary === "capacitor" || primary === "ionic") {
    base = { framework: primary, node: "20", java: "17", gradle: "8.6", androidSdk: 35, buildTools: "35.0.0", kotlin: "1.9.24" };
    recommendedImage = `${REGISTRY}/apk-capacitor-builder:latest`;
  } else if (primary === "native-android") {
    base = { framework: "native-android", node: "18", java: "17", gradle: "8.6", androidSdk: 35, buildTools: "35.0.0", kotlin: "1.9.24" };
    recommendedImage = `${REGISTRY}/apk-android-builder:latest`;
  } else if (primary === "pwa") {
    base = { framework: "pwa", node: "20", java: "17", gradle: "8.6", androidSdk: 35, buildTools: "35.0.0" };
    recommendedImage = `${REGISTRY}/apk-capacitor-builder:pwa`;
  }

  return {
    framework: base.framework ?? primary,
    node: base.node ?? "20",
    java: base.java ?? "17",
    gradle: base.gradle ?? "8.6",
    androidSdk: base.androidSdk ?? 35,
    buildTools: base.buildTools ?? "35.0.0",
    kotlin: base.kotlin,
    expo: base.expo,
    reactNative: base.reactNative,
    recommendedImage,
  };
}

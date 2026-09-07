/**
 * Auto versioning (stage 8). Bumps versionCode (always +1) and versionName
 * (semantic patch bump, or a build-suffix fallback) so every cloud build is
 * uniquely identifiable in the store without manual edits.
 */

export interface VersionBump {
  versionName: string;
  versionCode: number;
}

export function bumpVersion(versionName: string | undefined, versionCode: number | undefined): VersionBump {
  const nextCode = (versionCode ?? 0) + 1;
  const nextName = bumpName(versionName ?? "1.0.0");
  return { versionName: nextName, versionCode: nextCode };
}

function bumpName(name: string): string {
  const m = name.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    let [major, minor, patch] = m.slice(1, 4).map(Number);
    patch += 1;
    if (patch > 99) { patch = 0; minor += 1; }
    if (minor > 99) { minor = 0; major += 1; }
    return `${major}.${minor}.${patch}`;
  }
  // Non-semver: append a build counter.
  return `${name}+${Date.now()}`;
}

/** Produce an app.json patch that sets the new version (Expo projects). */
export function versionPatch(versionName: string, versionCode: number) {
  return { level: 2 as const, file: "app.json", target: "expo.version", value: versionName, description: `Set version to ${versionName} (code ${versionCode})`, risk: "low" as const };
}

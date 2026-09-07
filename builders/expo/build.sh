#!/usr/bin/env bash
# Expo build route (Route 1: EAS, fallback: local prebuild + Gradle).
# Receives the repo at $1 (working copy) and writes artifacts to ./artifacts.
set -euo pipefail
REPO_DIR="${1:-.}"
OUT_DIR="$(pwd)/artifacts"
mkdir -p "$OUT_DIR"

cd "$REPO_DIR"

# Honour a project-provided .npmrc (e.g. legacy-peer-deps) and install.
if [ -f .npmrc ]; then echo "using project .npmrc"; fi
npm install --legacy-peer-deps || npm install

if [ -n "${EXPO_TOKEN:-}" ]; then
  echo ">> Building with EAS (preview profile)"
  eas build --platform android --profile preview --non-interactive --output="$OUT_DIR/app.aab"
  # Also produce an APK for quick testing.
  eas build --platform android --profile preview --non-interactive --output="$OUT_DIR/app.apk" || true
else
  echo ">> No EXPO_TOKEN — local prebuild + Gradle (debug APK)"
  npx expo prebuild --platform android --non-interactive || true
  cd android
  ./gradlew assembleDebug || ./gradlew assembleRelease
  cp app/build/outputs/apk/debug/*.apk "$OUT_DIR/app.apk" 2>/dev/null || \
  cp app/build/outputs/apk/release/*.apk "$OUT_DIR/app.apk"
fi

echo ">> Artifacts:"; ls -la "$OUT_DIR"

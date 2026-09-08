#!/usr/bin/env bash
# React Native (bare) build route (Route 2: GitHub Actions / Docker).
set -euo pipefail
REPO_DIR="${1:-.}"
OUT_DIR="$(pwd)/artifacts"
mkdir -p "$OUT_DIR"
cd "$REPO_DIR"
npm install --legacy-peer-deps || npm install
# Zero-config release signing (keystore from vault, generated on first build)
bash "$(dirname "$0")/../common/sign.sh" android || true
cd android
if [ -n "${UPLOAD_STORE_PASSWORD:-}" ]; then
  ./gradlew --init-script apk-factory-signing.gradle assembleRelease bundleRelease
else
  ./gradlew assembleRelease
fi
cp app/build/outputs/apk/release/*.apk "$OUT_DIR/app.apk"
cp app/build/outputs/bundle/release/*.aab "$OUT_DIR/app.aab" 2>/dev/null || true
echo ">> Artifacts:"; ls -la "$OUT_DIR"

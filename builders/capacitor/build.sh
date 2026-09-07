#!/usr/bin/env bash
# Capacitor / Ionic build route.
set -euo pipefail
REPO_DIR="${1:-.}"
OUT_DIR="$(pwd)/artifacts"
mkdir -p "$OUT_DIR"
cd "$REPO_DIR"
npm install --legacy-peer-deps || npm install
npx cap sync android
cd android
./gradlew assembleRelease
cp app/build/outputs/apk/release/*.apk "$OUT_DIR/app.apk"
echo ">> Artifacts:"; ls -la "$OUT_DIR"

#!/usr/bin/env bash
# Flutter build route.
set -euo pipefail
REPO_DIR="${1:-.}"
OUT_DIR="$(pwd)/artifacts"
mkdir -p "$OUT_DIR"
cd "$REPO_DIR"
flutter pub get
# Zero-config release signing: Flutter reads android/key.properties
bash "$(dirname "$0")/../common/sign.sh" android || true
if [ -n "${UPLOAD_STORE_PASSWORD:-}" ]; then
  {
    echo "storeFile=${UPLOAD_KEYSTORE_PATH:-release.keystore}"
    echo "storePassword=$UPLOAD_STORE_PASSWORD"
    echo "keyAlias=${UPLOAD_KEY_ALIAS:-apkfactory}"
    echo "keyPassword=$UPLOAD_KEY_PASSWORD"
  } > android/key.properties
fi
flutter build apk --release -o "$OUT_DIR/app.apk"
flutter build appbundle --release -o "$OUT_DIR/app.aab" 2>/dev/null || true
echo ">> Artifacts:"; ls -la "$OUT_DIR"

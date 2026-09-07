#!/usr/bin/env bash
# Flutter build route.
set -euo pipefail
REPO_DIR="${1:-.}"
OUT_DIR="$(pwd)/artifacts"
mkdir -p "$OUT_DIR"
cd "$REPO_DIR"
flutter pub get
flutter build apk --release -o "$OUT_DIR/app.apk"
flutter build appbundle --release -o "$OUT_DIR/app.aab" 2>/dev/null || true
echo ">> Artifacts:"; ls -la "$OUT_DIR"

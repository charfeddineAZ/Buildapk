#!/usr/bin/env bash
# iOS build route (stage 8). Expo EAS builds the iOS archive; for bare RN the
# project is opened in Xcode on a macOS runner. Free-Tier note: EAS iOS builds
# also consume the EAS monthly quota, so the Build Router prefers the Android
# route unless iOS is explicitly requested.
set -euo pipefail
REPO_DIR="${1:-.}"
OUT_DIR="$(pwd)/artifacts"
mkdir -p "$OUT_DIR"
cd "$REPO_DIR"
npm install --legacy-peer-deps || npm install
if [ -n "${EXPO_TOKEN:-}" ]; then
  echo ">> Building iOS with EAS"
  npx eas build --platform ios --profile production --non-interactive --output="$OUT_DIR/app.ipa"
else
  echo ">> iOS requires EAS or a macOS runner with Xcode; skipping binary."
fi
echo ">> Artifacts:"; ls -la "$OUT_DIR"

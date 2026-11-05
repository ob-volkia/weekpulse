#!/bin/sh
# Publish a GitHub release for the version in manifest.json (BRAT installs from it).
# Usage: bump "version" in manifest.json and package.json, commit, then `npm run release`.
set -e
cd "$(dirname "$0")/.."
V=$(node -p 'require("./manifest.json").version')
[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first"; exit 1; }
npm run check
rm -rf release/build && OUT_DIR=release/build node esbuild.config.mjs
git push origin HEAD
cp "docs/guide/Weekpulse — инструкция.pdf" release/build/Weekpulse-guide.pdf
gh release create "$V" release/build/main.js release/build/manifest.json release/build/styles.css release/build/Weekpulse-guide.pdf \
  --title "$V" --notes "${NOTES:-Weekpulse $V}"
echo "Released $V"

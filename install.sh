#!/usr/bin/env sh
# GBP Sphere installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/sakibsphere/SphereGMB-Auditor/main/install.sh | sh
#
# Downloads the latest release zip from GitHub into ~/SphereGMB. Chrome does not let a script
# install an extension, so you finish with "Load unpacked". Run it again to update: the folder
# is reused, so you only press the reload arrow in chrome://extensions.
set -eu

REPO="sakibsphere/SphereGMB-Auditor"
TARGET="${HOME}/SphereGMB"
URL="https://github.com/${REPO}/releases/latest/download/sphere-gmb.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

command -v unzip >/dev/null 2>&1 || { echo "Please install 'unzip' first."; exit 1; }

echo "Downloading GBP Sphere from github.com/${REPO} ..."
curl -fsSL "$URL" -o "$TMP/sphere-gmb.zip"
unzip -q "$TMP/sphere-gmb.zip" -d "$TMP/ext"
[ -f "$TMP/ext/manifest.json" ] || { echo "The download does not look like the extension (no manifest.json)."; exit 1; }

mkdir -p "$TARGET"
find "$TARGET" -mindepth 1 -delete
cp -R "$TMP/ext/." "$TARGET/"

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$TARGET/manifest.json" | head -n 1)"
echo ""
echo "GBP Sphere v${VERSION} is in: ${TARGET}"
echo ""
echo "First time? Finish in your browser (Chrome, Edge, Brave):"
echo "  1. Open chrome://extensions"
echo "  2. Turn on 'Developer mode' (top right)"
echo "  3. Click 'Load unpacked' and choose: ${TARGET}"
echo ""
echo "Updating? Click the reload arrow on the GBP Sphere card in chrome://extensions."
if command -v open >/dev/null 2>&1; then open "$TARGET"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$TARGET" >/dev/null 2>&1 || true; fi

#!/usr/bin/env sh
# GBP Sphere installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/sakibsphere/GBP-Sphere/main/install.sh | sh
#
# Downloads the latest release into your Downloads folder (Downloads/GBP-Sphere-Extension). Chrome does
# not let a script install an extension, so you finish with "Load unpacked". Run it again to
# update: the folder is reused, so you only press the reload arrow in chrome://extensions.
# Older installs in ~/SphereGMB keep updating there, so they keep their saved data.
set -eu

REPO="sakibsphere/GBP-Sphere"
URL="https://github.com/${REPO}/releases/latest/download/sphere-gmb.zip"

downloads_dir() {
  # Linux desktops can move or translate Downloads; xdg-user-dir knows where it is.
  if command -v xdg-user-dir >/dev/null 2>&1; then
    d="$(xdg-user-dir DOWNLOAD 2>/dev/null || true)"
    if [ -n "$d" ] && [ "$d" != "$HOME" ] && [ -d "$d" ]; then echo "$d"; return; fi
  fi
  echo "${HOME}/Downloads"
}

if [ -n "${SPHEREGMB_DIR:-}" ]; then
  TARGET="$SPHEREGMB_DIR"
elif [ -f "${HOME}/SphereGMB/manifest.json" ]; then
  TARGET="${HOME}/SphereGMB"
else
  TARGET="$(downloads_dir)/GBP-Sphere-Extension"
fi

# Never wipe a folder that is not a GBP Sphere install.
if [ -d "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ] && [ ! -f "$TARGET/manifest.json" ]; then
  echo "$TARGET already exists and is not a GBP Sphere folder. Move it away, then run the installer again."
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
command -v unzip >/dev/null 2>&1 || { echo "Please install 'unzip' first."; exit 1; }

echo "Downloading GBP Sphere from github.com/${REPO} ..."
if [ -n "${SPHEREGMB_ZIP:-}" ]; then cp "$SPHEREGMB_ZIP" "$TMP/sphere-gmb.zip"; else curl -fsSL "$URL" -o "$TMP/sphere-gmb.zip"; fi
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
if [ -z "${SPHEREGMB_ZIP:-}" ]; then
  # On Linux "open" can be openvt, so only macOS uses it.
  if [ "$(uname -s)" = "Darwin" ]; then open "$TARGET" || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$TARGET" >/dev/null 2>&1 || true; fi
fi

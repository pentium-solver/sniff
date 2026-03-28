#!/bin/bash
set -euo pipefail

REPO="pentium-solver/sniff"
INSTALL_DIR="/usr/local/bin"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

case "$OS" in
  linux|darwin) ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

BINARY="sniff-${OS}-${ARCH}"
echo "Downloading sniff! for ${OS}/${ARCH}..."

# Get latest release download URL
DOWNLOAD_URL=$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep "browser_download_url.*${BINARY}" \
  | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Error: Could not find a release for ${OS}/${ARCH}"
  echo "Check https://github.com/${REPO}/releases for available builds."
  exit 1
fi

TMP=$(mktemp)
curl -fsSL "$DOWNLOAD_URL" -o "$TMP"
chmod +x "$TMP"

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "${INSTALL_DIR}/sniff"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "$TMP" "${INSTALL_DIR}/sniff"
fi

echo ""
echo "sniff! installed successfully."
echo ""
echo "Prerequisites:"
echo "  - Android device connected via USB with ADB debugging enabled"
echo "  - mitmproxy (mitmdump) installed"
echo "  - frida-server running on device"
echo ""
echo "Run 'sniff' to start."

#!/bin/bash
set -euo pipefail

REPO="pentium-solver/sniff"
INSTALL_DIR="/usr/local/bin"

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}sniff!${RESET} — Android HTTPS interception tool"
echo -e "${DIM}https://github.com/${REPO}${RESET}"
echo ""

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo -e "${RED}Error:${RESET} Unsupported architecture: $ARCH"; exit 1 ;;
esac

case "$OS" in
  linux|darwin) ;;
  *) echo -e "${RED}Error:${RESET} Unsupported OS: $OS"; exit 1 ;;
esac

BINARY="sniff-${OS}-${ARCH}"
echo -e "${DIM}Platform:${RESET}  ${OS}/${ARCH}"

# Get latest release
echo -e "${DIM}Fetching:${RESET}  latest release..."

RELEASE_JSON=$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest")

# Check if release exists
if echo "$RELEASE_JSON" | grep -q '"message": "Not Found"'; then
  echo ""
  echo -e "${RED}No releases found.${RESET}"
  echo ""
  echo "sniff! hasn't published a release yet. To build from source:"
  echo ""
  echo -e "  ${BLUE}git clone https://github.com/${REPO}.git${RESET}"
  echo -e "  ${BLUE}cd sniff${RESET}"
  echo -e "  ${BLUE}make build${RESET}"
  echo ""
  echo "Requires: Go 1.25+, Bun"
  exit 1
fi

DOWNLOAD_URL=$(echo "$RELEASE_JSON" \
  | grep "browser_download_url.*${BINARY}" \
  | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo ""
  echo -e "${RED}No binary found for ${OS}/${ARCH}.${RESET}"
  echo ""
  echo "Available builds:"
  echo "$RELEASE_JSON" | grep "browser_download_url" | cut -d '"' -f 4 | while read -r url; do
    echo "  $(basename "$url")"
  done
  echo ""
  echo "Build from source instead:"
  echo -e "  ${BLUE}git clone https://github.com/${REPO}.git && cd sniff && make build${RESET}"
  exit 1
fi

VERSION=$(echo "$RELEASE_JSON" | grep '"tag_name"' | cut -d '"' -f 4)
echo -e "${DIM}Version:${RESET}   ${VERSION}"
echo -e "${DIM}Binary:${RESET}    ${BINARY}"
echo ""

# Download
TMP=$(mktemp)
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP"
chmod +x "$TMP"

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "${INSTALL_DIR}/sniff"
else
  echo -e "Installing to ${INSTALL_DIR} ${DIM}(requires sudo)${RESET}"
  sudo mv "$TMP" "${INSTALL_DIR}/sniff"
fi

echo -e "${GREEN}Installed successfully!${RESET} $(sniff --version 2>/dev/null || echo "${VERSION}")"
echo ""
echo -e "${BOLD}Prerequisites:${RESET}"
echo "  - Android device connected via USB (ADB debugging enabled)"
echo "  - mitmproxy installed (mitmdump)"
echo "  - frida-server running on device"
echo ""
echo -e "Run ${BLUE}sniff${RESET} to start."
echo ""

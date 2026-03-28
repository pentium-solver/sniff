#!/bin/bash
set -euo pipefail

REPO="pentium-solver/sniff"
INSTALL_DIR="/usr/local/bin"

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}sniff!${RESET} — Android HTTPS interception tool"
echo -e "${DIM}https://github.com/${REPO}${RESET}"
echo ""

# ── Uninstall ────────────────────────────────────────────────

if [ "${1:-}" = "uninstall" ] || [ "${1:-}" = "--uninstall" ]; then
  echo -e "${BOLD}Uninstalling sniff!${RESET}"
  echo ""

  if [ -f "${INSTALL_DIR}/sniff" ]; then
    rm -f "${INSTALL_DIR}/sniff" 2>/dev/null || {
      echo -e "${DIM}Requires sudo${RESET}"
      sudo rm -f "${INSTALL_DIR}/sniff"
    }
    echo -e "  ${GREEN}✓${RESET} Removed ${INSTALL_DIR}/sniff"
  else
    echo -e "  ${DIM}Binary not found at ${INSTALL_DIR}/sniff${RESET}"
  fi

  echo ""
  echo -e "${GREEN}sniff! uninstalled.${RESET}"
  echo ""
  exit 0
fi

# ── Helpers ──────────────────────────────────────────────────

ask() {
  echo -ne "$1 ${DIM}[y/N]${RESET} "
  read -r answer
  [[ "$answer" =~ ^[Yy] ]]
}

has() {
  command -v "$1" &>/dev/null
}

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

# ── Download sniff! ──────────────────────────────────────────

echo -e "${DIM}Fetching:${RESET}  latest release..."

RELEASE_JSON=$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest")

if echo "$RELEASE_JSON" | grep -q '"message": "Not Found"'; then
  echo ""
  echo -e "${RED}No releases found.${RESET}"
  echo ""
  echo "sniff! hasn't published a release yet. To build from source:"
  echo ""
  echo -e "  ${BLUE}git clone https://github.com/${REPO}.git${RESET}"
  echo -e "  ${BLUE}cd sniff && make build${RESET}"
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

TMP=$(mktemp)
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP"
chmod +x "$TMP"

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "${INSTALL_DIR}/sniff"
else
  echo -e "Installing to ${INSTALL_DIR} ${DIM}(requires sudo)${RESET}"
  sudo mv "$TMP" "${INSTALL_DIR}/sniff"
fi

echo -e "${GREEN}sniff! installed.${RESET} ${DIM}${VERSION}${RESET}"

# ── Check dependencies ───────────────────────────────────────

echo ""
echo -e "${BOLD}Checking dependencies...${RESET}"
echo ""

MISSING=()

# ADB
if has adb; then
  echo -e "  ${GREEN}✓${RESET} adb"
else
  echo -e "  ${RED}✗${RESET} adb ${DIM}(Android Debug Bridge)${RESET}"
  MISSING+=("adb")
fi

# mitmproxy / mitmdump
if has mitmdump; then
  echo -e "  ${GREEN}✓${RESET} mitmdump"
elif has mitmproxy; then
  echo -e "  ${GREEN}✓${RESET} mitmproxy"
else
  echo -e "  ${RED}✗${RESET} mitmproxy ${DIM}(HTTPS proxy)${RESET}"
  MISSING+=("mitmproxy")
fi

# frida
if has frida; then
  echo -e "  ${GREEN}✓${RESET} frida"
elif pip3 show frida-tools &>/dev/null 2>&1; then
  echo -e "  ${GREEN}✓${RESET} frida-tools ${DIM}(via pip)${RESET}"
else
  echo -e "  ${RED}✗${RESET} frida ${DIM}(runtime instrumentation)${RESET}"
  MISSING+=("frida")
fi

# Python (needed for frida/mitmproxy)
if has python3; then
  echo -e "  ${GREEN}✓${RESET} python3"
elif has python; then
  echo -e "  ${GREEN}✓${RESET} python"
else
  echo -e "  ${RED}✗${RESET} python3 ${DIM}(required by frida & mitmproxy)${RESET}"
  MISSING+=("python3")
fi

echo ""

if [ ${#MISSING[@]} -eq 0 ]; then
  echo -e "${GREEN}All dependencies found.${RESET}"
  echo ""
  echo -e "Run ${BLUE}sniff${RESET} to start."
  echo ""
  exit 0
fi

# ── Offer to install missing deps ────────────────────────────

echo -e "${YELLOW}Missing ${#MISSING[@]} dependency(s):${RESET} ${MISSING[*]}"
echo ""

if ! ask "Install missing dependencies?"; then
  echo ""
  echo "Install them manually, then run sniff."
  echo ""
  exit 0
fi

echo ""

# Detect package manager
if [ "$OS" = "darwin" ]; then
  if ! has brew; then
    echo -e "${DIM}Installing Homebrew...${RESET}"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  PKG="brew"
elif has apt-get; then
  PKG="apt"
elif has dnf; then
  PKG="dnf"
elif has pacman; then
  PKG="pacman"
else
  echo -e "${RED}Could not detect package manager.${RESET} Install manually:"
  for dep in "${MISSING[@]}"; do
    case "$dep" in
      adb)       echo "  - adb: https://developer.android.com/tools/adb" ;;
      mitmproxy) echo "  - mitmproxy: pip3 install mitmproxy" ;;
      frida)     echo "  - frida: pip3 install frida-tools" ;;
      python3)   echo "  - python3: https://python.org" ;;
    esac
  done
  echo ""
  exit 1
fi

for dep in "${MISSING[@]}"; do
  case "$dep" in

    python3)
      echo -e "${DIM}Installing python3...${RESET}"
      case "$PKG" in
        brew)    brew install python3 ;;
        apt)     sudo apt-get update -qq && sudo apt-get install -y -qq python3 python3-pip ;;
        dnf)     sudo dnf install -y python3 python3-pip ;;
        pacman)  sudo pacman -Sy --noconfirm python python-pip ;;
      esac
      echo -e "  ${GREEN}✓${RESET} python3"
      ;;

    adb)
      echo -e "${DIM}Installing adb...${RESET}"
      case "$PKG" in
        brew)    brew install android-platform-tools ;;
        apt)     sudo apt-get update -qq && sudo apt-get install -y -qq android-tools-adb ;;
        dnf)     sudo dnf install -y android-tools ;;
        pacman)  sudo pacman -Sy --noconfirm android-tools ;;
      esac
      echo -e "  ${GREEN}✓${RESET} adb"
      ;;

    mitmproxy)
      echo -e "${DIM}Installing mitmproxy...${RESET}"
      if [ "$PKG" = "brew" ]; then
        brew install mitmproxy
      else
        pip3 install --user mitmproxy
      fi
      echo -e "  ${GREEN}✓${RESET} mitmproxy"
      ;;

    frida)
      echo -e "${DIM}Installing frida-tools...${RESET}"
      pip3 install --user frida-tools
      echo -e "  ${GREEN}✓${RESET} frida-tools"
      echo ""
      echo -e "  ${YELLOW}Note:${RESET} You also need frida-server on your Android device."
      echo -e "  Download from: ${BLUE}https://github.com/frida/frida/releases${RESET}"
      echo -e "  Push to device: ${DIM}adb push frida-server /data/local/tmp/${RESET}"
      echo -e "  Start on device: ${DIM}adb shell 'su -c /data/local/tmp/frida-server &'${RESET}"
      ;;

  esac
done

echo ""
echo -e "${GREEN}Setup complete.${RESET}"
echo ""
echo -e "Run ${BLUE}sniff${RESET} to start."
echo ""

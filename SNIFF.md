# Sniff

**by [x-lock](https://x-lock.cloud)**

Android HTTPS traffic interception and analysis toolkit. Automates the full capture pipeline — proxy setup, SSL pinning bypass via Frida, real-time flow inspection, and forensic HAR export — from a single interface.

---

## Table of Contents

1. [What is Sniff](#what-is-sniff)
2. [Why Sniff exists](#why-sniff-exists)
3. [How it works](#how-it-works)
4. [Architecture](#architecture)
5. [Prerequisites](#prerequisites)
6. [Installation](#installation)
7. [Usage](#usage)
8. [API Reference](#api-reference)
9. [Frida Scripts](#frida-scripts)
10. [Capture Modes](#capture-modes)
11. [Frontend (Web UI)](#frontend-web-ui)
12. [Configuration](#configuration)
13. [What's next](#whats-next)
14. [Open source roadmap](#open-source-roadmap)

---

## What is Sniff

Sniff is a purpose-built toolkit for intercepting, decrypting, and analyzing HTTPS traffic from Android applications. It orchestrates three tools that are normally configured separately — ADB, mitmproxy, and Frida — into a single automated workflow.

**Core capabilities:**

- **Automated capture pipeline** — One command goes from cold device to full MITM: sets SELinux permissive, starts Frida server, launches mitmproxy, configures device proxy, spawns/attaches to the target app with SSL bypass scripts, and begins capturing flows.
- **SSL pinning bypass** — 14 built-in Frida scripts covering Android platform TLS (TrustManager, Conscrypt), OkHttp, React Native, Flutter/Dart (BoringSSL native hooks), WebView, and app-specific bypasses.
- **Real-time flow inspection** — Live HTTP request/response table with headers, bodies, resource type filtering, and text search.
- **HAR forensics** — Export captures to HAR 1.2 format. Dedicated HAR inspector with deep search across all fields (URLs, headers, cookies, request/response bodies) with match highlighting.
- **Custom Frida scripts** — Create, upload, edit, and manage your own bypass scripts alongside built-ins.
- **Dual interface** — Full-featured terminal UI (TUI) built on BubbleTea, and a modern web dashboard built on Next.js.

**What Sniff is not:** It is not a general-purpose proxy, a VPN, or a network scanner. It is specifically designed for targeted app-level HTTPS interception on rooted Android devices during authorized security testing.

---

## Why Sniff exists

Intercepting HTTPS traffic from a modern Android app requires coordinating multiple tools:

1. **ADB** to manage the device, push configs, set proxy, control SELinux
2. **mitmproxy/mitmdump** to terminate TLS and capture decrypted traffic
3. **Frida** to bypass SSL pinning at runtime so the app trusts the proxy certificate
4. **Manual effort** to figure out which Frida script works for which app, handle timing (ART JIT warmup), manage proxy routing for apps that ignore system proxy settings, and deal with framework-specific quirks (Flutter ignoring system proxy, React Native's custom TLS stack, Cronet in LinkedIn, etc.)

Each of these tools works independently and has its own configuration surface. The typical workflow involves 10+ manual steps in 3-4 terminal windows, and a single mistake (wrong timing, wrong script, proxy not reachable) means starting over.

Sniff exists to collapse this into: **select app, select script, press start.**

The app-specific capture modes go further — they encode hard-won knowledge about specific apps' defenses (Cronet transport, APEX cert namespaces, iptables-based proxy redirect for Flutter, signup handoff flows) into reproducible, one-click sequences.

---

## How it works

### The capture pipeline

```
┌─────────────────────────────────────────────────────────┐
│                    Sniff (Go binary)                    │
│                                                         │
│  1. adb shell setenforce 0          (SELinux off)       │
│  2. adb shell am force-stop $pkg    (kill stale app)    │
│  3. adb shell su -c './fs-helper'   (start Frida)       │
│  4. mitmdump -p 8080 -s addon.py   (start proxy)       │
│  5. adb shell settings put proxy    (route traffic)     │
│  6. adb shell monkey -p $pkg ...    (launch app)        │
│  7. sleep $attach_delay             (wait for ART JIT)  │
│  8. frida -U -p $pid -l script.js  (inject bypass)     │
│  9. tail /tmp/sniff_flows.jsonl     (stream flows)      │
│                                                         │
│  On stop:                                               │
│  - Clear proxy, detach Frida, restore SELinux           │
└─────────────────────────────────────────────────────────┘
```

### Data flow

```
Android App
    │ HTTPS request
    ▼
System Proxy (set via ADB)
    │
    ▼
mitmdump (on host, port 8080)
    │ Terminates TLS (app trusts proxy CA because Frida
    │ bypassed certificate pinning at runtime)
    │
    ├──▶ /tmp/sniff_flows.jsonl  (one JSON line per flow)
    │
    ▼
Sniff (Go process)
    │ Tails JSONL file, parses flows
    │
    ├──▶ TUI view (BubbleTea)     ← direct rendering
    └──▶ Web API + SSE            ← real-time streaming to browser
              │
              ▼
         Next.js Dashboard        ← flow table, detail panel,
                                     HAR export, deep search
```

### Frida injection

The SSL bypass works by injecting JavaScript into the app's Dalvik/ART runtime (or native process for Flutter) at runtime:

- **Java-level hooks** (most apps): Replaces `TrustManager.checkServerTrusted()`, `OkHttp CertificatePinner.check()`, `HostnameVerifier.verify()`, etc. with no-op implementations that accept any certificate.
- **Native hooks** (Flutter/Dart): Patches `ssl_crypto_x509_session_verify_cert_chain` in `libflutter.so` to always return success.
- **Proxy redirect** (apps ignoring system proxy): Hooks `ProxySelector` to return the host proxy, or uses `iptables REDIRECT` for apps like Flutter that make native socket calls.

---

## Architecture

```
sniff-tui/
├── main.go              # 3,600 lines — TUI, capture sequences, ADB, Frida, mitmdump
├── web.go               # 900 lines — HTTP API server, SSE streaming, REST handlers
├── web_embed.go         # Embeds built Svelte frontend into binary (legacy)
├── go.mod               # Dependencies: BubbleTea ecosystem + Go stdlib
├── frida_scripts/       # 16 built-in .js bypass scripts
│   ├── custom/          # User-created scripts (with // META: headers)
│   └── *.js             # Built-in scripts
├── site/                # Next.js 16 web dashboard (new)
│   ├── src/app/         # App Router pages (landing, dashboard/*)
│   ├── src/components/  # React components (Sidebar, Terminal, FlowTable, etc.)
│   └── src/lib/         # API client, state management, filters, types
├── frontend/            # Legacy Svelte frontend (embedded in binary)
├── web/                 # Built Svelte static files (embedded)
├── dev                  # Development script (Go backend + Next.js dev server)
├── build-sniff-tui      # Production build script
└── sniff-tui            # Compiled binary (~10MB)
```

### Go backend (`main.go` + `web.go`)

Single Go binary, zero external dependencies beyond the Go stdlib and BubbleTea for terminal rendering. Manages all subprocesses (Frida, mitmdump, ADB) directly via `os/exec`.

**Key subsystems:**
- `fridaManager` — Frida process lifecycle (attach/spawn/detach with signal handling)
- `mitmdumpManager` — mitmdump process lifecycle with embedded Python addon
- `stateBroker` — Thread-safe event hub for SSE subscribers
- `captureSequence*()` — 8 orchestrated capture workflows
- `tailJSONL()` — Polls `/tmp/sniff_flows.jsonl` at 300ms intervals for new flows

### Next.js frontend (`site/`)

- **Next.js 16** with App Router, React 19, TypeScript, Tailwind CSS 4
- **Static export** (`output: "export"`) — no server-side rendering needed
- **SSE** for real-time updates (connects directly to Go backend on :9090)
- **React Context** for global state (flows, logs, capture status, connection status)
- **Client-side HAR generation** — no backend dependency for exports

---

## Prerequisites

| Requirement | Version | Purpose |
|------------|---------|---------|
| **Go** | 1.21+ | Build the backend |
| **Bun** | 1.0+ | Build the frontend |
| **ADB** | Any | Android device communication |
| **Frida** | 16+ | Runtime instrumentation |
| **frida-server** | Matching Frida version | Runs on device (arm64) |
| **mitmproxy** | 10+ | HTTPS proxy (`mitmdump` binary) |
| **Rooted Android device** | Android 7+ | Target device |
| **mitmproxy CA certificate** | Installed as system CA | Device trusts proxy |

### Device setup

1. Root the device (Magisk recommended)
2. Push `frida-server` to `/data/local/tmp/fs-helper-64`
3. Install mitmproxy's CA certificate as a system certificate
4. Connect device via USB and verify `adb devices` shows it

---

## Installation

### Development

```bash
# Clone the repository
git clone https://github.com/x-lock/sniff-tui.git
cd sniff-tui

# Install frontend dependencies
cd site && bun install && cd ..

# Run in development mode (Go backend on :9090, Next.js on :3000)
./dev
```

### Production build

```bash
# Build the frontend + Go binary
./build-sniff-tui

# Run the binary
./sniff-tui --web        # Web UI mode (serves on :9090)
./sniff-tui              # TUI mode (terminal interface)
./sniff-tui com.example  # TUI mode with target package preset
```

---

## Usage

### TUI mode

Launch with `./sniff-tui` for a full terminal interface:

| Key | Action |
|-----|--------|
| `c` | Start standard capture |
| `m` | Start MITM-only capture (no Frida) |
| `n` | App-specific capture modes |
| `s` | Settings |
| `f` | Frida script selection |
| `d` | Device info & management |
| `a` | Browse installed apps |
| `p` | Running processes |
| `l` | Full log viewer |
| `e` | Export captured flows |
| `q` | Quit |

During capture:
| Key | Action |
|-----|--------|
| `t` / `T` | Cycle resource type filter |
| `f` | Toggle text filter |
| `x` | Clear flows |
| `e` | Export to file |
| `i` | Open HAR inspector |
| `r` | Restart target activity |
| `Tab` | Toggle focus between flows and logs |
| `y` | Copy logs to clipboard |
| `Enter` | View flow detail |
| `Esc` | Back |

### Web UI mode

Launch with `./sniff-tui --web` or `./dev` (development).

**Dashboard pages:**

| Page | Path | Purpose |
|------|------|---------|
| Overview | `/dashboard` | Stats cards + quick action menu |
| Capture | `/dashboard/capture` | Live flow table, resource filters, detail panel |
| App Modes | `/dashboard/modes` | App-specific capture presets |
| HAR Inspector | `/dashboard/har` | Load, search, and analyze HAR files |
| Device | `/dashboard/device` | Device info, Frida/proxy management |
| Apps | `/dashboard/apps` | Browse and select target app |
| Scripts | `/dashboard/scripts` | Manage Frida bypass scripts |
| Settings | `/dashboard/settings` | Configure all settings |

The **terminal panel** at the bottom of every dashboard page shows real-time Frida output and backend logs. It's resizable, filterable, and shows connection status.

---

## API Reference

The Go backend exposes a REST API on the configured web port (default `:9090`). All endpoints are prefixed with `/api/`.

### State & Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/state` | Current state: capturing status, mode, flow/log counts, settings |
| `GET` | `/api/events` | **SSE stream** — real-time events for flows, logs, state changes, clears |

**SSE event types:**

| Event | Data | When |
|-------|------|------|
| `state` | `{ capturing, captureMode, captureName }` | Capture started/stopped |
| `flow` | Full flow object | New HTTP flow captured |
| `log` | `{ Time, Msg, Style }` | Backend log entry |
| `clear` | `{}` | Flows cleared |

### Capture Control

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `POST` | `/api/capture/start` | `{ mode, package }` | Start capture. Mode: `"standard"`, `"mitm_only"`, `"signup_handoff"`, `"linkedin_cronet"`, `"linkedin_replay"`, `"dailypay"`, `"speedway"`, `"papajohns"`. Returns 409 if already capturing. |
| `POST` | `/api/capture/stop` | `{}` | Stop active capture (clears proxy, detaches Frida, restores SELinux) |
| `POST` | `/api/capture/clear` | `{}` | Clear captured flows |

### Flows

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/flows` | All captured flows as JSON array |
| `GET` | `/api/flows?id=N` | Single flow by index |

**Flow object:**

```json
{
  "ts": 1711584000.123,
  "method": "POST",
  "url": "https://api.example.com/v1/auth",
  "host": "api.example.com",
  "path": "/v1/auth",
  "status": 200,
  "req_size": 256,
  "resp_size": 1024,
  "content_type": "application/json",
  "req_headers": { "Authorization": "Bearer ...", "Content-Type": "application/json" },
  "resp_headers": { "Content-Type": "application/json", "Set-Cookie": "..." },
  "req_body": "{\"username\":\"...\"}",
  "resp_body": "{\"token\":\"...\"}"
}
```

Bodies are truncated to 5,000 characters.

### Device Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/device` | Device info: model, Android version, SDK, SELinux, Frida status, proxy, host IP |
| `POST` | `/api/device/frida/start` | Start Frida server on device (`su -c ./fs-helper-64`) |
| `POST` | `/api/device/proxy/clear` | Clear system proxy setting |

### Apps

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/apps` | List installed apps (tries `frida-ps -Uai`, falls back to `pm list packages -3`) |

### Scripts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/scripts` | All scripts (built-in + custom) with ID, name, label, description |
| `GET` | `/api/scripts/content?id=X` | Full source code of a script |
| `POST` | `/api/scripts/custom` | Create custom script: `{ name, content, label, desc }` |
| `PUT` | `/api/scripts/custom` | Update script: `{ id, name, content, label, desc }` |
| `DELETE` | `/api/scripts/custom?id=X` | Delete custom script |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings` | All settings as key-value array |
| `PUT` | `/api/settings` | Update setting: `{ key, value }` |

### Export

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `POST` | `/api/export` | `{ format }` | Export flows (`"json"` or `"har"`) — saves to captures directory |

---

## Frida Scripts

### Built-in scripts

| ID | Name | Label | Target |
|----|------|-------|--------|
| `universal` | Universal SSL Unpin | BEST | TrustManager, OkHttp, Conscrypt, ProxySelector, HostnameVerifier, WebView, TrustKit, Netty — works for ~90% of apps |
| `trustmanager` | TrustManager Only | LIGHTWEIGHT | Android platform TLS only — lowest crash risk |
| `okhttp` | OkHttp Pinner + Proxy | OKHTTP APPS | OkHttp CertificatePinner + ProxySelector — no platform hooks |
| `proxy_only` | Proxy Redirect Only | DIAGNOSTIC | Forces traffic through proxy without any SSL bypass |
| `webview` | WebView + HttpsURLConnection | HYBRID APPS | WebViewClient.onReceivedSslError + HttpsURLConnection — Cordova/Ionic/Capacitor |
| `react_native` | React Native | RN APPS | OkHttpClientProvider, TrustKit, NetworkingModule, rn-fetch-blob |
| `flutter` | Flutter / Dart | FLUTTER | Native BoringSSL hooks in libflutter.so (requires iptables redirect) |
| `pilot_fj` | Pilot Flying J | APP-SPECIFIC | ProxySelector hook targeting bE1 class + universal SSL unpin |
| `pilot_fj_signup_handoff` | Pilot Signup Handoff | HANDOFF | Proxy toggle via config file on PingOne callback |
| `linkedin_cronet` | LinkedIn Cronet Patch | LINKEDIN | Disables QUIC, warmup, DNS remap in Cronet transport |
| `linkedin_challenge_trace` | LinkedIn Challenge Trace | LI-REPLAY | Auth flow tracing without MITM |
| `dailypay` | DailyPay SSL Bypass | DAILYPAY | Universal SSL + APEX conscrypt cert injection via nsenter |
| `speedway` | Speedway SSL Bypass | SPEEDWAY | OkHttp3 + Distil ABP stub + DataTheorem bypass |
| `papajohns` | Papa Johns Flutter Bypass | PAPAJOHNS | BoringSSL native + Dart proxy + Akamai BMP neutralization |

### Custom scripts

Custom scripts are stored in `frida_scripts/custom/` with a `// META:` header line:

```javascript
// META: {"label":"CUSTOM","desc":"My bypass script"}
Java.perform(function() {
  // Your hooks here
});
```

Create, upload (.js files), edit, and delete custom scripts from the web UI or via the API.

---

## Capture Modes

### Standard
The default mode. Covers most apps. Full pipeline: Frida + mitmproxy + system proxy.

### MITM Only
Skips Frida entirely. For apps where the CA is already trusted (system CA installed, no custom pinning) and you just need traffic visibility.

### Signup Handoff (Pilot Flying J)
Specialized for apps that use external browser-based auth (PingOne/DaVinci). Lets the signup flow run direct (no proxy interference), detects the callback return to the app, then enables proxy for post-auth API traffic.

### LinkedIn Cronet
Spawns the app (rather than attaching) with a script that disables Cronet's QUIC transport and DNS optimizations that bypass the system proxy. Required because LinkedIn uses Chromium's networking stack directly.

### LinkedIn Replay
Same as Cronet mode but adds a second script for auth challenge tracing. Uses `SpawnMultiScript` to concatenate both scripts.

### DailyPay
Standard bypass plus APEX certificate injection. DailyPay runs conscrypt in an isolated APEX mount namespace — this mode uses `nsenter` to inject the mitmproxy CA into that namespace so both Java and native WebView trust it.

### Speedway
Extended timing mode. Adds an extra 10-second ART settling period and late-attach strategy to handle Speedway's aggressive initialization. Also stubs Distil/Imperva bot protection and DataTheorem mobile SDK.

### Papa Johns (Flutter)
Uses `iptables REDIRECT` instead of system proxy (Flutter ignores system proxy). Routes all app traffic through `tproxy-connect` to the mitmproxy port. Combines BoringSSL native hooks with Java TrustManager fallback.

---

## Frontend (Web UI)

### Tech stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.2.1 | App Router, static export |
| React | 19.2.4 | UI rendering |
| TypeScript | 5 | Type safety |
| Tailwind CSS | 4 | Styling (CSS-based config) |
| Lucide React | - | Icons |
| Framer Motion | - | Landing page animations |

### Design system

Dark theme with dual-brand colors:

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#050505` | Page background |
| Card | `#0c0c0e` | Card surfaces |
| Border | `#1e1e22` | Default borders |
| Foreground | `#f5f5f5` | Primary text |
| Brand | `#a855f7` (purple) | x-lock chrome (logo, navbar) |
| Accent | `#3b6ff6` (blue) | Product UI (buttons, active states) |
| Good | `#22c55e` | Success/active |
| Warn | `#eab308` | Warnings |
| Bad | `#ef4444` | Errors/stop |

Fonts: Inter (sans-serif), JetBrains Mono (monospace).

### Real-time architecture

The frontend connects to the Go backend via SSE (`/api/events`) for real-time streaming. In development, SSE connects directly to `:9090` to bypass Next.js proxy buffering. The `AppProvider` component manages the SSE lifecycle with auto-reconnect (3-second retry).

State flows through React Context (`useAppState`):
```
SSE events → AppProvider → AppState Context → Dashboard pages
```

### Key features

- **Live flow table** with sortable columns, resource type pills, text search
- **Detail panel** with tabbed view (headers, query params, request body, response body)
- **JSON syntax highlighting** for API responses
- **HAR inspector** with drag-drop loading, deep full-text search with highlighting, recent capture history (localStorage)
- **Terminal panel** on every page — resizable, filterable, shows Frida output and backend logs
- **Script editor** with in-browser code editing for all scripts (built-in and custom)
- **Connection status indicator** in terminal (WiFi icon, auto-reconnect notification)

---

## Configuration

Settings are stored in `settings.json` and editable via the TUI (`s` key) or web UI (`/dashboard/settings`).

| Key | Default | Description |
|-----|---------|-------------|
| `package` | `""` | Target Android package name |
| `port` | `8080` | mitmproxy listen port |
| `attach_delay` | `10` | Seconds to wait for ART JIT before Frida attach |
| `ignore_hosts` | PerimeterX, PerfDrive regex | Hosts to pass through without interception |
| `frida_script_id` | `"universal"` | Active Frida script ID |
| `captures_dir` | `~/coding/ios-re/captures` | Directory for exported captures |
| `frida_server` | `/data/local/tmp/fs-helper-64` | Path to frida-server binary on device |
| `host_ip` | Auto-detect (en0) | Host machine IP for device proxy configuration |
| `export_format` | `"json"` | Default export format (`"json"` or `"har"`) |
| `ui_mode` | `"tui"` | UI mode (`"tui"` or `"web"`) |
| `web_port` | `9090` | Web UI port |

---

## What's next

### Short-term

- **Authentication** — The web UI currently has no auth. Add token-based authentication so Sniff can be safely exposed beyond localhost.
- **WebSocket upgrade** — Replace SSE with WebSocket for bidirectional communication (e.g., sending commands from the browser to Frida scripts).
- **Flow persistence** — Currently flows live in memory and are lost on restart. Add optional SQLite or file-based persistence.
- **Response body size limit** — Make the 5,000 character body truncation configurable, or stream large bodies on demand.
- **Certificate management** — Automate the mitmproxy CA installation as a system certificate (currently manual).
- **Multi-device support** — Allow selecting between multiple connected ADB devices.

### Medium-term

- **Replay & modify** — Intercept and modify requests before they reach the server (mitmproxy supports this, but Sniff doesn't expose it yet).
- **Diff view** — Compare two captures side by side to see what changed between sessions.
- **Breakpoints** — Pause on matching requests for manual inspection/modification.
- **Scope rules** — Include/exclude patterns for which hosts to capture (beyond `ignore_hosts`).
- **Script marketplace** — Community-contributed bypass scripts with ratings and app compatibility tags.
- **iOS support** — Extend to jailbroken iOS devices (Frida supports iOS, but the ADB/proxy automation is Android-specific).

### Long-term

- **Cloud dashboard** — Remote device management and capture viewing via x-lock.cloud.
- **Team collaboration** — Share captures, scripts, and device profiles across a team.
- **Automated bypass discovery** — Given an APK, automatically identify which SSL pinning implementation is used and select the right script.
- **CI integration** — Run captures as part of security testing pipelines.

---

## Open source roadmap

Sniff is currently a personal tool with production-quality code but no open-source infrastructure. Here's what's needed to ship it as a reliable open-source project.

### 1. Repository hygiene

**Immediate:**
- [ ] Remove hardcoded paths (`~/coding/ios-re/captures`, `172.16.1.129:8080` in pilot_fj.js)
- [ ] Remove app-specific scripts that reference internal infrastructure (or generalize them)
- [ ] Add `.gitignore` covering: `sniff-tui` (binary), `web/` (built frontend), `node_modules/`, `.next/`, `settings.json`, `frida_scripts/custom/`
- [ ] Add a proper `README.md` (condensed version of this document)
- [ ] Add `LICENSE` file (recommend MIT or Apache-2.0 for maximum adoption)
- [ ] Audit for secrets, API keys, or internal hostnames in script files

### 2. Build & distribution

**Build system:**
- [ ] `Makefile` or `Taskfile` with targets: `build`, `dev`, `test`, `lint`, `release`
- [ ] CI pipeline (GitHub Actions): build Go binary + frontend on push, run lints
- [ ] Cross-compilation for Linux arm64 (common for self-hosted on Android device itself)
- [ ] Release automation: goreleaser or manual GitHub Releases with pre-built binaries
- [ ] Docker image for the web UI mode (Go binary + static frontend, no Node.js runtime needed)

**Frontend build integration:**
- [ ] Currently two frontends exist (Svelte in `frontend/` and Next.js in `site/`). Decide which to ship:
  - **Option A**: Ship Next.js as the primary web UI, embed the static export in the Go binary (replace `web/` contents)
  - **Option B**: Keep both — Svelte for the embedded lightweight UI, Next.js as the standalone dashboard
- [ ] Update `build-sniff-tui` to build the chosen frontend
- [ ] The `web_embed.go` currently embeds from `web/` — update the embed path if switching to Next.js

### 3. Code quality

**Go backend:**
- [ ] Split `main.go` (3,600 lines) into packages: `cmd/`, `internal/adb/`, `internal/frida/`, `internal/capture/`, `internal/tui/`
- [ ] Add Go tests for critical paths: flow parsing, settings load/save, capture state machine
- [ ] Add `go vet` and `staticcheck` to CI
- [ ] Document exported types and functions
- [ ] Replace hardcoded sleep durations with configurable timeouts

**Frontend:**
- [ ] Add ESLint + Prettier config (currently has ESLint but minimal rules)
- [ ] Add basic component tests (Vitest + Testing Library)
- [ ] Add E2E smoke test (Playwright) — at minimum: landing page loads, dashboard loads with mock API

### 4. Configuration & portability

- [ ] Default `captures_dir` to `./captures/` (relative to binary) instead of hardcoded absolute path
- [ ] Default `host_ip` to auto-detect on all platforms (currently assumes macOS `en0`)
- [ ] Support `SNIFF_CONFIG` env var for custom settings path
- [ ] Support `--port`, `--config`, `--captures-dir` CLI flags
- [ ] XDG-compliant config location on Linux (`~/.config/sniff-tui/`)
- [ ] Windows compatibility: replace `su -c` with configurable root command, handle path separators

### 5. Documentation

- [ ] `README.md` — Quick start, screenshots, feature overview
- [ ] `docs/setup.md` — Full device setup guide (rooting, Frida server, CA cert, common issues)
- [ ] `docs/scripts.md` — How to write custom Frida scripts, META format, testing workflow
- [ ] `docs/api.md` — API reference (extract from this document)
- [ ] `docs/architecture.md` — System design for contributors
- [ ] `CONTRIBUTING.md` — How to contribute, code style, PR process
- [ ] `SECURITY.md` — Responsible use policy, scope of the tool, reporting vulnerabilities
- [ ] In-app help (already partially exists in TUI via `?` key)

### 6. Security & legal

- [ ] Add prominent disclaimer: "For authorized security testing only"
- [ ] Add `SECURITY.md` with responsible disclosure policy
- [ ] Rate-limit or auth-gate the web API (currently wide open on the network)
- [ ] Add CORS headers to the API (currently accepts all origins)
- [ ] Ensure no credentials or tokens are logged in SSE output
- [ ] Consider HTTPS for the web UI (self-signed cert generation)

### 7. Community infrastructure

- [ ] GitHub Issues templates (bug report, feature request, script request)
- [ ] GitHub Discussions for Q&A
- [ ] `CHANGELOG.md` with versioned releases
- [ ] Semantic versioning starting from `v1.0.0`
- [ ] GitHub Actions for automated releases on tag push
- [ ] Badge in README: build status, license, latest release

### 8. Migration checklist (to ship v1.0.0)

```
1. Fork/move repo to github.com/x-lock/sniff
2. Clean up hardcoded paths and app-specific configs
3. Choose and finalize the frontend (Next.js recommended)
4. Split main.go into packages
5. Add .gitignore, LICENSE, README.md, CONTRIBUTING.md
6. Set up CI (build + lint on push)
7. Create first tagged release with pre-built binaries
8. Write setup documentation with screenshots
9. Announce on relevant security/RE communities
```

---

## Summary

Sniff is ~4,500 lines of Go and a full Next.js dashboard that automates Android HTTPS interception end-to-end. It exists because the manual workflow of coordinating ADB + mitmproxy + Frida is tedious, error-prone, and requires deep knowledge of each app's specific defenses. The 14 built-in Frida scripts encode months of reverse engineering into one-click capture modes.

To go from a personal tool to a reliable open-source project, the main work is: clean up hardcoded paths, split the monolithic `main.go`, choose one frontend, add CI/CD, write docs, and ship tagged releases with binaries. The core functionality is solid — the gap is entirely in packaging and developer experience.

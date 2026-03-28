# sniff!

Open source Android HTTPS interception and network traffic analysis tool by [x-lock](https://x-lock.cloud).

## Overview

sniff! captures, decrypts, and inspects HTTPS traffic from Android applications in real time. It combines mitmproxy for traffic interception with Frida for runtime SSL pinning bypass, controlled through a web dashboard.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Hosted Site (site/)          sniff.sh           │
│  Next.js static export        nginx / CDN       │
└──────────────────────┬──────────────────────────┘
                       │ browser connects to localhost
┌──────────────────────▼──────────────────────────┐
│  Local Backend (Go)           :9090              │
│  REST API + SSE streaming                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ mitmproxy│  │  Frida   │  │   ADB        │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
└──────────────────────┬──────────────────────────┘
                       │ USB / TCP
┌──────────────────────▼──────────────────────────┐
│  Android Device                                  │
│  Target application with SSL pinning             │
└─────────────────────────────────────────────────┘
```

**Local backend** (Go) — runs on the user's machine, manages ADB, mitmproxy, and Frida processes. Exposes a REST API on `:9090` with SSE for real-time flow and log streaming.

**Hosted site** (Next.js) — static export deployed to a domain. Connects to the local backend via the browser. No server-side logic; all communication is client-to-localhost.

**Svelte TUI** (legacy) — original embedded frontend in `frontend/`, compiled into the Go binary via `web_embed.go`.

## Prerequisites

- Go 1.25+
- Bun
- Android device with USB debugging enabled
- mitmproxy (`mitmdump`)
- Frida (`frida-server` on device)
- ADB

## Quick Start

```bash
# Build
make build

# Run (opens browser automatically)
./sniff

# Or run in dev mode (Go backend + Next.js site with hot reload)
make dev
```

## Project Structure

```
sniff-tui/
├── main.go              # Go application entry point
├── web.go               # Web server, API handlers, SSE
├── web_embed.go         # Embeds Svelte frontend into binary
├── frontend/            # Svelte TUI frontend (builds to web/)
├── site/                # Next.js hosted dashboard + marketing site
│   ├── src/app/         # Pages: landing, connect, dashboard, docs
│   ├── src/components/  # React components
│   └── src/lib/         # API client, state, types, connection config
├── web/                 # Built Svelte output (embedded in binary)
├── Makefile             # Build targets
└── .github/workflows/   # CI/CD: site deploy + binary releases
```

## API

All endpoints are prefixed with `/api/` on the local backend (default `http://localhost:9090`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/state` | Current capture state and settings |
| GET | `/api/flows` | All captured flows |
| GET | `/api/events` | SSE stream (flow, log, state, clear events) |
| GET | `/api/device` | Device info and connection status |
| GET | `/api/apps` | Installed applications |
| GET | `/api/scripts` | Available Frida scripts |
| POST | `/api/capture/start` | Start capture session |
| POST | `/api/capture/stop` | Stop capture session |
| POST | `/api/capture/clear` | Clear captured flows |
| POST | `/api/export` | Export flows to file |
| PUT | `/api/settings` | Update settings |

## Deployment

The **site** is deployed automatically via GitHub Actions on push to `main` (changes in `site/`). It builds a Docker image and deploys to a VPS.

**Binary releases** are created automatically when a version tag is pushed (`v*`). Builds are produced for linux/darwin on amd64/arm64.

```bash
# Tag a release
git tag v1.0.0
git push origin v1.0.0
```

## Environment

See [.env.example](.env.example) for available configuration.

## License

MIT

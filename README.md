# sniff! 🏎️

**sniff!** is a professional-grade, full-stack network analysis and reverse engineering suite. Engineered for precision and modularity, it automates the full capture pipeline—hardware orchestration, SSL pinning bypass, real-time flow inspection, and deep cryptographic analysis.

Developed with pride by [x-lock](https://x-lock.cloud).

---

## 🏗️ Architecture

sniff! follows a **Modular Adapter Architecture**, decoupling the capture engine from platform-specific hardware.

*   **The Engine:** A thread-safe Go orchestrator that manages multiple platform adapters (Android, iOS, Desktop).
*   **The Intelligence:** Automated OpenAPI generation, cryptographic signature reversal, and AI-powered context.
*   **The Transmission:** A robust REST API with real-time SSE streaming.
*   **The Cabin:** A high-end Next.js web dashboard designed for an IDE-like research experience.

---

## 🚀 Quick Start

Ensure you have **Go 1.25+**, **mitmproxy**, and **Frida** installed on your host machine.

```bash
# Build the unified binary
make build

# Launch (automatically opens the dashboard)
./sniff --debug
```

### Development Mode
```bash
# Start backend and frontend with hot reload
make dev
```

---

## 🛠️ Project Structure

```
sniff/
├── cmd/sniff/           # The Ignition: Application entry point
├── internal/            # The Drivetrain: Core backend modules
│   ├── adb/             # Android device communication
│   ├── capture/         # Multi-platform capture engine
│   ├── analysis/        # Cryptographic & schema intelligence
│   ├── api/             # REST & SSE transmission
│   └── decompile/       # JADX background management
├── pkg/                 # Universal libraries (HAR, etc.)
├── site/                # The Cabin: Next.js Dashboard
├── legacy/              # Archived monolithic artifacts
└── Makefile             # Build & Test automation
```

---

## 🤝 Contributing

We maintain strict engineering standards to ensure **Absolute Elegance** in our codebase. No global state, no raw shell calls in the engine, and mandatory smoke tests for all new modules.

See [CONTRIBUTING.md](CONTRIBUTING.md) for our full technical standards and contribution path.

---

## ❤️ Support & Partnerships

We are looking for partners and creators who share our vision for professionalizing the reverse engineering space. We offer Pro-tier access, custom branding, and white-label integration models.

See [SUPPORT.md](SUPPORT.md) for our vision and partnership details.

---

*"Precision in every packet. Elegance in every line."*

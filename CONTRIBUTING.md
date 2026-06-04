# Engineering sniff! 🏎️

Welcome to **sniff!**. We are building a high-performance, modular, and full-stack analysis suite. Our goal is to set a new standard for precision and elegance in the reverse engineering space. 

This guide is for developers who want to contribute to the drivetrain, the transmission, or the cabin.

---

## 🏗️ The Architecture (The Drivetrain)

We follow a **Modular Adapter Architecture**. Logic is separated into domain-specific packages within `internal/`.

- `cmd/sniff/`: The ignition. Entry point for the CLI and Web Server.
- `internal/capture/`: The Engine. Orchestrates the capture lifecycle across different platforms (Android, Desktop, etc.).
- `internal/api/`: The Transmission. Delivers real-time data from the engine to the dashboard via REST and SSE.
- `internal/analysis/`: The Intelligence. Performs cryptographic signature detection, schema inference, and OpenAPI generation.
- `internal/decompile/`: The Eyes. Manages JADX background processes and source code navigation.
- `site/`: The Cabin. A Next.js dashboard for the ultimate user experience.

---

## 🛠️ Code Standards (The Finish)

To avoid "AI slop" and maintain unity, every line of code must follow these principles:

### 1. Unified Logging
Never use `fmt.Println` or `log.Printf`. Always use the `internal/logger` package, which wraps `log/slog` for structured, filterable logs.
```go
logger.Info("Starting capture", "adapter", "android", "pkg", pkgName)
```

### 2. Defensive Interfaces
If you are adding a new platform (e.g., iOS), do not hack it into the main engine. Implement the `CaptureAdapter` interface in `internal/capture/adapter.go`.
```go
type CaptureAdapter interface {
    Setup(ctx context.Context) error
    Start(ctx context.Context, target string, scriptID string) error
    Stop(ctx context.Context) error
}
```

### 3. Error Handling
Errors must be wrapped with context. Use `%w` to maintain the error chain.
```go
if err := a.adb.SetProxy(ctx, host, port); err != nil {
    return fmt.Errorf("failed to configure device proxy: %w", err)
}
```

### 4. Zero Global State
No global variables. All state must live within a struct (e.g., `Manager`, `Engine`, `Server`). Use `New...()` constructors to initialize components with their dependencies.

---

## 🚀 Getting Started

1.  **Clone & Build:**
    ```bash
    make build
    ```
2.  **Run with Debug:**
    ```bash
    ./sniff --debug
    ```
3.  **Explore the API:** Check `internal/api/server.go` for the REST routes. All routes are protected by JWT unless explicitly placed in the public mux.

## 🤝 Contribution Path

1.  **Pick a Phase:** Look at `REFACTOR.md` to see what is currently under construction.
2.  **Write a Test:** If you're building a new analysis feature, add a smoke test in a `_test.go` file. We value **Verified Logic** over "just-in-case" code.
3.  **Respect the Drivetrain:** Ensure your changes don't break the modularity. The Engine should remain platform-agnostic.

---

*"Precision in every packet. Elegance in every line."*

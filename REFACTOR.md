# Sniff! Revamp Plan

This document outlines the roadmap for transitioning `sniff` from an AI-generated monolithic codebase to a professional, modular, and maintainable software architecture.

## Core Objectives

1.  **Modularity:** Break down `main.go` and `web.go` into domain-specific packages.
2.  **Safety & Security:** Eliminate global state, implement proper error handling, and add Auth for the Web API.
3.  **Portability:** Remove hardcoded paths and ensure cross-platform compatibility (macOS/Linux).
4.  **Stability:** Implement a robust lifecycle manager (Engine) to ensure clean shutdowns and state consistency.
5.  **Engineering Standards:** Move to structured logging (`slog`), typed configurations, and [x] comprehensive testing (Smoke tests verified).
6.  **AI Augmentation:** Provide optional, modular AI-powered insights for traffic analysis and code comprehension.

## Phase 1: Infrastructure & Configuration (Current)
- [x] Initialize directory structure (`cmd/`, `internal/`, `pkg/`).
- [x] Implement `internal/config`:
    - Move `settings` struct to a dedicated package.
    - Implement OS-compliant path discovery (XDG, UserConfigDir).
    - Add validation for settings.
- [x] Implement `internal/logger`: Structured logging wrapper.

## Phase 2: Core Domain Decoupling (Current)
- [x] Implement `internal/adb`:
    - Clean up raw string parsing.
    - Concurrent device info fetching.
    - Improved error handling for common ADB failures.
- [x] Implement `internal/frida`:
    - Lifecycle management for `frida-server` and scripts.
    - Script registry with metadata validation.
- [x] Implement `internal/proxy`:
    - `mitmdump` process management.
    - Flow parsing and stream handling.

## Phase 3: The Engine (Orchestration) (Current)
- [x] Implement `internal/capture`:
    - [x] The "Brain" that coordinates ADB, Frida, and Proxy.
    - [x] Clean `Start()` and `Stop()` methods.
    - [x] State machine for capture lifecycle.
    - [x] **Modular Adapter System:** Support for multiple platforms (Android, iOS, Desktop).
    - [x] **TLS Fingerprinting:** Ported `tcpdump`+`tshark` logic for JA3/JA4 detection.

## Phase 4: Web API & Dashboard (Primary Focus) (Current)
- [x] Implement `internal/api`:
    - [x] Clean REST handlers for all engine controls.
    - [x] JWT-based Authentication for secure remote access.
    - [x] SSE (Server-Sent Events) streaming for real-time flow and log delivery.
    - [x] Integration with the `internal/capture` engine.
- [x] Refactor `cmd/sniff`:
    - [x] Modern CLI flag parsing (defaulting to `--web`).
    - [x] Graceful shutdown handling (ensuring cleanup on CTRL+C).
- [x] Implement `internal/proxy` Expansion:
    - [x] Support for system-wide Desktop proxying (macOS/Windows).
    - [ ] Browser-specific capture modes (Chrome/Firefox automation).
    - [ ] WebSocket interception and live modification logic.

## Phase 5: Reverse Engineering Core (Phase E) (Current)
- [x] Implement `internal/decompile`:
    - [x] JADX integration for APK decompilation.
    - [x] Source tree API and content viewer.
- [x] Implement `internal/analysis`:
    - [x] API Schema inference from captured flows.
    - [x] OpenAPI 3.0 export.
    - [x] Header & Signature analysis (entropy, HMAC detection).
    - [x] Deep Source Correlation: Link network signatures to Java/Kotlin logic.
    - [x] Security Audit: Byte-level APK scanning for pinning libraries.
- [x] Implement `internal/retrofit`:
    - [x] Extract API surface from decompiled source annotations.

## Phase 6: Multi-Platform Expansion (Android, iOS, Web, Desktop)
- [ ] Implement `internal/ios`:
    - libimobiledevice / go-ios integration.
    - iOS-specific Frida scripts for SSL unpinning.
- [ ] Implement `internal/desktop`:
    - [x] Windows/macOS/Linux system proxy automation.
    - [ ] Integration with OS-level certificate stores (Keychain/Certmgr).
    - [ ] Desktop app "Focus Mode" (filtering traffic to a specific PID).

## Phase 7: Legacy TUI & Final Cleanup
- [ ] Implement `internal/tui` (Optional/Low Priority):
    - Minimalist TUI for quick headless checks.
- [ ] Remove legacy `main.go` and `web.go`.
- [ ] Comprehensive integration testing.
- [ ] Update documentation and monetization funnel setup.

## Phase 8: AI-Assisted Intelligence (The Navigator) (Current)
- [/] Implement `internal/ai`:
    - [x] Modular provider interface (OpenAI).
    - [x] Traffic Contextualizer: "What is this endpoint likely doing?"
    - [ ] Signature Explainer: "How is this HMAC-SHA256 signature constructed?"
    - [ ] Code Summarizer: AI-powered summaries of decompiled JADX files.
    - [ ] Token Decoder: Smart detection and decoding of obscure JWT/Base64 payloads.

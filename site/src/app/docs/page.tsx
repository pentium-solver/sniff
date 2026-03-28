"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Terminal,
  Smartphone,
  ShieldOff,
  Wifi,
  Download,
  FileCode,
  Settings,
  Layers,
  Cpu,
  ArrowLeft,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import clsx from "clsx";

// ── Table of Contents ──────────────────────────────────────────────────────

interface TocItem {
  id: string;
  label: string;
  children?: { id: string; label: string }[];
}

const toc: TocItem[] = [
  {
    id: "overview",
    label: "Overview",
  },
  {
    id: "prerequisites",
    label: "Prerequisites",
  },
  {
    id: "installation",
    label: "Installation",
    children: [
      { id: "dev-setup", label: "Development" },
      { id: "production-build", label: "Production Build" },
    ],
  },
  {
    id: "usage",
    label: "Usage",
    children: [
      { id: "web-ui", label: "Web UI" },
      { id: "tui-mode", label: "TUI Mode" },
      { id: "capture-workflow", label: "Capture Workflow" },
    ],
  },
  {
    id: "capture-modes",
    label: "Capture Modes",
  },
  {
    id: "frida-scripts",
    label: "Frida Scripts",
    children: [
      { id: "built-in-scripts", label: "Built-in Scripts" },
      { id: "custom-scripts", label: "Custom Scripts" },
    ],
  },
  {
    id: "api-reference",
    label: "API Reference",
    children: [
      { id: "api-state", label: "State & Events" },
      { id: "api-capture", label: "Capture Control" },
      { id: "api-flows", label: "Flows" },
      { id: "api-device", label: "Device" },
      { id: "api-scripts", label: "Scripts" },
      { id: "api-settings", label: "Settings" },
    ],
  },
  {
    id: "configuration",
    label: "Configuration",
  },
  {
    id: "architecture",
    label: "Architecture",
  },
];

// ── Code Block ─────────────────────────────────────────────────────────────

function Code({ children, lang }: { children: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(children.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative group rounded-xl border border-border bg-[#08080a] overflow-hidden my-4">
      {lang && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-secondary/50">
          <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
            {lang}
          </span>
          <button
            onClick={copy}
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            {copied ? (
              <Check className="h-3 w-3 text-good" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-[12px] leading-[20px] font-mono text-foreground/90">
        <code>{children.trim()}</code>
      </pre>
    </div>
  );
}

// ── Section helpers ────────────────────────────────────────────────────────

function H2({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="text-2xl font-extrabold tracking-tight text-foreground mt-16 mb-4 scroll-mt-24 flex items-center gap-2"
    >
      {children}
    </h2>
  );
}

function H3({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <h3
      id={id}
      className="text-base font-bold text-foreground mt-10 mb-3 scroll-mt-24"
    >
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-text-secondary leading-relaxed mb-3">
      {children}
    </p>
  );
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | React.ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border my-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-secondary/50">
            {headers.map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left text-[11px] font-medium text-text-muted uppercase tracking-wider"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-border last:border-0 hover:bg-bg-secondary/30 transition-colors"
            >
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-text-secondary">
                  {typeof cell === "string" ? (
                    <span
                      className={
                        j === 0
                          ? "font-mono text-foreground text-[12px]"
                          : ""
                      }
                    >
                      {cell}
                    </span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ children, color = "accent" }: { children: string; color?: string }) {
  const colors: Record<string, string> = {
    accent: "bg-accent/15 text-accent border-accent/20",
    good: "bg-good/15 text-good border-good/20",
    warn: "bg-warn/15 text-warn border-warn/20",
    bad: "bg-bad/15 text-bad border-bad/20",
    muted: "bg-bg-tertiary text-text-muted border-border",
  };
  return (
    <span
      className={`inline-block rounded-lg border px-2 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap ${colors[color] || colors.muted}`}
    >
      {children}
    </span>
  );
}

function Inline({ children }: { children: string }) {
  return (
    <code className="text-[12px] font-mono bg-bg-tertiary text-accent-bright rounded px-1.5 py-0.5 border border-border">
      {children}
    </code>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeId, setActiveId] = useState("overview");

  useEffect(() => {
    const ids = toc.flatMap((t) => [
      t.id,
      ...(t.children?.map((c) => c.id) || []),
    ]);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -70% 0px" }
    );

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl flex items-center gap-4 px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-text-secondary hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="font-semibold"><span className="text-foreground">sniff</span><span className="text-accent-bright">!</span></span>
          </Link>
          <span className="text-border">/</span>
          <span className="text-sm font-medium text-foreground">
            Documentation
          </span>
          <div className="flex-1" />
          <Link
            href="/dashboard"
            className="text-[12px] font-medium text-text-secondary hover:text-foreground transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl flex">
        {/* Sidebar TOC */}
        <aside className="hidden lg:block w-56 shrink-0 sticky top-[53px] h-[calc(100vh-53px)] overflow-auto border-r border-border py-8 pl-6 pr-4">
          <nav className="space-y-1">
            {toc.map((item) => (
              <div key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={clsx(
                    "block py-1.5 text-[13px] font-medium transition-colors",
                    activeId === item.id
                      ? "text-accent-bright"
                      : "text-text-secondary hover:text-foreground"
                  )}
                >
                  {item.label}
                </a>
                {item.children && (
                  <div className="ml-3 border-l border-border pl-3 space-y-0.5">
                    {item.children.map((child) => (
                      <a
                        key={child.id}
                        href={`#${child.id}`}
                        className={clsx(
                          "block py-1 text-[12px] transition-colors",
                          activeId === child.id
                            ? "text-accent-bright"
                            : "text-text-muted hover:text-text-secondary"
                        )}
                      >
                        {child.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 px-6 lg:px-12 py-10 pb-32">
          <div className="max-w-3xl">
            {/* Hero */}
            <div className="mb-12">
              <div className="flex items-center gap-2 mb-3">
                <Badge color="accent">v1.0</Badge>
                <span className="text-[11px] text-text-muted">
                  Last updated: March 2025
                </span>
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-foreground mb-3">
                sniff! Documentation
              </h1>
              <p className="text-base text-text-secondary leading-relaxed max-w-2xl">
                Complete reference for setting up, using, and extending sniff! —
                the Android HTTPS traffic interception toolkit by x-lock.
              </p>
            </div>

            {/* ── Overview ────────────────────────────────────────────── */}
            <H2 id="overview">Overview</H2>
            <P>
              sniff! automates the full Android HTTPS interception pipeline —
              ADB device management, mitmproxy setup, and Frida-based SSL
              pinning bypass — from a single interface. Select an app, pick a
              bypass script, and start capturing decrypted traffic in seconds.
            </P>
            <P>
              It provides both a terminal UI (TUI) built on BubbleTea and a
              modern web dashboard built on Next.js. The Go backend orchestrates
              all subprocesses and streams captured flows in real-time via
              Server-Sent Events.
            </P>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 my-6">
              {[
                { icon: Wifi, label: "Traffic Capture" },
                { icon: ShieldOff, label: "SSL Bypass" },
                { icon: FileCode, label: "Frida Scripts" },
                { icon: Smartphone, label: "Device Mgmt" },
                { icon: Download, label: "HAR Export" },
                { icon: Layers, label: "App Modes" },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-2 rounded-lg border border-border bg-bg-secondary/50 px-3 py-2.5"
                >
                  <Icon className="h-4 w-4 text-accent shrink-0" />
                  <span className="text-[12px] font-medium text-foreground">
                    {label}
                  </span>
                </div>
              ))}
            </div>

            {/* ── Prerequisites ───────────────────────────────────────── */}
            <H2 id="prerequisites">Prerequisites</H2>
            <Table
              headers={["Requirement", "Version", "Purpose"]}
              rows={[
                ["Go", "1.21+", "Build the backend"],
                ["Bun", "1.0+", "Build the frontend"],
                ["ADB", "Any", "Android device communication"],
                ["Frida", "16+", "Runtime instrumentation"],
                ["frida-server", "Match Frida version", "Runs on device (arm64)"],
                ["mitmproxy", "10+", "HTTPS proxy (mitmdump)"],
                ["Rooted Android", "Android 7+", "Target device"],
                ["mitmproxy CA", "Installed as system CA", "Device trusts proxy"],
              ]}
            />
            <H3 id="device-setup">Device Setup</H3>
            <P>
              Your Android device needs to be rooted (Magisk recommended) with USB
              debugging enabled. The mitmproxy CA certificate must be installed as a
              system certificate, and frida-server must be pushed to the device.
            </P>
            <Code lang="bash">{`# Push frida-server to device
adb push frida-server-16.x.x-android-arm64 /data/local/tmp/fs-helper-64
adb shell "chmod 755 /data/local/tmp/fs-helper-64"

# Install mitmproxy CA as system cert (requires root)
adb push ~/.mitmproxy/mitmproxy-ca-cert.cer /sdcard/
# Then: Settings > Security > Install from storage`}</Code>

            {/* ── Installation ────────────────────────────────────────── */}
            <H2 id="installation">Installation</H2>
            <H3 id="dev-setup">Development</H3>
            <Code lang="bash">{`git clone https://github.com/x-lock/sniff.git
cd sniff

# Install frontend dependencies
cd site && bun install && cd ..

# Start both backend (:9090) and frontend (:3000)
./dev`}</Code>
            <P>
              The <Inline>dev</Inline> script starts the Go backend on port 9090
              and the Next.js dev server on port 3000, then opens the browser
              automatically.
            </P>

            <H3 id="production-build">Production Build</H3>
            <Code lang="bash">{`# Build frontend + Go binary
./build-sniff!

# Run in web mode
./sniff! --web

# Run in TUI mode
./sniff!

# Run with a preset target package
./sniff! com.example.app`}</Code>

            {/* ── Usage ───────────────────────────────────────────────── */}
            <H2 id="usage">Usage</H2>

            <H3 id="web-ui">Web UI</H3>
            <P>
              Launch with <Inline>./sniff! --web</Inline> or{" "}
              <Inline>./dev</Inline> for development. The dashboard is organized
              into these pages:
            </P>
            <Table
              headers={["Page", "Path", "Description"]}
              rows={[
                ["Overview", "/dashboard", "Stats cards and quick action menu"],
                ["Capture", "/dashboard/capture", "Live flow table, filters, detail panel, terminal"],
                ["App Modes", "/dashboard/modes", "App-specific capture presets"],
                ["HAR Inspector", "/dashboard/har", "Load, search, and analyze HAR files"],
                ["Terminal", "/dashboard/terminal", "Full-page Frida output and backend logs"],
                ["Device", "/dashboard/device", "ADB connection, Frida, proxy status"],
                ["Apps", "/dashboard/apps", "Browse and select target app"],
                ["Scripts", "/dashboard/scripts", "Manage Frida bypass scripts"],
                ["Settings", "/dashboard/settings", "Configure all settings"],
              ]}
            />

            <H3 id="tui-mode">TUI Mode</H3>
            <P>
              Launch with <Inline>./sniff!</Inline> for a full terminal interface.
            </P>
            <Table
              headers={["Key", "Action"]}
              rows={[
                ["c", "Start standard capture"],
                ["m", "Start MITM-only capture (no Frida)"],
                ["n", "App-specific capture modes"],
                ["s", "Settings"],
                ["f", "Frida script selection"],
                ["d", "Device info & management"],
                ["a", "Browse installed apps"],
                ["l", "Full log viewer"],
                ["e", "Export captured flows"],
                ["q", "Quit"],
              ]}
            />
            <P>During capture:</P>
            <Table
              headers={["Key", "Action"]}
              rows={[
                ["t / T", "Cycle resource type filter"],
                ["f", "Toggle text filter"],
                ["x", "Clear flows"],
                ["e", "Export to file"],
                ["r", "Restart target activity"],
                ["Tab", "Toggle focus between flows and logs"],
                ["Enter", "View flow detail"],
                ["Esc", "Back"],
              ]}
            />

            <H3 id="capture-workflow">Capture Workflow</H3>
            <P>
              When you start a standard capture, sniff! executes this sequence
              automatically:
            </P>
            <div className="my-4 rounded-xl border border-border bg-[#08080a] p-4 font-mono text-[11px] leading-[22px] text-text-secondary space-y-0.5">
              <div>
                <span className="text-text-muted">1.</span>{" "}
                <span className="text-warn">SELinux</span> → Permissive
              </div>
              <div>
                <span className="text-text-muted">2.</span>{" "}
                Force stop target app + kill stale processes
              </div>
              <div>
                <span className="text-text-muted">3.</span>{" "}
                Start <span className="text-accent-bright">frida-server</span>{" "}
                on device
              </div>
              <div>
                <span className="text-text-muted">4.</span>{" "}
                Start <span className="text-accent-bright">mitmdump</span> on
                configured port
              </div>
              <div>
                <span className="text-text-muted">5.</span>{" "}
                Set device <span className="text-good">system proxy</span>
              </div>
              <div>
                <span className="text-text-muted">6.</span>{" "}
                Verify device ↔ proxy connectivity
              </div>
              <div>
                <span className="text-text-muted">7.</span>{" "}
                Launch app, wait for PID
              </div>
              <div>
                <span className="text-text-muted">8.</span>{" "}
                Wait for ART JIT warmup (configurable delay)
              </div>
              <div>
                <span className="text-text-muted">9.</span>{" "}
                <span className="text-accent-bright">Attach Frida</span> with
                SSL bypass script
              </div>
              <div>
                <span className="text-text-muted">10.</span> Restart activity →
                capture flows in real-time
              </div>
            </div>
            <P>
              On stop: proxy is cleared, Frida detaches, SELinux is restored to
              Enforcing.
            </P>

            {/* ── Capture Modes ───────────────────────────────────────── */}
            <H2 id="capture-modes">Capture Modes</H2>
            <P>
              Beyond standard capture, sniff! includes specialized modes that
              encode app-specific bypass knowledge.
            </P>
            <Table
              headers={["Mode", "When to Use"]}
              rows={[
                [
                  "Standard",
                  "General apps. Full pipeline: Frida + mitmproxy + system proxy.",
                ],
                [
                  "MITM Only",
                  "Apps where CA is already trusted. Skips Frida entirely.",
                ],
                [
                  "Signup Handoff",
                  "Apps with external browser auth (PingOne/DaVinci). Lets signup flow run direct, enables proxy after callback.",
                ],
                [
                  "LinkedIn Cronet",
                  "LinkedIn app. Spawns with Cronet patch to disable QUIC and DNS bypass.",
                ],
                [
                  "DailyPay",
                  "DailyPay app. Standard bypass + APEX cert injection into isolated mount namespace.",
                ],
                [
                  "Speedway",
                  "Speedway/7-Eleven. Extended ART settle time + Distil/Imperva bot protection stub.",
                ],
                [
                  "Papa Johns",
                  "Papa Johns (Flutter). Uses iptables REDIRECT instead of system proxy + BoringSSL native hooks.",
                ],
              ]}
            />

            {/* ── Frida Scripts ───────────────────────────────────────── */}
            <H2 id="frida-scripts">Frida Scripts</H2>
            <H3 id="built-in-scripts">Built-in Scripts</H3>
            <Table
              headers={["ID", "Name", "Label", "Target"]}
              rows={[
                [
                  "universal",
                  "Universal SSL Unpin",
                  <Badge key="best" color="good">BEST</Badge>,
                  "TrustManager, OkHttp, Conscrypt, ProxySelector, HostnameVerifier, WebView, TrustKit, Netty",
                ],
                [
                  "trustmanager",
                  "TrustManager Only",
                  <Badge key="lw" color="accent">LIGHTWEIGHT</Badge>,
                  "Android platform TLS only — lowest crash risk",
                ],
                [
                  "okhttp",
                  "OkHttp Pinner + Proxy",
                  <Badge key="ok" color="warn">OKHTTP APPS</Badge>,
                  "OkHttp CertificatePinner + ProxySelector",
                ],
                [
                  "proxy_only",
                  "Proxy Redirect Only",
                  <Badge key="diag" color="muted">DIAGNOSTIC</Badge>,
                  "Forces traffic through proxy without SSL bypass",
                ],
                [
                  "webview",
                  "WebView + HttpsURL",
                  <Badge key="hyb" color="accent">HYBRID APPS</Badge>,
                  "WebView auto-proceed + HttpsURLConnection bypass",
                ],
                [
                  "react_native",
                  "React Native",
                  <Badge key="rn" color="accent">RN APPS</Badge>,
                  "OkHttpClientProvider, TrustKit, NetworkingModule",
                ],
                [
                  "flutter",
                  "Flutter / Dart",
                  <Badge key="fl" color="bad">FLUTTER</Badge>,
                  "Native BoringSSL hooks in libflutter.so (needs iptables)",
                ],
              ]}
            />
            <P>
              Plus 7 app-specific scripts for Pilot Flying J, LinkedIn, DailyPay,
              Speedway, and Papa Johns.
            </P>

            <H3 id="custom-scripts">Custom Scripts</H3>
            <P>
              Create custom scripts from the web UI (Scripts page → New Script)
              or upload <Inline>.js</Inline> files. Custom scripts are stored in{" "}
              <Inline>frida_scripts/custom/</Inline> with a META header:
            </P>
            <Code lang="javascript">{`// META: {"label":"CUSTOM","desc":"My bypass script"}
Java.perform(function() {
  var TrustManager = Java.use("javax.net.ssl.X509TrustManager");
  // Your hooks here
});`}</Code>
            <P>
              All scripts — built-in and custom — can be edited from the web UI.
              Changes are saved directly to the script file on disk.
            </P>

            {/* ── API Reference ───────────────────────────────────────── */}
            <H2 id="api-reference">API Reference</H2>
            <P>
              The Go backend serves a REST API on port{" "}
              <Inline>9090</Inline> (configurable). All endpoints are prefixed
              with <Inline>/api/</Inline>.
            </P>

            <H3 id="api-state">State & Events</H3>
            <Table
              headers={["Method", "Endpoint", "Description"]}
              rows={[
                ["GET", "/api/state", "Current capture state, mode, flow/log counts, settings"],
                ["GET", "/api/events", "SSE stream — real-time flows, logs, state changes"],
              ]}
            />
            <P>SSE event types:</P>
            <Table
              headers={["Event", "Data", "When"]}
              rows={[
                ["state", "{ capturing, captureMode, captureName }", "Capture started/stopped"],
                ["flow", "Full flow object", "New HTTP flow captured"],
                ["log", "{ Time, Msg, Style }", "Backend log entry"],
                ["clear", "{}", "Flows cleared"],
              ]}
            />

            <H3 id="api-capture">Capture Control</H3>
            <Table
              headers={["Method", "Endpoint", "Body", "Description"]}
              rows={[
                [
                  "POST",
                  "/api/capture/start",
                  "{ mode, package }",
                  "Start capture. Returns 409 if already capturing.",
                ],
                ["POST", "/api/capture/stop", "{}", "Stop active capture"],
                ["POST", "/api/capture/clear", "{}", "Clear captured flows"],
              ]}
            />
            <P>
              Available modes: <Inline>standard</Inline>,{" "}
              <Inline>mitm_only</Inline>, <Inline>signup_handoff</Inline>,{" "}
              <Inline>linkedin_cronet</Inline>, <Inline>linkedin_replay</Inline>,{" "}
              <Inline>dailypay</Inline>, <Inline>speedway</Inline>,{" "}
              <Inline>papajohns</Inline>
            </P>

            <H3 id="api-flows">Flows</H3>
            <Table
              headers={["Method", "Endpoint", "Description"]}
              rows={[
                ["GET", "/api/flows", "All captured flows as JSON array"],
                ["GET", "/api/flows?id=N", "Single flow by index"],
              ]}
            />
            <P>Flow object shape:</P>
            <Code lang="json">{`{
  "ts": 1711584000.123,
  "method": "POST",
  "url": "https://api.example.com/v1/auth",
  "host": "api.example.com",
  "path": "/v1/auth",
  "status": 200,
  "req_size": 256,
  "resp_size": 1024,
  "content_type": "application/json",
  "req_headers": { "Authorization": "Bearer ..." },
  "resp_headers": { "Set-Cookie": "..." },
  "req_body": "{\\"username\\":\\"...\\"}",
  "resp_body": "{\\"token\\":\\"...\\"}"
}`}</Code>
            <P>
              Bodies are truncated to 5,000 characters.
            </P>

            <H3 id="api-device">Device</H3>
            <Table
              headers={["Method", "Endpoint", "Description"]}
              rows={[
                [
                  "GET",
                  "/api/device",
                  "Device model, Android version, SDK, SELinux, Frida status, proxy, host IP",
                ],
                ["POST", "/api/device/frida/start", "Start frida-server on device"],
                ["POST", "/api/device/proxy/clear", "Clear system proxy setting"],
              ]}
            />

            <H3 id="api-scripts">Scripts</H3>
            <Table
              headers={["Method", "Endpoint", "Description"]}
              rows={[
                ["GET", "/api/scripts", "All scripts (built-in + custom) with metadata"],
                ["GET", "/api/scripts/content?id=X", "Full source code of a script"],
                ["POST", "/api/scripts/custom", "Create: { name, content, label, desc }"],
                ["PUT", "/api/scripts/custom", "Update: { id, name, content, label, desc }"],
                ["DELETE", "/api/scripts/custom?id=X", "Delete custom script"],
              ]}
            />

            <H3 id="api-settings">Settings</H3>
            <Table
              headers={["Method", "Endpoint", "Description"]}
              rows={[
                ["GET", "/api/settings", "All settings as key-value array"],
                ["PUT", "/api/settings", "Update setting: { key, value }"],
                ["POST", "/api/export", "Export flows: { format } (json or har)"],
              ]}
            />

            {/* ── Configuration ───────────────────────────────────────── */}
            <H2 id="configuration">Configuration</H2>
            <P>
              Settings are stored in <Inline>settings.json</Inline> and
              editable via the TUI or web UI.
            </P>
            <Table
              headers={["Key", "Default", "Description"]}
              rows={[
                ["package", '""', "Target Android package name"],
                ["port", "8080", "mitmproxy listen port"],
                ["attach_delay", "10", "Seconds to wait for ART JIT before Frida attach"],
                ["ignore_hosts", "PerimeterX regex", "Hosts to pass through without interception"],
                ["frida_script_id", '"universal"', "Active Frida script ID"],
                ["captures_dir", "./captures", "Directory for exported captures"],
                ["frida_server", "/data/local/tmp/fs-helper-64", "Path to frida-server on device"],
                ["host_ip", "Auto-detect", "Host machine IP for proxy config"],
                ["export_format", '"json"', 'Export format: "json" or "har"'],
                ["ui_mode", '"tui"', '"tui" or "web"'],
                ["web_port", "9090", "Web UI port"],
              ]}
            />

            {/* ── Architecture ────────────────────────────────────────── */}
            <H2 id="architecture">Architecture</H2>
            <Code lang="text">{`sniff!/
├── main.go              # TUI, capture sequences, ADB, Frida, mitmdump
├── web.go               # HTTP API, SSE streaming, REST handlers
├── go.mod               # Go dependencies (BubbleTea + stdlib)
├── frida_scripts/       # 14+ built-in .js bypass scripts
│   └── custom/          # User-created scripts
├── site/                # Next.js web dashboard
│   ├── src/app/         # App Router pages
│   ├── src/components/  # React components
│   └── src/lib/         # API client, state, filters, types
├── dev                  # Dev script (backend + frontend)
└── build-sniff!      # Production build script`}</Code>
            <P>
              The Go backend manages all subprocesses (Frida, mitmdump, ADB)
              via <Inline>os/exec</Inline>. Captured flows are written to a
              JSONL file by a mitmdump Python addon, then tailed by the Go
              process at 300ms intervals and streamed to connected clients via SSE.
            </P>
            <div className="my-6 rounded-xl border border-border bg-[#08080a] p-4 font-mono text-[11px] leading-[22px] text-text-secondary">
              <div className="text-text-muted mb-2">Data flow:</div>
              <div>
                Android App → System Proxy → <span className="text-accent-bright">mitmdump</span>{" "}
                (terminates TLS)
              </div>
              <div>
                {"  "}→ <Inline>/tmp/sniff_flows.jsonl</Inline> (one JSON per
                flow)
              </div>
              <div>
                {"  "}→ <span className="text-accent-bright">Go backend</span>{" "}
                (tails JSONL, parses flows)
              </div>
              <div>
                {"  "}→ <span className="text-good">SSE /api/events</span> →
                Next.js Dashboard
              </div>
            </div>
            <P>
              The Frida injection works by hooking Java-level SSL methods
              (TrustManager, OkHttp CertificatePinner, etc.) or native functions
              (BoringSSL for Flutter) at runtime, making the app accept the
              mitmproxy CA certificate.
            </P>

            {/* Bottom spacer */}
            <div className="mt-20 pt-8 border-t border-border">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-text-muted">
                  An{" "}
                  <a
                    href="https://x-lock.cloud"
                    className="text-brand-light hover:underline"
                  >
                    x-lock
                  </a>{" "}
                  open source project
                </p>
                <Link
                  href="/dashboard"
                  className="flex items-center gap-1.5 text-[12px] font-medium text-accent hover:text-accent-bright transition-colors"
                >
                  Open Dashboard
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

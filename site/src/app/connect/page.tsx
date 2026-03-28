"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Wifi,
  WifiOff,
  ArrowRight,
  Terminal,
  CheckCircle2,
  Loader2,
  RotateCw,
  Download,
} from "lucide-react";
import {
  getBackendUrl,
  setBackendUrl,
  checkHealth,
  isConfigured,
} from "@/lib/connection";

type Status = "idle" | "checking" | "connected" | "failed";

export default function ConnectPage() {
  const router = useRouter();
  const [url, setUrl] = useState("http://localhost:9090");
  const [status, setStatus] = useState<Status>("idle");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    if (isConfigured()) {
      setUrl(getBackendUrl());
    }
  }, []);

  // Auto-check on mount if already configured
  useEffect(() => {
    if (isConfigured()) {
      handleConnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setStatus("checking");
    const ok = await checkHealth(url.replace(/\/+$/, ""));
    if (ok) {
      setBackendUrl(url);
      setStatus("connected");
      setTimeout(() => router.push("/dashboard"), 600);
    } else {
      setStatus("failed");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleConnect();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-brand/[0.04] rounded-full blur-[120px] pointer-events-none" />

      <div className="relative w-full max-w-lg space-y-8">
        {/* Header */}
        <div className="flex flex-col items-center gap-5">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">
              Connect to{" "}
              <span className="text-foreground">sniff</span>
              <span className="text-accent-bright">!</span>
            </h1>
            <p className="mt-1.5 text-sm text-text-secondary max-w-sm mx-auto">
              Enter the address of your local sniff! backend. It runs on your
              machine alongside ADB and Frida.
            </p>
          </div>
        </div>

        {/* Connect form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Backend URL
            </label>
            <div className="relative">
              <Wifi className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
              <input
                type="url"
                placeholder="http://localhost:9090"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setStatus("idle");
                }}
                className="w-full rounded-xl border border-card-border bg-card pl-10 pr-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-accent placeholder:text-text-muted font-mono"
              />
            </div>
          </div>

          {/* Status messages */}
          {status === "failed" && (
            <div className="flex items-start gap-3 rounded-xl bg-bad/10 border border-bad/20 px-4 py-3 text-sm">
              <WifiOff className="h-4 w-4 text-bad mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-bad">Connection failed</p>
                <p className="text-text-secondary mt-0.5">
                  Make sure the sniff! backend is running at{" "}
                  <span className="font-mono text-text-muted">{url}</span>
                </p>
              </div>
            </div>
          )}

          {status === "connected" && (
            <div className="flex items-center gap-3 rounded-xl bg-good/10 border border-good/20 px-4 py-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-good shrink-0" />
              <p className="font-medium text-good">
                Connected — redirecting to dashboard...
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={status === "checking" || status === "connected"}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-semibold text-white hover:bg-accent-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === "checking" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : status === "connected" ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Connected
              </>
            ) : status === "failed" ? (
              <>
                <RotateCw className="h-4 w-4" />
                Retry
              </>
            ) : (
              <>
                Connect
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        {/* Setup instructions */}
        <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Terminal className="h-4 w-4 text-accent" />
            Quick Start
          </div>
          <div className="space-y-2.5 text-sm text-text-secondary">
            <div>
              <p className="mb-1.5">
                1. Download and install the sniff! backend for your platform:
              </p>
              <div className="flex gap-2">
                <a
                  href="https://github.com/pentium-solver/sniff/releases/latest"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-bg-tertiary border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:text-foreground hover:bg-bg-elevated transition-colors no-underline"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              </div>
              <p className="mt-1.5 text-xs text-text-muted">
                Or install via terminal:
              </p>
              <div className="rounded-lg bg-bg-tertiary border border-border px-3 py-2 font-mono text-xs text-text-secondary select-all mt-1">
                {`curl -fsSL ${origin}/install.sh | bash`}
              </div>
            </div>
            <p>
              2. Connect your Android device via USB with ADB debugging enabled.
            </p>
            <p>
              3. Start the backend:
            </p>
            <div className="rounded-lg bg-bg-tertiary border border-border px-3 py-2 font-mono text-xs text-text-secondary select-all">
              sniff
            </div>
            <p>
              4. Click <strong className="text-foreground">Connect</strong> above — the dashboard will appear once the
              backend is detected on port <span className="font-mono">9090</span>.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-1.5 pt-2">
          <span className="text-[11px] text-text-muted">
            Powered by{" "}
            <a
              href="https://x-lock.cloud"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand/60 hover:text-brand transition-colors"
            >
              <span className="text-brand/60">x</span>-lock
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}

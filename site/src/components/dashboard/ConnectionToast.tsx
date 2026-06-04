"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WifiOff, X, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";

// How long (ms) ADB must be unreachable before the toast appears.
// 20 s avoids false positives during heavy operations (jadx, APK pull).
const FAILURE_THRESHOLD_MS = 20_000;
// Polling interval when connection is healthy.
const POLL_INTERVAL_MS = 8_000;
// Polling interval when connection is already known-bad (faster recovery detection).
const RECOVERY_POLL_MS = 3_000;
// Per-request timeout. Backend ping uses a 4 s context so 6 s gives plenty of margin.
const REQUEST_TIMEOUT_MS = 6_000;

export default function ConnectionToast() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const firstFailRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;

    async function poll() {
      if (!active) return;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let adbOk = false;
      try {
        // Use the fast ping endpoint — only runs `adb devices`, doesn't block
        // on APK pulls or other long-running ADB operations.
        const data = await api<{ connected?: boolean; detail?: string; elapsed_ms?: number }>(
          "/device/ping", { signal: controller.signal }
        );
        adbOk = data?.connected === true;
        if (!adbOk && data?.detail) {
          console.warn(`[sniff ADB] ping failed: ${data.detail} (${data.elapsed_ms ?? "?"}ms)`);
        } else if (data?.elapsed_ms && data.elapsed_ms > 2000) {
          console.info(`[sniff ADB] slow ping: ${data.elapsed_ms}ms`);
        }
      } catch (e) {
        adbOk = false;
        console.warn(`[sniff ADB] ping fetch error:`, e);
      } finally {
        clearTimeout(timeoutId);
      }

      if (!active) return;

      if (adbOk) {
        // Connection healthy — reset failure tracking and hide toast.
        firstFailRef.current = null;
        setVisible(false);
        setDismissed(false); // Allow it to show again if it breaks again
        schedule(POLL_INTERVAL_MS);
      } else {
        // Connection unhealthy.
        const now = Date.now();
        if (firstFailRef.current === null) {
          firstFailRef.current = now;
          console.warn(`[sniff ADB] first failure at ${new Date(now).toLocaleTimeString()}`);
        }
        const failDuration = now - firstFailRef.current;
        if (failDuration >= FAILURE_THRESHOLD_MS && !dismissed) {
          console.error(`[sniff ADB] connection lost for ${Math.round(failDuration / 1000)}s — showing toast`);
          setVisible(true);
        }
        schedule(RECOVERY_POLL_MS);
      }
    }

    function schedule(ms: number) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(poll, ms);
    }

    // Start after a short delay so the page can settle.
    timerRef.current = setTimeout(poll, 5_000);

    return () => {
      active = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dismissed]);

  if (!visible) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 flex items-start gap-3 rounded-2xl border border-warn/30 bg-bg-secondary shadow-xl shadow-black/30 px-4 py-3 max-w-xs animate-in slide-in-from-top-2 fade-in duration-200"
      role="alert"
    >
      {/* Icon */}
      <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-warn/10 border border-warn/20 shrink-0 mt-0.5">
        <WifiOff className="h-4 w-4 text-warn" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-foreground">ADB connection lost</p>
        <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
          Device is unreachable. Try replugging the USB cable or restarting the server.
        </p>
        <Link
          href="/dashboard/device"
          onClick={() => setVisible(false)}
          className="inline-flex items-center gap-1 mt-2 text-[11px] font-medium text-accent-bright hover:underline"
        >
          Device page
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Dismiss */}
      <button
        onClick={() => {
          setDismissed(true);
          setVisible(false);
        }}
        className="p-1 rounded-lg text-text-muted hover:text-foreground hover:bg-bg-tertiary transition-colors cursor-pointer shrink-0"
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

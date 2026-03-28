"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AppContext, type AppState } from "@/lib/store";
import { api, connectSSE } from "@/lib/api";
import { checkHealth } from "@/lib/connection";
import type { Flow, LogEntry } from "@/lib/types";

export default function AppProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [flows, setFlowsRaw] = useState<Flow[]>([]);
  const [logs, setLogsRaw] = useState<LogEntry[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [captureMode, setCaptureMode] = useState("");
  const [captureName, setCaptureName] = useState("");
  const [pkg, setPkg] = useState("");
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);

  const setFlows = useCallback(
    (fn: (prev: Flow[]) => Flow[]) => setFlowsRaw(fn),
    []
  );
  const setLogs = useCallback(
    (fn: (prev: LogEntry[]) => LogEntry[]) => setLogsRaw(fn),
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const ok = await checkHealth();
      if (cancelled) return;

      if (!ok) {
        router.replace("/connect");
        return;
      }

      setReady(true);

      api("/state")
        .then((s) => {
          if (cancelled) return;
          setPkg(s.settings?.package || "");
          setCapturing(!!s.capturing);
          setCaptureMode(s.captureMode || "");
          setCaptureName(s.captureName || "");
        })
        .catch((e) => console.error("init:", e));

      const close = connectSSE({
        onFlow: (flow) => setFlowsRaw((prev) => [...prev, flow]),
        onLog: (entry) => setLogsRaw((prev) => [...prev, entry]),
        onState: (s) => {
          setCapturing(s.capturing);
          setCaptureMode(s.captureMode || "");
          setCaptureName(s.captureName || "");
        },
        onClear: () => setFlowsRaw([]),
        onConnect: () => setConnected(true),
        onDisconnect: () => setConnected(false),
      });

      return close;
    }

    let cleanup: (() => void) | undefined;
    init().then((c) => {
      cleanup = c;
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [router]);

  const state: AppState = {
    flows,
    logs,
    capturing,
    captureMode,
    captureName,
    pkg,
    connected,
    setFlows,
    setLogs,
    setCapturing,
    setCaptureMode,
    setCaptureName,
    setPkg,
    setConnected,
  };

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-secondary">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-text-muted">Connecting to backend...</span>
        </div>
      </div>
    );
  }

  return <AppContext.Provider value={state}>{children}</AppContext.Provider>;
}

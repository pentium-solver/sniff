"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { AppContext, type AppState } from "@/lib/store";
import { api, connectSSE } from "@/lib/api";
import { checkHealth } from "@/lib/connection";
import type { Flow, LogEntry, CapturedFingerprint } from "@/lib/types";
import ConnectionToast from "./ConnectionToast";

// Hard caps — prevents React state from growing unbounded.
// At 60 flows/min during a heavy capture, 2000 flows ≈ 33 minutes of data.
const MAX_FLOWS = 2000;
const MAX_LOGS  = 400;

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
  const [fingerprints, setFingerprintsRaw] = useState<CapturedFingerprint[]>([]);
  const [fingerprintCapturing, setFingerprintCapturing] = useState(false);

  // Track the SSE cleanup so the watchdog can force-reconnect.
  const cleanupRef = useRef<(() => void) | undefined>(undefined);
  // Track last SSE event time — watchdog uses this to detect silent hangs.
  const lastEventRef = useRef<number>(Date.now());

  const setFlows = useCallback(
    (fn: (prev: Flow[]) => Flow[]) => setFlowsRaw(fn),
    []
  );
  const setLogs = useCallback(
    (fn: (prev: LogEntry[]) => LogEntry[]) => setLogsRaw(fn),
    []
  );
  const setFingerprints = useCallback(
    (fn: (prev: CapturedFingerprint[]) => CapturedFingerprint[]) => setFingerprintsRaw(fn),
    []
  );

  // ── Core SSE + init ──────────────────────────────────────────────────────────

  const startSSE = useCallback(() => {
    // Tear down any existing SSE connection first.
    cleanupRef.current?.();
    cleanupRef.current = undefined;

    const touch = () => { lastEventRef.current = Date.now(); };

    const close = connectSSE({
      onFlow: (flow) => {
        touch();
        setFlowsRaw((prev) => {
          const next = [...prev, { ...flow, _id: crypto.randomUUID() }];
          // Keep only the most recent MAX_FLOWS — oldest fall off the front.
          return next.length > MAX_FLOWS ? next.slice(next.length - MAX_FLOWS) : next;
        });
      },
      onLog: (entry) => {
        touch();
        setLogsRaw((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
        });
      },
      onState: (s) => {
        touch();
        setCapturing(s.capturing);
        setCaptureMode(s.captureMode || "");
        setCaptureName(s.captureName || "");
        if (s.fingerprintCapturing !== undefined) {
          setFingerprintCapturing(s.fingerprintCapturing);
        }
      },
      onClear: () => { touch(); setFlowsRaw([]); },
      onConnect: () => { touch(); setConnected(true); },
      onDisconnect: () => setConnected(false),
      onFingerprint: (fp) => { touch(); setFingerprintsRaw((prev) => [...prev, fp]); },
      onFingerprintState: (s) => { touch(); setFingerprintCapturing(s.active); },
    });

    cleanupRef.current = close;
  }, []);

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

      startSSE();
    }

    init();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = undefined;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ── SSE watchdog ─────────────────────────────────────────────────────────────
  // The server sends a `: ping` SSE comment every 15 s. If we haven't seen any
  // event (flow / state / log / connect) in 40 s, the connection has silently
  // hung — force a reconnect. This fires before the ADB toast (20 s threshold)
  // so the dashboard recovers on its own before the user notices anything wrong.
  useEffect(() => {
    if (!ready) return;

    const WATCHDOG_INTERVAL = 10_000;  // check every 10 s
    const HANG_THRESHOLD    = 40_000;  // reconnect after 40 s of silence

    const id = setInterval(() => {
      const silence = Date.now() - lastEventRef.current;
      if (silence > HANG_THRESHOLD) {
        console.warn(`[sniff SSE] silent for ${Math.round(silence / 1000)}s — reconnecting`);
        lastEventRef.current = Date.now(); // reset before reconnect to avoid rapid loops
        startSSE();
      }
    }, WATCHDOG_INTERVAL);

    return () => clearInterval(id);
  }, [ready, startSSE]);

  const state: AppState = {
    flows,
    logs,
    capturing,
    captureMode,
    captureName,
    pkg,
    connected,
    fingerprints,
    fingerprintCapturing,
    setFlows,
    setLogs,
    setCapturing,
    setCaptureMode,
    setCaptureName,
    setPkg,
    setConnected,
    setFingerprints,
    setFingerprintCapturing,
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

  return (
    <AppContext.Provider value={state}>
      {children}
      <ConnectionToast />
    </AppContext.Provider>
  );
}

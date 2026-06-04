"use client";

import { createContext, useContext } from "react";
import type { Flow, LogEntry, CapturedFingerprint } from "./types";

export interface AppState {
  flows: Flow[];
  logs: LogEntry[];
  capturing: boolean;
  captureMode: string;
  captureName: string;
  pkg: string;
  connected: boolean;
  fingerprints: CapturedFingerprint[];
  fingerprintCapturing: boolean;
  setFlows: (fn: (prev: Flow[]) => Flow[]) => void;
  setLogs: (fn: (prev: LogEntry[]) => LogEntry[]) => void;
  setCapturing: (v: boolean) => void;
  setCaptureMode: (v: string) => void;
  setCaptureName: (v: string) => void;
  setPkg: (v: string) => void;
  setConnected: (v: boolean) => void;
  setFingerprints: (fn: (prev: CapturedFingerprint[]) => CapturedFingerprint[]) => void;
  setFingerprintCapturing: (v: boolean) => void;
}

export const AppContext = createContext<AppState | null>(null);

export function useAppState(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}

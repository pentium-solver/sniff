"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Key,
  Zap,
  AlertTriangle,
  Lock,
  ShieldOff,
} from "lucide-react";
import type { Flow } from "@/lib/types";
import { detectSignals } from "@/lib/signals";
import type { Signal, SignalType } from "@/lib/signals";
import JsonView from "./JsonView";
import clsx from "clsx";

// ── Icons & styles ────────────────────────────────────────────────────────────

function SignalIcon({ type }: { type: SignalType }) {
  switch (type) {
    case "jwt":
      return <Lock className="h-3.5 w-3.5 text-accent-bright shrink-0" />;
    case "bearer":
      return <Key className="h-3.5 w-3.5 text-[#d29922] shrink-0" />;
    case "basic-auth":
      return <Key className="h-3.5 w-3.5 text-[#f85149] shrink-0" />;
    case "api-key":
      return <Key className="h-3.5 w-3.5 text-purple-400 shrink-0" />;
    case "aws-key":
      return <Zap className="h-3.5 w-3.5 text-[#f85149] shrink-0" />;
    case "grpc":
      return <Zap className="h-3.5 w-3.5 text-cyan-400 shrink-0" />;
    case "insecure-http":
      return <AlertTriangle className="h-3.5 w-3.5 text-[#d29922] shrink-0" />;
    default:
      return <ShieldOff className="h-3.5 w-3.5 text-text-muted shrink-0" />;
  }
}

function badgeClass(type: SignalType): string {
  switch (type) {
    case "jwt":        return "bg-accent/10 text-accent-bright border-accent/20";
    case "bearer":     return "bg-[#d29922]/10 text-[#d29922] border-[#d29922]/20";
    case "basic-auth": return "bg-[#f85149]/10 text-[#f85149] border-[#f85149]/20";
    case "api-key":    return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    case "aws-key":    return "bg-[#f85149]/10 text-[#f85149] border-[#f85149]/20";
    case "grpc":       return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
    default:           return "bg-[#d29922]/10 text-[#d29922] border-[#d29922]/20";
  }
}

function maskValue(value: string, type: SignalType): string {
  if (type === "grpc" || type === "insecure-http") return value;
  if (value.length <= 12) return "•".repeat(value.length);
  const tail = value.slice(-6);
  const dots = "•".repeat(Math.min(value.length - 12, 24));
  return value.slice(0, 6) + dots + tail;
}

// ── CopyBtn ───────────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handle() {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={handle}
      title="Copy full value"
      className="text-text-muted hover:text-foreground transition-colors cursor-pointer shrink-0"
    >
      {copied ? (
        <Check className="h-3 w-3 text-good" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

// ── SignalRow ─────────────────────────────────────────────────────────────────

function SignalRow({ signal }: { signal: Signal }) {
  const [expanded, setExpanded] = useState(false);
  const hasDecoded = !!signal.decoded;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-2.5 px-3 py-2 bg-bg-secondary flex-wrap">
        <SignalIcon type={signal.type} />
        <span
          className={clsx(
            "text-[10px] font-mono font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 border shrink-0",
            badgeClass(signal.type)
          )}
        >
          {signal.type}
        </span>
        <span className="text-[11px] text-foreground font-medium">{signal.label}</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {signal.headerName && (
            <span className="text-[10px] font-mono text-text-muted hidden sm:inline">
              {signal.headerName}
            </span>
          )}
          <span className="text-[10px] text-text-muted/60 font-mono">{signal.location}</span>
          <CopyBtn text={signal.value} />
          {hasDecoded && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-text-muted hover:text-foreground transition-colors cursor-pointer"
              title={expanded ? "Collapse" : "Expand decoded payload"}
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Masked value */}
      <div className="px-3 py-1.5 font-mono text-[10px] text-text-muted bg-bg-primary break-all leading-relaxed">
        {maskValue(signal.value, signal.type)}
      </div>

      {/* Decoded JWT */}
      {hasDecoded && expanded && (
        <div className="border-t border-border p-3 bg-bg-primary">
          <JsonView
            text={JSON.stringify(signal.decoded, null, 2)}
            mime="application/json"
          />
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface SignalsPanelProps {
  flow: Flow;
}

export default function SignalsPanel({ flow }: SignalsPanelProps) {
  const signals = useMemo(() => detectSignals(flow), [flow]);

  if (signals.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-text-muted text-[12px]">
        No secrets or signals detected in this request
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {signals.map((signal, i) => (
        <SignalRow key={`${signal.type}_${signal.location}_${i}`} signal={signal} />
      ))}
    </div>
  );
}

// ── Inline warning badge (used in FlowTable rows) ─────────────────────────────

export function SignalWarning({ flow }: { flow: Flow }) {
  const count = useMemo(() => detectSignals(flow).length, [flow]);
  if (count === 0) return null;
  return (
    <span
      title={`${count} signal${count !== 1 ? "s" : ""} detected`}
      className="inline-flex items-center gap-0.5 text-[#d29922] shrink-0"
    >
      <AlertTriangle className="h-2.5 w-2.5" />
    </span>
  );
}

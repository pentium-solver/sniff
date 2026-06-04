"use client";

import { useMemo, useState } from "react";
import { useAppState } from "@/lib/store";
import { detectSignals } from "@/lib/signals";
import type { Signal, SignalType } from "@/lib/signals";
import type { Flow } from "@/lib/types";
import {
  ShieldAlert,
  Copy,
  Check,
  Key,
  Zap,
  AlertTriangle,
  Lock,
  Filter,
} from "lucide-react";
import clsx from "clsx";

// ── Aggregated row ─────────────────────────────────────────────────────────────

interface AggregatedSignal extends Signal {
  occurrences: number;
  hosts: string[];
  firstFlow: Flow;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALL_TYPES: SignalType[] = [
  "jwt", "bearer", "basic-auth", "api-key", "aws-key", "insecure-http", "grpc",
];

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

function TypeIcon({ type }: { type: SignalType }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (type) {
    case "jwt":        return <Lock className={clsx(cls, "text-accent-bright")} />;
    case "bearer":     return <Key className={clsx(cls, "text-[#d29922]")} />;
    case "basic-auth": return <Key className={clsx(cls, "text-[#f85149]")} />;
    case "api-key":    return <Key className={clsx(cls, "text-purple-400")} />;
    case "aws-key":    return <Zap className={clsx(cls, "text-[#f85149]")} />;
    case "grpc":       return <Zap className={clsx(cls, "text-cyan-400")} />;
    default:           return <AlertTriangle className={clsx(cls, "text-[#d29922]")} />;
  }
}

function maskValue(value: string, type: SignalType): string {
  if (type === "grpc" || type === "insecure-http") {
    return value.length > 60 ? value.slice(0, 60) + "…" : value;
  }
  if (value.length <= 12) return "•".repeat(value.length);
  return value.slice(0, 6) + "•".repeat(Math.min(value.length - 12, 24)) + value.slice(-6);
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handle(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={handle}
      className="text-text-muted hover:text-foreground transition-colors cursor-pointer shrink-0 p-1"
      title="Copy value"
    >
      {copied ? <Check className="h-3 w-3 text-good" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SecretsPage() {
  const { flows } = useAppState();
  const [activeTypes, setActiveTypes] = useState<Set<SignalType>>(new Set());
  const [search, setSearch] = useState("");

  // Aggregate all signals across all flows, deduplicated by value
  const aggregated = useMemo<AggregatedSignal[]>(() => {
    const byValue = new Map<string, AggregatedSignal>();
    for (const flow of flows) {
      const signals = detectSignals(flow);
      for (const sig of signals) {
        const key = `${sig.type}::${sig.value}`;
        const existing = byValue.get(key);
        if (existing) {
          existing.occurrences++;
          if (!existing.hosts.includes(flow.host)) existing.hosts.push(flow.host);
        } else {
          byValue.set(key, {
            ...sig,
            occurrences: 1,
            hosts: [flow.host],
            firstFlow: flow,
          });
        }
      }
    }
    // Sort: aws-key and basic-auth first (highest severity), then by occurrences desc
    const severity: Record<SignalType, number> = {
      "aws-key": 0, "basic-auth": 1, "jwt": 2, "bearer": 3,
      "api-key": 4, "insecure-http": 5, "grpc": 6,
    };
    return [...byValue.values()].sort((a, b) => {
      const sd = (severity[a.type] ?? 9) - (severity[b.type] ?? 9);
      if (sd !== 0) return sd;
      return b.occurrences - a.occurrences;
    });
  }, [flows]);

  // Active type counts
  const typeCounts = useMemo(() => {
    const m: Partial<Record<SignalType, number>> = {};
    for (const s of aggregated) m[s.type] = (m[s.type] ?? 0) + 1;
    return m;
  }, [aggregated]);

  // Filter
  const filtered = useMemo(() => {
    return aggregated.filter((s) => {
      if (activeTypes.size > 0 && !activeTypes.has(s.type)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          s.label.toLowerCase().includes(q) ||
          s.hosts.some((h) => h.includes(q)) ||
          s.type.includes(q)
        );
      }
      return true;
    });
  }, [aggregated, activeTypes, search]);

  function toggleType(t: SignalType) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (flows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
        <ShieldAlert className="h-8 w-8 opacity-30" />
        <p className="text-[13px]">Start a capture to detect secrets automatically</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert className="h-5 w-5 text-accent-bright" />
          <h1 className="text-[15px] font-semibold">Secrets</h1>
          <span className="ml-auto text-[11px] text-text-muted font-mono">
            {aggregated.length} unique · {flows.length} flows scanned
          </span>
        </div>

        {/* Type filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter className="h-3 w-3 text-text-muted shrink-0" />
          {ALL_TYPES.filter((t) => typeCounts[t]).map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={clsx(
                "text-[10px] font-mono font-semibold uppercase tracking-wider rounded-full px-2.5 py-0.5 border transition-colors cursor-pointer",
                activeTypes.has(t)
                  ? badgeClass(t)
                  : "bg-bg-tertiary text-text-muted border-border hover:text-foreground"
              )}
            >
              {t} ({typeCounts[t]})
            </button>
          ))}

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="ml-auto text-[11px] font-mono bg-bg-tertiary border border-border rounded-lg px-2.5 py-1 outline-none focus:border-accent/40 transition-colors w-40 placeholder:text-text-muted"
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-text-muted text-[12px]">
            No signals match the current filter
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left bg-bg-secondary text-text-muted border-b-2 border-border px-4 py-2 font-semibold text-[11px] uppercase tracking-wide w-24">Type</th>
                <th className="text-left bg-bg-secondary text-text-muted border-b-2 border-border px-4 py-2 font-semibold text-[11px] uppercase tracking-wide">Signal</th>
                <th className="text-left bg-bg-secondary text-text-muted border-b-2 border-border px-4 py-2 font-semibold text-[11px] uppercase tracking-wide w-48">Value</th>
                <th className="text-left bg-bg-secondary text-text-muted border-b-2 border-border px-4 py-2 font-semibold text-[11px] uppercase tracking-wide w-32">Host(s)</th>
                <th className="text-left bg-bg-secondary text-text-muted border-b-2 border-border px-4 py-2 font-semibold text-[11px] uppercase tracking-wide w-16">Seen</th>
                <th className="bg-bg-secondary border-b-2 border-border w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((sig, i) => (
                <tr key={i} className="border-b border-border/30 hover:bg-accent/[.04] transition-colors">
                  {/* Type badge */}
                  <td className="px-4 py-2.5 w-24">
                    <div className="flex items-center gap-1.5">
                      <TypeIcon type={sig.type} />
                      <span className={clsx(
                        "text-[10px] font-mono font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 border",
                        badgeClass(sig.type)
                      )}>
                        {sig.type}
                      </span>
                    </div>
                  </td>

                  {/* Label + location */}
                  <td className="px-4 py-2.5">
                    <div className="text-[11px] text-foreground font-medium">{sig.label}</div>
                    <div className="text-[10px] text-text-muted font-mono mt-0.5">
                      {sig.location}
                      {sig.headerName ? ` · ${sig.headerName}` : ""}
                    </div>
                  </td>

                  {/* Masked value */}
                  <td className="px-4 py-2.5 w-48">
                    <span className="font-mono text-[10px] text-text-muted break-all">
                      {maskValue(sig.value, sig.type)}
                    </span>
                  </td>

                  {/* Hosts */}
                  <td className="px-4 py-2.5 w-32">
                    <div className="font-mono text-[10px] text-text-secondary truncate" title={sig.hosts.join(", ")}>
                      {sig.hosts[0]}
                      {sig.hosts.length > 1 && (
                        <span className="text-text-muted"> +{sig.hosts.length - 1}</span>
                      )}
                    </div>
                  </td>

                  {/* Occurrence count */}
                  <td className="px-4 py-2.5 w-16 text-center">
                    <span className="text-[11px] font-mono text-text-muted">{sig.occurrences}×</span>
                  </td>

                  {/* Copy */}
                  <td className="px-2 py-2.5 w-10 text-center">
                    <CopyBtn text={sig.value} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

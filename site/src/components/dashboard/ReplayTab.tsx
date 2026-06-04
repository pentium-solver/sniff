"use client";

import { useState, useEffect, useRef } from "react";
import {
  Send,
  Plus,
  Trash2,
  Clock,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import type { Flow } from "@/lib/types";
import { apiPost } from "@/lib/api";
import JsonView from "./JsonView";
import clsx from "clsx";

// ── Types ────────────────────────────────────────────────────────────────────

interface EditableHeader {
  id: string;
  key: string;
  value: string;
}

interface ReplayState {
  method: string;
  url: string;
  headers: EditableHeader[];
  body: string;
}

interface ReplayResult {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
  encoding: string; // "" or "base64"
  duration_ms: number;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const MAX_HISTORY = 5;

function statusClass(s: number): string {
  const c = String(s)[0];
  if (c === "2") return "bg-good/15 text-good";
  if (c === "3") return "bg-[#d29922]/15 text-[#d29922]";
  if (c === "4" || c === "5") return "bg-[#f85149]/15 text-[#f85149]";
  return "bg-bg-tertiary text-text-muted";
}

function isPseudoHeader(key: string): boolean {
  return key.startsWith(":") || key.toLowerCase() === "content-length";
}

function flowToState(flow: Flow): ReplayState {
  const headers: EditableHeader[] = Object.entries(flow.req_headers || {})
    .filter(([k]) => !isPseudoHeader(k))
    .map(([k, v], i) => ({ id: `h_${i}_${k}`, key: k, value: v }));
  return {
    method: flow.method,
    url: flow.url,
    headers,
    body: flow.req_body || "",
  };
}

function flowKey(flow: Flow): string {
  return flow._id ?? String(flow.ts);
}

// ── ResponsePanel ─────────────────────────────────────────────────────────────

function ResponsePanel({ result }: { result: ReplayResult }) {
  const [headersOpen, setHeadersOpen] = useState(false);
  const headerEntries = Object.entries(result.headers || {});
  const contentType =
    result.headers?.["Content-Type"] ??
    result.headers?.["content-type"] ??
    "";

  if (result.error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[#f85149]/20 bg-[#f85149]/5 px-4 py-3 text-[12px] text-[#f85149]">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {result.error}
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-3 px-3 py-2 bg-bg-secondary border-b border-border">
        <span
          className={clsx(
            "rounded px-2 py-0.5 text-[11px] font-semibold font-mono",
            statusClass(result.status)
          )}
        >
          {result.status}
        </span>
        <span className="text-[11px] text-text-muted font-mono">
          {result.status_text}
        </span>
        {result.encoding === "base64" && (
          <span className="text-[10px] text-text-muted bg-bg-tertiary border border-border rounded px-1.5 py-0.5 font-mono">
            binary
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-text-muted font-mono">
          <Clock className="h-3 w-3" />
          {result.duration_ms}ms
        </span>
      </div>

      {/* Response headers (collapsible) */}
      {headerEntries.length > 0 && (
        <div className="border-b border-border">
          <button
            onClick={() => setHeadersOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            {headersOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Response Headers ({headerEntries.length})
          </button>
          {headersOpen && (
            <table className="w-full border-collapse">
              <tbody>
                {headerEntries.map(([k, v]) => (
                  <tr key={k} className="border-t border-border/30 hover:bg-accent/[.04]">
                    <td className="px-3 py-1 text-[11px] font-mono text-accent whitespace-nowrap w-[220px]">
                      {k}
                    </td>
                    <td className="px-3 py-1 text-[11px] font-mono text-text-secondary break-all">
                      {v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Body */}
      <div className="p-3">
        {result.encoding === "base64" ? (
          <div className="text-[11px] text-text-muted italic font-mono">
            Binary response — {Math.round((result.body.length * 3) / 4)} bytes
          </div>
        ) : (
          <JsonView text={result.body} mime={contentType} />
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface ReplayTabProps {
  flow: Flow;
}

export default function ReplayTab({ flow }: ReplayTabProps) {
  const [state, setState] = useState<ReplayState>(() => flowToState(flow));
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ReplayResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const prevKeyRef = useRef(flowKey(flow));

  // Re-initialise when a different flow row is selected.
  useEffect(() => {
    const k = flowKey(flow);
    if (k !== prevKeyRef.current) {
      prevKeyRef.current = k;
      setState(flowToState(flow));
      setHistory([]);
      setActiveIdx(0);
    }
  }, [flow]);

  function updateHeader(id: string, field: "key" | "value", val: string) {
    setState((s) => ({
      ...s,
      headers: s.headers.map((h) =>
        h.id === id ? { ...h, [field]: val } : h
      ),
    }));
  }

  function removeHeader(id: string) {
    setState((s) => ({
      ...s,
      headers: s.headers.filter((h) => h.id !== id),
    }));
  }

  function addHeader() {
    setState((s) => ({
      ...s,
      headers: [
        ...s.headers,
        { id: `h_${Date.now()}`, key: "", value: "" },
      ],
    }));
  }

  function resetToOriginal() {
    setState(flowToState(flow));
  }

  async function send() {
    if (loading || !state.url) return;
    setLoading(true);
    try {
      const headersMap: Record<string, string> = {};
      for (const h of state.headers) {
        if (h.key.trim()) headersMap[h.key.trim()] = h.value;
      }
      const result = await apiPost<ReplayResult>("/replay", {
        method: state.method,
        url: state.url,
        headers: headersMap,
        body: state.body,
      });
      setHistory((prev) => [result, ...prev].slice(0, MAX_HISTORY));
      setActiveIdx(0);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Request failed";
      const errResult: ReplayResult = {
        status: 0,
        status_text: "",
        headers: {},
        body: "",
        encoding: "",
        duration_ms: 0,
        error: msg,
      };
      setHistory((prev) => [errResult, ...prev].slice(0, MAX_HISTORY));
      setActiveIdx(0);
    } finally {
      setLoading(false);
    }
  }

  const showBody = ["POST", "PUT", "PATCH", "DELETE"].includes(state.method);
  const currentResult = history[activeIdx] ?? null;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Method + URL + Actions ── */}
      <div className="flex items-center gap-2">
        <select
          value={state.method}
          onChange={(e) =>
            setState((s) => ({ ...s, method: e.target.value }))
          }
          className="bg-bg-tertiary border border-border rounded-lg px-2 py-1.5 text-[12px] font-mono font-semibold text-accent-bright outline-none focus:border-accent/40 transition-colors cursor-pointer shrink-0"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={state.url}
          onChange={(e) =>
            setState((s) => ({ ...s, url: e.target.value }))
          }
          onKeyDown={(e) => e.key === "Enter" && send()}
          className="flex-1 bg-bg-primary border border-border rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-foreground placeholder:text-text-muted outline-none focus:border-accent/40 transition-colors"
          placeholder="https://…"
          spellCheck={false}
        />

        <button
          onClick={resetToOriginal}
          title="Reset to original request"
          className="p-1.5 rounded-lg border border-border bg-bg-tertiary text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer shrink-0"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={send}
          disabled={loading || !state.url}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/20 text-[12px] font-medium text-accent-bright hover:bg-accent/25 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <Send
            className={clsx(
              "h-3.5 w-3.5",
              loading && "animate-pulse"
            )}
          />
          {loading ? "Sending…" : "Send"}
        </button>
      </div>

      {/* ── Request Headers ── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-bg-secondary border-b border-border">
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
            Request Headers
          </span>
          <button
            onClick={addHeader}
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>
        <div className="divide-y divide-border/40">
          {state.headers.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-text-muted italic">
              No headers
            </p>
          )}
          {state.headers.map((h) => (
            <div key={h.id} className="flex items-center gap-1 px-2 py-1">
              <input
                value={h.key}
                onChange={(e) => updateHeader(h.id, "key", e.target.value)}
                placeholder="Header-Name"
                className="w-[180px] shrink-0 bg-transparent text-[11px] font-mono text-accent outline-none px-1 py-0.5 border-b border-transparent focus:border-accent/30 transition-colors"
                spellCheck={false}
              />
              <span className="text-text-muted text-[10px] shrink-0">:</span>
              <input
                value={h.value}
                onChange={(e) => updateHeader(h.id, "value", e.target.value)}
                placeholder="value"
                className="flex-1 bg-transparent text-[11px] font-mono text-text-secondary outline-none px-1 py-0.5 border-b border-transparent focus:border-accent/30 transition-colors"
                spellCheck={false}
              />
              <button
                onClick={() => removeHeader(h.id)}
                className="text-text-muted hover:text-[#f85149] transition-colors cursor-pointer shrink-0 p-0.5"
                title="Remove header"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Request Body (only for mutation methods) ── */}
      {showBody && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="px-3 py-1.5 bg-bg-secondary border-b border-border">
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Request Body
            </span>
          </div>
          <textarea
            value={state.body}
            onChange={(e) =>
              setState((s) => ({ ...s, body: e.target.value }))
            }
            rows={6}
            placeholder="Request body…"
            className="w-full bg-bg-primary px-3 py-2 text-[11px] font-mono text-foreground placeholder:text-text-muted resize-y outline-none leading-relaxed"
            spellCheck={false}
          />
        </div>
      )}

      {/* ── History strip ── */}
      {history.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-text-muted font-mono uppercase tracking-wider">
            History:
          </span>
          {history.map((r, i) => (
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              className={clsx(
                "rounded px-2 py-0.5 text-[10px] font-mono font-semibold transition-colors cursor-pointer border",
                i === activeIdx
                  ? `${statusClass(r.status)} border-current/20`
                  : "bg-bg-tertiary text-text-muted border-border hover:text-foreground"
              )}
            >
              {r.error ? "ERR" : r.status}
            </button>
          ))}
        </div>
      )}

      {/* ── Response ── */}
      {currentResult ? (
        <ResponsePanel result={currentResult} />
      ) : (
        !loading && (
          <div className="flex items-center justify-center h-24 text-text-muted text-[12px] border border-dashed border-border rounded-xl">
            Send a request to see the response
          </div>
        )
      )}
    </div>
  );
}

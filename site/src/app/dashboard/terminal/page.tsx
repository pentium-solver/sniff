"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Terminal as TerminalIcon,
  Trash2,
  Filter,
  X,
  Wifi,
  WifiOff,
  ArrowDown,
} from "lucide-react";
import { useAppState } from "@/lib/store";
import clsx from "clsx";

function colorForStyle(style: string): string {
  switch (style) {
    case "green":
      return "text-good";
    case "red":
      return "text-bad";
    case "yellow":
      return "text-warn";
    case "cyan":
      return "text-accent";
    case "dim":
      return "text-text-muted";
    default:
      return "text-foreground";
  }
}

export default function TerminalPage() {
  const { logs, setLogs, connected } = useAppState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const prevLogCount = useRef(0);

  const filteredLogs = filter
    ? logs.filter((l) => l.Msg.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (autoScroll && logs.length > prevLogCount.current) {
      scrollToBottom();
    }
    prevLogCount.current = logs.length;
  }, [logs, autoScroll, scrollToBottom]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-border bg-bg-secondary flex items-center gap-2 shrink-0">
        <TerminalIcon className="h-4 w-4 text-accent" />
        <span className="text-[12px] font-semibold text-foreground">
          Terminal
        </span>

        <div className="flex items-center gap-1 ml-2">
          {connected ? (
            <span className="flex items-center gap-1 text-[10px] text-good">
              <Wifi className="h-3 w-3" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-bad">
              <WifiOff className="h-3 w-3" />
              Disconnected
            </span>
          )}
        </div>

        <div className="flex-1" />

        <span className="text-[10px] font-mono text-text-muted">
          {filteredLogs.length === logs.length
            ? `${logs.length} lines`
            : `${filteredLogs.length}/${logs.length}`}
        </span>

        {showFilter ? (
          <div className="flex items-center gap-1 bg-bg-tertiary border border-border rounded-lg px-2 py-0.5">
            <Filter className="h-3 w-3 text-text-muted shrink-0" />
            <input
              ref={filterRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter logs…"
              className="bg-transparent text-[11px] text-foreground outline-none w-40 placeholder:text-text-muted"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setFilter("");
                  setShowFilter(false);
                }
              }}
            />
            <button
              onClick={() => {
                setFilter("");
                setShowFilter(false);
              }}
              className="text-text-muted hover:text-foreground cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setShowFilter(true);
              setTimeout(() => filterRef.current?.focus(), 50);
            }}
            className="p-1 rounded text-text-muted hover:text-foreground hover:bg-bg-tertiary transition-colors cursor-pointer"
            title="Filter"
          >
            <Filter className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          onClick={() => setLogs(() => [])}
          className="p-1 rounded text-text-muted hover:text-foreground hover:bg-bg-tertiary transition-colors cursor-pointer"
          title="Clear"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-[#08080a] font-mono text-[11px] leading-[18px] relative"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-[12px]">
            {!connected ? (
              <div className="text-center space-y-1">
                <WifiOff className="h-5 w-5 mx-auto text-text-muted/50" />
                <div>Backend not connected</div>
                <div className="text-[10px] text-text-muted/60">
                  Retrying automatically…
                </div>
              </div>
            ) : (
              "Waiting for output…"
            )}
          </div>
        ) : (
          <div className="p-3 space-y-0">
            {filteredLogs.map((log, i) => (
              <div key={i} className="flex gap-2 hover:bg-white/[0.02]">
                <span className="text-text-muted/40 shrink-0 select-none w-16">
                  {log.Time}
                </span>
                <span className={colorForStyle(log.Style)}>{log.Msg}</span>
              </div>
            ))}
          </div>
        )}

        {!autoScroll && filteredLogs.length > 0 && (
          <button
            onClick={() => {
              setAutoScroll(true);
              scrollToBottom();
            }}
            className="sticky bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-accent/90 text-white text-[10px] font-medium px-3 py-1 rounded-full shadow-lg cursor-pointer hover:bg-accent transition-colors"
          >
            <ArrowDown className="h-3 w-3" />
            New output
          </button>
        )}
      </div>
    </div>
  );
}

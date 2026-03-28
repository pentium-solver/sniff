"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Terminal as TerminalIcon,
  ChevronDown,
  ChevronUp,
  Trash2,
  Filter,
  X,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useAppState } from "@/lib/store";
import clsx from "clsx";

const MIN_HEIGHT = 38;
const DEFAULT_HEIGHT = 220;
const MAX_HEIGHT = 500;

export default function TerminalPanel() {
  const { logs, setLogs, connected } = useAppState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [collapsed, setCollapsed] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Detect manual scroll-up to pause auto-scroll
  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 30;
    setAutoScroll(atBottom);
  }

  // Drag-to-resize
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = height;

      function onMouseMove(ev: MouseEvent) {
        if (!dragging.current) return;
        const delta = startY.current - ev.clientY;
        const next = Math.min(MAX_HEIGHT, Math.max(80, startH.current + delta));
        setHeight(next);
        setCollapsed(false);
      }

      function onMouseUp() {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [height]
  );

  const styleClass = (s: string) => {
    if (s === "green") return "text-good";
    if (s === "red") return "text-bad";
    if (s === "yellow") return "text-warn";
    if (s === "cyan") return "text-accent-bright";
    return "text-text-muted";
  };

  const filtered = filter
    ? logs.filter((l) => l.Msg.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  const unread = collapsed ? logs.length : 0;

  return (
    <div
      ref={panelRef}
      className="shrink-0 border-t border-border bg-[#08080a] flex flex-col"
      style={{ height: collapsed ? MIN_HEIGHT : height }}
    >
      {/* Drag handle */}
      {!collapsed && (
        <div
          className="h-1 cursor-row-resize hover:bg-accent/30 transition-colors group relative"
          onMouseDown={onMouseDown}
        >
          <div className="absolute inset-x-0 -top-1 -bottom-1" />
          <div className="absolute left-1/2 -translate-x-1/2 top-0 w-8 h-1 rounded-full bg-border-light opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 shrink-0 h-[37px] border-b border-border/50">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-text-secondary hover:text-foreground hover:bg-bg-tertiary transition-colors cursor-pointer"
        >
          <TerminalIcon className="h-3.5 w-3.5" />
          Terminal
          {unread > 0 && (
            <span className="ml-1 text-[10px] font-mono font-semibold text-accent-bright bg-accent/15 rounded px-1.5 py-0.5 min-w-[18px] text-center">
              {unread}
            </span>
          )}
          {collapsed ? (
            <ChevronUp className="h-3 w-3 ml-0.5" />
          ) : (
            <ChevronDown className="h-3 w-3 ml-0.5" />
          )}
        </button>

        {/* Connection indicator */}
        <div
          className={clsx(
            "flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5",
            connected
              ? "text-good/70"
              : "text-bad/70"
          )}
        >
          {connected ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          {connected ? "Connected" : "Disconnected"}
        </div>

        {!collapsed && (
          <>
            <div className="flex-1" />

            {/* Filter */}
            {showFilter ? (
              <div className="flex items-center gap-1 bg-bg-tertiary border border-border rounded-md px-2 py-0.5">
                <Filter className="h-3 w-3 text-text-muted shrink-0" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter logs…"
                  className="bg-transparent text-[11px] text-foreground outline-none w-32 placeholder:text-text-muted"
                  autoFocus
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
                onClick={() => setShowFilter(true)}
                className="p-1 rounded text-text-muted hover:text-foreground hover:bg-bg-tertiary transition-colors cursor-pointer"
                title="Filter"
              >
                <Filter className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Clear */}
            <button
              onClick={() => setLogs(() => [])}
              className="p-1 rounded text-text-muted hover:text-foreground hover:bg-bg-tertiary transition-colors cursor-pointer"
              title="Clear terminal"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Log content */}
      {!collapsed && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden font-mono text-[11px] leading-[18px] px-3 py-1.5 select-text"
        >
          {!connected && filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <WifiOff className="h-5 w-5 text-text-muted/30" />
              <span className="text-text-muted/50 text-[11px]">
                Backend not connected
              </span>
              <span className="text-text-muted/30 text-[10px]">
                Retrying automatically…
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-muted/50 text-[11px]">
              {filter
                ? "No matching log entries"
                : "Connected — waiting for output…"}
            </div>
          ) : (
            filtered.map((log, i) => (
              <div
                key={i}
                className={clsx(
                  "py-[1px] whitespace-pre-wrap break-all hover:bg-white/[0.02] px-1 -mx-1 rounded",
                  styleClass(log.Style)
                )}
              >
                <span className="text-text-muted/40 select-none mr-2">
                  {log.Time}
                </span>
                {log.Msg}
              </div>
            ))
          )}

          {/* Auto-scroll indicator */}
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                if (scrollRef.current)
                  scrollRef.current.scrollTop =
                    scrollRef.current.scrollHeight;
              }}
              className="sticky bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1 text-[10px] font-medium text-accent-bright bg-accent/15 border border-accent/20 rounded-full px-2.5 py-1 cursor-pointer hover:bg-accent/25 transition-colors backdrop-blur-sm"
            >
              <ChevronDown className="h-3 w-3" />
              New output
            </button>
          )}
        </div>
      )}
    </div>
  );
}

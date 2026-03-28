"use client";

import { useEffect, useRef } from "react";
import { useAppState } from "@/lib/store";

export default function LogPanel() {
  const { logs } = useAppState();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs]);

  const styleClass = (s: string) => {
    if (s === "green") return "text-good";
    if (s === "red") return "text-[#f85149]";
    if (s === "yellow") return "text-[#d29922]";
    if (s === "cyan") return "text-accent";
    return "text-text-muted";
  };

  return (
    <div
      ref={ref}
      className="border-t border-border bg-bg-secondary max-h-[150px] overflow-y-auto font-mono text-[11px] px-3.5 py-1.5"
    >
      {logs.map((log, i) => (
        <div key={i} className={`py-0.5 ${styleClass(log.Style)}`}>
          [{log.Time}] {log.Msg}
        </div>
      ))}
    </div>
  );
}

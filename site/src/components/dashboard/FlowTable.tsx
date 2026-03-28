"use client";

import { useMemo, useState } from "react";
import { formatBytes } from "@/lib/api";
import type { Flow } from "@/lib/types";

interface FlowTableProps {
  flows: Flow[];
  selected: number;
  onSelect: (idx: number) => void;
}

function methodClass(m: string): string {
  const map: Record<string, string> = {
    GET: "bg-good/15 text-good",
    POST: "bg-accent-dim text-accent",
    PUT: "bg-[#d29922]/15 text-[#d29922]",
    PATCH: "bg-[#d29922]/15 text-[#d29922]",
    DELETE: "bg-[#f85149]/15 text-[#f85149]",
  };
  return map[m] || "bg-bg-tertiary text-text-muted";
}

function statusClass(s: number): string {
  const c = String(s)[0];
  if (c === "2") return "text-good";
  if (c === "3") return "text-[#d29922]";
  if (c === "4" || c === "5") return "text-[#f85149]";
  return "text-text-muted";
}

const cols = [
  { key: "index", label: "#", w: "w-11" },
  { key: "status", label: "Status", w: "w-14" },
  { key: "method", label: "Method", w: "w-[72px]" },
  { key: "host", label: "Host", w: "w-40" },
  { key: "path", label: "Path", w: "" },
  { key: "resp_size", label: "Size", w: "w-16" },
];

export default function FlowTable({
  flows,
  selected,
  onSelect,
}: FlowTableProps) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = useMemo(() => {
    const arr = flows.map((f, i) => ({ ...f, _index: i + 1 }));
    if (!sortCol) return arr;
    const col = sortCol;
    const dir = sortAsc ? 1 : -1;
    return [...arr].sort((a, b) => {
      const av = col === "index" ? a._index : (a as any)[col];
      const bv = col === "index" ? b._index : (b as any)[col];
      if (typeof av === "string") return dir * av.localeCompare(bv);
      return dir * ((av ?? 0) - (bv ?? 0));
    });
  }, [flows, sortCol, sortAsc]);

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            {cols.map((col) => (
              <th
                key={col.key}
                className={`text-left bg-bg-secondary text-text-muted border-b-2 border-border px-2 py-2 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-foreground ${col.w} ${sortCol === col.key ? "text-accent" : ""}`}
                onClick={() => toggleSort(col.key)}
              >
                {col.label}
                <span
                  className={`ml-0.5 text-[10px] ${sortCol === col.key ? "opacity-100" : "opacity-40"}`}
                >
                  {sortCol === col.key ? (sortAsc ? "\u25B2" : "\u25BC") : "\u25B2"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((flow, idx) => (
            <tr
              key={flow._index}
              className={`cursor-pointer border-b border-border/30 transition-colors duration-75 hover:bg-accent/[.06] ${idx === selected ? "bg-accent-dim" : ""}`}
              onClick={() => onSelect(idx)}
            >
              <td className="px-2 py-1.5 text-text-muted w-11">
                {flow._index}
              </td>
              <td className={`px-2 py-1.5 w-14 ${statusClass(flow.status)}`}>
                {flow.status}
              </td>
              <td className="px-2 py-1.5 w-[72px]">
                <span
                  className={`inline-block rounded px-1.5 py-px text-[11px] font-semibold font-mono ${methodClass(flow.method)}`}
                >
                  {flow.method}
                </span>
              </td>
              <td
                className="px-2 py-1.5 w-40 text-text-secondary truncate"
                title={flow.host}
              >
                {flow.host}
              </td>
              <td
                className="px-2 py-1.5 text-text-secondary truncate max-w-0"
                title={flow.path}
              >
                {flow.path}
              </td>
              <td className="px-2 py-1.5 w-16 text-text-secondary">
                {formatBytes(flow.resp_size)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

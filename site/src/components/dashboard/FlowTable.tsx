"use client";

import { useMemo, useState } from "react";
import { formatBytes } from "@/lib/api";
import type { Flow } from "@/lib/types";
import { useAnnotationsAll } from "@/hooks/useAnnotation";
import PinButton from "./PinButton";
import TagList from "./TagList";
import InlineLabel from "./InlineLabel";
import { NoteIndicator } from "./NoteEditor";
import { SignalWarning } from "./SignalsPanel";

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
  { key: "index", label: "#", w: "w-14" },
  { key: "status", label: "Status", w: "w-14" },
  { key: "method", label: "Method", w: "w-[72px]" },
  { key: "host", label: "Host", w: "w-44" },
  { key: "path", label: "Path", w: "" },
  { key: "resp_size", label: "Size", w: "w-16" },
];

function FlowRow({
  flow,
  idx,
  selected,
  onSelect,
}: {
  flow: Flow & { _index: number };
  idx: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const id = flow._id ?? `flow_${flow._index}`;

  return (
    <tr
      className={`cursor-pointer border-b border-border/30 transition-colors duration-75 hover:bg-accent/[.06] ${selected ? "bg-accent-dim" : ""}`}
      onClick={onSelect}
    >
      {/* # + pin */}
      <td className="px-2 py-1.5 text-text-muted w-14">
        <div className="flex items-center gap-1">
          <PinButton id={id} />
          <span className="text-[11px] font-mono">{flow._index}</span>
        </div>
      </td>

      {/* Status */}
      <td className={`px-2 py-1.5 w-14 font-mono text-[11px] ${statusClass(flow.status)}`}>
        {flow.status}
      </td>

      {/* Method */}
      <td className="px-2 py-1.5 w-[72px]">
        <span className={`inline-block rounded px-1.5 py-px text-[11px] font-semibold font-mono ${methodClass(flow.method)}`}>
          {flow.method}
        </span>
      </td>

      {/* Host with inline label, tags, note indicator */}
      <td className="px-2 py-1.5 w-44">
        <InlineLabel
          id={id}
          fallback={flow.host}
          className="text-[11px] text-text-secondary truncate block max-w-[160px]"
        />
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <TagList id={id} maxTags={3} />
          <NoteIndicator id={id} />
          <SignalWarning flow={flow} />
        </div>
      </td>

      {/* Path */}
      <td className="px-2 py-1.5 text-text-secondary truncate max-w-0 text-[11px]" title={flow.path}>
        {flow.path}
      </td>

      {/* Size */}
      <td className="px-2 py-1.5 w-16 text-text-secondary text-[11px]">
        {formatBytes(flow.resp_size)}
      </td>
    </tr>
  );
}

export default function FlowTable({ flows, selected, onSelect }: FlowTableProps) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const allAnns = useAnnotationsAll();

  const withIndex = useMemo(
    () => flows.map((f, i) => ({ ...f, _index: i + 1 })),
    [flows]
  );

  const sorted = useMemo(() => {
    if (!sortCol) return withIndex;
    const col = sortCol;
    const dir = sortAsc ? 1 : -1;
    return [...withIndex].sort((a, b) => {
      const av = col === "index" ? a._index : (a as any)[col];
      const bv = col === "index" ? b._index : (b as any)[col];
      if (typeof av === "string") return dir * av.localeCompare(bv);
      return dir * ((av ?? 0) - (bv ?? 0));
    });
  }, [withIndex, sortCol, sortAsc]);

  function toggleSort(col: string) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  const pinned = sorted.filter((f) => allAnns[f._id ?? `flow_${f._index}`]?.pinned);
  const unpinned = sorted.filter((f) => !allAnns[f._id ?? `flow_${f._index}`]?.pinned);

  function renderRow(flow: Flow & { _index: number }, displayIdx: number) {
    const id = flow._id ?? `flow_${flow._index}`;
    const globalIdx = sorted.indexOf(flow);
    return (
      <FlowRow
        key={flow._id ?? flow._index}
        flow={flow}
        idx={displayIdx}
        selected={globalIdx === selected}
        onSelect={() => onSelect(globalIdx)}
      />
    );
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
                <span className={`ml-0.5 text-[10px] ${sortCol === col.key ? "opacity-100" : "opacity-40"}`}>
                  {sortCol === col.key ? (sortAsc ? "▲" : "▼") : "▲"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pinned.length > 0 && (
            <>
              <tr>
                <td colSpan={6} className="px-2 py-0.5 bg-bg-secondary/80 border-b border-border">
                  <span className="text-[9px] font-mono font-semibold uppercase tracking-widest text-text-muted/60">Pinned</span>
                </td>
              </tr>
              {pinned.map((f, i) => renderRow(f, i + 1))}
              {unpinned.length > 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-0.5 bg-bg-secondary/80 border-b border-border">
                    <span className="text-[9px] font-mono font-semibold uppercase tracking-widest text-text-muted/60">All</span>
                  </td>
                </tr>
              )}
            </>
          )}
          {unpinned.map((f, i) => renderRow(f, pinned.length + i + 1))}
        </tbody>
      </table>
    </div>
  );
}

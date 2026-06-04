"use client";

import { useState, useEffect } from "react";
import { Folder, FolderOpen, ChevronRight, X, Check, Home, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import clsx from "clsx";

interface BrowseResult {
  path: string;
  parent: string;
  entries: { name: string }[];
}

interface FolderPickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export default function FolderPicker({ initialPath, onSelect, onClose }: FolderPickerProps) {
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(initialPath || "");

  async function browse(path?: string) {
    setLoading(true);
    try {
      const params = path ? `?path=${encodeURIComponent(path)}` : "";
      const data = await api(`/browse${params}`) as BrowseResult;
      setResult(data);
      setSelected(data.path);
    } catch (e) {
      console.error("browse:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    browse(initialPath);
  }, []);

  // Breadcrumb segments from current path
  function breadcrumbs(path: string) {
    const sep = path.startsWith("/") ? "/" : "\\";
    const parts = path.split(/[\\/]/).filter(Boolean);
    const crumbs: { label: string; path: string }[] = [];
    let acc = sep === "/" ? "" : "";
    for (const part of parts) {
      acc = acc ? `${acc}${sep}${part}` : (sep === "/" ? `/${part}` : part);
      crumbs.push({ label: part, path: acc });
    }
    if (sep === "/") crumbs.unshift({ label: "/", path: "/" });
    return crumbs;
  }

  const crumbs = result ? breadcrumbs(result.path) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-card border border-card-border rounded-2xl shadow-2xl shadow-black/60 w-[520px] max-h-[520px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-accent-bright" />
            <span className="text-[13px] font-semibold">Choose folder</span>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-foreground cursor-pointer transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-bg-secondary/50 overflow-x-auto shrink-0">
          <button
            onClick={() => browse("")}
            title="Home"
            className="text-text-muted hover:text-foreground cursor-pointer transition-colors shrink-0"
          >
            <Home className="h-3.5 w-3.5" />
          </button>
          {crumbs.map((c, i) => (
            <div key={c.path} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="h-3 w-3 text-text-muted/40" />
              <button
                onClick={() => browse(c.path)}
                className={clsx(
                  "text-[11px] font-mono cursor-pointer transition-colors hover:text-foreground",
                  i === crumbs.length - 1 ? "text-foreground font-semibold" : "text-text-muted"
                )}
              >
                {c.label}
              </button>
            </div>
          ))}
        </div>

        {/* Directory listing */}
        <div className="flex-1 overflow-auto p-2 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-24 text-text-muted text-[12px]">
              Loading…
            </div>
          ) : result?.entries.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-text-muted text-[12px]">
              Empty directory
            </div>
          ) : (
            <div className="space-y-0.5">
              {result?.parent && (
                <button
                  onClick={() => browse(result.parent)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12px] text-text-muted hover:bg-bg-elevated hover:text-foreground transition-colors cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span className="font-mono">..</span>
                </button>
              )}
              {result?.entries.map((e) => {
                const fullPath = result.path.endsWith("/") || result.path.endsWith("\\")
                  ? `${result.path}${e.name}`
                  : `${result.path}/${e.name}`;
                return (
                  <button
                    key={e.name}
                    onClick={() => browse(fullPath)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12px] text-foreground hover:bg-bg-elevated transition-colors cursor-pointer text-left"
                  >
                    <Folder className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span className="font-mono truncate">{e.name}</span>
                    <ChevronRight className="h-3 w-3 text-text-muted/30 ml-auto shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected path + confirm */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0 bg-bg-secondary/40">
          <span className="flex-1 text-[11px] font-mono text-foreground bg-bg-tertiary border border-border rounded-lg px-2.5 py-1.5 truncate">
            {selected || "—"}
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl border border-border bg-bg-tertiary text-[12px] font-medium text-text-secondary hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => { onSelect(selected); onClose(); }}
            disabled={!selected}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent/15 border border-accent/20 text-[12px] font-medium text-accent-bright hover:bg-accent/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check className="h-3.5 w-3.5" />
            Select
          </button>
        </div>
      </div>
    </div>
  );
}

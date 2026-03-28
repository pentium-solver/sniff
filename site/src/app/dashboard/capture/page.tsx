"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw, Search, X as XIcon } from "lucide-react";
import TerminalPanel from "@/components/dashboard/Terminal";
import { useAppState } from "@/lib/store";
import { apiPost, flowsToHar, downloadJson } from "@/lib/api";
import {
  resourceTypes,
  type ResourceType,
  classifyFlow,
  filterByResourceType,
} from "@/lib/filters";
import FlowTable from "@/components/dashboard/FlowTable";
import FlowDetail from "@/components/dashboard/FlowDetail";
import type { Flow } from "@/lib/types";
import clsx from "clsx";

interface ConflictState {
  mode: string;
  restarting: boolean;
}

function CaptureConflictModal({
  onRestart,
  onCancel,
  restarting,
}: {
  onRestart: () => void;
  onCancel: () => void;
  restarting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-sm mx-4 rounded-2xl border border-card-border bg-card shadow-2xl shadow-black/40 overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-warn to-warn/50" />
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warn/10 border border-warn/15">
              <AlertTriangle className="h-5 w-5 text-warn" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">
                Capture in progress
              </h3>
              <p className="mt-1 text-sm text-text-secondary leading-relaxed">
                A capture session is already running. Would you like to stop it
                and start a new one?
              </p>
            </div>
          </div>
          <div className="flex gap-2.5 pt-1">
            <button
              onClick={onCancel}
              disabled={restarting}
              className="flex-1 rounded-xl border border-border bg-bg-tertiary py-2.5 text-[13px] font-medium text-text-secondary hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer disabled:opacity-50"
            >
              Keep current
            </button>
            <button
              onClick={onRestart}
              disabled={restarting}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-warn/15 border border-warn/20 py-2.5 text-[13px] font-semibold text-warn hover:bg-warn/20 transition-colors cursor-pointer disabled:opacity-50"
            >
              {restarting ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5 animate-spin" />
                  Restarting…
                </>
              ) : (
                <>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Stop & restart
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CapturePageWrapper() {
  return (
    <Suspense>
      <CapturePage />
    </Suspense>
  );
}

function CapturePage() {
  const { flows, capturing, pkg, captureName, setFlows, setCapturing } =
    useAppState();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [selectedFlow, setSelectedFlow] = useState<Flow | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [resourceFilter, setResourceFilter] = useState<ResourceType>("All");
  const [textFilter, setTextFilter] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const didAutoStart = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (didAutoStart.current) return;
    const mode = searchParams.get("mode");
    if (mode) {
      didAutoStart.current = true;
      startCapture(mode);
      router.replace("/dashboard/capture");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resource type counts
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const type of resourceTypes) counts[type] = 0;
    for (const f of flows) {
      counts[classifyFlow(f)]++;
      counts["All"]++;
    }
    return counts;
  }, [flows]);

  // Filtered flows
  const filteredFlows = useMemo(() => {
    let list = filterByResourceType(flows, resourceFilter);
    if (textFilter) {
      const q = textFilter.toLowerCase();
      list = list.filter(
        (f) =>
          f.url.toLowerCase().includes(q) ||
          f.host.toLowerCase().includes(q) ||
          String(f.status).includes(q) ||
          f.method.toLowerCase().includes(q)
      );
    }
    return list;
  }, [flows, resourceFilter, textFilter]);

  async function startCapture(mode = "standard") {
    try {
      await apiPost("/capture/start", { mode, package: pkg });
      setCapturing(true);
    } catch (e: any) {
      if (e.message?.includes("already capturing")) {
        setCapturing(true);
        setConflict({ mode, restarting: false });
        return;
      }
      console.error("start:", e);
    }
  }

  const handleRestart = useCallback(
    async () => {
      if (!conflict) return;
      setConflict((c) => (c ? { ...c, restarting: true } : c));
      try {
        setCapturing(false);
        await apiPost("/capture/stop", {});
        await apiPost("/capture/start", {
          mode: conflict.mode,
          package: pkg,
        });
        setCapturing(true);
      } catch (e: any) {
        console.error("restart:", e);
      } finally {
        setConflict(null);
      }
    },
    [conflict, pkg, setCapturing]
  );

  async function stopCapture() {
    setCapturing(false);
    try {
      await apiPost("/capture/stop", {});
    } catch (e: any) {
      console.error("stop:", e);
      setCapturing(true);
    }
  }

  async function clearFlows() {
    try {
      await apiPost("/capture/clear", {});
      setSelectedIdx(-1);
      setSelectedFlow(null);
      setShowDetail(false);
    } catch (e: any) {
      console.error("clear:", e);
    }
  }

  function handleDownload() {
    if (flows.length === 0) return;
    const har = flowsToHar(flows);
    const name =
      captureName ||
      `capture_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "_")}`;
    downloadJson(har, `${name}.har`);
    setExportMsg(`Downloaded ${flows.length} flows`);
    setTimeout(() => setExportMsg(""), 3000);
  }

  function onSelect(idx: number) {
    setSelectedIdx(idx);
    setSelectedFlow(filteredFlows[idx] || null);
    setShowDetail(true);
  }

  function onClose() {
    setShowDetail(false);
    setSelectedIdx(-1);
    setSelectedFlow(null);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="px-3 py-1.5 border-b border-border bg-bg-secondary flex items-center gap-1.5 shrink-0 flex-wrap">
        {/* Capture controls */}
        {!capturing ? (
          <button
            className="text-[11px] font-medium text-good border border-border rounded-lg px-2.5 py-1 bg-bg-tertiary hover:bg-border transition-colors cursor-pointer"
            onClick={() => startCapture()}
          >
            Start
          </button>
        ) : (
          <button
            className="text-[11px] font-medium text-bad border border-border rounded-lg px-2.5 py-1 bg-bg-tertiary hover:bg-border transition-colors cursor-pointer"
            onClick={stopCapture}
          >
            Stop
          </button>
        )}
        <button
          className="text-[11px] font-medium text-text-muted border border-border rounded-lg px-2.5 py-1 bg-bg-tertiary hover:bg-border hover:text-foreground transition-colors cursor-pointer"
          onClick={clearFlows}
        >
          Clear
        </button>
        <button
          className="text-[11px] font-medium text-text-muted border border-border rounded-lg px-2.5 py-1 bg-bg-tertiary hover:bg-border hover:text-foreground transition-colors cursor-pointer"
          onClick={handleDownload}
          disabled={flows.length === 0}
        >
          Export
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Resource type pills */}
        <div className="flex items-center gap-0.5">
          {resourceTypes.map((type) => (
            <button
              key={type}
              onClick={() =>
                setResourceFilter(resourceFilter === type ? "All" : type)
              }
              className={clsx(
                "text-[10px] font-medium rounded-md px-1.5 py-0.5 transition-colors cursor-pointer",
                resourceFilter === type
                  ? "bg-accent/15 text-accent-bright border border-accent/20"
                  : typeCounts[type] > 0
                    ? "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary"
                    : "text-text-muted/30 cursor-default"
              )}
              disabled={typeCounts[type] === 0 && type !== "All"}
            >
              {type}
              {typeCounts[type] > 0 && type !== "All" && (
                <span className="ml-0.5 opacity-60">{typeCounts[type]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {exportMsg && (
          <span className="text-[11px] text-good font-mono">{exportMsg}</span>
        )}

        {/* Filter count */}
        <span className="text-[10px] font-mono text-text-muted">
          {filteredFlows.length === flows.length
            ? `${flows.length} flows`
            : `${filteredFlows.length}/${flows.length}`}
        </span>

        {/* Text search */}
        {showSearch ? (
          <div className="flex items-center gap-1 bg-bg-tertiary border border-border rounded-lg px-2 py-0.5">
            <Search className="h-3 w-3 text-text-muted shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
              placeholder="Filter…"
              className="bg-transparent text-[11px] text-foreground outline-none w-28 placeholder:text-text-muted"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setTextFilter("");
                  setShowSearch(false);
                }
              }}
            />
            <button
              onClick={() => {
                setTextFilter("");
                setShowSearch(false);
              }}
              className="text-text-muted hover:text-foreground cursor-pointer"
            >
              <XIcon className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setShowSearch(true);
              setTimeout(() => searchRef.current?.focus(), 50);
            }}
            className="p-1 rounded text-text-muted hover:text-foreground hover:bg-bg-tertiary transition-colors cursor-pointer"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        )}

        {captureName && (
          <span className="text-[10px] text-text-muted font-mono truncate max-w-[200px]">
            {captureName}
          </span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        <div
          className={`flex-1 flex flex-col min-w-0 ${showDetail ? "max-w-[60%]" : ""}`}
        >
          <FlowTable
            flows={filteredFlows}
            selected={selectedIdx}
            onSelect={onSelect}
          />
        </div>

        {showDetail && (
          <div className="w-[40%] min-w-[320px] border-l border-border flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-bg-secondary shrink-0">
              <span className="text-[11px] text-text-muted font-medium">
                Detail
              </span>
              <button
                className="text-[11px] text-text-muted hover:text-foreground cursor-pointer"
                onClick={onClose}
              >
                Close
              </button>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              <FlowDetail flow={selectedFlow} onClose={onClose} />
            </div>
          </div>
        )}
      </div>

      <TerminalPanel />

      {conflict && (
        <CaptureConflictModal
          onRestart={handleRestart}
          onCancel={() => setConflict(null)}
          restarting={conflict.restarting}
        />
      )}
    </div>
  );
}

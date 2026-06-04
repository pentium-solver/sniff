"use client";

import { useState, useEffect, useMemo } from "react";
import { Play, Square, Trash2, AlertCircle, Search, X, Layers } from "lucide-react";
import { useAppState } from "@/lib/store";
import { apiPost, api } from "@/lib/api";
import type { AppItem } from "@/lib/types";
import FingerprintTable from "@/components/dashboard/FingerprintTable";
import { useAnnotationsAll } from "@/hooks/useAnnotation";
import clsx from "clsx";

export default function FingerprintsPage() {
  const {
    fingerprints,
    fingerprintCapturing,
    setFingerprints,
    setFingerprintCapturing,
    pkg,
  } = useAppState();

  const [apps, setApps] = useState<AppItem[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [selectedPkg, setSelectedPkg] = useState(pkg || "");
  const [appSearch, setAppSearch] = useState("");
  const [showAppPicker, setShowAppPicker] = useState(false);
  const [error, setError] = useState("");
  const [dedup, setDedup] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const allAnns = useAnnotationsAll();

  // Unique tags across all current fingerprints' annotations
  const activeTags = useMemo(() => {
    const seen = new Set<string>();
    fingerprints.forEach((fp) => {
      (allAnns[fp.id]?.tags ?? []).forEach((t) => seen.add(t));
    });
    return [...seen].sort();
  }, [fingerprints, allAnns]);

  // Apply dedup + tag filter before passing to table
  const displayedFingerprints = useMemo(() => {
    let list = fingerprints;
    if (dedup) {
      const seen = new Set<string>();
      list = list.filter((fp) => {
        if (seen.has(fp.ja4)) return false;
        seen.add(fp.ja4);
        return true;
      });
    }
    if (tagFilter) {
      list = list.filter((fp) => allAnns[fp.id]?.tags.includes(tagFilter));
    }
    return list;
  }, [fingerprints, dedup, tagFilter, allAnns]);

  // Load app list once on mount
  useEffect(() => {
    api("/apps")
      .then((data) => setApps(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setAppsLoading(false));
  }, []);

  // Keep selectedPkg in sync with global pkg
  useEffect(() => {
    if (pkg && !selectedPkg) setSelectedPkg(pkg);
  }, [pkg, selectedPkg]);

  const filteredApps = appSearch
    ? apps.filter(
        (a) =>
          a.Name.toLowerCase().includes(appSearch.toLowerCase()) ||
          a.ID.toLowerCase().includes(appSearch.toLowerCase())
      )
    : apps;

  async function handleStart() {
    setError("");
    try {
      await apiPost("/fingerprint/start", { package: selectedPkg || undefined });
      setFingerprintCapturing(true);
    } catch (e: any) {
      setError(e.message || "Failed to start fingerprint capture");
    }
  }

  async function handleStop() {
    try {
      await apiPost("/fingerprint/stop", {});
      setFingerprintCapturing(false);
    } catch (e: any) {
      console.error("stop fingerprint:", e);
    }
  }

  function handleClear() {
    setFingerprints(() => []);
  }

  const selectedApp = apps.find((a) => a.ID === selectedPkg);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="px-3 py-1.5 border-b border-border bg-bg-secondary flex items-center gap-2 shrink-0 flex-wrap">

        {/* App selector */}
        <div className="relative">
          <button
            onClick={() => setShowAppPicker((v) => !v)}
            className={clsx(
              "flex items-center gap-2 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer",
              showAppPicker
                ? "bg-accent/10 border-accent/20 text-accent-bright"
                : "bg-bg-tertiary border-border text-text-secondary hover:text-foreground hover:bg-bg-elevated"
            )}
          >
            <span className="max-w-[160px] truncate">
              {selectedApp ? selectedApp.Name : selectedPkg || "Select app"}
            </span>
            <span className="text-text-muted text-[10px]">▾</span>
          </button>

          {showAppPicker && (
            <div className="absolute top-full left-0 mt-1 z-50 w-72 rounded-xl border border-card-border bg-card shadow-xl shadow-black/40 overflow-hidden">
              <div className="p-2 border-b border-border">
                <div className="flex items-center gap-2 bg-bg-tertiary rounded-lg px-2.5 py-1.5">
                  <Search className="h-3.5 w-3.5 text-text-muted shrink-0" />
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search apps…"
                    value={appSearch}
                    onChange={(e) => setAppSearch(e.target.value)}
                    className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-text-muted"
                  />
                  {appSearch && (
                    <button onClick={() => setAppSearch("")} className="cursor-pointer text-text-muted hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
              <div className="max-h-52 overflow-y-auto">
                {appsLoading ? (
                  <div className="p-4 text-center text-[12px] text-text-muted">Loading…</div>
                ) : filteredApps.length === 0 ? (
                  <div className="p-4 text-center text-[12px] text-text-muted">No apps found</div>
                ) : (
                  filteredApps.map((app) => (
                    <button
                      key={app.ID}
                      onClick={() => {
                        setSelectedPkg(app.ID);
                        setShowAppPicker(false);
                        setAppSearch("");
                      }}
                      className={clsx(
                        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer border-b border-border/30 last:border-0",
                        selectedPkg === app.ID
                          ? "bg-accent/[0.08] text-accent-bright"
                          : "hover:bg-bg-elevated text-foreground"
                      )}
                    >
                      <div className="w-6 h-6 rounded-md bg-bg-tertiary flex items-center justify-center shrink-0 text-[10px] font-mono text-text-muted">
                        {app.Name[0]?.toUpperCase() || "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-medium truncate">{app.Name}</div>
                        <div className="text-[10px] font-mono text-text-muted truncate">{app.ID}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-border" />

        {/* Start / Stop */}
        {!fingerprintCapturing ? (
          <button
            onClick={handleStart}
            disabled={!selectedPkg && !pkg}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-good/20 bg-good/10 text-good text-[11px] font-medium hover:bg-good/15 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="h-3 w-3" />
            Start Fingerprinting
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-bad/20 bg-bad/10 text-bad text-[11px] font-medium hover:bg-bad/15 transition-colors cursor-pointer"
          >
            <Square className="h-3 w-3 fill-current" />
            Stop
          </button>
        )}

        {/* Active pulse */}
        {fingerprintCapturing && (
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-good animate-pulse-dot" />
            <span className="text-[10px] text-good font-mono">capturing</span>
          </div>
        )}

        {/* Divider */}
        <div className="w-px h-5 bg-border" />

        {/* Dedup toggle */}
        <button
          onClick={() => setDedup((v) => !v)}
          title="Show unique JA4 only"
          className={clsx(
            "flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium transition-colors cursor-pointer",
            dedup
              ? "bg-accent/10 border-accent/20 text-accent-bright"
              : "bg-bg-tertiary border-border text-text-muted hover:text-foreground hover:bg-bg-elevated"
          )}
        >
          <Layers className="h-3 w-3" />
          Dedup
        </button>

        {/* Tag filter chips */}
        {activeTags.map((tag) => (
          <button
            key={tag}
            onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
            className={clsx(
              "text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-lg border transition-colors cursor-pointer",
              tagFilter === tag
                ? "bg-accent/15 border-accent/30 text-accent-bright"
                : "bg-bg-tertiary border-border text-text-muted hover:text-foreground"
            )}
          >
            {tag}
          </button>
        ))}

        <div className="flex-1" />

        {/* Count */}
        {fingerprints.length > 0 && (
          <span className="text-[10px] font-mono text-text-muted">
            {fingerprints.length} fingerprint{fingerprints.length !== 1 ? "s" : ""}
          </span>
        )}

        {/* Clear */}
        <button
          onClick={handleClear}
          disabled={fingerprints.length === 0}
          className="flex items-center gap-1 p-1.5 rounded-lg text-text-muted hover:text-foreground hover:bg-bg-tertiary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title="Clear fingerprints"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-bad/20 bg-bad/[0.04] text-[12px] text-bad">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Info bar — shown when idle with no data */}
      {!fingerprintCapturing && fingerprints.length === 0 && (
        <div className="mx-3 mt-2 px-3 py-2.5 rounded-xl border border-border bg-bg-secondary text-[12px] text-text-muted space-y-0.5">
          <p className="font-medium text-text-secondary">How it works</p>
          <p>Select an app, click <span className="text-foreground font-medium">Start Fingerprinting</span> — sniff! captures raw Client Hellos via tcpdump and extracts the native TLS fingerprint without any proxy interference.</p>
          <p className="text-[11px]">Each captured fingerprint shows its JA4 hash and a ready-to-paste uTLS <code className="bg-bg-tertiary px-1 rounded">ClientHelloSpec</code> Go struct. Click <span className="text-foreground font-medium">Copy Go</span> to use it.</p>
        </div>
      )}

      {/* Table */}
      <FingerprintTable fingerprints={displayedFingerprints} />

      {/* Backdrop for app picker */}
      {showAppPicker && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowAppPicker(false)}
        />
      )}
    </div>
  );
}

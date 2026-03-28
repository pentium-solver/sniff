"use client";

import { useEffect, useState, useMemo } from "react";
import { api, apiPut } from "@/lib/api";
import { useAppState } from "@/lib/store";
import { Search, Check, AlertCircle } from "lucide-react";
import type { AppItem } from "@/lib/types";

export default function AppsPage() {
  const { pkg, setPkg } = useAppState();
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api("/apps")
      .then((data) => setApps(Array.isArray(data) ? data : []))
      .catch((e) => {
        console.error("apps load:", e);
        setError(e.message || "Failed to load apps");
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      filter
        ? apps.filter(
            (a) =>
              a.Name.toLowerCase().includes(filter.toLowerCase()) ||
              a.ID.toLowerCase().includes(filter.toLowerCase())
          )
        : apps,
    [apps, filter]
  );

  async function selectApp(id: string) {
    await apiPut("/settings", { key: "package", value: id });
    setPkg(id);
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Installed Apps</h2>
            <p className="text-sm text-text-muted mt-0.5">
              Select a target application for traffic capture
            </p>
          </div>
          <span className="text-xs font-mono text-text-muted bg-bg-tertiary rounded-lg px-3 py-1.5">
            {apps.length} apps
          </span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by name or package ID..."
            className="w-full rounded-xl border border-card-border bg-card pl-10 pr-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-accent placeholder:text-text-muted"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {/* App list */}
        {loading ? (
          <div className="rounded-xl border border-card-border bg-card p-12 text-center">
            <p className="text-sm text-text-muted">Loading apps (this may take a moment)...</p>
          </div>
        ) : error || (!filter && apps.length === 0) ? (
          <div className="rounded-xl border border-bad/20 bg-bad/[0.04] p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-bad shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-bad">
                  {error || "No ADB device connected"}
                </p>
                <p className="text-sm text-text-muted mt-1.5">
                  Connect your Android device via USB and enable USB debugging.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-card-border bg-card overflow-hidden divide-y divide-card-border">
            {filtered.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-sm text-text-muted">
                  No apps match your search
                </p>
              </div>
            ) : (
              filtered.map((app) => {
                const isSelected = pkg === app.ID;
                return (
                  <button
                    key={app.ID}
                    className={`w-full flex items-center gap-4 px-5 py-3.5 text-left cursor-pointer transition-all duration-150 ${
                      isSelected
                        ? "bg-accent/[0.06]"
                        : "hover:bg-card-hover"
                    }`}
                    onClick={() => selectApp(app.ID)}
                  >
                    <div className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${
                      isSelected ? "bg-accent/15" : "bg-bg-tertiary"
                    }`}>
                      {isSelected ? (
                        <Check className="h-4 w-4 text-accent" />
                      ) : (
                        <span className="text-xs font-mono text-text-muted">
                          {app.Name[0]?.toUpperCase() || "?"}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {app.Name}
                      </div>
                      <div className="text-xs font-mono text-text-muted truncate">
                        {app.ID}
                      </div>
                    </div>
                    {app.PID > 0 && (
                      <span className="text-[10px] font-mono font-semibold text-good bg-good/10 rounded-md px-2 py-0.5 shrink-0">
                        PID {app.PID}
                      </span>
                    )}
                    {isSelected && (
                      <span className="text-[10px] font-semibold text-accent shrink-0">
                        ACTIVE
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

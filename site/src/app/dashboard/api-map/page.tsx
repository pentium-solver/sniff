"use client";

import { useMemo, useState } from "react";
import { useAppState } from "@/lib/store";
import { detectSignals } from "@/lib/signals";
import { inferSchema } from "@/lib/schemaInference";
import { generateOpenAPI } from "@/lib/openapi";
import SchemaPanel from "./SchemaPanel";
import type { Flow } from "@/lib/types";
import type { EndpointSchema } from "@/lib/schemaInference";
import { Map as MapIcon, AlertTriangle, Download, Search } from "lucide-react";
import clsx from "clsx";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiEndpoint {
  host: string;
  method: string;
  path: string;
  hitCount: number;
  firstSeen: number;
  lastSeen: number;
  contentTypes: string[];
  statusCodes: number[];
  hasSecrets: boolean;
}

interface HostGroup {
  host: string;
  count: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function methodClass(m: string): string {
  const map: Record<string, string> = {
    GET:     "bg-good/15 text-good",
    POST:    "bg-accent-dim text-accent",
    PUT:     "bg-[#d29922]/15 text-[#d29922]",
    PATCH:   "bg-[#d29922]/15 text-[#d29922]",
    DELETE:  "bg-[#f85149]/15 text-[#f85149]",
    HEAD:    "bg-bg-tertiary text-text-muted",
    OPTIONS: "bg-bg-tertiary text-text-muted",
  };
  return map[m] ?? "bg-bg-tertiary text-text-muted";
}

function statusDot(codes: number[]): string {
  if (codes.some((c) => c >= 500)) return "bg-[#f85149]";
  if (codes.some((c) => c >= 400)) return "bg-[#d29922]";
  if (codes.some((c) => c >= 200 && c < 300)) return "bg-good";
  return "bg-text-muted";
}

function pathFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function timeAgo(ts: number): string {
  const delta = Date.now() / 1000 - ts;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

// ── Export helpers ────────────────────────────────────────────────────────────

function exportMarkdown(endpoints: ApiEndpoint[]): string {
  const lines = ["# API Surface Map\n"];
  let currentHost = "";
  for (const ep of endpoints) {
    if (ep.host !== currentHost) {
      lines.push(`\n## ${ep.host}\n`);
      currentHost = ep.host;
    }
    const secretTag = ep.hasSecrets ? " ⚠️" : "";
    lines.push(`- \`${ep.method} ${ep.path}\` — ${ep.hitCount} hit${ep.hitCount !== 1 ? "s" : ""}${secretTag}`);
  }
  return lines.join("\n");
}

function exportJSON(endpoints: ApiEndpoint[]): object {
  return endpoints.map((ep) => ({
    host: ep.host,
    method: ep.method,
    path: ep.path,
    hit_count: ep.hitCount,
    content_types: ep.contentTypes,
    status_codes: ep.statusCodes,
    has_secrets: ep.hasSecrets,
    first_seen: ep.firstSeen,
    last_seen: ep.lastSeen,
  }));
}

function downloadText(text: string, filename: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ApiMapPage() {
  const { flows } = useAppState();
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [openApiMenu, setOpenApiMenu] = useState(false);

  // Build endpoint map from all flows
  const { endpoints, hostGroups } = useMemo(() => {
    const epMap = new Map<string, ApiEndpoint>();

    for (const flow of flows) {
      const path = pathFromUrl(flow.url);
      const key = `${flow.host}::${flow.method}::${path}`;
      const existing = epMap.get(key);
      const hasSecrets = detectSignals(flow).length > 0;
      const ct = flow.content_type?.split(";")[0].trim() ?? "";

      if (existing) {
        existing.hitCount++;
        existing.lastSeen = Math.max(existing.lastSeen, flow.ts);
        existing.firstSeen = Math.min(existing.firstSeen, flow.ts);
        if (ct && !existing.contentTypes.includes(ct)) existing.contentTypes.push(ct);
        if (!existing.statusCodes.includes(flow.status)) existing.statusCodes.push(flow.status);
        if (hasSecrets) existing.hasSecrets = true;
      } else {
        epMap.set(key, {
          host: flow.host,
          method: flow.method,
          path,
          hitCount: 1,
          firstSeen: flow.ts,
          lastSeen: flow.ts,
          contentTypes: ct ? [ct] : [],
          statusCodes: [flow.status],
          hasSecrets,
        });
      }
    }

    const all = [...epMap.values()].sort((a, b) => {
      const hc = a.host.localeCompare(b.host);
      if (hc !== 0) return hc;
      return b.hitCount - a.hitCount;
    });

    const hostMap = new Map<string, number>();
    for (const ep of all) hostMap.set(ep.host, (hostMap.get(ep.host) ?? 0) + 1);
    const hg: HostGroup[] = [...hostMap.entries()]
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count);

    return { endpoints: all, hostGroups: hg };
  }, [flows]);

  // Schema inference (memoized — runs once per flow batch change)
  const schemas = useMemo<EndpointSchema[]>(() => {
    if (flows.length === 0) return [];
    return inferSchema(flows);
  }, [flows]);

  // Filtered view
  const filtered = useMemo(() => {
    return endpoints.filter((ep) => {
      if (selectedHost && ep.host !== selectedHost) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          ep.path.toLowerCase().includes(q) ||
          ep.host.toLowerCase().includes(q) ||
          ep.method.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [endpoints, selectedHost, search]);

  // Selected endpoint for schema panel
  const selectedEndpoint = useMemo<EndpointSchema | null>(() => {
    if (!selectedKey) return null;
    const [host, method, path] = selectedKey.split("\x00");
    return schemas.find(s => s.host === host && s.method === method && s.path === path) ?? null;
  }, [selectedKey, schemas]);

  function epKey(ep: { host: string; method: string; path: string }) {
    return `${ep.host}\x00${ep.method}\x00${ep.path}`;
  }

  function handleRowClick(ep: ApiEndpoint) {
    const k = epKey(ep);
    setSelectedKey(prev => prev === k ? null : k);
  }

  function handleExport(fmt: "md" | "json") {
    const data = selectedHost ? filtered : endpoints;
    if (fmt === "md") {
      downloadText(exportMarkdown(data), "api-map.md", "text/markdown");
    } else {
      downloadText(JSON.stringify(exportJSON(data), null, 2), "api-map.json", "application/json");
    }
  }

  function handleOpenApiExport(fmt: "yaml" | "json") {
    setOpenApiMenu(false);
    const targetEndpoints = selectedHost
      ? schemas.filter(s => s.host === selectedHost)
      : schemas;
    const name = selectedHost ?? "Captured API";
    const { yaml, json } = generateOpenAPI(targetEndpoints, name);
    if (fmt === "yaml") {
      downloadText(yaml, `${name.replace(/[^a-z0-9]/gi, "_")}-openapi.yaml`, "text/yaml");
    } else {
      downloadText(json, `${name.replace(/[^a-z0-9]/gi, "_")}-openapi.json`, "application/json");
    }
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (flows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
        <MapIcon className="h-8 w-8 opacity-30" />
        <p className="text-[13px]">Start a capture to build the API surface map</p>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: host list ── */}
      <div className="w-48 shrink-0 border-r border-border flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border shrink-0">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Hosts</span>
        </div>
        <div className="flex-1 overflow-auto">
          <button
            onClick={() => { setSelectedHost(null); setSelectedKey(null); }}
            className={clsx(
              "w-full flex items-center justify-between px-3 py-2 text-[11px] transition-colors cursor-pointer",
              !selectedHost
                ? "bg-accent/10 text-accent-bright font-medium"
                : "text-text-secondary hover:text-foreground hover:bg-bg-elevated"
            )}
          >
            <span>All hosts</span>
            <span className="font-mono text-[10px] text-text-muted">{endpoints.length}</span>
          </button>
          {hostGroups.map((hg) => (
            <button
              key={hg.host}
              onClick={() => { setSelectedHost(hg.host === selectedHost ? null : hg.host); setSelectedKey(null); }}
              className={clsx(
                "w-full flex items-center justify-between px-3 py-2 text-[11px] transition-colors cursor-pointer",
                selectedHost === hg.host
                  ? "bg-accent/10 text-accent-bright font-medium"
                  : "text-text-secondary hover:text-foreground hover:bg-bg-elevated"
              )}
            >
              <span className="truncate text-left font-mono" title={hg.host}>
                {hg.host}
              </span>
              <span className="font-mono text-[10px] text-text-muted shrink-0 ml-1">{hg.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Center: endpoint table ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
          <MapIcon className="h-4 w-4 text-accent-bright shrink-0" />
          <span className="text-[13px] font-semibold">
            {selectedHost ?? "All endpoints"}
          </span>
          <span className="text-[11px] text-text-muted font-mono">{filtered.length} routes</span>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1">
              <Search className="h-3 w-3 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter…"
                className="text-[11px] font-mono bg-transparent outline-none placeholder:text-text-muted w-28 text-foreground"
              />
            </div>

            {/* OpenAPI export */}
            <div className="relative">
              <button
                onClick={() => setOpenApiMenu(m => !m)}
                className="flex items-center gap-1 text-[11px] text-accent-bright border border-accent/30 rounded-lg px-2.5 py-1 transition-colors cursor-pointer hover:bg-accent/5"
              >
                <Download className="h-3 w-3" />
                OpenAPI
              </button>
              {openApiMenu && (
                <div className="absolute right-0 top-8 z-20 bg-bg-secondary border border-border rounded-lg shadow-lg py-1 w-28">
                  <button
                    onClick={() => handleOpenApiExport("yaml")}
                    className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
                  >
                    YAML
                  </button>
                  <button
                    onClick={() => handleOpenApiExport("json")}
                    className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
                  >
                    JSON
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => handleExport("md")}
              className="flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground border border-border rounded-lg px-2.5 py-1 transition-colors cursor-pointer"
            >
              <Download className="h-3 w-3" />
              MD
            </button>
            <button
              onClick={() => handleExport("json")}
              className="flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground border border-border rounded-lg px-2.5 py-1 transition-colors cursor-pointer"
            >
              <Download className="h-3 w-3" />
              JSON
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left bg-bg-secondary text-text-muted border-b-2 border-border px-3 py-2 font-semibold text-[11px] uppercase tracking-wide w-20">Method</th>
                <th className="text-left bg-bg-secondary text-text-muted border-b-2 border-border px-3 py-2 font-semibold text-[11px] uppercase tracking-wide">Path</th>
                {!selectedHost && (
                  <th className="text-left bg-bg-secondary text-text-muted border-b-2 border-border px-3 py-2 font-semibold text-[11px] uppercase tracking-wide w-40">Host</th>
                )}
                <th className="text-left bg-bg-secondary text-text-muted border-b-2 border-border px-3 py-2 font-semibold text-[11px] uppercase tracking-wide w-28">Type</th>
                <th className="text-left bg-bg-secondary text-text-muted border-b-2 border-border px-3 py-2 font-semibold text-[11px] uppercase tracking-wide w-20">Last seen</th>
                <th className="text-center bg-bg-secondary text-text-muted border-b-2 border-border px-3 py-2 font-semibold text-[11px] uppercase tracking-wide w-14">Hits</th>
                <th className="bg-bg-secondary border-b-2 border-border w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((ep, i) => {
                const k = epKey(ep);
                const active = selectedKey === k;
                return (
                  <tr
                    key={i}
                    onClick={() => handleRowClick(ep)}
                    className={clsx(
                      "border-b border-border/30 transition-colors cursor-pointer",
                      active
                        ? "bg-accent/10 border-l-2 border-l-accent-bright"
                        : "hover:bg-accent/[.04]"
                    )}
                  >
                    {/* Method */}
                    <td className="px-3 py-2 w-20">
                      <span className={clsx(
                        "inline-block rounded px-1.5 py-px text-[11px] font-semibold font-mono",
                        methodClass(ep.method)
                      )}>
                        {ep.method}
                      </span>
                    </td>

                    {/* Path */}
                    <td className="px-3 py-2">
                      <span className="font-mono text-[11px] text-foreground">{ep.path}</span>
                    </td>

                    {/* Host */}
                    {!selectedHost && (
                      <td className="px-3 py-2 w-40">
                        <span className="font-mono text-[10px] text-text-secondary truncate block" title={ep.host}>
                          {ep.host}
                        </span>
                      </td>
                    )}

                    {/* Content type */}
                    <td className="px-3 py-2 w-28">
                      <span className="text-[10px] text-text-muted font-mono truncate block" title={ep.contentTypes.join(", ")}>
                        {ep.contentTypes[0] ?? "—"}
                        {ep.contentTypes.length > 1 && ` +${ep.contentTypes.length - 1}`}
                      </span>
                    </td>

                    {/* Last seen */}
                    <td className="px-3 py-2 w-20">
                      <span className="text-[10px] text-text-muted font-mono">{timeAgo(ep.lastSeen)}</span>
                    </td>

                    {/* Hits + status dot */}
                    <td className="px-3 py-2 w-14 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className={clsx("inline-block h-1.5 w-1.5 rounded-full shrink-0", statusDot(ep.statusCodes))} />
                        <span className="text-[11px] font-mono text-text-secondary">{ep.hitCount}</span>
                      </div>
                    </td>

                    {/* Secret warning */}
                    <td className="px-2 py-2 w-8 text-center">
                      {ep.hasSecrets && (
                        <span title="Secrets detected">
                          <AlertTriangle className="h-3 w-3 text-[#d29922] mx-auto" />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Right: schema panel ── */}
      {selectedEndpoint && (
        <SchemaPanel
          endpoint={selectedEndpoint}
          allEndpoints={schemas}
          appName={selectedHost ?? undefined}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </div>
  );
}

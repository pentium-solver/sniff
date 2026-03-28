"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Upload,
  FileJson,
  Search,
  X,
  Clock,
  Trash2,
  FileText,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { formatBytes } from "@/lib/api";
import {
  resourceTypes,
  type ResourceType,
  classifyFlow,
  filterByResourceType,
  deepSearch,
  type SearchMatch,
  getRecentHars,
  saveRecentHar,
  removeRecentHar,
  type RecentHar,
} from "@/lib/filters";
import type { Flow } from "@/lib/types";
import FlowDetail from "@/components/dashboard/FlowDetail";
import clsx from "clsx";

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    headers: { name: string; value: string }[];
    queryString?: { name: string; value: string }[];
    postData?: { mimeType: string; text: string };
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    headers: { name: string; value: string }[];
    content: { size: number; mimeType: string; text?: string };
    bodySize: number;
  };
}

function harEntryToFlow(entry: HarEntry, index: number): Flow {
  const url = entry.request.url;
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.host;
    path = u.pathname + u.search;
  } catch {
    host = url;
  }
  const reqHeaders: Record<string, string> = {};
  for (const h of entry.request.headers || []) reqHeaders[h.name] = h.value;
  const respHeaders: Record<string, string> = {};
  for (const h of entry.response.headers || []) respHeaders[h.name] = h.value;

  return {
    ts: new Date(entry.startedDateTime).getTime() / 1000,
    method: entry.request.method,
    url,
    host,
    path,
    status: entry.response.status,
    req_size: entry.request.bodySize || 0,
    resp_size: entry.response.content?.size || entry.response.bodySize || 0,
    content_type: entry.response.content?.mimeType || "",
    req_headers: reqHeaders,
    resp_headers: respHeaders,
    req_body: entry.request.postData?.text || null,
    resp_body: entry.response.content?.text || null,
    _index: index + 1,
  };
}

function methodClass(m: string): string {
  const map: Record<string, string> = {
    GET: "bg-good/15 text-good",
    POST: "bg-accent-dim text-accent",
    PUT: "bg-warn/15 text-warn",
    PATCH: "bg-warn/15 text-warn",
    DELETE: "bg-bad/15 text-bad",
    OPTIONS: "bg-bg-tertiary text-text-muted",
    HEAD: "bg-bg-tertiary text-text-muted",
  };
  return map[m] || "bg-bg-tertiary text-text-muted";
}

function statusClass(s: number): string {
  const c = String(s)[0];
  if (c === "2") return "text-good";
  if (c === "3") return "text-warn";
  if (c === "4" || c === "5") return "text-bad";
  return "text-text-muted";
}

function HighlightSnippet({ text, start, end }: { text: string; start: number; end: number }) {
  return (
    <span className="font-mono text-[11px] text-text-secondary break-all">
      {text.slice(0, start)}
      <mark className="bg-warn/30 text-warn rounded-sm px-0.5">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </span>
  );
}

const fieldLabels: Record<string, string> = {
  url: "URL",
  host: "Host",
  path: "Path",
  status: "Status",
  req_header: "Req Header",
  resp_header: "Resp Header",
  req_body: "Req Body",
  resp_body: "Resp Body",
};

type SortKey = "index" | "status" | "method" | "host" | "path" | "resp_size" | "ts";

export default function HarInspectorPage() {
  const [entries, setEntries] = useState<Flow[]>([]);
  const [fileName, setFileName] = useState("");
  const [rawHarData, setRawHarData] = useState("");
  const [selected, setSelected] = useState<Flow | null>(null);
  const [search, setSearch] = useState("");
  const [deepQuery, setDeepQuery] = useState("");
  const [showDeepSearch, setShowDeepSearch] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("index");
  const [sortAsc, setSortAsc] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [resourceFilter, setResourceFilter] = useState<ResourceType>("All");
  const [recentHars, setRecentHars] = useState<RecentHar[]>([]);
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecentHars(getRecentHars());
  }, []);

  const loadHarFromData = useCallback((data: string, name: string, save = true) => {
    try {
      const har = JSON.parse(data);
      const harEntries: HarEntry[] = har.log?.entries || [];
      const flows = harEntries.map((entry, i) => harEntryToFlow(entry, i));
      setEntries(flows);
      setFileName(name);
      setRawHarData(data);
      setSelected(null);
      setSearch("");
      setDeepQuery("");
      setResourceFilter("All");
      setHighlightIndex(null);
      if (save) {
        saveRecentHar({
          name,
          size: data.length,
          entryCount: harEntries.length,
          date: new Date().toISOString(),
          data,
        });
        setRecentHars(getRecentHars());
      }
    } catch (err) {
      console.error("Invalid HAR file:", err);
    }
  }, []);

  const loadHar = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      loadHarFromData(e.target?.result as string, file.name);
    };
    reader.readAsText(file);
  }, [loadHarFromData]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadHar(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadHar(file);
  }

  function handleDeleteRecent(name: string, e: React.MouseEvent) {
    e.stopPropagation();
    removeRecentHar(name);
    setRecentHars(getRecentHars());
  }

  // Resource type counts
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const type of resourceTypes) counts[type] = 0;
    for (const f of entries) {
      counts[classifyFlow(f)]++;
      counts["All"]++;
    }
    return counts;
  }, [entries]);

  // Filtered by resource type + quick search (URL/host/status/method only)
  const filtered = useMemo(() => {
    let list = filterByResourceType(entries, resourceFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (f) =>
          f.url.toLowerCase().includes(q) ||
          f.host.toLowerCase().includes(q) ||
          String(f.status).includes(q) ||
          f.method.toLowerCase().includes(q)
      );
    }
    return list;
  }, [entries, resourceFilter, search]);

  // Deep search results
  const searchResults = useMemo(
    () => (deepQuery.length >= 2 ? deepSearch(entries, deepQuery) : []),
    [entries, deepQuery]
  );

  // Sorted
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortAsc ? 1 : -1;
    return arr.sort((a, b) => {
      const av = sortKey === "index" ? (a._index ?? 0) : (a as any)[sortKey];
      const bv = sortKey === "index" ? (b._index ?? 0) : (b as any)[sortKey];
      if (typeof av === "string") return dir * av.localeCompare(bv);
      return dir * ((av ?? 0) - (bv ?? 0));
    });
  }, [filtered, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  }

  function jumpToMatch(match: SearchMatch) {
    const flow = entries[match.flowIndex];
    if (!flow) return;
    setSelected(flow);
    setHighlightIndex(match.flowIndex);
    // Scroll the row into view
    setTimeout(() => {
      const row = tableRef.current?.querySelector(`[data-idx="${flow._index}"]`);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
  }

  // Empty state with recent HARs
  if (entries.length === 0) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              HAR Inspector
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Load a HAR file to inspect HTTP requests and responses
            </p>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`relative rounded-2xl border-2 border-dashed transition-colors p-12 text-center ${
              dragOver ? "border-accent bg-accent/5" : "border-border hover:border-border-light"
            }`}
          >
            <input
              type="file"
              accept=".har,.json"
              onChange={handleFileSelect}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-card border border-card-border">
                <Upload className="h-6 w-6 text-text-muted" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Drop a .har file here or click to browse
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Supports HAR 1.2 format — export from captures via "Download results"
                </p>
              </div>
            </div>
          </div>

          {/* Recent HARs */}
          {recentHars.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-text-muted" />
                Recent captures
              </h3>
              <div className="rounded-xl border border-card-border bg-card overflow-hidden divide-y divide-card-border">
                {recentHars.map((har) => (
                  <div
                    key={har.name}
                    onClick={() => loadHarFromData(har.data, har.name, false)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-card-hover transition-colors cursor-pointer text-left group"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") loadHarFromData(har.data, har.name, false); }}
                  >
                    <FileJson className="h-4 w-4 text-accent shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-foreground truncate">
                        {har.name}
                      </div>
                      <div className="text-[11px] text-text-muted mt-0.5">
                        {har.entryCount} entries · {formatBytes(har.size)} · {new Date(har.date).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteRecent(har.name, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-bad transition-all cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <ArrowRight className="h-4 w-4 text-text-muted/30 group-hover:text-accent transition-colors shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const cols: { key: SortKey; label: string; w: string }[] = [
    { key: "index", label: "#", w: "w-11" },
    { key: "status", label: "Status", w: "w-14" },
    { key: "method", label: "Method", w: "w-[72px]" },
    { key: "host", label: "Host", w: "w-44" },
    { key: "path", label: "Path", w: "" },
    { key: "resp_size", label: "Size", w: "w-16" },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="px-3 py-1.5 border-b border-border bg-bg-secondary flex items-center gap-2 shrink-0 flex-wrap">
        {/* File info */}
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
          <FileJson className="h-3.5 w-3.5 text-accent" />
          <span className="font-mono">{fileName}</span>
        </div>

        {/* Resource type pills */}
        <div className="flex items-center gap-0.5 ml-2">
          {resourceTypes.map((type) => (
            <button
              key={type}
              onClick={() => setResourceFilter(resourceFilter === type ? "All" : type)}
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

        {/* Filtered/total count */}
        <span className="text-[10px] font-mono text-text-muted">
          {filtered.length === entries.length
            ? `${entries.length} entries`
            : `${filtered.length}/${entries.length}`}
        </span>

        {/* Quick filter */}
        <div className="flex items-center gap-1 bg-bg-tertiary border border-border rounded-lg px-2 py-0.5">
          <Search className="h-3 w-3 text-text-muted shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            className="bg-transparent text-[11px] text-foreground outline-none w-24 placeholder:text-text-muted"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-text-muted hover:text-foreground cursor-pointer">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Deep search toggle */}
        <button
          onClick={() => {
            setShowDeepSearch(!showDeepSearch);
            if (!showDeepSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
          }}
          className={clsx(
            "flex items-center gap-1 text-[11px] font-medium rounded-lg px-2 py-1 transition-colors cursor-pointer border",
            showDeepSearch
              ? "bg-accent/10 text-accent-bright border-accent/20"
              : "text-text-muted border-border hover:bg-bg-tertiary hover:text-foreground"
          )}
        >
          <Search className="h-3 w-3" />
          Deep search
        </button>

        {/* Load new */}
        <label className="text-[11px] font-medium text-text-muted border border-border rounded-lg px-2 py-1 hover:bg-bg-tertiary hover:text-foreground transition-colors cursor-pointer">
          <input type="file" accept=".har,.json" onChange={handleFileSelect} className="hidden" />
          Load new
        </label>
      </div>

      {/* Deep search panel */}
      {showDeepSearch && (
        <div className="border-b border-border bg-[#08080a]">
          <div className="px-3 py-2 flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-accent shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={deepQuery}
              onChange={(e) => setDeepQuery(e.target.value)}
              placeholder="Search URLs, headers, request/response bodies…"
              className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-text-muted font-mono"
            />
            {deepQuery && (
              <span className="text-[10px] text-text-muted font-mono">
                {searchResults.length} matches
              </span>
            )}
            <button
              onClick={() => { setDeepQuery(""); setShowDeepSearch(false); setHighlightIndex(null); }}
              className="text-text-muted hover:text-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="max-h-[200px] overflow-auto border-t border-border/50 divide-y divide-border/30">
              {searchResults.map((match, i) => (
                <button
                  key={i}
                  onClick={() => jumpToMatch(match)}
                  className="w-full text-left px-3 py-1.5 hover:bg-accent/[.06] transition-colors cursor-pointer flex items-start gap-2"
                >
                  <span className="text-[10px] font-mono text-text-muted w-6 shrink-0 mt-0.5">
                    #{entries[match.flowIndex]?._index}
                  </span>
                  <span className={clsx(
                    "text-[10px] font-semibold rounded px-1 py-0.5 shrink-0 mt-px",
                    match.field.includes("req") ? "bg-accent/10 text-accent" : "bg-good/10 text-good"
                  )}>
                    {fieldLabels[match.field]}
                  </span>
                  <HighlightSnippet
                    text={match.snippet}
                    start={match.matchStart}
                    end={match.matchEnd}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {/* Table */}
        <div ref={tableRef} className={`flex-1 flex flex-col min-w-0 ${selected ? "max-w-[60%]" : ""}`}>
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  {cols.map((col) => (
                    <th
                      key={col.key}
                      className={`text-left bg-bg-secondary text-text-muted border-b-2 border-border px-2 py-2 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-foreground ${col.w} ${sortKey === col.key ? "text-accent" : ""}`}
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.label}
                      <span className={`ml-0.5 text-[10px] ${sortKey === col.key ? "opacity-100" : "opacity-40"}`}>
                        {sortKey === col.key ? (sortAsc ? "\u25B2" : "\u25BC") : "\u25B2"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((flow) => (
                  <tr
                    key={flow._index}
                    data-idx={flow._index}
                    className={clsx(
                      "cursor-pointer border-b border-border/30 transition-colors duration-75 hover:bg-accent/[.06]",
                      selected?._index === flow._index && "bg-accent-dim",
                      highlightIndex !== null && flow._index === entries[highlightIndex]?._index && "ring-1 ring-warn/40 bg-warn/[.04]"
                    )}
                    onClick={() => { setSelected(flow); setHighlightIndex(null); }}
                  >
                    <td className="px-2 py-1.5 text-text-muted w-11">{flow._index}</td>
                    <td className={`px-2 py-1.5 w-14 ${statusClass(flow.status)}`}>{flow.status}</td>
                    <td className="px-2 py-1.5 w-[72px]">
                      <span className={`inline-block rounded px-1.5 py-px text-[11px] font-semibold font-mono ${methodClass(flow.method)}`}>
                        {flow.method}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 w-44 text-text-secondary truncate" title={flow.host}>{flow.host}</td>
                    <td className="px-2 py-1.5 text-text-secondary truncate max-w-0" title={flow.path}>{flow.path}</td>
                    <td className="px-2 py-1.5 w-16 text-text-secondary">{formatBytes(flow.resp_size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sorted.length === 0 && (
              <div className="flex items-center justify-center py-12 text-text-muted text-xs">
                No matching entries
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-[40%] min-w-[320px] border-l border-border flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-bg-secondary shrink-0">
              <span className="text-[11px] text-text-muted font-medium">Detail</span>
              <button className="text-[11px] text-text-muted hover:text-foreground cursor-pointer" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              <FlowDetail flow={selected} onClose={() => setSelected(null)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

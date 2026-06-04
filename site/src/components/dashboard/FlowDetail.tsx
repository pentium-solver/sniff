"use client";

import { useState, useMemo } from "react";
import { formatBytes } from "@/lib/api";
import type { Flow } from "@/lib/types";
import JsonView from "./JsonView";
import PinButton from "./PinButton";
import TagList from "./TagList";
import InlineLabel from "./InlineLabel";
import NoteEditor from "./NoteEditor";
import ReplayTab from "./ReplayTab";
import SignalsPanel from "./SignalsPanel";
import { detectSignals } from "@/lib/signals";
import { Copy, Check } from "lucide-react";

interface FlowDetailProps {
  flow: Flow | null;
  onClose: () => void;
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
  if (c === "2") return "bg-good/15 text-good";
  if (c === "3") return "bg-[#d29922]/15 text-[#d29922]";
  if (c === "4" || c === "5") return "bg-[#f85149]/15 text-[#f85149]";
  return "bg-bg-tertiary text-text-muted";
}

function headerVal(headers: Record<string, string>, name: string): string {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return "";
}

/** Format a Flow as a curl command. */
function flowToCurl(flow: Flow): string {
  const parts: string[] = [`curl -X ${flow.method} '${flow.url}'`];
  for (const [k, v] of Object.entries(flow.req_headers || {})) {
    // Skip pseudo-headers and connection-specific headers
    if (k.startsWith(":") || k.toLowerCase() === "content-length") continue;
    parts.push(`  -H '${k}: ${v.replace(/'/g, "'\\''")}'`);
  }
  if (flow.req_body) {
    const body = flow.req_body.replace(/'/g, "'\\''");
    parts.push(`  --data-raw '${body}'`);
  }
  return parts.join(" \\\n");
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      className="text-[11px] text-text-muted border border-border rounded px-2 py-0.5 bg-bg-tertiary hover:bg-border hover:text-foreground transition-colors font-medium cursor-pointer flex items-center gap-1"
      onClick={handleCopy}
    >
      {copied ? <><Check className="h-3 w-3 text-good" />{" "}Copied</> : label}
    </button>
  );
}

const TAB_IDS = ["headers", "query", "reqBody", "resBody", "replay", "secrets", "notes"] as const;
const tabs = [
  { id: "headers", label: "Headers" },
  { id: "query", label: "Query" },
  { id: "reqBody", label: "Request Body" },
  { id: "resBody", label: "Response Body" },
  { id: "replay", label: "Replay" },
  { id: "secrets", label: "Secrets" },
  { id: "notes", label: "Notes" },
];

export default function FlowDetail({ flow, onClose }: FlowDetailProps) {
  const [activeTab, setActiveTab] = useState<typeof TAB_IDS[number]>("headers");

  const id = flow?._id ?? (flow ? `flow_${flow._index ?? flow.ts}` : "");

  const queryParams = useMemo(() => {
    if (!flow) return [];
    try {
      const u = new URL(flow.url);
      const params: { name: string; value: string }[] = [];
      u.searchParams.forEach((v, k) => params.push({ name: k, value: v }));
      return params;
    } catch {
      return [];
    }
  }, [flow]);

  const reqHeaders = useMemo(
    () => (flow ? Object.entries(flow.req_headers || {}) : []),
    [flow]
  );
  const resHeaders = useMemo(
    () => (flow ? Object.entries(flow.resp_headers || {}) : []),
    [flow]
  );

  const signals = useMemo(() => (flow ? detectSignals(flow) : []), [flow]);

  const tabCounts = useMemo(
    () => ({
      headers: reqHeaders.length + resHeaders.length,
      query: queryParams.length,
      reqBody: flow?.req_body ? 1 : 0,
      resBody: flow?.resp_body ? 1 : 0,
      replay: 0,
      secrets: signals.length,
      notes: 0,
    }),
    [reqHeaders, resHeaders, queryParams, flow, signals]
  );

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  if (!flow) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-xs font-medium tracking-wide">
        Select a request to inspect
      </div>
    );
  }

  return (
    <>
      {/* URL bar */}
      <div className="px-4 py-2.5 border-b border-border bg-bg-secondary flex items-center gap-2 min-h-[42px]">
        <span className={`inline-block rounded px-1.5 py-px text-xs font-semibold font-mono shrink-0 ${methodClass(flow.method)}`}>
          {flow.method}
        </span>
        <span className="font-mono text-xs text-foreground break-all leading-snug">
          {flow.url}
        </span>
        <CopyButton text={flow.url} />
        <CopyButton text={flowToCurl(flow)} label="cURL" />
        <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold font-mono ${statusClass(flow.status)}`}>
          {flow.status}
        </span>
      </div>

      {/* Annotation bar */}
      <div className="px-4 py-2 border-b border-border bg-bg-secondary flex items-center gap-3 flex-wrap">
        <PinButton id={id} />
        <InlineLabel
          id={id}
          fallback={flow.host}
          className="text-[11px] font-mono text-text-secondary"
          inputClassName="text-[11px] font-mono"
        />
        <TagList id={id} />
      </div>

      {/* Meta */}
      <div className="px-4 py-2 border-b border-border bg-bg-secondary flex gap-5 flex-wrap text-xs">
        <span>
          <span className="text-text-muted font-medium">Host:</span>{" "}
          <span className="text-text-secondary font-mono text-[11px]">{flow.host}</span>
        </span>
        <span>
          <span className="text-text-muted font-medium">Size:</span>{" "}
          <span className="text-text-secondary font-mono text-[11px]">{formatBytes(flow.resp_size)}</span>
        </span>
        <span>
          <span className="text-text-muted font-medium">Type:</span>{" "}
          <span className="text-text-secondary font-mono text-[11px]">{flow.content_type || "-"}</span>
        </span>
      </div>

      {/* Tabs */}
      <div className="flex border-b-2 border-border bg-bg-secondary px-2 overflow-x-auto shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`relative border-0 bg-transparent px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors hover:text-text-secondary cursor-pointer ${activeTab === tab.id ? "text-foreground" : "text-text-muted"}`}
            onClick={() => setActiveTab(tab.id as typeof TAB_IDS[number])}
          >
            {tab.label}
            {(tabCounts as any)[tab.id] > 0 && (
              <span className="ml-1 text-[10px] text-text-muted opacity-70">
                ({(tabCounts as any)[tab.id]})
              </span>
            )}
            {activeTab === tab.id && (
              <span className="absolute bottom-[-2px] left-0 right-0 h-0.5 bg-accent rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {activeTab === "headers" && (
          <>
            {reqHeaders.length > 0 && (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2 pb-1 border-b border-border flex justify-between items-center">
                  <span>Request Headers ({reqHeaders.length})</span>
                  <button
                    className="text-[11px] text-text-muted border border-border rounded px-2 py-0.5 bg-bg-tertiary hover:bg-border hover:text-foreground font-medium normal-case tracking-normal cursor-pointer"
                    onClick={() => copy(reqHeaders.map(([k, v]) => `${k}: ${v}`).join("\n"))}
                  >
                    Copy
                  </button>
                </div>
                <table className="w-full border-collapse text-xs mb-4">
                  <thead>
                    <tr>
                      <th className="text-left text-text-muted font-semibold text-[11px] uppercase tracking-wide px-2 py-1.5 border-b border-border sticky top-0 bg-background">Name</th>
                      <th className="text-left text-text-muted font-semibold text-[11px] uppercase tracking-wide px-2 py-1.5 border-b border-border sticky top-0 bg-background">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reqHeaders.map(([k, v]) => (
                      <tr key={k} className="hover:bg-accent/[.04]">
                        <td className="px-2 py-1 border-b border-border/30 text-accent font-medium font-mono whitespace-nowrap w-[220px] min-w-[160px]">{k}</td>
                        <td className="px-2 py-1 border-b border-border/30 text-text-secondary font-mono break-all">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {resHeaders.length > 0 && (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2 pb-1 border-b border-border flex justify-between items-center">
                  <span>Response Headers ({resHeaders.length})</span>
                  <button
                    className="text-[11px] text-text-muted border border-border rounded px-2 py-0.5 bg-bg-tertiary hover:bg-border hover:text-foreground font-medium normal-case tracking-normal cursor-pointer"
                    onClick={() => copy(resHeaders.map(([k, v]) => `${k}: ${v}`).join("\n"))}
                  >
                    Copy
                  </button>
                </div>
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="text-left text-text-muted font-semibold text-[11px] uppercase tracking-wide px-2 py-1.5 border-b border-border sticky top-0 bg-background">Name</th>
                      <th className="text-left text-text-muted font-semibold text-[11px] uppercase tracking-wide px-2 py-1.5 border-b border-border sticky top-0 bg-background">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resHeaders.map(([k, v]) => (
                      <tr key={k} className="hover:bg-accent/[.04]">
                        <td className="px-2 py-1 border-b border-border/30 text-accent font-medium font-mono whitespace-nowrap w-[220px] min-w-[160px]">{k}</td>
                        <td className="px-2 py-1 border-b border-border/30 text-text-secondary font-mono break-all">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}

        {activeTab === "query" &&
          (queryParams.length === 0 ? (
            <p className="text-text-muted text-xs">No query parameters</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="text-left text-text-muted font-semibold text-[11px] uppercase tracking-wide px-2 py-1.5 border-b border-border sticky top-0 bg-background">Name</th>
                  <th className="text-left text-text-muted font-semibold text-[11px] uppercase tracking-wide px-2 py-1.5 border-b border-border sticky top-0 bg-background">Value</th>
                </tr>
              </thead>
              <tbody>
                {queryParams.map((p) => (
                  <tr key={p.name} className="hover:bg-accent/[.04]">
                    <td className="px-2 py-1 border-b border-border/30 text-accent font-medium font-mono w-[220px]">{p.name}</td>
                    <td className="px-2 py-1 border-b border-border/30 text-text-secondary font-mono break-all">{p.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {activeTab === "reqBody" && (
          <JsonView text={flow.req_body} mime={headerVal(flow.req_headers || {}, "content-type")} />
        )}

        {activeTab === "resBody" && (
          <JsonView text={flow.resp_body} mime={flow.content_type} />
        )}

        {activeTab === "replay" && (
          <ReplayTab flow={flow} />
        )}

        {activeTab === "secrets" && (
          <SignalsPanel flow={flow} />
        )}

        {activeTab === "notes" && (
          <NoteEditor id={id} className="max-w-xl" />
        )}
      </div>
    </>
  );
}

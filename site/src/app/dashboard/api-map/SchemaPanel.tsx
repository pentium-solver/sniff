"use client";

import { useState } from "react";
import { X, Copy, Check, ChevronRight, ChevronDown, Download, Lock, Zap } from "lucide-react";
import type { EndpointSchema, FieldSchema, HeaderAnalysis, EntropyClass } from "@/lib/schemaInference";
import { generateOpenAPI } from "@/lib/openapi";
import clsx from "clsx";

// ── Entropy badge ─────────────────────────────────────────────────────────────

const ENTROPY_STYLES: Record<EntropyClass, string> = {
  "static":       "bg-bg-tertiary text-text-muted border-border",
  "dynamic":      "bg-[#d29922]/10 text-[#d29922] border-[#d29922]/20",
  "high-entropy": "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

const ENTROPY_LABELS: Record<EntropyClass, string> = {
  "static":       "static",
  "dynamic":      "dynamic",
  "high-entropy": "⚡ computed",
};

function EntropyBadge({ entropy }: { entropy: EntropyClass }) {
  return (
    <span className={clsx(
      "inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-mono border font-medium",
      ENTROPY_STYLES[entropy]
    )}>
      {ENTROPY_LABELS[entropy]}
    </span>
  );
}

// ── Pattern badge ─────────────────────────────────────────────────────────────

const PATTERN_LABELS: Record<string, string> = {
  "jwt": "JWT",
  "bearer": "Bearer",
  "basic-auth": "Basic",
  "hmac-sha256": "HMAC-256",
  "hmac-sha512": "HMAC-512",
  "uuid": "UUID",
  "base64": "Base64",
  "timestamp": "Timestamp",
};

function PatternBadge({ pattern }: { pattern?: string }) {
  if (!pattern || !PATTERN_LABELS[pattern]) return null;
  return (
    <span className="inline-block rounded px-1.5 py-px text-[10px] font-mono bg-accent/10 text-accent-bright border border-accent/20 font-medium">
      {PATTERN_LABELS[pattern]}
    </span>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }
  return (
    <button
      onClick={copy}
      className="p-0.5 rounded text-text-muted hover:text-foreground transition-colors cursor-pointer"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-good" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ── Field schema tree ─────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  string:  "text-good",
  number:  "text-accent-bright",
  boolean: "text-[#d29922]",
  null:    "text-text-muted",
  array:   "text-purple-400",
  object:  "text-cyan-400",
  mixed:   "text-orange-400",
};

function FieldRow({
  name,
  schema,
  depth = 0,
}: {
  name: string;
  schema: FieldSchema;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = schema.type === "object" && schema.children && Object.keys(schema.children).length > 0;
  const isArray = schema.type === "array" && schema.items;
  const indent = depth * 12;

  const typeLabel = schema.nullable && schema.type !== "null"
    ? `${schema.type} | null`
    : schema.type;

  return (
    <>
      <tr className="border-b border-border/20 hover:bg-accent/[.03] transition-colors">
        <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + indent}px` }}>
          <div className="flex items-center gap-1">
            {(hasChildren || isArray) && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-text-muted hover:text-foreground cursor-pointer"
              >
                {expanded
                  ? <ChevronDown className="h-3 w-3" />
                  : <ChevronRight className="h-3 w-3" />}
              </button>
            )}
            {!hasChildren && !isArray && <span className="w-3 shrink-0" />}
            <span className="font-mono text-[11px] text-foreground">{name}</span>
            {schema.nullable && schema.type !== "null" && (
              <span className="text-text-muted text-[10px] font-mono">?</span>
            )}
          </div>
        </td>
        <td className="px-3 py-1.5">
          <span className={clsx("font-mono text-[11px]", TYPE_COLORS[schema.type] ?? "text-foreground")}>
            {typeLabel}
          </span>
          {schema.format && (
            <span className="ml-1 text-[10px] text-text-muted font-mono">({schema.format})</span>
          )}
        </td>
        <td className="px-3 py-1.5">
          {schema.example !== undefined && schema.example !== null && typeof schema.example !== "object" && (
            <span className="font-mono text-[10px] text-text-secondary truncate block max-w-[120px]" title={String(schema.example)}>
              {String(schema.example).substring(0, 40)}
              {String(schema.example).length > 40 && "…"}
            </span>
          )}
        </td>
      </tr>
      {expanded && hasChildren && schema.children &&
        Object.entries(schema.children).map(([k, v]) => (
          <FieldRow key={k} name={k} schema={v} depth={depth + 1} />
        ))
      }
      {expanded && isArray && schema.items && (
        <FieldRow name="[item]" schema={schema.items} depth={depth + 1} />
      )}
    </>
  );
}

function BodySchemaTable({ body }: { body: Record<string, FieldSchema> }) {
  const entries = Object.entries(body);
  if (entries.length === 0) return <p className="text-[11px] text-text-muted px-3 py-2">Empty object</p>;
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          <th className="text-left px-3 py-1.5 text-[10px] font-mono uppercase tracking-wide text-text-muted border-b border-border w-2/5">Field</th>
          <th className="text-left px-3 py-1.5 text-[10px] font-mono uppercase tracking-wide text-text-muted border-b border-border w-1/5">Type</th>
          <th className="text-left px-3 py-1.5 text-[10px] font-mono uppercase tracking-wide text-text-muted border-b border-border">Example</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([k, v]) => <FieldRow key={k} name={k} schema={v} />)}
      </tbody>
    </table>
  );
}

// ── Header analysis table ─────────────────────────────────────────────────────

function HeaderTable({ headers }: { headers: HeaderAnalysis[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (headers.length === 0) {
    return <p className="text-[11px] text-text-muted px-3 py-2">No request headers tracked</p>;
  }

  return (
    <div>
      {headers.map((h) => (
        <div key={h.name} className="border-b border-border/20 last:border-0">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/[.03] transition-colors cursor-pointer text-left"
            onClick={() => setExpanded(expanded === h.name ? null : h.name)}
          >
            <span className="font-mono text-[11px] text-foreground flex-1 truncate">{h.name}</span>
            <PatternBadge pattern={h.pattern} />
            <EntropyBadge entropy={h.entropy} />
            <span className="text-text-muted shrink-0">
              {expanded === h.name
                ? <ChevronDown className="h-3 w-3" />
                : <ChevronRight className="h-3 w-3" />}
            </span>
          </button>

          {expanded === h.name && (
            <div className="px-3 pb-2 space-y-1">
              {h.sampleValues.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <code className="text-[10px] font-mono text-text-secondary bg-bg-tertiary rounded px-1.5 py-0.5 flex-1 truncate" title={v}>
                    {v.length > 80 ? v.substring(0, 80) + "…" : v}
                  </code>
                  <CopyButton text={v} />
                </div>
              ))}
              {h.sampleValues.length === 0 && (
                <p className="text-[10px] text-text-muted">No samples collected</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Status code badge ─────────────────────────────────────────────────────────

function StatusBadge({ code }: { code: number }) {
  const cls = code >= 500 ? "text-[#f85149] bg-[#f85149]/10"
    : code >= 400 ? "text-[#d29922] bg-[#d29922]/10"
    : code >= 300 ? "text-purple-400 bg-purple-400/10"
    : "text-good bg-good/10";
  return (
    <span className={clsx("rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold", cls)}>{code}</span>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/50">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-accent/[.03] transition-colors cursor-pointer"
      >
        <span className="text-text-muted">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{title}</span>
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

// ── Download helpers ──────────────────────────────────────────────────────────

function downloadText(text: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// ── SchemaPanel ───────────────────────────────────────────────────────────────

interface Props {
  endpoint: EndpointSchema;
  allEndpoints: EndpointSchema[];
  appName?: string;
  onClose: () => void;
}

export default function SchemaPanel({ endpoint, allEndpoints, appName, onClose }: Props) {
  const [exportMenu, setExportMenu] = useState(false);

  function handleExport(fmt: "yaml" | "json") {
    setExportMenu(false);
    const { yaml, json } = generateOpenAPI(
      allEndpoints.filter(e => e.host === endpoint.host),
      appName ?? endpoint.host
    );
    if (fmt === "yaml") {
      downloadText(yaml, `${endpoint.host}-openapi.yaml`, "text/yaml");
    } else {
      downloadText(json, `${endpoint.host}-openapi.json`, "application/json");
    }
  }

  const statusCodes = Object.keys(endpoint.responses).map(Number).sort();

  return (
    <div className="w-80 shrink-0 border-l border-border flex flex-col overflow-hidden bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-foreground font-semibold truncate">{endpoint.path}</span>
            {endpoint.authRequired && (
              <span title="Auth required">
                <Lock className="h-3 w-3 text-[#d29922] shrink-0" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="font-mono text-[10px] text-text-muted">{endpoint.host}</span>
            <span className="text-[10px] text-text-muted">·</span>
            <span className="text-[10px] text-text-muted">{endpoint.sampleCount} sample{endpoint.sampleCount !== 1 ? "s" : ""}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Export dropdown */}
          <div className="relative">
            <button
              onClick={() => setExportMenu(m => !m)}
              className="flex items-center gap-1 text-[10px] text-text-muted hover:text-foreground border border-border rounded px-2 py-1 transition-colors cursor-pointer"
              title="Export OpenAPI"
            >
              <Download className="h-3 w-3" />
              OpenAPI
            </button>
            {exportMenu && (
              <div className="absolute right-0 top-7 z-20 bg-bg-secondary border border-border rounded-lg shadow-lg py-1 w-32">
                <button
                  onClick={() => handleExport("yaml")}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
                >
                  YAML
                </button>
                <button
                  onClick={() => handleExport("json")}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
                >
                  JSON
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Entropy legend */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 shrink-0">
        <Zap className="h-3 w-3 text-orange-400 shrink-0" />
        <span className="text-[10px] text-text-muted">
          <span className="text-orange-400 font-mono">⚡ computed</span> = value changes every request (likely signature)
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {/* Request headers */}
        <Section title={`Request Headers (${endpoint.requestHeaders.length})`}>
          <HeaderTable headers={endpoint.requestHeaders} />
        </Section>

        {/* Request body */}
        {endpoint.requestBody && (
          <Section title="Request Body (JSON)">
            <BodySchemaTable body={endpoint.requestBody} />
          </Section>
        )}

        {/* Responses */}
        {statusCodes.map(code => (
          <Section key={code} title={`Response ${code}`} defaultOpen={code >= 200 && code < 300}>
            {endpoint.responses[code].body
              ? <BodySchemaTable body={endpoint.responses[code].body!} />
              : <p className="text-[11px] text-text-muted px-3 py-2">No JSON body captured</p>
            }
          </Section>
        ))}

        {statusCodes.length === 0 && !endpoint.requestBody && (
          <p className="text-[11px] text-text-muted px-3 py-4 text-center">
            No request or response body captured for this endpoint.
          </p>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api, apiPut } from "@/lib/api";
import { useAppState } from "@/lib/store";
import {
  Check,
  Package,
  Radio,
  Cpu,
  FolderOpen,
  Network,
  Monitor,
  Plus,
  X,
  RefreshCw,
  FolderSearch,
} from "lucide-react";
import type { SettingsField } from "@/lib/types";
import FolderPicker from "@/components/dashboard/FolderPicker";
import clsx from "clsx";

// ── Glob ↔ regex conversion ───────────────────────────────────────────────────
// Backend stores pipe-separated regex like: .*perimeterx\.net|.*perfdrive\.com
// UI shows human-friendly globs:            *.perimeterx.net  *.perfdrive.com

function globToRegex(glob: string): string {
  // If it already looks like regex (contains \.  or starts with .* etc), keep it
  if (/\\\.|^\.\*/.test(glob)) return glob;
  // Escape dots, then turn * wildcard into .*
  const escaped = glob.replace(/\./g, "\\.").replace(/\*/g, ".*");
  return escaped.startsWith(".*") ? escaped : `.*${escaped}`;
}

function regexToGlob(regex: string): string {
  // .*foo\.com → *.foo.com
  return regex
    .replace(/^\.\*/, "*")    // leading .* → *
    .replace(/\\\./g, ".");   // \. → .
}

function parseIgnoreHosts(raw: string): string[] {
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(regexToGlob);
}

function serializeIgnoreHosts(globs: string[]): string {
  return globs.map(globToRegex).join("|");
}

// ── Field metadata ────────────────────────────────────────────────────────────

interface FieldMeta {
  group: string;
  label: string;
  description: string;
  type: "text" | "number" | "textarea" | "segment" | "path" | "ignore-hosts" | "frida-path" | "host-ip";
  options?: { label: string; value: string }[];
  placeholder?: string;
  mono?: boolean;
  hidden?: boolean;
}

const FIELD_META: Record<string, FieldMeta> = {
  package: {
    group: "Capture",
    label: "Target app",
    description: "Android package ID of the app to intercept. Set this from the app picker in Capture or Fingerprints.",
    type: "text",
    placeholder: "com.example.app",
    mono: true,
    hidden: true, // set elsewhere — redundant here
  },
  port: {
    group: "Capture",
    label: "Proxy port",
    description: "Local port mitmproxy listens on. Configure this as the device's HTTP proxy.",
    type: "number",
    placeholder: "8080",
  },
  ignore_hosts: {
    group: "Capture",
    label: "Ignored hosts",
    description: "Hostnames to hide from capture results. Use * as a wildcard — e.g. *.analytics.com",
    type: "ignore-hosts",
  },
  attach_delay: {
    group: "Frida",
    label: "Attach delay",
    description: "Seconds to wait after app launch before Frida attaches. Increase if the app crashes on injection.",
    type: "number",
    placeholder: "10",
  },
  frida_server: {
    group: "Frida",
    label: "Frida server path",
    description: "Path to the frida-server binary on the Android device.",
    type: "frida-path",
    mono: true,
  },
  host_ip: {
    group: "Network",
    label: "Host IP",
    description: "IP of this machine used for device proxy config. Leave blank to auto-detect.",
    type: "host-ip",
  },
  web_port: {
    group: "Network",
    label: "Web UI port",
    description: "Port this sniff! web interface listens on.",
    type: "number",
    placeholder: "9090",
  },
  export_format: {
    group: "Output",
    label: "Export format",
    description: "Default format when downloading captured traffic.",
    type: "segment",
    options: [
      { label: "JSON", value: "json" },
      { label: "HAR", value: "har" },
    ],
  },
  captures_dir: {
    group: "Output",
    label: "Captures directory",
    description: "Local directory where exported captures are saved.",
    type: "path",
    mono: true,
  },
  ui_mode: {
    group: "Interface",
    label: "UI mode",
    description: "Whether sniff! starts in terminal TUI or web browser mode.",
    type: "segment",
    options: [
      { label: "Web UI", value: "web" },
      { label: "Terminal", value: "tui" },
    ],
  },
};

const GROUPS: { key: string; label: string; icon: React.ElementType }[] = [
  { key: "Capture",   label: "Capture",   icon: Radio },
  { key: "Frida",     label: "Frida",     icon: Cpu },
  { key: "Network",   label: "Network",   icon: Network },
  { key: "Output",    label: "Output",    icon: FolderOpen },
  { key: "Interface", label: "Interface", icon: Monitor },
];

// ── Saved flash ────────────────────────────────────────────────────────────────

function useSaved() {
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const flash = useCallback((key: string) => {
    setSavedKey(key);
    setTimeout(() => setSavedKey(null), 1800);
  }, []);
  return { savedKey, flash };
}

// ── Segmented control ──────────────────────────────────────────────────────────

function SegmentControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex bg-bg-tertiary border border-border rounded-xl p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={clsx(
            "px-3 py-1.5 rounded-[10px] text-[12px] font-medium transition-all cursor-pointer",
            value === opt.value
              ? "bg-accent/15 text-accent-bright shadow-sm"
              : "text-text-muted hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Ignore-hosts tag list ──────────────────────────────────────────────────────

function IgnoreHostsList({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [items, setItems] = useState<string[]>(() => parseIgnoreHosts(value));
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(newItems: string[]) {
    setItems(newItems);
    onChange(serializeIgnoreHosts(newItems));
  }

  function addItem() {
    const trimmed = input.trim();
    if (!trimmed || items.includes(trimmed)) {
      setInput("");
      return;
    }
    commit([...items, trimmed]);
    setInput("");
  }

  function removeItem(idx: number) {
    commit(items.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 bg-bg-tertiary border border-border rounded-lg px-2 py-1 text-[11px] font-mono text-foreground"
          >
            {item}
            <button
              onClick={() => removeItem(i)}
              className="text-text-muted hover:text-bad transition-colors cursor-pointer ml-0.5"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); addItem(); }
            if (e.key === "Escape") setInput("");
          }}
          placeholder="*.example.com or exact host"
          className="flex-1 bg-bg-tertiary border border-border rounded-xl px-3 py-2 text-[12px] font-mono text-foreground outline-none focus:border-accent/50 transition-colors placeholder:text-text-muted"
        />
        <button
          onClick={addItem}
          disabled={!input.trim()}
          className="flex items-center gap-1 px-3 py-2 rounded-xl border border-border bg-bg-tertiary text-[12px] text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
      <p className="text-[10px] text-text-muted/60">
        Press Enter or click Add. Use * as wildcard — *.cdn.net, exact.host.com
      </p>
    </div>
  );
}

// ── Host IP field with auto-detect ────────────────────────────────────────────

function HostIPField({
  value,
  onSave,
  saved,
}: {
  value: string;
  onSave: (v: string) => void;
  saved: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [detected, setDetected] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => setDraft(value), [value]);

  async function detect() {
    setDetecting(true);
    try {
      const dev = await api("/device") as { HostIP?: string };
      setDetected(dev.HostIP || null);
    } catch {}
    setDetecting(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft !== value) onSave(draft); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave(draft);
            if (e.key === "Escape") setDraft(value);
          }}
          placeholder="Auto-detect"
          className="flex-1 bg-bg-tertiary border border-border rounded-xl px-3 py-2 text-[12px] font-mono text-foreground outline-none focus:border-accent/50 transition-colors placeholder:text-text-muted"
        />
        <button
          onClick={detect}
          disabled={detecting}
          title="Detect from connected device"
          className="flex items-center gap-1 px-3 py-2 rounded-xl border border-border bg-bg-tertiary text-[12px] text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer disabled:opacity-40"
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", detecting && "animate-spin")} />
          Detect
        </button>
        {draft && (
          <button
            onClick={() => { setDraft(""); onSave(""); }}
            title="Clear — use auto-detection"
            className="flex items-center gap-1 px-3 py-2 rounded-xl border border-border bg-bg-tertiary text-[12px] text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
            Auto
          </button>
        )}
      </div>
      {detected && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-text-muted">Detected:</span>
          <span className="font-mono text-foreground">{detected}</span>
          <button
            onClick={() => { setDraft(detected); onSave(detected); setDetected(null); }}
            className="text-accent-bright hover:text-accent cursor-pointer transition-colors underline"
          >
            Use this
          </button>
        </div>
      )}
      {!draft && (
        <p className="text-[10px] text-text-muted/60">
          Blank = auto-detect from network interfaces
        </p>
      )}
    </div>
  );
}

// ── Frida server path with auto-detect ────────────────────────────────────────

function FridaPathField({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [found, setFound] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => setDraft(value), [value]);

  async function detect() {
    setDetecting(true);
    try {
      const res = await api("/detect/frida") as { paths: string[] };
      setFound(res.paths || []);
      setShowDropdown(true);
    } catch {}
    setDetecting(false);
  }

  return (
    <div className="space-y-2 relative">
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft !== value) onSave(draft); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave(draft);
            if (e.key === "Escape") setDraft(value);
          }}
          placeholder="/data/local/tmp/frida-server"
          className="flex-1 bg-bg-tertiary border border-border rounded-xl px-3 py-2 text-[12px] font-mono text-foreground outline-none focus:border-accent/50 transition-colors placeholder:text-text-muted"
        />
        <button
          onClick={detect}
          disabled={detecting}
          title="Scan device for frida-server"
          className="flex items-center gap-1 px-3 py-2 rounded-xl border border-border bg-bg-tertiary text-[12px] text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer disabled:opacity-40"
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", detecting && "animate-spin")} />
          Detect
        </button>
      </div>

      {showDropdown && (
        <div className="rounded-xl border border-card-border bg-card shadow-lg overflow-hidden">
          {found.length === 0 ? (
            <div className="px-3 py-2.5 text-[12px] text-text-muted flex items-center gap-2">
              <X className="h-3.5 w-3.5 text-bad" />
              No frida-server found on device
            </div>
          ) : (
            <>
              <div className="px-3 py-1.5 text-[10px] text-text-muted border-b border-border">
                Found on device:
              </div>
              {found.map((p) => (
                <button
                  key={p}
                  onClick={() => { setDraft(p); onSave(p); setShowDropdown(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-bg-elevated transition-colors cursor-pointer text-[12px] font-mono text-foreground"
                >
                  <Check className="h-3.5 w-3.5 text-good shrink-0" />
                  {p}
                </button>
              ))}
            </>
          )}
          <button
            onClick={() => setShowDropdown(false)}
            className="w-full px-3 py-1.5 text-[10px] text-text-muted hover:text-foreground border-t border-border transition-colors cursor-pointer text-left"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// ── Path field with folder picker ─────────────────────────────────────────────

function PathField({
  value,
  onSave,
  mono,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [picking, setPicking] = useState(false);

  useEffect(() => setDraft(value), [value]);

  return (
    <>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft !== value) onSave(draft); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave(draft);
            if (e.key === "Escape") setDraft(value);
          }}
          placeholder={placeholder}
          className={clsx(
            "flex-1 bg-bg-tertiary border border-border rounded-xl px-3 py-2 text-[12px] outline-none focus:border-accent/50 transition-colors placeholder:text-text-muted",
            mono ? "font-mono text-foreground" : "text-foreground"
          )}
        />
        <button
          onClick={() => setPicking(true)}
          title="Browse…"
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-bg-tertiary text-[12px] text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
        >
          <FolderSearch className="h-3.5 w-3.5" />
          Browse
        </button>
      </div>

      {picking && (
        <FolderPicker
          initialPath={draft || undefined}
          onSelect={(p) => { setDraft(p); onSave(p); }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

// ── Generic setting row ────────────────────────────────────────────────────────

function SettingRow({
  field,
  meta,
  onSave,
  saved,
}: {
  field: SettingsField;
  meta: FieldMeta;
  onSave: (key: string, value: string) => Promise<void>;
  saved: boolean;
}) {
  const [draft, setDraft] = useState(field.value);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(field.value), [field.value]);

  async function commit(value: string) {
    if (value === field.value) return;
    setSaving(true);
    await onSave(field.key, value);
    setSaving(false);
  }

  const inputClass = clsx(
    "w-full bg-bg-tertiary border border-border rounded-xl px-3 py-2 text-[12px] outline-none focus:border-accent/50 transition-colors placeholder:text-text-muted",
    meta.mono ? "font-mono text-foreground" : "text-foreground"
  );

  function renderInput() {
    if (meta.type === "segment" && meta.options) {
      return (
        <SegmentControl
          value={draft}
          options={meta.options}
          onChange={(v) => { setDraft(v); commit(v); }}
        />
      );
    }
    if (meta.type === "ignore-hosts") {
      return (
        <IgnoreHostsList
          value={draft}
          onChange={(v) => { setDraft(v); commit(v); }}
        />
      );
    }
    if (meta.type === "host-ip") {
      return (
        <HostIPField
          value={draft}
          onSave={(v) => { setDraft(v); commit(v); }}
          saved={saved}
        />
      );
    }
    if (meta.type === "frida-path") {
      return (
        <FridaPathField
          value={draft}
          onSave={(v) => { setDraft(v); commit(v); }}
        />
      );
    }
    if (meta.type === "path") {
      return (
        <PathField
          value={draft}
          onSave={(v) => { setDraft(v); commit(v); }}
          mono={meta.mono}
          placeholder={meta.placeholder}
        />
      );
    }
    return (
      <input
        type={meta.type === "number" ? "number" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(draft);
          if (e.key === "Escape") setDraft(field.value);
        }}
        placeholder={meta.placeholder}
        className={inputClass}
      />
    );
  }

  return (
    <div className="grid grid-cols-[1fr_1.3fr] gap-6 py-4 px-5 items-start border-b border-border/50 last:border-0">
      <div className="space-y-0.5 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-foreground">{meta.label}</span>
          {saved && (
            <span className="flex items-center gap-0.5 text-[10px] text-good font-mono animate-in fade-in">
              <Check className="h-2.5 w-2.5" /> saved
            </span>
          )}
          {saving && <span className="text-[10px] text-text-muted font-mono">saving…</span>}
        </div>
        <p className="text-[11px] text-text-muted leading-relaxed">{meta.description}</p>
      </div>
      <div>{renderInput()}</div>
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────────────────────

function Section({
  group,
  fields,
  onSave,
  savedKey,
}: {
  group: (typeof GROUPS)[0];
  fields: SettingsField[];
  onSave: (key: string, value: string) => Promise<void>;
  savedKey: string | null;
}) {
  const visible = fields.filter((f) => !FIELD_META[f.key]?.hidden);
  if (visible.length === 0) return null;
  const Icon = group.icon;
  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-card-border bg-bg-secondary/40">
        <Icon className="h-3.5 w-3.5 text-text-muted" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
          {group.label}
        </span>
      </div>
      {visible.map((f) => {
        const meta = FIELD_META[f.key];
        if (!meta) return null;
        return (
          <SettingRow
            key={f.key}
            field={f}
            meta={meta}
            onSave={onSave}
            saved={savedKey === f.key}
          />
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { setPkg } = useAppState();
  const [fields, setFields] = useState<SettingsField[]>([]);
  const { savedKey, flash } = useSaved();

  useEffect(() => {
    api("/settings")
      .then((data) => setFields(Array.isArray(data) ? data : []))
      .catch((e) => console.error("settings load:", e));
  }, []);

  async function handleSave(key: string, value: string) {
    await apiPut("/settings", { key, value });
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, value } : f)));
    if (key === "package") setPkg(value);
    flash(key);
  }

  const grouped = GROUPS.map((g) => ({
    group: g,
    fields: fields.filter((f) => FIELD_META[f.key]?.group === g.key),
  }));

  const unmapped = fields.filter((f) => !FIELD_META[f.key]);

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-text-muted" />
          <div>
            <h2 className="text-[18px] font-bold text-foreground">Settings</h2>
            <p className="text-[12px] text-text-muted">Changes save automatically on blur or Enter</p>
          </div>
        </div>

        {grouped.map(({ group, fields: gFields }) => (
          <Section key={group.key} group={group} fields={gFields} onSave={handleSave} savedKey={savedKey} />
        ))}

        {unmapped.length > 0 && (
          <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b border-card-border bg-bg-secondary/40">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">Other</span>
            </div>
            {unmapped.map((f) => (
              <SettingRow
                key={f.key}
                field={f}
                meta={{ group: "Other", label: f.label, description: "", type: "text", mono: true }}
                onSave={handleSave}
                saved={savedKey === f.key}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

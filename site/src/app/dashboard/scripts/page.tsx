"use client";

import { useEffect, useState, useRef } from "react";
import { api, apiPost, apiPut } from "@/lib/api";
import {
  Check, Plus, Pencil, Trash2, Upload, X, Save, Code,
  FileCode, ChevronLeft, Globe, RefreshCw, ExternalLink,
  Loader2, ArrowDownToLine, Filter,
} from "lucide-react";
import type { FridaScript } from "@/lib/types";
import {
  fetchCommunityScripts,
  fetchCommunityScriptContent,
  invalidateCommunityScripts,
  type CommunityScriptEntry,
} from "@/lib/communityScripts";
import { useAppState } from "@/lib/store";
import { getCachedFramework, FRAMEWORK_LABELS } from "@/lib/frameworkCache";
import clsx from "clsx";

// ── Label colors ──────────────────────────────────────────────────────────────

function labelColor(label: string): string {
  const map: Record<string, string> = {
    BEST: "bg-good/15 text-good border-good/20",
    LIGHTWEIGHT: "bg-accent/15 text-accent border-accent/20",
    "OKHTTP APPS": "bg-warn/15 text-warn border-warn/20",
    DIAGNOSTIC: "bg-bg-tertiary text-text-muted border-border",
    "HYBRID APPS": "bg-accent/15 text-accent border-accent/20",
    "RN APPS": "bg-accent/15 text-accent border-accent/20",
    FLUTTER: "bg-bad/15 text-bad border-bad/20",
    "APP-SPECIFIC": "bg-bad/15 text-bad border-bad/20",
    CUSTOM: "bg-brand-dim text-brand-light border-brand/20",
    COMMUNITY: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  };
  return map[label] || "bg-bg-tertiary text-text-muted border-border";
}

// ── Editor state ──────────────────────────────────────────────────────────────

interface EditorState {
  mode: "create" | "edit" | "view";
  scriptId?: string;
  name: string;
  label: string;
  desc: string;
  content: string;
  isCustom: boolean;
  saving: boolean;
}

// ── Community script card ─────────────────────────────────────────────────────

function CommunityScriptCard({
  entry,
  onInstall,
}: {
  entry: CommunityScriptEntry;
  onInstall: () => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function handleInstall() {
    if (done) return;
    setInstalling(true);
    setErr("");
    try {
      const content = await fetchCommunityScriptContent(entry.path);
      await apiPost("/scripts/custom", {
        name: entry.name,
        content,
        label: "COMMUNITY",
        desc: entry.description,
      });
      setDone(true);
      onInstall();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card px-5 py-4 flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={clsx("rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide shrink-0 w-24 text-center", labelColor("COMMUNITY"))}>
              COMMUNITY
            </span>
            <span className="text-sm font-semibold text-foreground truncate">{entry.name}</span>
          </div>
          <p className="text-xs text-text-muted leading-relaxed">{entry.description}</p>
        </div>
      </div>

      {/* Framework + tag chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {entry.frameworks.map((fw) => (
          <span
            key={fw}
            className="text-[9px] font-mono font-semibold px-1.5 py-px rounded border bg-accent/10 border-accent/20 text-accent-bright"
          >
            {FRAMEWORK_LABELS[fw] ?? fw}
          </span>
        ))}
        {entry.tags.map((tag) => (
          <span
            key={tag}
            className="text-[9px] font-mono px-1.5 py-px rounded border bg-bg-tertiary border-border text-text-muted"
          >
            #{tag}
          </span>
        ))}
        <span className="ml-auto text-[10px] font-mono text-text-muted">
          by {entry.author}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        {err && <span className="text-[10px] text-bad font-mono flex-1">{err}</span>}
        <div className="flex-1" />
        <button
          onClick={handleInstall}
          disabled={installing || done}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer disabled:opacity-60",
            done
              ? "bg-good/10 border-good/20 text-good"
              : "bg-accent text-white border-transparent hover:bg-accent-light shadow-sm shadow-accent/25"
          )}
        >
          {installing ? (
            <><Loader2 className="h-3 w-3 animate-spin" />Installing…</>
          ) : done ? (
            <><Check className="h-3 w-3" />Installed</>
          ) : (
            <><ArrowDownToLine className="h-3 w-3" />Install</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "library" | "community";

export default function ScriptsPage() {
  const { pkg } = useAppState();
  const [tab, setTab] = useState<Tab>("library");
  const [scripts, setScripts] = useState<FridaScript[]>([]);
  const [activeId, setActiveId] = useState("universal");
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Community state
  const [community, setCommunity] = useState<CommunityScriptEntry[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityErr, setCommunityErr] = useState("");
  const [fwFilter, setFwFilter] = useState<string | null>(null);

  // Detected framework for the active package
  const detectedFw = pkg ? getCachedFramework(pkg) : null;
  const detectedFwKey = detectedFw?.framework !== "unknown" ? detectedFw?.framework ?? null : null;

  function loadScripts() {
    Promise.all([api("/scripts"), api("/state")])
      .then(([scriptList, state]) => {
        setScripts(Array.isArray(scriptList) ? scriptList : []);
        setActiveId(state.settings?.frida_script_id || "universal");
      })
      .catch((e) => console.error("scripts load:", e))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadScripts();
  }, []);

  useEffect(() => {
    if (tab !== "community" || community.length > 0) return;
    loadCommunity();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadCommunity(forceRefresh = false) {
    if (forceRefresh) invalidateCommunityScripts();
    setCommunityLoading(true);
    setCommunityErr("");
    try {
      const data = await fetchCommunityScripts();
      setCommunity(data);
      // Auto-set framework filter to detected framework on first load
      if (detectedFwKey && data.some((e) => e.frameworks.includes(detectedFwKey))) {
        setFwFilter(detectedFwKey);
      }
    } catch {
      setCommunityErr("Failed to load community scripts");
    } finally {
      setCommunityLoading(false);
    }
  }

  async function select(id: string) {
    await apiPut("/settings", { key: "frida_script_id", value: id });
    setActiveId(id);
  }

  async function openEditor(script: FridaScript, mode: "edit" | "view") {
    try {
      const res = await api(`/scripts/content?id=${script.ID}`);
      let content = res.content || "";
      if (content.startsWith("// META:")) {
        const idx = content.indexOf("\n");
        if (idx >= 0) content = content.slice(idx + 1);
      }
      setEditor({
        mode,
        scriptId: script.ID,
        name: script.Name,
        label: script.Label,
        desc: script.Desc,
        content,
        isCustom: script.ID.startsWith("custom_"),
        saving: false,
      });
    } catch (e) {
      console.error("load script:", e);
    }
  }

  function openCreate() {
    setEditor({
      mode: "create",
      name: "",
      label: "CUSTOM",
      desc: "",
      content: `// Custom Frida script
Java.perform(function() {
  console.log("[*] Script loaded");
});
`,
      isCustom: true,
      saving: false,
    });
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      const name = file.name.replace(/\.js$/, "");
      setEditor({ mode: "create", name, label: "CUSTOM", desc: "", content, isCustom: true, saving: false });
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleSave() {
    if (!editor) return;
    setEditor({ ...editor, saving: true });
    try {
      if (editor.mode === "create") {
        await apiPost("/scripts/custom", {
          name: editor.name,
          content: editor.content,
          label: editor.label,
          desc: editor.desc,
        });
      } else {
        await apiPut("/scripts/custom", {
          id: editor.scriptId,
          content: editor.content,
          label: editor.label,
          desc: editor.desc,
          name: editor.name,
        });
      }
      setEditor(null);
      loadScripts();
    } catch (e) {
      console.error("save:", e);
      setEditor({ ...editor, saving: false });
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await api(`/scripts/custom?id=${id}`, { method: "DELETE" });
      loadScripts();
    } catch (e) {
      console.error("delete:", e);
    } finally {
      setDeleting(null);
    }
  }

  // All unique frameworks across community scripts, for filter chips
  const allFrameworks = Array.from(
    new Set(community.flatMap((e) => e.frameworks))
  );

  const filteredCommunity = fwFilter
    ? community.filter(
        (e) => e.frameworks.length === 0 || e.frameworks.includes(fwFilter)
      )
    : community;

  // ── Editor view ─────────────────────────────────────────────────────────────
  if (editor) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-2.5 border-b border-border bg-bg-secondary flex items-center gap-3 shrink-0">
          <button
            onClick={() => setEditor(null)}
            className="flex items-center gap-1 text-[12px] text-text-secondary hover:text-foreground transition-colors cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <div className="w-px h-5 bg-border" />
          <FileCode className="h-4 w-4 text-accent shrink-0" />
          <input
            type="text"
            value={editor.name}
            onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            placeholder="Script name"
            className="bg-transparent text-sm font-semibold text-foreground outline-none flex-1 min-w-0 placeholder:text-text-muted"
          />
          <div className="flex-1" />
          {!editor.isCustom && (
            <span className="text-[10px] font-medium text-warn bg-warn/10 rounded px-2 py-0.5 border border-warn/20">
              BUILT-IN
            </span>
          )}
          <input
            type="text"
            value={editor.desc}
            onChange={(e) => setEditor({ ...editor, desc: e.target.value })}
            placeholder="Description"
            className="bg-bg-tertiary border border-border rounded-lg px-2.5 py-1 text-[11px] text-foreground outline-none w-48 placeholder:text-text-muted focus:border-accent/30"
          />
          <button
            onClick={handleSave}
            disabled={editor.saving || !editor.name.trim()}
            className="flex items-center gap-1.5 text-[11px] font-semibold bg-accent text-white rounded-lg px-3 py-1.5 hover:bg-accent-light transition-colors cursor-pointer disabled:opacity-50 shadow-sm shadow-accent/25"
          >
            <Save className="h-3 w-3" />
            {editor.saving ? "Saving…" : editor.mode === "create" ? "Create" : "Save"}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-[#08080a]">
          <textarea
            ref={textareaRef}
            value={editor.content}
            onChange={(e) => setEditor({ ...editor, content: e.target.value })}
            className="w-full h-full min-h-[500px] bg-transparent text-[12px] leading-[20px] font-mono text-foreground p-4 outline-none resize-none"
            spellCheck={false}
            placeholder="// Write your Frida script here..."
          />
        </div>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Frida Scripts</h2>
            <p className="text-sm text-text-muted mt-0.5">
              Select, create, or install SSL pinning bypass scripts
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Tab toggle */}
            <div className="flex items-center gap-0.5 bg-bg-tertiary border border-border rounded-lg p-0.5">
              <button
                onClick={() => setTab("library")}
                className={clsx(
                  "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer",
                  tab === "library"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-text-muted hover:text-foreground"
                )}
              >
                Library
              </button>
              <button
                onClick={() => setTab("community")}
                className={clsx(
                  "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer",
                  tab === "community"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-text-muted hover:text-foreground"
                )}
              >
                <Globe className="h-3 w-3" />
                Community
              </button>
            </div>

            {tab === "library" && (
              <>
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg-tertiary hover:text-foreground transition-colors cursor-pointer">
                  <Upload className="h-3 w-3" />
                  Upload .js
                  <input ref={fileInputRef} type="file" accept=".js" onChange={handleUpload} className="hidden" />
                </label>
                <button
                  onClick={openCreate}
                  className="flex items-center gap-1.5 text-[11px] font-semibold bg-accent text-white rounded-lg px-3 py-1.5 hover:bg-accent-light transition-colors cursor-pointer shadow-sm shadow-accent/25"
                >
                  <Plus className="h-3 w-3" />
                  New script
                </button>
              </>
            )}

            {tab === "community" && (
              <>
                <button
                  onClick={() => loadCommunity(true)}
                  disabled={communityLoading}
                  title="Refresh"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border bg-bg-tertiary text-[11px] font-medium text-text-muted hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={clsx("h-3 w-3", communityLoading && "animate-spin")} />
                  Refresh
                </button>
                <a
                  href="https://github.com/pentium-solver/sniff/blob/main/CONTRIBUTING.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border bg-bg-tertiary text-[11px] font-medium text-text-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <ExternalLink className="h-3 w-3" />
                  Submit yours
                </a>
              </>
            )}
          </div>
        </div>

        {/* ── Library tab ── */}
        {tab === "library" && (
          loading ? (
            <div className="rounded-xl border border-card-border bg-card p-12 text-center">
              <p className="text-sm text-text-muted">Loading scripts...</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Framework recommendation banner */}
              {detectedFwKey && (
                <div className="rounded-xl border border-accent/20 bg-accent/[0.04] px-4 py-3 flex items-center gap-3">
                  <span className="text-[11px] font-semibold text-accent-bright">
                    {FRAMEWORK_LABELS[detectedFwKey] ?? detectedFwKey} detected
                  </span>
                  <span className="text-[11px] text-text-muted">
                    — select a script tagged for this framework for best results.
                  </span>
                </div>
              )}

              {/* Built-in scripts */}
              {scripts
                .filter((s) => !s.ID.startsWith("custom_"))
                .map((script) => {
                  const isActive = activeId === script.ID;
                  return (
                    <div
                      key={script.ID}
                      className={clsx(
                        "rounded-xl border px-5 py-4 transition-all duration-150 group",
                        isActive
                          ? "border-accent/30 bg-accent/[0.06]"
                          : "border-card-border bg-card hover:border-border-light hover:bg-card-hover"
                      )}
                    >
                      <div className="flex items-center gap-3 mb-1.5">
                        <button
                          onClick={() => select(script.ID)}
                          className="cursor-pointer flex items-center gap-3 flex-1 min-w-0 text-left"
                        >
                          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide shrink-0 w-24 text-center ${labelColor(script.Label)}`}>
                            {script.Label}
                          </span>
                          <span className="text-sm font-semibold text-foreground truncate">{script.Name}</span>
                        </button>
                        {isActive && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-accent shrink-0">
                            <Check className="h-3.5 w-3.5" />
                            ACTIVE
                          </span>
                        )}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={() => openEditor(script, "edit")}
                            className="p-1.5 rounded-lg text-text-muted hover:text-foreground hover:bg-bg-tertiary transition-colors cursor-pointer"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-text-muted leading-relaxed pl-0.5">{script.Desc}</p>
                    </div>
                  );
                })}

              {/* Custom scripts section */}
              {scripts.some((s) => s.ID.startsWith("custom_")) && (
                <>
                  <div className="pt-3 pb-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-muted">
                      Custom Scripts
                    </div>
                  </div>
                  {scripts
                    .filter((s) => s.ID.startsWith("custom_"))
                    .map((script) => {
                      const isActive = activeId === script.ID;
                      return (
                        <div
                          key={script.ID}
                          className={clsx(
                            "rounded-xl border px-5 py-4 transition-all duration-150 group",
                            isActive
                              ? "border-accent/30 bg-accent/[0.06]"
                              : "border-card-border bg-card hover:border-border-light hover:bg-card-hover"
                          )}
                        >
                          <div className="flex items-center gap-3 mb-1.5">
                            <button
                              onClick={() => select(script.ID)}
                              className="cursor-pointer flex items-center gap-3 flex-1 min-w-0 text-left"
                            >
                              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide shrink-0 w-24 text-center ${labelColor(script.Label)}`}>
                                {script.Label}
                              </span>
                              <span className="text-sm font-semibold text-foreground truncate">{script.Name}</span>
                            </button>
                            {isActive && (
                              <span className="flex items-center gap-1 text-[11px] font-semibold text-accent shrink-0">
                                <Check className="h-3.5 w-3.5" />
                                ACTIVE
                              </span>
                            )}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <button
                                onClick={() => openEditor(script, "edit")}
                                className="p-1.5 rounded-lg text-text-muted hover:text-foreground hover:bg-bg-tertiary transition-colors cursor-pointer"
                                title="Edit"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleDelete(script.ID)}
                                disabled={deleting === script.ID}
                                className="p-1.5 rounded-lg text-text-muted hover:text-bad hover:bg-bad/10 transition-colors cursor-pointer disabled:opacity-50"
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-text-muted leading-relaxed pl-0.5">{script.Desc}</p>
                        </div>
                      );
                    })}
                </>
              )}
            </div>
          )
        )}

        {/* ── Community tab ── */}
        {tab === "community" && (
          communityLoading ? (
            <div className="rounded-xl border border-card-border bg-card p-12 flex flex-col items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
              <p className="text-sm text-text-muted">Loading community scripts…</p>
            </div>
          ) : communityErr ? (
            <div className="rounded-xl border border-bad/20 bg-bad/[0.04] p-8 text-center space-y-3">
              <p className="text-sm text-bad">{communityErr}</p>
              <button onClick={() => loadCommunity(true)} className="text-xs text-accent-bright hover:underline cursor-pointer">
                Try again
              </button>
            </div>
          ) : community.length === 0 ? (
            <div className="rounded-xl border border-card-border bg-card p-12 flex flex-col items-center gap-3 text-center">
              <Globe className="h-8 w-8 text-text-muted/30" />
              <p className="text-sm text-text-muted">No community scripts yet</p>
              <p className="text-xs text-text-muted/60 max-w-xs">
                Be the first to contribute. Write a Frida script, open a PR to add it to{" "}
                <code className="font-mono">library/</code>, and it appears here for everyone.
              </p>
              <a
                href="https://github.com/pentium-solver/sniff/blob/main/CONTRIBUTING.md"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-accent-bright hover:underline cursor-pointer"
              >
                <ExternalLink className="h-3 w-3" />
                Contribution guide →
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Framework filter chips */}
              {allFrameworks.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Filter className="h-3 w-3 text-text-muted shrink-0" />
                  <button
                    onClick={() => setFwFilter(null)}
                    className={clsx(
                      "text-[10px] font-mono font-semibold px-2 py-0.5 rounded border transition-colors cursor-pointer",
                      fwFilter === null
                        ? "bg-accent/15 border-accent/30 text-accent-bright"
                        : "bg-bg-tertiary border-border text-text-muted hover:text-foreground"
                    )}
                  >
                    All
                  </button>
                  {allFrameworks.map((fw) => (
                    <button
                      key={fw}
                      onClick={() => setFwFilter(fwFilter === fw ? null : fw)}
                      className={clsx(
                        "text-[10px] font-mono font-semibold px-2 py-0.5 rounded border transition-colors cursor-pointer",
                        fwFilter === fw
                          ? "bg-accent/15 border-accent/30 text-accent-bright"
                          : "bg-bg-tertiary border-border text-text-muted hover:text-foreground"
                      )}
                    >
                      {FRAMEWORK_LABELS[fw] ?? fw}
                      {fw === detectedFwKey && (
                        <span className="ml-1 text-[8px] text-good">●</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Script cards */}
              <div className="space-y-2">
                {filteredCommunity.map((entry) => (
                  <CommunityScriptCard
                    key={entry.id}
                    entry={entry}
                    onInstall={() => {
                      // Switch to library tab so user sees the installed script
                      setTab("library");
                      loadScripts();
                    }}
                  />
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

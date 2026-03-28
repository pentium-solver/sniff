"use client";

import { useEffect, useState, useRef } from "react";
import { api, apiPost, apiPut } from "@/lib/api";
import {
  Check,
  Plus,
  Pencil,
  Trash2,
  Upload,
  X,
  Save,
  Code,
  Eye,
  FileCode,
  ChevronLeft,
} from "lucide-react";
import type { FridaScript } from "@/lib/types";
import clsx from "clsx";

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
  };
  return map[label] || "bg-bg-tertiary text-text-muted border-border";
}

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

export default function ScriptsPage() {
  const [scripts, setScripts] = useState<FridaScript[]>([]);
  const [activeId, setActiveId] = useState("universal");
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function select(id: string) {
    await apiPut("/settings", { key: "frida_script_id", value: id });
    setActiveId(id);
  }

  async function openEditor(script: FridaScript, mode: "edit" | "view") {
    try {
      const res = await api(`/scripts/content?id=${script.ID}`);
      let content = res.content || "";
      // Strip META line for editing
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
    } catch (e: any) {
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
      setEditor({
        mode: "create",
        name,
        label: "CUSTOM",
        desc: "",
        content,
        isCustom: true,
        saving: false,
      });
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
    } catch (e: any) {
      console.error("save:", e);
      setEditor({ ...editor, saving: false });
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await api(`/scripts/custom?id=${id}`, { method: "DELETE" });
      loadScripts();
    } catch (e: any) {
      console.error("delete:", e);
    } finally {
      setDeleting(null);
    }
  }

  // Editor view
  if (editor) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Editor toolbar */}
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

          {/* Description */}
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

        {/* Code editor */}
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

  // Script list view
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Frida Scripts
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Select, create, or edit SSL pinning bypass scripts
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg-tertiary hover:text-foreground transition-colors cursor-pointer">
              <Upload className="h-3 w-3" />
              Upload .js
              <input
                ref={fileInputRef}
                type="file"
                accept=".js"
                onChange={handleUpload}
                className="hidden"
              />
            </label>
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 text-[11px] font-semibold bg-accent text-white rounded-lg px-3 py-1.5 hover:bg-accent-light transition-colors cursor-pointer shadow-sm shadow-accent/25"
            >
              <Plus className="h-3 w-3" />
              New script
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-card-border bg-card p-12 text-center">
            <p className="text-sm text-text-muted">Loading scripts...</p>
          </div>
        ) : (
          <div className="space-y-2">
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
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide shrink-0 w-24 text-center ${labelColor(script.Label)}`}
                        >
                          {script.Label}
                        </span>
                        <span className="text-sm font-semibold text-foreground truncate">
                          {script.Name}
                        </span>
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
                    <p className="text-xs text-text-muted leading-relaxed pl-0.5">
                      {script.Desc}
                    </p>
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
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide shrink-0 w-24 text-center ${labelColor(script.Label)}`}
                            >
                              {script.Label}
                            </span>
                            <span className="text-sm font-semibold text-foreground truncate">
                              {script.Name}
                            </span>
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
                        <p className="text-xs text-text-muted leading-relaxed pl-0.5">
                          {script.Desc}
                        </p>
                      </div>
                    );
                  })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

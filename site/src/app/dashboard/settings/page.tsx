"use client";

import { useEffect, useState } from "react";
import { api, apiPut } from "@/lib/api";
import { useAppState } from "@/lib/store";
import { Pencil, Check, X } from "lucide-react";
import type { SettingsField } from "@/lib/types";

export default function SettingsPage() {
  const { setPkg } = useAppState();
  const [fields, setFields] = useState<SettingsField[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("/settings")
      .then((data) => setFields(Array.isArray(data) ? data : []))
      .catch((e) => console.error("settings load:", e));
  }, []);

  function startEdit(f: SettingsField) {
    setEditing(f.key);
    setEditValue(f.value);
  }

  async function save(key: string) {
    setSaving(true);
    try {
      await apiPut("/settings", { key, value: editValue });
      setFields((prev) =>
        prev.map((f) => (f.key === key ? { ...f, value: editValue } : f))
      );
      if (key === "package") setPkg(editValue);
      setEditing(null);
    } catch (e) {
      console.error("save:", e);
    } finally {
      setSaving(false);
    }
  }

  function handleKey(e: React.KeyboardEvent, key: string) {
    if (e.key === "Enter") save(key);
    if (e.key === "Escape") setEditing(null);
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold text-foreground">Settings</h2>
          <p className="text-sm text-text-muted mt-0.5">
            Configure capture parameters, Frida settings, and export options
          </p>
        </div>

        {/* Settings card */}
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="divide-y divide-card-border">
            {fields.map((f) => (
              <div
                key={f.key}
                className="flex items-center gap-4 px-5 py-4 group hover:bg-card-hover transition-colors"
              >
                <div className="w-52 shrink-0">
                  <span className="text-sm font-medium text-text-secondary">
                    {f.label}
                  </span>
                </div>
                {editing === f.key ? (
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="text"
                      className="flex-1 bg-bg-tertiary border border-border-light rounded-lg px-3 py-2 text-sm font-mono text-foreground outline-none focus:border-accent transition-colors"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => handleKey(e, f.key)}
                      autoFocus
                    />
                    <button
                      className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition-colors cursor-pointer"
                      onClick={() => save(f.key)}
                      disabled={saving}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      className="flex items-center justify-center w-8 h-8 rounded-lg bg-bg-tertiary text-text-muted hover:bg-bg-elevated hover:text-foreground transition-colors cursor-pointer"
                      onClick={() => setEditing(null)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center gap-3 min-w-0">
                    <span className="flex-1 text-sm font-mono text-foreground truncate">
                      {f.value || "\u2014"}
                    </span>
                    <button
                      className="flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:bg-bg-elevated hover:text-foreground opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      onClick={() => startEdit(f)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

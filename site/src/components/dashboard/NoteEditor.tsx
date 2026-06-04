"use client";

import { useState, useEffect } from "react";
import { StickyNote } from "lucide-react";
import { useAnnotation } from "@/hooks/useAnnotation";
import clsx from "clsx";

interface NoteEditorProps {
  id: string;
  className?: string;
}

/** Inline note textarea. Auto-saves on blur. Shows a filled icon when a note exists. */
export default function NoteEditor({ id, className }: NoteEditorProps) {
  const [ann, update] = useAnnotation(id);
  const [draft, setDraft] = useState(ann.note ?? "");

  // Keep draft in sync if annotation changes from outside
  useEffect(() => {
    setDraft(ann.note ?? "");
  }, [ann.note]);

  function save() {
    const trimmed = draft.trim();
    update({ note: trimmed || undefined });
  }

  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-1.5">
        <StickyNote
          className={clsx(
            "h-3 w-3 shrink-0",
            ann.note ? "text-amber-400" : "text-text-muted"
          )}
        />
        <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
          Note
        </span>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        placeholder="Add a note…"
        rows={3}
        className="w-full bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-[11px] font-mono text-foreground placeholder:text-text-muted resize-y outline-none focus:border-accent/40 transition-colors leading-relaxed"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/** Compact note indicator icon — used in table rows to signal a note exists. */
export function NoteIndicator({ id }: { id: string }) {
  const [ann] = useAnnotation(id);
  if (!ann.note) return null;
  return (
    <span title={ann.note}>
      <StickyNote className="h-2.5 w-2.5 text-amber-400 shrink-0" />
    </span>
  );
}

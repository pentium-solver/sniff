"use client";

import { useState, useRef, useEffect } from "react";
import { useAnnotation } from "@/hooks/useAnnotation";
import clsx from "clsx";

interface InlineLabelProps {
  id: string;
  fallback: string;           // displayed when no custom label set
  className?: string;
  inputClassName?: string;
  title?: string;
}

/** Displays label ?? fallback. Double-click to rename inline. */
export default function InlineLabel({
  id,
  fallback,
  className,
  inputClassName,
  title,
}: InlineLabelProps) {
  const [ann, update] = useAnnotation(id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(ann.label ?? fallback);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, ann.label, fallback]);

  function commit() {
    const trimmed = draft.trim();
    update({ label: trimmed || undefined });
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") cancel();
        }}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          "bg-bg-tertiary border border-accent/40 rounded px-1 py-px outline-none text-foreground",
          inputClassName ?? className
        )}
      />
    );
  }

  return (
    <span
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title={title ?? (ann.label ? `${ann.label} (${fallback})` : fallback)}
      className={clsx(
        "cursor-text select-none",
        ann.label ? "text-foreground" : "",
        className
      )}
    >
      {ann.label ?? fallback}
    </span>
  );
}

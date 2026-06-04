"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, X } from "lucide-react";
import { useAnnotation } from "@/hooks/useAnnotation";
import clsx from "clsx";

// Six preset colors assigned deterministically from tag string hash.
// All classes are literal strings so Tailwind includes them in the bundle.
const PALETTE = [
  { bg: "bg-violet-500/20", text: "text-violet-300", x: "hover:bg-violet-500/30" },
  { bg: "bg-blue-500/20",   text: "text-blue-300",   x: "hover:bg-blue-500/30" },
  { bg: "bg-emerald-500/20",text: "text-emerald-300",x: "hover:bg-emerald-500/30" },
  { bg: "bg-amber-500/20",  text: "text-amber-300",  x: "hover:bg-amber-500/30" },
  { bg: "bg-rose-500/20",   text: "text-rose-300",   x: "hover:bg-rose-500/30" },
  { bg: "bg-cyan-500/20",   text: "text-cyan-300",   x: "hover:bg-cyan-500/30" },
];

function tagColor(tag: string) {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

interface TagListProps {
  id: string;
  maxTags?: number;
  className?: string;
}

export default function TagList({ id, maxTags = 5, className }: TagListProps) {
  const [ann, update] = useAnnotation(id);
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function addTag() {
    const tag = input.trim().toLowerCase().replace(/\s+/g, "-");
    if (!tag || ann.tags.includes(tag) || ann.tags.length >= maxTags) {
      setAdding(false);
      setInput("");
      return;
    }
    update({ tags: [...ann.tags, tag] });
    setInput("");
    setAdding(false);
  }

  function removeTag(tag: string, e: React.MouseEvent) {
    e.stopPropagation();
    update({ tags: ann.tags.filter((t) => t !== tag) });
  }

  return (
    <div
      className={clsx("flex items-center gap-1 flex-wrap", className)}
      onClick={(e) => e.stopPropagation()}
    >
      {ann.tags.map((tag) => {
        const c = tagColor(tag);
        return (
          <span
            key={tag}
            className={clsx(
              "inline-flex items-center gap-0.5 text-[9px] font-mono font-semibold px-1 py-px rounded leading-tight",
              c.bg, c.text
            )}
          >
            {tag}
            <button
              onClick={(e) => removeTag(tag, e)}
              className={clsx("rounded ml-0.5 cursor-pointer transition-colors", c.x)}
            >
              <X className="h-2 w-2" />
            </button>
          </span>
        );
      })}

      {ann.tags.length < maxTags && (
        adding ? (
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTag();
              if (e.key === "Escape") { setAdding(false); setInput(""); }
            }}
            onBlur={addTag}
            placeholder="tag…"
            className="text-[9px] font-mono bg-bg-tertiary border border-border rounded px-1 py-px w-14 outline-none text-foreground placeholder:text-text-muted"
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            title="Add tag"
            className="text-text-muted/40 hover:text-text-muted transition-colors cursor-pointer"
          >
            <Plus className="h-2.5 w-2.5" />
          </button>
        )
      )}
    </div>
  );
}

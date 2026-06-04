"use client";

import { Star } from "lucide-react";
import { useAnnotation } from "@/hooks/useAnnotation";
import clsx from "clsx";

interface PinButtonProps {
  id: string;
  className?: string;
}

export default function PinButton({ id, className }: PinButtonProps) {
  const [ann, update] = useAnnotation(id);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        update({ pinned: !ann.pinned });
      }}
      title={ann.pinned ? "Unpin" : "Pin"}
      className={clsx(
        "p-0.5 rounded transition-colors cursor-pointer shrink-0 select-none",
        ann.pinned
          ? "text-amber-400 hover:text-amber-300"
          : "text-text-muted/30 hover:text-text-muted",
        className
      )}
    >
      <Star className={clsx("h-3 w-3", ann.pinned && "fill-current")} />
    </button>
  );
}

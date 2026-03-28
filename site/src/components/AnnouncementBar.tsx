"use client";

import { useState } from "react";
import { X, ArrowRight } from "lucide-react";

export default function AnnouncementBar() {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div className="relative bg-brand-dim border-b border-brand/15 px-4 py-2.5 text-center text-sm">
      <span className="text-text-secondary">
        Open Source — Universal SSL Pinning Bypass with Frida Scripts
      </span>
      <a
        href="#features"
        className="ml-2 inline-flex items-center gap-1 text-brand-light hover:text-brand transition-colors"
      >
        Learn more <ArrowRight className="h-3.5 w-3.5" />
      </a>
      <button
        onClick={() => setVisible(false)}
        className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted hover:text-foreground transition-colors cursor-pointer"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

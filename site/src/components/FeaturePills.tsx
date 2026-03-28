"use client";

import { useState } from "react";
import { moduleTags } from "@/lib/constants";
import clsx from "clsx";

export default function FeaturePills() {
  const [selected, setSelected] = useState(0);

  return (
    <section id="modules" className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:py-20">
        <p className="mb-8 font-mono text-[11px] tracking-wider font-medium text-text-muted uppercase text-center">
          All-in-one Android traffic analysis &bull; Efficiency and control
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          {moduleTags.map((tag, i) => (
            <button
              key={tag}
              onClick={() => setSelected(i)}
              className={clsx(
                "rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-200 cursor-pointer",
                i === selected
                  ? "border-accent bg-accent-dim text-accent-light shadow-lg shadow-accent/10"
                  : "border-border text-text-secondary hover:border-border-light hover:text-foreground"
              )}
            >
              {i === selected && (
                <span className="mr-1.5 text-accent">&#10003;</span>
              )}
              {tag}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

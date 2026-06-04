"use client";

import { useState } from "react";
import { moduleTags } from "@/lib/constants";
import clsx from "clsx";

export default function FeaturePills() {
  const [selected, setSelected] = useState(0);

  return (
    <section id="modules" className="border-t border-border/40 bg-bg-secondary/30 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-6 py-28 lg:py-36 flex flex-col items-center text-center">
        <Badge className="mb-6">Capabilities</Badge>
        <h2 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl max-w-4xl leading-[1.1]">
          Everything you need for <span className="gradient-text">mobile security</span>
        </h2>
        <p className="mt-6 text-xl text-text-secondary max-w-2xl leading-relaxed">
          A comprehensive suite of tools designed for high-performance traffic analysis, security auditing, and reverse engineering.
        </p>

        <div className="flex flex-wrap justify-center gap-4 mt-16 max-w-5xl">
          {moduleTags.map((tag, i) => (
            <button
              key={tag}
              onClick={() => setSelected(i)}
              className={clsx(
                "rounded-full border px-8 py-3 text-sm font-bold tracking-wide transition-all duration-500 cursor-pointer backdrop-blur-2xl",
                i === selected
                  ? "border-accent/40 bg-accent-dim/20 text-accent-light shadow-[0_0_25px_rgba(59,111,246,0.15)] scale-105"
                  : "border-white/[0.03] bg-white/[0.02] text-text-secondary hover:border-white/10 hover:bg-white/[0.05] hover:text-foreground"
              )}
            >
              <div className="flex items-center gap-3">
                {i === selected && (
                  <div className="w-2 h-2 rounded-full bg-accent animate-pulse shadow-[0_0_8px_#3b6ff6]" />
                )}
                {tag}
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

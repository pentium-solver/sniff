"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

function KeyBadge({ k }: { k: string }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded-md border border-accent/20 bg-accent/10 w-6 h-6 font-mono text-[11px] font-semibold text-accent-bright">
      {k}
    </kbd>
  );
}

const modes = [
  { key: "h", mode: "signup_handoff", label: "Pilot signup handoff capture", desc: "Captures signup flow handoff requests" },
  { key: "k", mode: "linkedin_cronet", label: "LinkedIn Cronet capture", desc: "Bypasses Cronet certificate pinning" },
  { key: "l", mode: "linkedin_replay", label: "LinkedIn Cronet + challenge trace", desc: "Captures Cronet traffic with challenge replay" },
  { key: "y", mode: "dailypay", label: "DailyPay capture (APEX cert inject)", desc: "Injects custom certificate for APEX pinning" },
  { key: "w", mode: "speedway", label: "Speedway / 7-Eleven capture", desc: "Handles Speedway custom SSL implementation" },
  { key: "j", mode: "papajohns", label: "Papa Johns capture (Flutter)", desc: "Bypasses Flutter BoringSSL pinning" },
];

export default function ModesPage() {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold text-foreground">App-Specific Modes</h2>
          <p className="text-sm text-text-muted mt-0.5">
            Specialized capture modes for apps with custom networking stacks
          </p>
        </div>

        {/* Modes list */}
        <div className="rounded-xl border border-card-border bg-card overflow-hidden divide-y divide-card-border">
          {modes.map((item) => (
            <Link
              key={item.key}
              href={`/dashboard/capture?mode=${item.mode}`}
              className="flex items-center gap-4 px-5 py-4 hover:bg-card-hover transition-all duration-150 no-underline group"
            >
              <KeyBadge k={item.key} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground group-hover:text-accent-bright transition-colors">
                  {item.label}
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  {item.desc}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-text-muted/30 group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Radio,
  Layers,
  Settings,
  Smartphone,
  AppWindow,
  FileCode,
  Wifi,
  ShieldOff,
  Activity,
  ArrowRight,
  Zap,
  Target,
  BarChart3,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAppState } from "@/lib/store";

function KeyBadge({ k }: { k: string }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded-md border border-accent/20 bg-accent/10 w-6 h-6 font-mono text-[11px] font-semibold text-accent-bright">
      {k}
    </kbd>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  subValue?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-5 relative overflow-hidden group hover:border-border-light transition-colors">
      {/* Subtle glow on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative">
        <div className="flex items-center gap-2 text-text-muted text-xs font-medium mb-3">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <div
          className={`font-bold font-mono tracking-tight break-all ${accent ? "text-accent-bright" : "text-foreground"} ${value.length > 16 ? "text-sm leading-snug" : "text-2xl"}`}
        >
          {value}
        </div>
        {subValue && (
          <div className="text-[11px] font-mono text-text-muted mt-1 truncate">
            {subValue}
          </div>
        )}
      </div>
    </div>
  );
}

const quickActions = [
  {
    href: "/dashboard/capture",
    icon: Radio,
    key: "c",
    label: "Start capture",
    desc: "Standard SSL unpinning + proxy capture",
  },
  {
    href: "/dashboard/capture?mode=mitm_only",
    icon: Activity,
    key: "m",
    label: "MITM only",
    desc: "Proxy only, no Frida injection",
  },
  {
    href: "/dashboard/modes",
    icon: Layers,
    key: "n",
    label: "App-specific modes",
    desc: "LinkedIn, DailyPay, Papa Johns, etc.",
  },
  {
    href: "/dashboard/settings",
    icon: Settings,
    key: "s",
    label: "Settings",
    desc: "Package, port, frida, export config",
  },
  {
    href: "/dashboard/scripts",
    icon: FileCode,
    key: "f",
    label: "Frida scripts",
    desc: "Select SSL bypass script",
  },
  {
    href: "/dashboard/device",
    icon: Smartphone,
    key: "d",
    label: "Device info",
    desc: "ADB, Frida server, proxy status",
  },
  {
    href: "/dashboard/apps",
    icon: AppWindow,
    key: "a",
    label: "Installed apps",
    desc: "Browse and select target app",
  },
];

export default function DashboardMenu() {
  const { pkg, setPkg, flows, capturing } = useAppState();
  const [scriptLabel, setScriptLabel] = useState("");
  const [scriptName, setScriptName] = useState("");
  const [port, setPort] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await api("/state");
        setPkg(s.settings?.package || "");
        setPort(s.settings?.port || 0);
        const scripts = await api("/scripts");
        const activeId = s.settings?.frida_script_id || "universal";
        const active = scripts.find((sc: any) => sc.ID === activeId);
        if (active) {
          setScriptLabel(active.Label);
          setScriptName(active.Name);
        }
      } catch (e) {
        console.error("menu load:", e);
      } finally {
        setLoaded(true);
      }
    })();
  }, [setPkg]);

  return (
    <div className="flex-1 overflow-auto">
      {/* Top glow effect */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-accent/[0.04] rounded-full blur-[100px] pointer-events-none" />

      <div className="relative p-6 space-y-6">
        {/* Stats cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard
            icon={Wifi}
            label="Flows Captured"
            value={flows.length.toLocaleString()}
          />
          <StatCard
            icon={ShieldOff}
            label="SSL Bypass"
            value={capturing ? "Active" : "Idle"}
            accent={capturing}
          />
          <StatCard
            icon={Target}
            label="Target"
            value={pkg || "\u2014"}
          />
          <StatCard
            icon={Zap}
            label="Script"
            value={scriptLabel || "\u2014"}
            subValue={scriptName}
          />
        </div>

        {/* Quick actions */}
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-card-border flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-foreground">
              Quick Actions
            </h2>
            {loaded && port > 0 && (
              <span className="text-[11px] font-mono text-text-muted bg-bg-tertiary rounded-md px-2 py-0.5">
                Port {port}
              </span>
            )}
          </div>
          <div className="divide-y divide-card-border">
            {quickActions.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-card-hover transition-all duration-150 no-underline group"
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-bg-tertiary group-hover:bg-bg-elevated transition-colors">
                  <item.icon className="h-4 w-4 text-text-muted group-hover:text-accent transition-colors" />
                </div>
                <KeyBadge k={item.key} />
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-foreground">
                    {item.label}
                  </span>
                  <span className="ml-3 text-xs text-text-muted">
                    {item.desc}
                  </span>
                </div>
                <ArrowRight className="h-4 w-4 text-text-muted/30 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

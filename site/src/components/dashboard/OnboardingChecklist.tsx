"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  X,
  Smartphone,
  Zap,
  Wifi,
  Shield,
  AppWindow,
  Radio,
} from "lucide-react";
import { api, apiPost } from "@/lib/api";
import { useAppState } from "@/lib/store";
import type { DeviceInfo } from "@/lib/types";
import clsx from "clsx";

// ── Persistence ───────────────────────────────────────────────────────────────

const DISMISSED_KEY = "sniff_onboarding_dismissed";
const COLLAPSED_KEY = "sniff_onboarding_collapsed";

function isDismissed(): boolean {
  try { return localStorage.getItem(DISMISSED_KEY) === "1"; } catch { return false; }
}
function dismiss(): void {
  try { localStorage.setItem(DISMISSED_KEY, "1"); } catch {}
}
function isCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}
function setCollapsed(v: boolean): void {
  try { localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0"); } catch {}
}

// ── Step definition ───────────────────────────────────────────────────────────

interface Step {
  icon: React.ElementType;
  title: string;
  desc: string;
  done: boolean;
  action?: React.ReactNode;
}

// ── Main component ────────────────────────────────────────────────────────────

interface OnboardingChecklistProps {
  device: DeviceInfo | null;
}

export default function OnboardingChecklist({ device }: OnboardingChecklistProps) {
  const { pkg, flows, fingerprints, capturing } = useAppState();
  const [visible, setVisible] = useState(false);
  const [collapsed, setCollapsedState] = useState(false);
  const [startingFrida, setStartingFrida] = useState(false);
  const [fridaMsg, setFridaMsg] = useState("");

  useEffect(() => {
    if (!isDismissed()) {
      setVisible(true);
      setCollapsedState(isCollapsed());
    }
  }, []);

  async function handleStartFrida() {
    setStartingFrida(true);
    setFridaMsg("");
    try {
      await apiPost("/device/frida/start", {});
      setFridaMsg("Started — reload in a moment");
    } catch (e: unknown) {
      setFridaMsg(e instanceof Error ? e.message : "Failed to start Frida");
    } finally {
      setStartingFrida(false);
    }
  }

  function handleDismiss() {
    dismiss();
    setVisible(false);
  }

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsedState(next);
    setCollapsed(next);
  }

  if (!visible) return null;

  const connected = device?.Connected ?? false;
  const fridaRunning = device?.FridaRunning ?? false;
  const proxySet = !!(device?.Proxy);
  const appSelected = !!pkg;
  const hasActivity =
    flows.length > 0 || fingerprints.length > 0 || capturing;

  const steps: Step[] = [
    {
      icon: Smartphone,
      title: "Connect your Android device",
      desc: "USB debugging enabled, ADB device detected.",
      done: connected,
      action: !connected ? (
        <a
          href="https://developer.android.com/studio/debug/dev-options"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-accent-bright hover:underline cursor-pointer"
        >
          Enable USB debugging →
        </a>
      ) : undefined,
    },
    {
      icon: Zap,
      title: "Start Frida server",
      desc: "Required for SSL unpinning and traffic interception.",
      done: fridaRunning,
      action: !fridaRunning && connected ? (
        <div className="flex items-center gap-2">
          <button
            onClick={handleStartFrida}
            disabled={startingFrida}
            className="text-[10px] font-medium text-accent-bright bg-accent/10 border border-accent/20 rounded px-2 py-0.5 hover:bg-accent/20 transition-colors cursor-pointer disabled:opacity-50"
          >
            {startingFrida ? "Starting…" : "Start Frida"}
          </button>
          {fridaMsg && (
            <span className="text-[10px] text-text-muted">{fridaMsg}</span>
          )}
        </div>
      ) : undefined,
    },
    {
      icon: Wifi,
      title: "Configure device proxy",
      desc: "Routes HTTPS traffic through sniff! for interception.",
      done: proxySet,
      action: !proxySet ? (
        <Link
          href="/dashboard/device"
          className="text-[10px] text-accent-bright hover:underline no-underline"
        >
          Set proxy on Device page →
        </Link>
      ) : undefined,
    },
    {
      icon: Shield,
      title: "SELinux permissive (recommended)",
      desc: "Required for some interception methods and root commands.",
      done: device?.SELinux?.toLowerCase() === "permissive",
      action:
        device && device.SELinux?.toLowerCase() !== "permissive" ? (
          <Link
            href="/dashboard/device"
            className="text-[10px] text-accent-bright hover:underline no-underline"
          >
            Manage on Device page →
          </Link>
        ) : undefined,
    },
    {
      icon: AppWindow,
      title: "Select a target app",
      desc: "Pick the app you want to intercept or fingerprint.",
      done: appSelected,
      action: !appSelected ? (
        <Link
          href="/dashboard/apps"
          className="text-[10px] text-accent-bright hover:underline no-underline"
        >
          Browse installed apps →
        </Link>
      ) : undefined,
    },
    {
      icon: Radio,
      title: "Start your first capture",
      desc: "Intercept traffic or capture TLS fingerprints.",
      done: hasActivity,
      action: !hasActivity ? (
        <Link
          href="/dashboard/capture"
          className="text-[10px] text-accent-bright hover:underline no-underline"
        >
          Go to Capture →
        </Link>
      ) : undefined,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  return (
    <div
      className={clsx(
        "rounded-2xl border transition-colors",
        allDone
          ? "border-good/20 bg-good/[0.03]"
          : "border-card-border bg-card"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              {allDone ? "Setup complete" : "Getting started"}
            </span>
            <span className="text-[10px] font-mono text-text-muted bg-bg-tertiary border border-border rounded px-1.5 py-0.5">
              {doneCount}/{steps.length}
            </span>
          </div>
          {!allDone && (
            <p className="text-[11px] text-text-muted mt-0.5">
              Complete these steps to start intercepting traffic
            </p>
          )}
        </div>
        <button
          onClick={toggleCollapse}
          className="text-text-muted hover:text-foreground transition-colors cursor-pointer p-1"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={handleDismiss}
          className="text-text-muted hover:text-foreground transition-colors cursor-pointer p-1"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="px-4 pb-2">
        <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
          <div
            className={clsx(
              "h-full rounded-full transition-all duration-500",
              allDone ? "bg-good" : "bg-accent"
            )}
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      {!collapsed && (
        <div className="px-4 pb-4 space-y-1 border-t border-border pt-3 mt-1">
          {steps.map((step, i) => (
            <div
              key={i}
              className={clsx(
                "flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors",
                step.done
                  ? "opacity-60"
                  : "bg-bg-secondary"
              )}
            >
              {/* Icon */}
              <div className="shrink-0 mt-0.5">
                {step.done ? (
                  <CheckCircle2 className="h-4 w-4 text-good" />
                ) : (
                  <Circle className="h-4 w-4 text-text-muted/40" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <step.icon className="h-3 w-3 text-text-muted shrink-0" />
                  <span
                    className={clsx(
                      "text-[12px] font-medium",
                      step.done ? "text-text-muted" : "text-foreground"
                    )}
                  >
                    {step.title}
                  </span>
                </div>
                {!step.done && (
                  <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                    {step.desc}
                  </p>
                )}
                {step.action && !step.done && (
                  <div className="mt-1.5">{step.action}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

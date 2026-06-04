"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import OnboardingChecklist from "@/components/dashboard/OnboardingChecklist";
import {
  Radio,
  Fingerprint,
  FileSearch,
  Smartphone,
  ShieldOff,
  Wifi,
  Zap,
  BookmarkCheck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Play,
  Square,
  ArrowRight,
} from "lucide-react";
import { api, apiPost, formatBytes } from "@/lib/api";
import { useAppState } from "@/lib/store";
import { useRouter } from "next/navigation";
import type { DeviceInfo } from "@/lib/types";
import clsx from "clsx";
import { listProfiles } from "@/lib/profiles";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(s: number) {
  const c = String(s)[0];
  if (c === "2") return "text-good";
  if (c === "3") return "text-[#d29922]";
  if (c === "4" || c === "5") return "text-[#f85149]";
  return "text-text-muted";
}

function methodColor(m: string) {
  const map: Record<string, string> = {
    GET: "text-good",
    POST: "text-accent",
    PUT: "text-[#d29922]",
    PATCH: "text-[#d29922]",
    DELETE: "text-[#f85149]",
  };
  return map[m] || "text-text-muted";
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  active,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  active?: boolean;
  href?: string;
}) {
  const inner = (
    <div
      className={clsx(
        "rounded-2xl border bg-card p-4 flex flex-col gap-2 transition-colors",
        active ? "border-accent/20" : "border-card-border hover:border-accent/10"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-medium text-text-muted">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        {active && (
          <span className="h-1.5 w-1.5 rounded-full bg-good animate-pulse-dot" />
        )}
      </div>
      <div className={clsx(
        "font-bold font-mono tracking-tight break-all",
        active ? "text-accent-bright" : "text-foreground",
        String(value).length > 16 ? "text-sm leading-snug" : "text-2xl"
      )}>
        {value}
      </div>
      {sub && <div className="text-[10px] font-mono text-text-muted leading-tight">{sub}</div>}
    </div>
  );

  return href ? (
    <Link href={href} className="no-underline">
      {inner}
    </Link>
  ) : inner;
}

// ── Device status panel ────────────────────────────────────────────────────────

function DevicePanel({ device }: { device: DeviceInfo | null }) {
  if (!device) {
    return (
      <div className="rounded-2xl border border-card-border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-medium text-text-muted">
          <Smartphone className="h-3.5 w-3.5" />
          Device
        </div>
        <div className="flex items-center gap-2 text-text-muted text-[12px]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Loading device info…
        </div>
      </div>
    );
  }

  const rows: { label: string; value: React.ReactNode; ok?: boolean | null }[] = [
    {
      label: "Model",
      value: (
        <span className="flex items-center gap-1.5 justify-end">
          {device.Model || "Unknown"}
          {device.IsEmulator && (
            <span className="text-[9px] font-mono bg-bg-tertiary border border-border rounded px-1 py-px text-text-muted">
              emulator
            </span>
          )}
        </span>
      ),
    },
    {
      label: "Android",
      value: device.Android ? `Android ${device.Android} (SDK ${device.SDK})` : "—",
    },
    {
      label: "Frida",
      value: device.FridaRunning ? "Running" : "Not running",
      ok: device.FridaRunning,
    },
    {
      label: "Proxy",
      value: device.Proxy || "Not set",
      ok: !!device.Proxy,
    },
    {
      label: "SELinux",
      value: device.SELinux || "—",
      ok: device.SELinux?.toLowerCase() === "permissive" ? true : null,
    },
  ];

  return (
    <div className="rounded-2xl border border-card-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-medium text-text-muted">
          <Smartphone className="h-3.5 w-3.5" />
          Device
        </span>
        <Link
          href="/dashboard/device"
          className="text-[10px] text-text-muted hover:text-foreground no-underline transition-colors"
        >
          Details →
        </Link>
      </div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-text-muted font-mono w-14 shrink-0">{row.label}</span>
            <span className={clsx(
              "font-mono text-right truncate",
              row.ok === true ? "text-good" : row.ok === false ? "text-bad" : "text-foreground"
            )}>
              {row.ok === true && <CheckCircle2 className="h-3 w-3 inline mr-1" />}
              {row.ok === false && <XCircle className="h-3 w-3 inline mr-1" />}
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Recent flows ──────────────────────────────────────────────────────────────

function RecentFlows({ flows }: { flows: import("@/lib/types").Flow[] }) {
  const recent = flows.slice(-8).reverse();

  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-card-border flex items-center justify-between">
        <span className="text-[12px] font-semibold flex items-center gap-1.5">
          <Wifi className="h-3.5 w-3.5 text-text-muted" />
          Recent Flows
        </span>
        {flows.length > 0 && (
          <Link
            href="/dashboard/capture"
            className="text-[10px] text-accent-bright hover:text-accent no-underline transition-colors"
          >
            View all {flows.length} →
          </Link>
        )}
      </div>

      {recent.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-[12px] text-text-muted">No flows captured yet</p>
          <p className="text-[10px] text-text-muted/60 mt-1">
            Select a target app and click{" "}
            <span className="text-foreground">Start Capture</span> in the top bar
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {recent.map((flow, i) => (
            <Link
              key={flow._id ?? i}
              href="/dashboard/capture"
              className="flex items-center gap-3 px-4 py-2 hover:bg-bg-elevated transition-colors no-underline group"
            >
              <span className={clsx("font-mono text-[10px] font-semibold w-10 shrink-0", methodColor(flow.method))}>
                {flow.method}
              </span>
              <span className={clsx("font-mono text-[11px] w-10 shrink-0", statusColor(flow.status))}>
                {flow.status}
              </span>
              <span className="text-[11px] text-text-muted font-mono shrink-0 w-24 truncate">
                {flow.host}
              </span>
              <span className="text-[11px] text-text-secondary truncate flex-1 font-mono">
                {flow.path}
              </span>
              <span className="text-[10px] text-text-muted/60 font-mono shrink-0">
                {formatBytes(flow.resp_size)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Recent fingerprints ────────────────────────────────────────────────────────

function RecentFingerprints({ fingerprints }: { fingerprints: import("@/lib/types").CapturedFingerprint[] }) {
  const recent = fingerprints.slice(-5).reverse();

  function protoBadge(ja4: string) {
    const seg = ja4?.split("_")[0] ?? "";
    const transport = seg[0];
    const alpn = seg.slice(-2);
    if (transport === "q" || alpn === "h3") return <span className="text-[8px] font-mono px-1 py-px rounded bg-violet-500/15 text-violet-400">QUIC</span>;
    if (alpn === "h2") return <span className="text-[8px] font-mono px-1 py-px rounded bg-accent/10 text-accent-bright">h2</span>;
    return null;
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-card-border flex items-center justify-between">
        <span className="text-[12px] font-semibold flex items-center gap-1.5">
          <Fingerprint className="h-3.5 w-3.5 text-text-muted" />
          Recent Fingerprints
        </span>
        {fingerprints.length > 0 && (
          <Link
            href="/dashboard/fingerprints"
            className="text-[10px] text-accent-bright hover:text-accent no-underline transition-colors"
          >
            View all {fingerprints.length} →
          </Link>
        )}
      </div>

      {recent.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-[12px] text-text-muted">No fingerprints captured yet</p>
          <p className="text-[10px] text-text-muted/60 mt-1">
            Go to <Link href="/dashboard/fingerprints" className="text-foreground no-underline">Fingerprints</Link> to start
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {recent.map((fp, i) => (
            <Link
              key={fp.id ?? i}
              href="/dashboard/fingerprints"
              className="flex items-center gap-2 px-4 py-2 hover:bg-bg-elevated transition-colors no-underline"
            >
              <span className="font-mono text-[11px] text-foreground truncate flex-1">{fp.sni || fp.dst_ip || "—"}</span>
              {protoBadge(fp.ja4)}
              <span className="font-mono text-[9px] text-accent-bright truncate max-w-[120px]">{fp.ja4}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Action card ────────────────────────────────────────────────────────────────

function ActionCard({
  href,
  icon: Icon,
  label,
  desc,
  accent,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  desc: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "rounded-2xl border p-4 flex items-center gap-3 no-underline transition-all group",
        accent
          ? "bg-accent/[0.07] border-accent/20 hover:bg-accent/10 hover:border-accent/30"
          : "bg-card border-card-border hover:bg-card-hover hover:border-accent/10"
      )}
    >
      <div className={clsx(
        "h-8 w-8 rounded-xl flex items-center justify-center shrink-0 transition-colors",
        accent ? "bg-accent/15" : "bg-bg-tertiary group-hover:bg-bg-elevated"
      )}>
        <Icon className={clsx("h-4 w-4", accent ? "text-accent-bright" : "text-text-muted group-hover:text-accent")} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={clsx("text-[12px] font-semibold", accent ? "text-accent-bright" : "text-foreground")}>
          {label}
        </div>
        <div className="text-[10px] text-text-muted">{desc}</div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-text-muted/30 group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardOverview() {
  const { pkg, setPkg, flows, fingerprints, capturing, setCapturing } = useAppState();
  const router = useRouter();
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [scriptLabel, setScriptLabel] = useState("—");
  const [profileCount, setProfileCount] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const [s, scripts, dev] = await Promise.all([
          api("/state"),
          api("/scripts"),
          api("/device"),
        ]);
        setPkg(s.settings?.package || "");
        const activeId = s.settings?.frida_script_id || "universal";
        const active = (scripts as any[]).find((sc) => sc.ID === activeId);
        if (active) setScriptLabel(active.Label);
        setDevice(dev as DeviceInfo);
      } catch {}
    }
    load();
    setProfileCount(listProfiles().length);
  }, [setPkg]);

  async function handleCaptureToggle() {
    if (capturing) {
      setCapturing(false);
      try { await apiPost("/capture/stop", {}); }
      catch { setCapturing(true); }
    } else {
      try {
        await apiPost("/capture/start", { mode: "standard", package: pkg });
        setCapturing(true);
        router.push("/dashboard/capture");
      } catch {}
    }
  }

  // Derived stats
  const uniqueHosts = useMemo(() => new Set(flows.map((f) => f.host)).size, [flows]);
  const flowBreakdown = useMemo(() => ({
    ok:  flows.filter((f) => f.status >= 200 && f.status < 300).length,
    redir: flows.filter((f) => f.status >= 300 && f.status < 400).length,
    err:   flows.filter((f) => f.status >= 400).length,
  }), [flows]);

  const uniqueJA4 = useMemo(() => new Set(fingerprints.map((f) => f.ja4).filter(Boolean)).size, [fingerprints]);
  const tcpFps = useMemo(() => fingerprints.filter((f) => f.ja4 && !f.ja4.startsWith("q")).length, [fingerprints]);
  const quicFps = useMemo(() => fingerprints.filter((f) => f.ja4?.startsWith("q")).length, [fingerprints]);

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-5 space-y-5 max-w-[1400px]">

        {/* ── Onboarding checklist (dismissed once all steps pass) ── */}
        <OnboardingChecklist device={device} />

        {/* ── Capture status bar ── */}
        <div className={clsx(
          "rounded-2xl border px-5 py-3.5 flex items-center gap-4 flex-wrap",
          capturing
            ? "bg-good/[0.04] border-good/20"
            : "bg-card border-card-border"
        )}>
          <div className="flex items-center gap-2.5">
            {capturing ? (
              <>
                <span className="h-2 w-2 rounded-full bg-good animate-pulse-dot" />
                <span className="text-[13px] font-semibold text-good">Capture running</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-text-muted/30" />
                <span className="text-[13px] font-semibold text-text-secondary">Capture idle</span>
              </>
            )}
          </div>

          {pkg && (
            <>
              <div className="w-px h-5 bg-border" />
              <span className="text-[12px] font-mono text-text-muted">
                <span className="text-text-muted/60 mr-1">target</span>
                {pkg}
              </span>
            </>
          )}
          {scriptLabel !== "—" && (
            <>
              <div className="w-px h-5 bg-border" />
              <span className="text-[12px] font-mono text-text-muted">
                <span className="text-text-muted/60 mr-1">script</span>
                {scriptLabel}
              </span>
            </>
          )}

          <div className="flex-1" />

          <button
            onClick={handleCaptureToggle}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer",
              capturing
                ? "bg-bad/15 text-bad border border-bad/20 hover:bg-bad/25"
                : "bg-accent text-white shadow-sm shadow-accent/25 hover:bg-accent-light"
            )}
          >
            {capturing ? <><Square className="h-3 w-3" />Stop</> : <><Play className="h-3 w-3" />Start Capture</>}
          </button>
        </div>

        {/* ── Stat row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Wifi}
            label="Flows"
            value={flows.length}
            sub={
              flows.length > 0 ? (
                <span className="flex gap-2">
                  <span className="text-good">{flowBreakdown.ok} 2xx</span>
                  <span className="text-[#d29922]">{flowBreakdown.redir} 3xx</span>
                  <span className="text-[#f85149]">{flowBreakdown.err} err</span>
                  <span className="text-text-muted/60">· {uniqueHosts} hosts</span>
                </span>
              ) : "No flows yet"
            }
            active={capturing}
            href="/dashboard/capture"
          />
          <StatCard
            icon={Fingerprint}
            label="Fingerprints"
            value={fingerprints.length}
            sub={
              fingerprints.length > 0 ? (
                <span className="flex gap-2">
                  <span>{uniqueJA4} unique JA4</span>
                  {quicFps > 0 && <span className="text-violet-400">{quicFps} QUIC</span>}
                  {tcpFps > 0 && <span className="text-accent-bright">{tcpFps} TCP</span>}
                </span>
              ) : "No captures yet"
            }
            href="/dashboard/fingerprints"
          />
          <StatCard
            icon={ShieldOff}
            label="SSL Bypass"
            value={capturing ? "Active" : "Idle"}
            sub={device ? (device.FridaRunning ? "Frida running" : "Frida not running") : "—"}
            active={capturing}
          />
          <StatCard
            icon={BookmarkCheck}
            label="Profiles"
            value={profileCount}
            sub="saved fingerprints"
            href="/dashboard/profiles"
          />
        </div>

        {/* ── Main content: activity + device ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: recent activity (2/3 width) */}
          <div className="lg:col-span-2 space-y-4">
            <RecentFlows flows={flows} />
            <RecentFingerprints fingerprints={fingerprints} />
          </div>

          {/* Right: device + quick actions (1/3 width) */}
          <div className="space-y-4">
            <DevicePanel device={device} />

            {/* Action cards */}
            <div className="space-y-2">
              <ActionCard
                href="/dashboard/fingerprints"
                icon={Fingerprint}
                label="Fingerprint Mode"
                desc="Capture native TLS Client Hellos"
                accent
              />
              <ActionCard
                href="/dashboard/capture"
                icon={Radio}
                label="Capture"
                desc="SSL unpinning + proxy intercept"
              />
              <ActionCard
                href="/dashboard/har"
                icon={FileSearch}
                label="HAR Inspector"
                desc="Load and diff HAR captures"
              />
              <ActionCard
                href="/dashboard/profiles"
                icon={BookmarkCheck}
                label="Profile Library"
                desc={`${profileCount} saved fingerprint${profileCount !== 1 ? "s" : ""}`}
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useMemo } from "react";
import { api, apiPost, apiPut } from "@/lib/api";
import { useAppState } from "@/lib/store";
import { useRouter } from "next/navigation";
import {
  Search, Check, AlertCircle, Loader2, ChevronRight, Radio,
  Cpu, Shield, ShieldAlert, ShieldCheck, Zap, Code2, Layers,
  Lock, Copy, Save, ChevronDown, ChevronUp, FileCode,
} from "lucide-react";
import type { AppItem } from "@/lib/types";
import {
  detectFramework,
  getCachedFramework,
  invalidateCachedFramework,
  FRAMEWORK_LABELS,
  FRAMEWORK_COLORS,
} from "@/lib/frameworkCache";
import type { FrameworkResult } from "@/lib/frameworkCache";
import {
  detectProtections,
  getCachedProtections,
  invalidateCachedProtections,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
} from "@/lib/protectionCache";
import type { DetectedProtection } from "@/lib/protectionCache";
import {
  analyzePinning,
  getCachedPinning,
  invalidateCachedPinning,
  CONFIDENCE_COLORS,
  CONFIDENCE_LABELS,
} from "@/lib/pinningCache";
import type { PinningAnalysis, PinMechanism } from "@/lib/pinningCache";
import clsx from "clsx";

// ── Category icon map ─────────────────────────────────────────────────────────

function ProtectionIcon({ category }: { category: DetectedProtection["category"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (category) {
    case "antibot":       return <ShieldAlert className={cls} />;
    case "cert-pinning":  return <Shield className={cls} />;
    case "anti-tamper":   return <Layers className={cls} />;
    case "root-detection":return <Cpu className={cls} />;
    case "hook-detection":return <Zap className={cls} />;
    case "attestation":   return <ShieldCheck className={cls} />;
  }
}

// ── Pinning analysis section ──────────────────────────────────────────────────

function MechRow({ mech }: { mech: PinMechanism }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-card-hover transition-colors cursor-pointer"
        onClick={() => setOpen((x) => !x)}
      >
        <span
          className={clsx(
            "text-[9px] font-mono font-semibold rounded px-1.5 py-0.5 border shrink-0",
            CONFIDENCE_COLORS[mech.confidence]
          )}
        >
          {CONFIDENCE_LABELS[mech.confidence]}
        </span>
        <Lock className="h-3.5 w-3.5 text-text-muted shrink-0" />
        <span className="text-[12px] font-medium text-foreground flex-1 truncate">
          {mech.name}
        </span>
        {mech.evidence.length > 0 && (
          <span className="text-[10px] font-mono text-text-muted bg-bg-tertiary border border-border rounded px-1.5 py-0.5 shrink-0">
            {mech.evidence.length} ref{mech.evidence.length !== 1 ? "s" : ""}
          </span>
        )}
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-text-muted/50 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-text-muted/50 shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-card-border px-4 py-3 space-y-2">
          <p className="text-[11px] text-text-muted leading-relaxed">{mech.description}</p>
          {mech.classes && mech.classes.length > 0 && (
            <div>
              <p className="text-[10px] font-mono font-semibold text-text-muted uppercase tracking-wider mb-1">
                Detected classes
              </p>
              <div className="flex flex-wrap gap-1">
                {mech.classes.map((cls) => (
                  <span
                    key={cls}
                    className="text-[9px] font-mono text-accent-bright bg-accent/5 border border-accent/15 rounded px-1.5 py-0.5 truncate max-w-[320px]"
                    title={cls}
                  >
                    {cls}
                  </span>
                ))}
              </div>
            </div>
          )}
          {mech.evidence.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {mech.evidence.map((ev, i) => (
                <span
                  key={i}
                  className="text-[9px] font-mono text-text-muted bg-bg-tertiary border border-border rounded px-1.5 py-0.5 truncate max-w-[320px]"
                  title={ev}
                >
                  {ev}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScriptBlock({
  script,
  scriptName,
  onSave,
  onUseForCapture,
}: {
  script: string;
  scriptName: string;
  onSave: (name: string, content: string) => Promise<void>;
  onUseForCapture: (name: string, content: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [msg, setMsg] = useState("");

  function showMsg(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(""), 3000);
  }

  async function copy() {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(scriptName.replace(".js", ""), script);
      showMsg("Saved!");
    } catch (e: unknown) {
      showMsg("Save failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  async function useForCapture() {
    setLaunching(true);
    try {
      await onUseForCapture(scriptName.replace(".js", ""), script);
      // navigation happens inside onUseForCapture
    } catch (e: unknown) {
      showMsg("Launch failed: " + (e instanceof Error ? e.message : String(e)));
      setLaunching(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border bg-bg-tertiary">
        <div className="flex items-center gap-2">
          <FileCode className="h-3.5 w-3.5 text-text-muted" />
          <span className="text-[11px] font-mono text-text-muted">{scriptName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {msg && (
            <span className={`text-[10px] ${msg.startsWith("Save") || msg.startsWith("Launch") ? "text-bad" : "text-good"}`}>{msg}</span>
          )}
          {/* Use for Capture — primary action */}
          <button
            onClick={useForCapture}
            disabled={launching}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold text-white bg-accent hover:bg-accent-light transition-colors cursor-pointer disabled:opacity-50 shadow-sm shadow-accent/20"
          >
            {launching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Radio className="h-3 w-3" />}
            {launching ? "Launching…" : "Use for Capture"}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-text-muted bg-bg-secondary border border-border hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-text-muted bg-bg-secondary border border-border hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
          >
            <Copy className="h-3 w-3" />
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      {/* Code */}
      <pre className="overflow-auto max-h-64 p-4 text-[10px] font-mono leading-relaxed text-text-secondary whitespace-pre">
        {script}
      </pre>
    </div>
  );
}

function PinningSection({
  pkg,
  analysis,
  analyzing,
  error,
  onAnalyze,
  onSaveScript,
  onUseForCapture,
}: {
  pkg: string;
  analysis: PinningAnalysis | null;
  analyzing: boolean;
  error: string;
  onAnalyze: () => void;
  onSaveScript: (name: string, content: string) => Promise<void>;
  onUseForCapture: (name: string, content: string) => Promise<void>;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Lock className="h-3.5 w-3.5 text-text-muted shrink-0" />
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
          SSL Pinning
        </span>
        {!analyzing && analysis && (analysis.mechanisms ?? []).length > 0 && (
          <span className="text-[10px] font-mono text-text-muted bg-bg-tertiary border border-border rounded px-1.5 py-0.5">
            {analysis.mechanisms.length} mechanism{analysis.mechanisms.length !== 1 ? "s" : ""}
          </span>
        )}
        {!analyzing && analysis && (
          <button
            onClick={onAnalyze}
            className="ml-auto text-[10px] text-accent-bright hover:underline cursor-pointer"
          >
            Re-analyze
          </button>
        )}
      </div>

      {analyzing ? (
        <div className="flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Scanning APK…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-bad/20 bg-bad/[0.04] px-4 py-3 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-bad shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-medium text-bad">{error}</p>
            {error.toLowerCase().includes("decompile") && (
              <p className="text-[10px] text-text-muted mt-0.5">
                Use the Decompile button above first, then run pinning analysis.
              </p>
            )}
          </div>
        </div>
      ) : !analysis ? (
        <p className="text-[12px] text-text-muted/60">Click Analyze APK above to scan for pinning →</p>
      ) : (
        <div className="space-y-3">
          {/* Summary */}
          {analysis.summary && (
            <p className="text-[11px] text-text-muted leading-relaxed">{analysis.summary}</p>
          )}

          {/* Mechanisms */}
          {(analysis.mechanisms ?? []).length > 0 ? (
            <div className="space-y-2">
              {(analysis.mechanisms ?? []).map((m) => (
                <MechRow key={m.id} mech={m} />
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-text-muted/60">No pinning detected in APK</p>
          )}

          {/* Hardcoded pins */}
          {(analysis.pins ?? []).length > 0 && (
            <div>
              <p className="text-[10px] font-mono font-semibold text-text-muted uppercase tracking-wider mb-2">
                Hardcoded pin hashes ({analysis.pins.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {(analysis.pins ?? []).map((p, i) => (
                  <span
                    key={i}
                    className="text-[9px] font-mono text-bad bg-bad/5 border border-bad/15 rounded px-1.5 py-0.5 truncate max-w-full"
                    title={`${p.file}:${p.line}`}
                  >
                    {p.hash}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Generated script */}
          {analysis.script && (
            <div>
              <p className="text-[10px] font-mono font-semibold text-text-muted uppercase tracking-wider mb-2">
                Generated Frida bypass script
              </p>
              <ScriptBlock
                script={analysis.script}
                scriptName={analysis.script_name}
                onSave={onSaveScript}
                onUseForCapture={onUseForCapture}
              />
            </div>
          )}

          {/* Elapsed */}
          <p className="text-[10px] text-text-muted/50 font-mono">
            analysis took {analysis.elapsed_ms}ms
          </p>
        </div>
      )}
    </div>
  );
}

// ── App list row ──────────────────────────────────────────────────────────────

function AppRow({
  app,
  isActive,
  isViewed,
  onClick,
}: {
  app: AppItem;
  isActive: boolean;
  isViewed: boolean;
  onClick: () => void;
}) {
  const cached = getCachedFramework(app.ID);
  const hasCachedFw = cached && cached.framework !== "unknown" && cached.framework !== "native";

  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-100 border-b border-card-border/50",
        isViewed
          ? "bg-accent/[0.08] border-l-2 border-l-accent"
          : "hover:bg-card-hover border-l-2 border-l-transparent"
      )}
    >
      {/* Avatar */}
      <div
        className={clsx(
          "flex items-center justify-center w-7 h-7 rounded-lg shrink-0 text-xs font-mono",
          isActive ? "bg-accent/15 text-accent" : "bg-bg-tertiary text-text-muted"
        )}
      >
        {isActive ? <Check className="h-3.5 w-3.5" /> : (app.Name[0]?.toUpperCase() || "?")}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-medium text-foreground truncate">{app.Name}</span>
          {hasCachedFw && (
            <span
              className={clsx(
                "text-[9px] font-mono font-semibold rounded px-1 py-px border shrink-0",
                FRAMEWORK_COLORS[cached!.framework] ?? ""
              )}
            >
              {FRAMEWORK_LABELS[cached!.framework] ?? cached!.framework}
            </span>
          )}
        </div>
        <div className="text-[10px] font-mono text-text-muted truncate">{app.ID}</div>
      </div>

      {/* Right indicators */}
      <div className="flex items-center gap-1.5 shrink-0">
        {app.PID > 0 && (
          <span className="text-[9px] font-mono font-semibold text-good bg-good/10 rounded px-1.5 py-0.5">
            PID
          </span>
        )}
        <ChevronRight className={clsx("h-3.5 w-3.5 transition-colors", isViewed ? "text-accent" : "text-text-muted/40")} />
      </div>
    </button>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function AppDetail({
  app,
  isActive,
  onSetTarget,
  onAnalyze,
  onDecompile,
  onAnalyzePinning,
  onSavePinScript,
  onUseForCapture,
  frameworkResult,
  protections,
  detecting,
  pinning,
  analyzingPinning,
  pinningError,
}: {
  app: AppItem;
  isActive: boolean;
  onSetTarget: () => void;
  onAnalyze: () => void;
  onDecompile: () => void;
  onAnalyzePinning: () => void;
  onSavePinScript: (name: string, content: string) => Promise<void>;
  onUseForCapture: (name: string, content: string) => Promise<void>;
  frameworkResult: FrameworkResult | null;
  protections: DetectedProtection[];
  detecting: boolean;
  pinning: PinningAnalysis | null;
  analyzingPinning: boolean;
  pinningError: string;
}) {
  const showFw = frameworkResult && frameworkResult.framework !== "unknown";
  const hasFw = showFw && frameworkResult!.framework !== "native";

  const hasResults = frameworkResult !== null || protections.length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-auto">
      {/* App header */}
      <div className="px-6 py-5 border-b border-border">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold text-foreground truncate">{app.Name}</h2>
            <p className="text-[11px] font-mono text-text-muted mt-0.5 break-all">{app.ID}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {isActive && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-accent bg-accent/10 border border-accent/20 rounded-full px-2.5 py-0.5">
                  <Radio className="h-2.5 w-2.5" />
                  ACTIVE TARGET
                </span>
              )}
              {app.PID > 0 && (
                <span className="text-[10px] font-mono text-good bg-good/10 border border-good/20 rounded-full px-2.5 py-0.5">
                  Running · PID {app.PID}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isActive && (
              <button
                onClick={onSetTarget}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold bg-accent text-white hover:bg-accent-light transition-colors cursor-pointer shadow-sm shadow-accent/25"
              >
                <Radio className="h-3.5 w-3.5" />
                Set as Target
              </button>
            )}
            <button
              onClick={onAnalyze}
              disabled={detecting}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold border border-border bg-bg-tertiary text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer disabled:opacity-50"
              title={hasResults ? "Re-analyze APK" : "Analyze APK"}
            >
              {detecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Cpu className="h-3.5 w-3.5" />
              )}
              {detecting ? "Analyzing…" : hasResults ? "Re-analyze" : "Analyze APK"}
            </button>
            <button
              onClick={onDecompile}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold border border-border bg-bg-tertiary text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
              title="Decompile with jadx and open Source viewer"
            >
              <Code2 className="h-3.5 w-3.5" />
              Decompile
            </button>
          </div>
        </div>
      </div>

      {/* Analysis section */}
      <div className="px-6 py-5 space-y-5">
        {/* Framework */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Code2 className="h-3.5 w-3.5 text-text-muted shrink-0" />
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Framework</span>
          </div>

          {detecting ? (
            <div className="flex items-center gap-2 text-[12px] text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analyzing APK…
            </div>
          ) : !hasResults ? (
            <button onClick={onAnalyze} className="text-[12px] text-accent-bright hover:underline cursor-pointer text-left">
              Click Analyze APK to detect framework →
            </button>
          ) : showFw ? (
            <div className="rounded-xl border border-card-border bg-card px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={clsx(
                    "text-[11px] font-mono font-semibold rounded px-2 py-0.5 border",
                    FRAMEWORK_COLORS[frameworkResult!.framework] ?? FRAMEWORK_COLORS["native"]
                  )}
                >
                  {hasFw
                    ? FRAMEWORK_LABELS[frameworkResult!.framework] ?? frameworkResult!.framework
                    : "Native (Android)"}
                </span>
                <span className="text-[10px] text-text-muted font-mono">
                  {frameworkResult!.confidence} confidence
                </span>
              </div>
              {frameworkResult!.indicators.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {frameworkResult!.indicators.slice(0, 4).map((ind) => (
                    <span
                      key={ind}
                      className="text-[9px] font-mono text-text-muted bg-bg-tertiary border border-border rounded px-1.5 py-0.5 truncate max-w-[260px]"
                      title={ind}
                    >
                      {ind}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-text-muted/60">Not yet analyzed</p>
          )}
        </div>

        {/* Protections */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-3.5 w-3.5 text-text-muted shrink-0" />
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Protections
            </span>
            {!detecting && protections.length > 0 && (
              <span className="text-[10px] font-mono text-text-muted bg-bg-tertiary border border-border rounded px-1.5 py-0.5">
                {protections.length} detected
              </span>
            )}
          </div>

          {detecting ? (
            <div className="flex items-center gap-2 text-[12px] text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Scanning DEX…
            </div>
          ) : protections.length === 0 ? (
            hasResults ? (
              <p className="text-[12px] text-text-muted/60">None detected</p>
            ) : (
              <button onClick={onAnalyze} className="text-[12px] text-accent-bright hover:underline cursor-pointer text-left">
                Click Analyze APK to scan for protections →
              </button>
            )
          ) : (
            <div className="space-y-2">
              {protections.map((pt, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-card-border bg-card px-4 py-3"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={clsx("p-0.5", CATEGORY_COLORS[pt.category].split(" ").find(c => c.startsWith("text-")))}>
                      <ProtectionIcon category={pt.category} />
                    </span>
                    <span
                      className={clsx(
                        "text-[10px] font-mono font-semibold rounded px-1.5 py-0.5 border shrink-0",
                        CATEGORY_COLORS[pt.category]
                      )}
                    >
                      {CATEGORY_LABELS[pt.category]}
                    </span>
                    <span className="text-[12px] text-foreground font-medium">{pt.name}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {pt.evidence.map((ev) => (
                      <span
                        key={ev}
                        className="text-[9px] font-mono text-text-muted bg-bg-tertiary border border-border rounded px-1.5 py-0.5 truncate max-w-[300px]"
                        title={ev}
                      >
                        {ev}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SSL Pinning Analysis */}
        <div className="border-t border-border pt-5">
          <PinningSection
            pkg={app.ID}
            analysis={pinning}
            analyzing={detecting || analyzingPinning}
            error={pinningError}
            onAnalyze={onAnalyzePinning}
            onSaveScript={onSavePinScript}
            onUseForCapture={onUseForCapture}
          />
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AppsPage() {
  const { pkg, setPkg } = useAppState();
  const router = useRouter();
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  // Which app the user is currently *viewing* (detail panel) — separate from active capture target
  const [viewedId, setViewedId] = useState<string | null>(null);

  // Per-app detection state
  const [detecting, setDetecting] = useState(false);
  const [frameworkResult, setFrameworkResult] = useState<FrameworkResult | null>(null);
  const [protections, setProtections] = useState<DetectedProtection[]>([]);

  // Pinning analysis state
  const [analyzingPinning, setAnalyzingPinning] = useState(false);
  const [pinning, setPinning] = useState<PinningAnalysis | null>(null);
  const [pinningError, setPinningError] = useState("");

  useEffect(() => {
    api("/apps")
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setApps(list);
        // Auto-select the active pkg in the detail panel — but only pull cached
        // detection results. Don't trigger a fresh APK pull on page load.
        if (pkg && list.some((a: AppItem) => a.ID === pkg)) {
          setViewedId(pkg);
          const cachedFw = getCachedFramework(pkg);
          const cachedPt = getCachedProtections(pkg);
          const cachedPin = getCachedPinning(pkg);
          if (cachedFw) setFrameworkResult(cachedFw);
          if (cachedPt) setProtections(cachedPt);
          if (cachedPin) setPinning(cachedPin);
        }
      })
      .catch((e) => {
        console.error("apps load:", e);
        setError(e.message || "Failed to load apps");
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openDetail(id: string) {
    setViewedId(id);
    // Load from cache immediately — don't auto-pull APK.
    // User must click "Analyze" to trigger a fresh pull.
    const cachedFw = getCachedFramework(id);
    const cachedPt = getCachedProtections(id);
    const cachedPin = getCachedPinning(id);
    setFrameworkResult(cachedFw ?? null);
    setProtections(cachedPt ?? []);
    setPinning(cachedPin ?? null);
    setPinningError("");
  }

  async function runAnalysis(id: string) {
    if (detecting) return;
    setDetecting(true);
    invalidateCachedFramework(id);
    invalidateCachedProtections(id);
    invalidateCachedPinning(id);
    setPinningError("");
    try {
      const [fw, pt, pin] = await Promise.all([
        detectFramework(id, true),
        detectProtections(id, true),
        analyzePinning(id, true),
      ]);
      setFrameworkResult(fw);
      setProtections(pt);
      setPinning(pin);
    } catch (e: unknown) {
      // framework + protections resolve individually; pinning error is non-fatal
      console.warn("analysis partial error:", e);
    } finally {
      setDetecting(false);
      setAnalyzingPinning(false);
    }
  }

  async function runPinningAnalysis(id: string) {
    if (analyzingPinning) return;
    setAnalyzingPinning(true);
    setPinningError("");
    invalidateCachedPinning(id);
    try {
      const result = await analyzePinning(id, true);
      setPinning(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setPinningError(msg || "Analysis failed");
    } finally {
      setAnalyzingPinning(false);
    }
  }

  async function savePinScript(name: string, content: string) {
    await apiPost("/scripts/custom", {
      name,
      content,
      label: "AUTO-UNPIN",
      desc: `Auto-generated SSL unpinning script for ${viewedId ?? "unknown"}`,
    });
  }

  async function useForCapture(name: string, content: string) {
    // Set the app as the active capture target in client state immediately
    // so every component that reads pkg (Sidebar stats, Capture page, etc.)
    // reflects the right app before we even navigate.
    if (viewedId) setPkg(viewedId);
    // Single POST: saves script, activates it, starts capture — then navigate.
    await apiPost("/capture/start", {
      package: viewedId,
      script_content: content,
      script_name: name.replace(/[^a-z0-9_-]/gi, "_"),
    });
    router.push("/dashboard/capture");
  }

  async function setAsTarget(id: string) {
    await apiPut("/settings", { key: "package", value: id });
    setPkg(id);
  }

  const filtered = useMemo(
    () =>
      filter
        ? apps.filter(
            (a) =>
              a.Name.toLowerCase().includes(filter.toLowerCase()) ||
              a.ID.toLowerCase().includes(filter.toLowerCase())
          )
        : apps,
    [apps, filter]
  );

  const viewedApp = apps.find((a) => a.ID === viewedId) ?? null;

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* ── Left: App list ──────────────────────────────────────────────────── */}
      <div className="w-80 flex flex-col border-r border-border shrink-0">
        {/* Search + count */}
        <div className="px-3 py-2.5 border-b border-border bg-bg-secondary shrink-0">
          <div className="flex items-center gap-2 bg-bg-tertiary border border-border rounded-lg px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-text-muted shrink-0" />
            <input
              type="text"
              placeholder="Search apps…"
              className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-text-muted"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {apps.length > 0 && (
              <span className="text-[10px] font-mono text-text-muted shrink-0">{apps.length}</span>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-6 text-center">
              <p className="text-[12px] text-text-muted">Loading apps…</p>
            </div>
          ) : error || (!filter && apps.length === 0) ? (
            <div className="p-4">
              <div className="rounded-xl border border-bad/20 bg-bad/[0.04] p-4 flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-bad shrink-0 mt-0.5" />
                <div>
                  <p className="text-[12px] font-medium text-bad">{error || "No ADB device connected"}</p>
                  <p className="text-[11px] text-text-muted mt-1">
                    Connect your Android device via USB and enable USB debugging.
                  </p>
                </div>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-[12px] text-text-muted">No apps match your search</p>
            </div>
          ) : (
            filtered.map((app) => (
              <AppRow
                key={app.ID}
                app={app}
                isActive={pkg === app.ID}
                isViewed={viewedId === app.ID}
                onClick={() => openDetail(app.ID)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right: Detail panel ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {viewedApp ? (
          <AppDetail
            app={viewedApp}
            isActive={pkg === viewedApp.ID}
            onSetTarget={() => setAsTarget(viewedApp.ID)}
            onAnalyze={() => runAnalysis(viewedApp.ID)}
            onDecompile={() => router.push(`/dashboard/source?pkg=${encodeURIComponent(viewedApp.ID)}`)}
            onAnalyzePinning={() => runPinningAnalysis(viewedApp.ID)}
            onSavePinScript={savePinScript}
            onUseForCapture={useForCapture}
            frameworkResult={frameworkResult}
            protections={protections}
            detecting={detecting}
            pinning={pinning}
            analyzingPinning={analyzingPinning}
            pinningError={pinningError}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
            <div className="w-12 h-12 rounded-2xl bg-bg-tertiary border border-border flex items-center justify-center">
              <Search className="h-5 w-5 text-text-muted/50" />
            </div>
            <p className="text-sm font-medium text-text-muted">Select an app</p>
            <p className="text-xs text-text-muted/60 max-w-xs">
              Click any app in the list to view its framework, protection analysis, and set it as your capture target.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

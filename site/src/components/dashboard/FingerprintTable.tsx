"use client";

import { useState, useRef, useEffect } from "react";
import { Copy, Check, ChevronDown, ChevronRight, Bookmark, BookmarkCheck } from "lucide-react";
import type { CapturedFingerprint } from "@/lib/types";
import { useAnnotationsAll } from "@/hooks/useAnnotation";
import PinButton from "./PinButton";
import TagList from "./TagList";
import InlineLabel from "./InlineLabel";
import NoteEditor, { NoteIndicator } from "./NoteEditor";
import SaveProfileDialog from "./SaveProfileDialog";
import clsx from "clsx";

// ── Protocol badge ────────────────────────────────────────────────────────────

function ProtocolBadge({ ja4 }: { ja4: string }) {
  if (!ja4) return null;
  const seg = ja4.split("_")[0] ?? "";
  const transport = seg[0];
  const alpn = seg.slice(-2);

  if (transport === "q" || alpn === "h3") {
    return (
      <span className="inline-flex items-center text-[9px] font-mono font-semibold px-1 py-px rounded bg-violet-500/15 text-violet-400 shrink-0 leading-tight">
        QUIC
      </span>
    );
  }
  if (alpn === "h2") {
    return (
      <span className="inline-flex items-center text-[9px] font-mono font-semibold px-1 py-px rounded bg-accent/10 text-accent-bright shrink-0 leading-tight">
        h2
      </span>
    );
  }
  if (alpn === "h1") {
    return (
      <span className="inline-flex items-center text-[9px] font-mono font-semibold px-1 py-px rounded bg-bg-tertiary text-text-muted shrink-0 leading-tight">
        h1
      </span>
    );
  }
  return null;
}

// ── Copy Go button ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy Go uTLS spec"
      className={clsx(
        "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all duration-150 cursor-pointer border shrink-0",
        copied
          ? "bg-good/10 border-good/20 text-good"
          : "bg-bg-tertiary border-border text-text-muted hover:bg-accent/10 hover:border-accent/20 hover:text-accent-bright"
      )}
    >
      {copied ? <><Check className="h-3 w-3" />Copied</> : <><Copy className="h-3 w-3" />Copy Go</>}
    </button>
  );
}

// ── Expanded row ──────────────────────────────────────────────────────────────

function ExpandedRow({ fp }: { fp: CapturedFingerprint }) {
  return (
    <tr className="bg-bg-secondary/50">
      <td colSpan={9} className="px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div>
              <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">JA3</span>
              <p className="font-mono text-[11px] text-foreground mt-0.5 break-all">{fp.ja3 || "—"}</p>
            </div>
            <div>
              <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Destination</span>
              <p className="font-mono text-[11px] text-foreground mt-0.5">
                {fp.dst_ip}:{fp.dst_port}
              </p>
            </div>
            <div>
              <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Captured</span>
              <p className="font-mono text-[11px] text-foreground mt-0.5">
                {new Date(fp.ts * 1000).toLocaleTimeString()}
              </p>
            </div>
            <NoteEditor id={fp.id} />
          </div>
          <div>
            <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">uTLS Spec Preview</span>
            <pre className="mt-0.5 bg-bg-primary border border-border rounded-lg p-2 text-[10px] font-mono text-foreground overflow-x-auto max-h-32 overflow-y-auto leading-relaxed">
              {fp.utls_spec.slice(0, 400)}{fp.utls_spec.length > 400 ? "\n// …" : ""}
            </pre>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────

function FingerprintRow({
  fp,
  index,
  expanded,
  onToggle,
  onSave,
}: {
  fp: CapturedFingerprint;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onSave: (fp: CapturedFingerprint) => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={clsx(
          "border-b border-border/50 cursor-pointer transition-colors",
          expanded ? "bg-accent/[0.05]" : "hover:bg-bg-elevated"
        )}
      >
        {/* # + pin */}
        <td className="px-2 py-2.5 text-text-muted font-mono w-12">
          <div className="flex items-center gap-1">
            <PinButton id={fp.id} />
            {expanded
              ? <ChevronDown className="h-3 w-3 text-accent" />
              : <ChevronRight className="h-3 w-3 text-text-muted/40" />
            }
            <span className="text-[11px]">{index}</span>
          </div>
        </td>

        {/* Host (SNI) */}
        <td className="px-3 py-2.5 max-w-[200px]">
          <InlineLabel
            id={fp.id}
            fallback={fp.sni || fp.dst_ip || "—"}
            className="font-mono text-[12px] truncate block"
          />
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {fp.package && (
              <span className="text-[10px] text-text-muted truncate">
                {fp.package.split(".").slice(-2).join(".")}
              </span>
            )}
            <ProtocolBadge ja4={fp.ja4} />
            <NoteIndicator id={fp.id} />
          </div>
          <TagList id={fp.id} className="mt-1" />
        </td>

        {/* JA4 */}
        <td className="px-3 py-2.5">
          <span
            className="font-mono text-[11px] text-accent-bright truncate block max-w-[220px]"
            title={fp.ja4}
          >
            {fp.ja4 || "—"}
          </span>
        </td>

        {/* TLS */}
        <td className="px-3 py-2.5">
          <span className={clsx(
            "text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-md",
            fp.tls_version === "TLS 1.3"
              ? "text-good bg-good/10"
              : "text-warn bg-warn/10"
          )}>
            {fp.tls_version?.replace("TLS ", "") || "?"}
          </span>
        </td>

        {/* Ciphers */}
        <td className="px-3 py-2.5 text-center font-mono text-[12px] text-text-secondary">
          {fp.cipher_count}
        </td>

        {/* Extensions */}
        <td className="px-3 py-2.5 text-center font-mono text-[12px] text-text-secondary">
          {fp.ext_count}
        </td>

        {/* Time */}
        <td className="px-3 py-2.5 font-mono text-[10px] text-text-muted whitespace-nowrap">
          {new Date(fp.ts * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </td>

        {/* Actions */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5 justify-end" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onSave(fp)}
              title="Save as profile"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border bg-bg-tertiary border-border text-text-muted hover:bg-amber-500/10 hover:border-amber-500/20 hover:text-amber-400 transition-all duration-150 cursor-pointer shrink-0"
            >
              <Bookmark className="h-3 w-3" />
              Save
            </button>
            <CopyButton text={fp.utls_spec} />
          </div>
        </td>
      </tr>

      {expanded && <ExpandedRow fp={fp} />}
    </>
  );
}

// ── Section divider ───────────────────────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={9} className="px-3 py-1 bg-bg-secondary/80 border-b border-border">
        <span className="text-[9px] font-mono font-semibold uppercase tracking-widest text-text-muted/60">
          {label}
        </span>
      </td>
    </tr>
  );
}

// ── Main table ────────────────────────────────────────────────────────────────

export default function FingerprintTable({
  fingerprints,
}: {
  fingerprints: CapturedFingerprint[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savingFp, setSavingFp] = useState<CapturedFingerprint | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const allAnns = useAnnotationsAll();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [fingerprints.length]);

  if (fingerprints.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-sm text-text-muted">No fingerprints captured yet</p>
          <p className="text-xs text-text-muted/60">
            Select an app and click Start Fingerprinting
          </p>
        </div>
      </div>
    );
  }

  const pinned = fingerprints.filter((fp) => allAnns[fp.id]?.pinned);
  const unpinned = fingerprints.filter((fp) => !allAnns[fp.id]?.pinned);

  let globalIndex = 0;

  function renderRow(fp: CapturedFingerprint) {
    globalIndex++;
    const idx = globalIndex;
    return (
      <FingerprintRow
        key={fp.id}
        fp={fp}
        index={idx}
        expanded={expanded === fp.id}
        onToggle={() => setExpanded(expanded === fp.id ? null : fp.id)}
        onSave={setSavingFp}
      />
    );
  }

  return (
    <>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 z-10 bg-bg-secondary border-b border-border">
            <tr>
              <th className="w-12 px-2 py-2 text-left font-mono text-[10px] text-text-muted">#</th>
              <th className="px-3 py-2 text-left font-mono text-[10px] text-text-muted">Host (SNI)</th>
              <th className="px-3 py-2 text-left font-mono text-[10px] text-text-muted">JA4</th>
              <th className="w-16 px-3 py-2 text-left font-mono text-[10px] text-text-muted">TLS</th>
              <th className="w-16 px-3 py-2 text-center font-mono text-[10px] text-text-muted">Ciphers</th>
              <th className="w-16 px-3 py-2 text-center font-mono text-[10px] text-text-muted">Exts</th>
              <th className="w-20 px-3 py-2 text-left font-mono text-[10px] text-text-muted">Time</th>
              <th className="w-40 px-3 py-2 text-right font-mono text-[10px] text-text-muted">Action</th>
            </tr>
          </thead>
          <tbody>
            {pinned.length > 0 && (
              <>
                <SectionDivider label="Pinned" />
                {pinned.map(renderRow)}
                {unpinned.length > 0 && <SectionDivider label="All" />}
              </>
            )}
            {unpinned.map(renderRow)}
          </tbody>
        </table>
        <div ref={bottomRef} />
      </div>

      {savingFp && (
        <SaveProfileDialog
          fingerprint={savingFp}
          onClose={() => setSavingFp(null)}
        />
      )}
    </>
  );
}

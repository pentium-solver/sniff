"use client";

import { useState, useEffect, useRef } from "react";
import { X, BookmarkCheck } from "lucide-react";
import type { CapturedFingerprint } from "@/lib/types";
import { saveProfile } from "@/lib/profiles";
import { getAnnotation } from "@/lib/annotations";
import clsx from "clsx";

interface SaveProfileDialogProps {
  fingerprint: CapturedFingerprint;
  onClose: () => void;
}

export default function SaveProfileDialog({
  fingerprint,
  onClose,
}: SaveProfileDialogProps) {
  const ann = getAnnotation(fingerprint.id);
  const [name, setName] = useState(
    ann.label || fingerprint.sni || fingerprint.dst_ip || "New Profile"
  );
  const [browser, setBrowser] = useState("");
  const [version, setVersion] = useState("");
  const [device, setDevice] = useState("");
  const [os, setOs] = useState("");
  const [notes, setNotes] = useState(ann.note ?? "");
  const [saved, setSaved] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  function handleSave() {
    saveProfile({
      name: name.trim() || "Unnamed Profile",
      browser: browser.trim() || undefined,
      version: version.trim() || undefined,
      device: device.trim() || undefined,
      os: os.trim() || undefined,
      notes: notes.trim() || undefined,
      fingerprint,
    });
    setSaved(true);
    setTimeout(onClose, 800);
  }

  function field(
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    ref?: React.RefObject<HTMLInputElement>
  ) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
          {label}
        </label>
        <input
          ref={ref as React.RefObject<HTMLInputElement> | undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
          className="bg-bg-tertiary border border-border rounded-lg px-2.5 py-1.5 text-[12px] font-mono text-foreground placeholder:text-text-muted outline-none focus:border-accent/40 transition-colors"
        />
      </div>
    );
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-card border border-card-border rounded-2xl shadow-2xl shadow-black/60 w-[420px] p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookmarkCheck className="h-4 w-4 text-accent-bright" />
            <span className="text-[13px] font-semibold">Save Fingerprint Profile</span>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-foreground cursor-pointer transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* JA4 preview */}
        <div className="bg-bg-secondary border border-border rounded-lg px-3 py-2 text-[10px] font-mono text-text-muted space-y-0.5">
          <div><span className="text-text-muted/60">SNI</span> <span className="text-foreground">{fingerprint.sni || "—"}</span></div>
          <div><span className="text-text-muted/60">JA4</span> <span className="text-accent-bright">{fingerprint.ja4}</span></div>
          <div><span className="text-text-muted/60">JA3</span> <span className="text-foreground">{fingerprint.ja3}</span></div>
        </div>

        {/* Fields */}
        {field("Name *", name, setName, "e.g. Brave Android 130", nameRef as React.RefObject<HTMLInputElement>)}

        <div className="grid grid-cols-2 gap-2">
          {field("Browser", browser, setBrowser, "Brave")}
          {field("Version", version, setVersion, "1.74.48")}
          {field("Device", device, setDevice, "Pixel 4a 5G")}
          {field("OS", os, setOs, "Android 13")}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes about this profile…"
            rows={2}
            className="bg-bg-tertiary border border-border rounded-lg px-2.5 py-1.5 text-[12px] font-mono text-foreground placeholder:text-text-muted outline-none focus:border-accent/40 transition-colors resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-xl border border-border bg-bg-tertiary text-[12px] font-medium text-text-secondary hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saved}
            className={clsx(
              "flex-1 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors cursor-pointer",
              saved
                ? "bg-good/15 text-good border border-good/20"
                : "bg-accent/15 border border-accent/20 text-accent-bright hover:bg-accent/20"
            )}
          >
            {saved ? "✓ Saved!" : "Save Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

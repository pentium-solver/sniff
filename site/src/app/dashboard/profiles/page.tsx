"use client";

import { useState, useEffect, useRef } from "react";
import {
  Trash2, Copy, Check, Download, Upload, BookmarkCheck, Search,
  Globe, ArrowDownToLine, RefreshCw, ExternalLink, Loader2,
} from "lucide-react";
import {
  listProfiles,
  deleteProfile,
  exportProfilesJSON,
  importProfilesJSON,
  saveProfile,
  type FingerprintProfile,
} from "@/lib/profiles";
import {
  fetchCommunityIndex,
  fetchCommunityProfile,
  invalidateCommunityIndex,
  type CommunityProfileEntry,
} from "@/lib/communityProfiles";
import clsx from "clsx";

// ── Shared helpers ────────────────────────────────────────────────────────────

function CopyGoButton({ spec }: { spec: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try { await navigator.clipboard.writeText(spec); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={handleCopy}
      className={clsx(
        "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-all cursor-pointer",
        copied
          ? "bg-good/10 border-good/20 text-good"
          : "bg-bg-tertiary border-border text-text-muted hover:bg-accent/10 hover:border-accent/20 hover:text-accent-bright"
      )}
    >
      {copied ? <><Check className="h-3 w-3" />Copied</> : <><Copy className="h-3 w-3" />Copy Go</>}
    </button>
  );
}

function MetaBadge({ label }: { label: string }) {
  return (
    <span className="text-[9px] font-mono px-1.5 py-px rounded bg-bg-tertiary border border-border text-text-muted">
      {label}
    </span>
  );
}

// ── Saved profile card ────────────────────────────────────────────────────────

function ProfileCard({
  profile,
  onDelete,
}: {
  profile: FingerprintProfile;
  onDelete: () => void;
}) {
  const seg = profile.fingerprint.ja4?.split("_")[0] ?? "";
  const isQuic = seg[0] === "q";

  function exportSingle() {
    const blob = new Blob([exportProfilesJSON([profile.id])], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${profile.name.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="bg-card border border-card-border rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <BookmarkCheck className="h-3.5 w-3.5 text-accent-bright shrink-0" />
            <span className="text-[13px] font-semibold truncate">{profile.name}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {profile.browser && <MetaBadge label={profile.browser} />}
            {profile.version && <MetaBadge label={profile.version} />}
            {profile.device && <MetaBadge label={profile.device} />}
            {profile.os && <MetaBadge label={profile.os} />}
            {isQuic && (
              <span className="text-[9px] font-mono font-semibold px-1.5 py-px rounded bg-violet-500/15 text-violet-400">QUIC</span>
            )}
          </div>
        </div>
        <span className="text-[10px] text-text-muted/60 font-mono shrink-0 whitespace-nowrap">
          {new Date(profile.savedAt).toLocaleDateString()}
        </span>
      </div>

      <div className="bg-bg-secondary border border-border rounded-xl px-3 py-2 space-y-1">
        {profile.fingerprint.sni && (
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-text-muted/60 w-8 shrink-0">SNI</span>
            <span className="text-foreground truncate">{profile.fingerprint.sni}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="text-text-muted/60 w-8 shrink-0">JA4</span>
          <span className="text-accent-bright truncate">{profile.fingerprint.ja4}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="text-text-muted/60 w-8 shrink-0">JA3</span>
          <span className="text-foreground truncate">{profile.fingerprint.ja3}</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-text-muted">
          <span>{profile.fingerprint.cipher_count} ciphers</span>
          <span>{profile.fingerprint.ext_count} extensions</span>
          <span>{profile.fingerprint.tls_version}</span>
        </div>
      </div>

      {profile.notes && (
        <p className="text-[11px] text-text-muted leading-relaxed">{profile.notes}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <CopyGoButton spec={profile.fingerprint.utls_spec} />
        <button
          onClick={exportSingle}
          title="Export as JSON"
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border bg-bg-tertiary border-border text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
        >
          <Download className="h-3 w-3" />
          Export
        </button>
        <div className="flex-1" />
        <button
          onClick={() => { if (confirm(`Delete "${profile.name}"?`)) onDelete(); }}
          title="Delete profile"
          className="flex items-center gap-1 p-1.5 rounded-lg text-text-muted/40 hover:text-bad hover:bg-bad/10 transition-colors cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Community profile card ────────────────────────────────────────────────────

function CommunityCard({
  entry,
  alreadyImported,
  onImport,
}: {
  entry: CommunityProfileEntry;
  alreadyImported: boolean;
  onImport: () => void;
}) {
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(alreadyImported);
  const [err, setErr] = useState("");

  async function handleImport() {
    if (done) return;
    setImporting(true);
    setErr("");
    try {
      const full = await fetchCommunityProfile(entry.path);
      // Give it a fresh local id + savedAt so it doesn't conflict
      saveProfile({
        name: full.name ?? entry.name,
        device: full.device ?? entry.device,
        browser: full.browser ?? entry.browser,
        version: full.version ?? entry.version,
        os: full.os ?? entry.os,
        notes: full.notes,
        fingerprint: full.fingerprint,
      });
      setDone(true);
      onImport();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="bg-card border border-card-border rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Globe className="h-3.5 w-3.5 text-accent-bright shrink-0" />
            <span className="text-[13px] font-semibold truncate">{entry.name}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {entry.browser && <MetaBadge label={entry.browser} />}
            {entry.version && <MetaBadge label={entry.version} />}
            {entry.device && <MetaBadge label={entry.device} />}
            {entry.os && <MetaBadge label={entry.os} />}
            {entry.category && (
              <span className="text-[9px] font-mono font-semibold px-1.5 py-px rounded bg-accent/10 border border-accent/20 text-accent-bright">
                {entry.category}
              </span>
            )}
          </div>
        </div>
        {entry.updatedAt && (
          <span className="text-[10px] text-text-muted/60 font-mono shrink-0 whitespace-nowrap">
            {entry.updatedAt}
          </span>
        )}
      </div>

      {entry.ja4 && (
        <div className="bg-bg-secondary border border-border rounded-xl px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-text-muted/60 w-8 shrink-0">JA4</span>
            <span className="text-accent-bright truncate">{entry.ja4}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        {entry.submittedBy && (
          <span className="text-[10px] text-text-muted font-mono">
            by {entry.submittedBy}
          </span>
        )}
        <div className="flex-1" />
        {err && <span className="text-[10px] text-bad font-mono">{err}</span>}
        <button
          onClick={handleImport}
          disabled={importing || done}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer disabled:opacity-60",
            done
              ? "bg-good/10 border-good/20 text-good"
              : "bg-accent text-white border-transparent hover:bg-accent-light shadow-sm shadow-accent/25"
          )}
        >
          {importing ? (
            <><Loader2 className="h-3 w-3 animate-spin" />Importing…</>
          ) : done ? (
            <><Check className="h-3 w-3" />Imported</>
          ) : (
            <><ArrowDownToLine className="h-3 w-3" />Import</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "saved" | "community";

export default function ProfilesPage() {
  const [tab, setTab] = useState<Tab>("saved");
  const [profiles, setProfiles] = useState<FingerprintProfile[]>([]);
  const [search, setSearch] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState("");

  // Community state
  const [community, setCommunity] = useState<CommunityProfileEntry[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityErr, setCommunityErr] = useState("");

  function reloadSaved() {
    setProfiles(listProfiles());
  }

  useEffect(() => {
    reloadSaved();
  }, []);

  useEffect(() => {
    if (tab !== "community" || community.length > 0) return;
    loadCommunity();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadCommunity(forceRefresh = false) {
    if (forceRefresh) invalidateCommunityIndex();
    setCommunityLoading(true);
    setCommunityErr("");
    try {
      const data = await fetchCommunityIndex();
      setCommunity(data);
    } catch {
      setCommunityErr("Failed to load community profiles");
    } finally {
      setCommunityLoading(false);
    }
  }

  function handleDelete(id: string) {
    deleteProfile(id);
    reloadSaved();
  }

  function handleExportAll() {
    const blob = new Blob([exportProfilesJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sniff_profiles_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const n = importProfilesJSON(reader.result as string);
        setImportMsg(`Imported ${n} new profile${n !== 1 ? "s" : ""}`);
        reloadSaved();
        setTimeout(() => setImportMsg(""), 3000);
      } catch {
        setImportMsg("Import failed — invalid JSON");
        setTimeout(() => setImportMsg(""), 3000);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const savedIds = new Set(profiles.map((p) => p.id));

  const filteredSaved = search
    ? profiles.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.browser?.toLowerCase().includes(search.toLowerCase()) ||
          p.device?.toLowerCase().includes(search.toLowerCase()) ||
          p.fingerprint.ja4?.toLowerCase().includes(search.toLowerCase()) ||
          p.fingerprint.sni?.toLowerCase().includes(search.toLowerCase())
      )
    : profiles;

  const filteredCommunity = search
    ? community.filter(
        (e) =>
          e.name.toLowerCase().includes(search.toLowerCase()) ||
          e.browser?.toLowerCase().includes(search.toLowerCase()) ||
          e.device?.toLowerCase().includes(search.toLowerCase()) ||
          e.ja4?.toLowerCase().includes(search.toLowerCase())
      )
    : community;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="px-3 py-1.5 border-b border-border bg-bg-secondary flex items-center gap-2 shrink-0 flex-wrap">
        <BookmarkCheck className="h-4 w-4 text-accent-bright shrink-0" />
        <span className="text-[12px] font-semibold">Profiles</span>

        <div className="w-px h-5 bg-border" />

        {/* Tab toggle */}
        <div className="flex items-center gap-0.5 bg-bg-tertiary border border-border rounded-lg p-0.5">
          <button
            onClick={() => setTab("saved")}
            className={clsx(
              "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer",
              tab === "saved"
                ? "bg-card text-foreground shadow-sm"
                : "text-text-muted hover:text-foreground"
            )}
          >
            Saved
          </button>
          <button
            onClick={() => setTab("community")}
            className={clsx(
              "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer",
              tab === "community"
                ? "bg-card text-foreground shadow-sm"
                : "text-text-muted hover:text-foreground"
            )}
          >
            <Globe className="h-3 w-3" />
            Community
          </button>
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Search */}
        <div className="flex items-center gap-1.5 bg-bg-tertiary border border-border rounded-lg px-2 py-1">
          <Search className="h-3 w-3 text-text-muted shrink-0" />
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-[11px] text-foreground outline-none placeholder:text-text-muted w-32"
          />
        </div>

        <div className="flex-1" />

        {importMsg && (
          <span className="text-[10px] font-mono text-good">{importMsg}</span>
        )}

        {tab === "saved" ? (
          <>
            <button
              onClick={() => importRef.current?.click()}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border bg-bg-tertiary text-[11px] font-medium text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
            >
              <Upload className="h-3 w-3" />
              Import
            </button>
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <button
              onClick={handleExportAll}
              disabled={profiles.length === 0}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border bg-bg-tertiary text-[11px] font-medium text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="h-3 w-3" />
              Export All
            </button>
            <span className="text-[10px] font-mono text-text-muted">
              {profiles.length} profile{profiles.length !== 1 ? "s" : ""}
            </span>
          </>
        ) : (
          <>
            <button
              onClick={() => loadCommunity(true)}
              disabled={communityLoading}
              title="Refresh community index"
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border bg-bg-tertiary text-[11px] font-medium text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={clsx("h-3 w-3", communityLoading && "animate-spin")} />
              Refresh
            </button>
            <a
              href="https://github.com/pentium-solver/sniff/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border bg-bg-tertiary text-[11px] font-medium text-text-muted hover:text-foreground hover:bg-bg-elevated transition-colors cursor-pointer"
            >
              <ExternalLink className="h-3 w-3" />
              Submit yours
            </a>
            <span className="text-[10px] font-mono text-text-muted">
              {community.length} profile{community.length !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {tab === "saved" ? (
          filteredSaved.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <BookmarkCheck className="h-8 w-8 text-text-muted/30" />
              <p className="text-sm text-text-muted">
                {profiles.length === 0
                  ? "No profiles saved yet"
                  : "No profiles match your search"}
              </p>
              {profiles.length === 0 && (
                <p className="text-xs text-text-muted/60">
                  In Fingerprints, click{" "}
                  <span className="text-foreground font-medium">Save</span> on any
                  captured fingerprint to build your library.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {filteredSaved.map((p) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  onDelete={() => handleDelete(p.id)}
                />
              ))}
            </div>
          )
        ) : communityLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            <p className="text-sm text-text-muted">Loading community profiles…</p>
          </div>
        ) : communityErr ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <p className="text-sm text-bad">{communityErr}</p>
            <button
              onClick={() => loadCommunity(true)}
              className="text-xs text-accent-bright hover:underline cursor-pointer"
            >
              Try again
            </button>
          </div>
        ) : filteredCommunity.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Globe className="h-8 w-8 text-text-muted/30" />
            <p className="text-sm text-text-muted">
              {community.length === 0
                ? "No community profiles yet"
                : "No profiles match your search"}
            </p>
            {community.length === 0 && (
              <>
                <p className="text-xs text-text-muted/60 max-w-xs">
                  Be the first to contribute a fingerprint profile.
                  Save any captured fingerprint locally, export it, and open a PR.
                </p>
                <a
                  href="https://github.com/pentium-solver/sniff/blob/main/CONTRIBUTING.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-accent-bright hover:underline cursor-pointer"
                >
                  <ExternalLink className="h-3 w-3" />
                  Contribution guide →
                </a>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {filteredCommunity.map((entry) => (
              <CommunityCard
                key={entry.id}
                entry={entry}
                alreadyImported={savedIds.has(entry.id)}
                onImport={reloadSaved}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

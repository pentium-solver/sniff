"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import {
  Code2, ChevronRight, ChevronDown, Search, RefreshCw,
  FileCode, Folder, FolderOpen, AlertCircle, Loader2,
  X, Package, ZoomIn
} from "lucide-react";
import clsx from "clsx";

// ── Java/Kotlin keywords to skip in definition lookup ─────────────────────────

const SKIP_WORDS = new Set([
  "class","void","public","private","protected","static","final","new","return",
  "if","else","for","while","do","try","catch","finally","throw","throws",
  "import","package","this","super","extends","implements","interface","enum",
  "abstract","synchronized","native","transient","volatile","strictfp","assert",
  "break","continue","switch","case","default","instanceof","null","true","false",
  "int","long","short","byte","char","double","float","boolean",
  "String","Object","List","Map","Set","Array","Override","Nullable","NonNull",
  "val","var","fun","when","is","in","by","object","companion","data","sealed",
  "open","override","internal","inline","suspend","it","let","run","also","apply",
]);

// Extract the identifier under the mouse cursor using the browser Selection API.
function getWordAtPoint(x: number, y: number): string | null {
  const range = (document as unknown as { caretRangeFromPoint?: (x: number, y: number) => Range | null })
    .caretRangeFromPoint?.(x, y);
  if (!range) return null;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";
  const offset = range.startOffset;

  // Walk left/right to find identifier boundaries (\w and $)
  let start = offset;
  while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && /[\w$]/.test(text[end])) end++;

  const word = text.slice(start, end);
  if (word.length < 2 || SKIP_WORDS.has(word)) return null;
  // Skip all-lowercase short words (likely local vars) and pure numbers
  if (/^\d+$/.test(word)) return null;
  return word;
}

// ── Definition popup ──────────────────────────────────────────────────────────

interface DefResult {
  file: string;
  line: number;
  match: string;
  kind: string;
}
interface PopupState {
  x: number;
  y: number;
  symbol: string;
  loading: boolean;
  results: DefResult[];
  notFound?: boolean;
}

const KIND_STYLES: Record<string, string> = {
  class:       "bg-cyan-500/10 text-cyan-400",
  interface:   "bg-purple-500/10 text-purple-400",
  enum:        "bg-[#d29922]/10 text-[#d29922]",
  record:      "bg-cyan-500/10 text-cyan-400",
  object:      "bg-purple-500/10 text-purple-400",
  function:    "bg-accent/10 text-accent-bright",
  method:      "bg-accent/10 text-accent-bright",
  constructor: "bg-good/10 text-good",
  field:       "bg-bg-tertiary text-text-muted",
};

function DefinitionPopup({ popup, onJump, onClose }: {
  popup: PopupState;
  onJump: (file: string, line: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Escape to dismiss
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Click-outside to dismiss
  useEffect(() => {
    function onMouse(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    // Delay so the originating click doesn't immediately close it
    const id = setTimeout(() => document.addEventListener("mousedown", onMouse), 50);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", onMouse); };
  }, [onClose]);

  // Position: try right of cursor, flip left if near edge
  const W = 380;
  const left = popup.x + 14 + W > window.innerWidth ? popup.x - W - 14 : popup.x + 14;
  const top = Math.min(popup.y - 8, window.innerHeight - 220);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-bg-secondary border border-border rounded-xl shadow-2xl shadow-black/60 overflow-hidden"
      style={{ left, top, width: W }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-[11px] font-mono font-semibold text-accent-bright truncate flex-1">{popup.symbol}</span>
        {popup.loading && <Loader2 className="h-3 w-3 animate-spin text-text-muted shrink-0" />}
        {popup.notFound && <span className="text-[10px] text-text-muted">No definition found</span>}
        <button onClick={onClose} className="p-0.5 text-text-muted hover:text-foreground cursor-pointer shrink-0">
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Results */}
      {popup.results.map((r, i) => (
        <button
          key={i}
          onClick={() => onJump(r.file, r.line)}
          className="w-full text-left px-3 py-2.5 hover:bg-bg-elevated transition-colors cursor-pointer border-b border-border/30 last:border-0"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className={clsx("text-[9px] font-mono rounded px-1.5 py-px font-semibold", KIND_STYLES[r.kind] ?? KIND_STYLES.field)}>
              {r.kind}
            </span>
            <span className="font-mono text-[10px] text-text-secondary truncate">{r.file.split("/").pop()}</span>
            <span className="text-[10px] text-text-muted ml-auto shrink-0 font-mono">:{r.line}</span>
          </div>
          <div className="font-mono text-[11px] text-foreground truncate pl-0.5">{r.match.trim()}</div>
        </button>
      ))}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  is_file: boolean;
  has_children?: boolean;
  children?: TreeNode[];
}

interface DecompileStatus {
  status: "idle" | "running" | "ready" | "error";
  progress?: number;
  fileCount?: number;
  error?: string;
  log?: string[];
  elapsed_ms?: number;
}

function formatElapsed(ms: number | undefined): string {
  if (!ms || ms < 1000) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function decompilePhaseLabel(progress: number | undefined, log: string[] | undefined): string {
  const p = progress ?? 0;
  if (p === 0) return "Starting…";
  if (p <= 2) return "Loading DEX files…";
  if (p <= 5) return "Processing bytecode…";
  if (p <= 7) return "Preparing decompiler…";
  return `Decompiling classes (${p}%)`;
}

interface FileContent {
  path: string;
  content: string;
  lines: number;
  truncated: boolean;
}

interface SearchResult {
  file: string;
  line: number;
  match: string;
}

interface SearchResponse {
  results: SearchResult[];
  count: number;
  capped?: boolean;
  deep?: boolean;
}

// ── Syntax highlighting ───────────────────────────────────────────────────────

const JAVA_KEYWORDS = new Set([
  "abstract","assert","boolean","break","byte","case","catch","char","class",
  "const","continue","default","do","double","else","enum","extends","final",
  "finally","float","for","goto","if","implements","import","instanceof","int",
  "interface","long","native","new","package","private","protected","public",
  "return","short","static","strictfp","super","switch","synchronized","this",
  "throw","throws","transient","try","var","void","volatile","while",
  // Kotlin
  "fun","val","var","is","in","when","object","companion","data","sealed",
  "open","override","internal","inline","reified","crossinline","noinline",
  "suspend","by","typealias","where","as","null","true","false","it","out",
]);

function tokenize(code: string): string {
  // We build HTML spans in a single pass using a simple state machine.
  const out: string[] = [];
  let i = 0;
  const n = code.length;

  function escape(s: string) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  while (i < n) {
    // Line comment
    if (code[i] === "/" && code[i+1] === "/") {
      let end = code.indexOf("\n", i);
      if (end === -1) end = n;
      out.push(`<span class="syn-comment">${escape(code.slice(i, end))}</span>`);
      i = end;
      continue;
    }
    // Block comment
    if (code[i] === "/" && code[i+1] === "*") {
      let end = code.indexOf("*/", i+2);
      end = end === -1 ? n : end + 2;
      out.push(`<span class="syn-comment">${escape(code.slice(i, end))}</span>`);
      i = end;
      continue;
    }
    // String
    if (code[i] === '"') {
      let j = i + 1;
      while (j < n && code[j] !== '"') {
        if (code[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, n);
      out.push(`<span class="syn-string">${escape(code.slice(i, j))}</span>`);
      i = j;
      continue;
    }
    // Char literal
    if (code[i] === "'") {
      let j = i + 1;
      while (j < n && code[j] !== "'") {
        if (code[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, n);
      out.push(`<span class="syn-string">${escape(code.slice(i, j))}</span>`);
      i = j;
      continue;
    }
    // Annotation
    if (code[i] === "@") {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(code[j])) j++;
      out.push(`<span class="syn-annotation">${escape(code.slice(i, j))}</span>`);
      i = j;
      continue;
    }
    // Number
    if (/[0-9]/.test(code[i]) && (i === 0 || /\W/.test(code[i-1]))) {
      let j = i;
      while (j < n && /[0-9a-fA-FxX._L]/.test(code[j])) j++;
      out.push(`<span class="syn-number">${escape(code.slice(i, j))}</span>`);
      i = j;
      continue;
    }
    // Identifier or keyword
    if (/[A-Za-z_$]/.test(code[i])) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (JAVA_KEYWORDS.has(word)) {
        out.push(`<span class="syn-keyword">${escape(word)}</span>`);
      } else if (word.length > 1 && word[0] === word[0].toUpperCase() && /^[A-Z]/.test(word)) {
        out.push(`<span class="syn-type">${escape(word)}</span>`);
      } else {
        out.push(escape(word));
      }
      i = j;
      continue;
    }
    // Anything else — operator/punctuation
    out.push(escape(code[i]));
    i++;
  }

  return out.join("");
}

// ── File tree ─────────────────────────────────────────────────────────────────

function FileTreeNode({
  node,
  depth,
  selectedPath,
  pkg,
  onSelect,
  defaultExpand,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  pkg: string;
  onSelect: (node: TreeNode) => void;
  defaultExpand?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpand ?? depth < 2);
  // Lazy-loaded children — null means not fetched yet
  const [children, setChildren] = useState<TreeNode[] | null>(
    node.children && node.children.length > 0 ? node.children : null
  );
  const [loadingChildren, setLoadingChildren] = useState(false);
  const indent = depth * 12;

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    // Lazy-load children when expanding a dir that hasn't been fetched
    if (next && !children && node.has_children) {
      setLoadingChildren(true);
      try {
        const tree = await api<TreeNode>(
          `/decompile/tree?package=${encodeURIComponent(pkg)}&path=${encodeURIComponent(node.path)}&depth=2`
        );
        setChildren(tree.children ?? []);
      } catch { /* ignore */ }
      finally { setLoadingChildren(false); }
    }
  }

  if (node.is_file) {
    const ext = node.name.split(".").pop() ?? "";
    const iconColor = ext === "kt" ? "text-purple-400"
      : ext === "java" ? "text-accent-bright"
      : ext === "xml" ? "text-good"
      : "text-text-muted";

    return (
      <button
        onClick={() => onSelect(node)}
        className={clsx(
          "w-full flex items-center gap-1.5 py-0.5 pr-2 text-left transition-colors cursor-pointer hover:bg-accent/[.04] rounded",
          selectedPath === node.path && "bg-accent/10 text-accent-bright"
        )}
        style={{ paddingLeft: `${8 + indent}px` }}
      >
        <FileCode className={clsx("h-3.5 w-3.5 shrink-0", iconColor)} />
        <span className={clsx(
          "font-mono text-[11px] truncate",
          selectedPath === node.path ? "text-accent-bright" : "text-text-secondary hover:text-foreground"
        )}>
          {node.name}
        </span>
      </button>
    );
  }

  // Directory
  const hasKids = node.has_children || (children && children.length > 0);

  return (
    <div>
      <button
        onClick={toggleExpand}
        className="w-full flex items-center gap-1.5 py-0.5 pr-2 text-left transition-colors cursor-pointer hover:bg-accent/[.04] rounded"
        style={{ paddingLeft: `${8 + indent}px` }}
      >
        <span className="text-text-muted h-3.5 w-3.5 flex items-center shrink-0">
          {loadingChildren
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : hasKids
              ? (expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)
              : <span className="w-3" />
          }
        </span>
        {expanded
          ? <FolderOpen className="h-3.5 w-3.5 text-[#d29922] shrink-0" />
          : <Folder className="h-3.5 w-3.5 text-[#d29922] shrink-0" />}
        <span className="font-mono text-[11px] text-text-secondary truncate">{node.name}</span>
      </button>
      {expanded && children && (
        <div>
          {children.map(child => (
            <FileTreeNode
              key={child.path || child.name}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              pkg={pkg}
              onSelect={onSelect}
              defaultExpand={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Source viewer ─────────────────────────────────────────────────────────────

function SourceViewer({
  file,
  searchTerm,
  targetLine,
  pkg,
  onJumpToFile,
}: {
  file: FileContent;
  searchTerm: string;
  targetLine?: number | null;
  pkg: string;
  onJumpToFile: (filePath: string, line: number) => void;
}) {
  const lines = useMemo(() => file.content.split("\n"), [file.content]);
  const ext = file.path.split(".").pop() ?? "";
  const canHighlight = ext === "java" || ext === "kt";
  const targetRef = useRef<HTMLDivElement | null>(null);
  const [cmdHeld, setCmdHeld] = useState(false);
  const [popup, setPopup] = useState<PopupState | null>(null);

  // Track Cmd / Ctrl key held state — changes cursor to pointer
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { if (e.key === "Meta" || e.key === "Control") setCmdHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Meta" || e.key === "Control") setCmdHeld(false); };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }, []);

  // Scroll to target line when it changes or the file loads
  useEffect(() => {
    if (targetLine && targetRef.current) {
      targetRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [targetLine, file.path]);

  // Cmd+click → definition lookup
  async function handleClick(e: React.MouseEvent) {
    if (!e.metaKey && !e.ctrlKey) return;
    e.preventDefault();

    const word = getWordAtPoint(e.clientX, e.clientY);
    if (!word) return;

    setPopup({ x: e.clientX, y: e.clientY, symbol: word, loading: true, results: [] });

    try {
      const data = await api<{ symbol: string; kind: string; results: DefResult[] }>(
        `/decompile/definition?package=${encodeURIComponent(pkg)}&symbol=${encodeURIComponent(word)}`
      );
      const results = data.results ?? [];

      if (results.length === 0) {
        setPopup(p => p ? { ...p, loading: false, notFound: true } : null);
        setTimeout(() => setPopup(null), 2000);
        return;
      }
      if (results.length === 1) {
        setPopup(null);
        onJumpToFile(results[0].file, results[0].line);
        return;
      }
      setPopup(p => p ? { ...p, loading: false, results } : null);
    } catch {
      setPopup(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* File path breadcrumb */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border shrink-0 bg-bg-secondary">
        {file.path.split("/").map((part, i, arr) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-text-muted" />}
            <span className={clsx(
              "font-mono text-[11px]",
              i === arr.length - 1 ? "text-foreground font-semibold" : "text-text-muted"
            )}>
              {part}
            </span>
          </span>
        ))}
        <span className="ml-auto text-[10px] text-text-muted font-mono">
          {targetLine && <span className="text-[#d29922] mr-2">:{targetLine}</span>}
          {file.lines} lines
          {file.truncated && " (truncated at 4000)"}
        </span>
      </div>

      {/* Code — cmd+click for go-to-definition */}
      <div
        className="flex-1 overflow-auto"
        onClick={handleClick}
        style={{ cursor: cmdHeld ? "pointer" : undefined }}
      >
        {/* Hint bar when cmd is held */}
        {cmdHeld && (
          <div className="sticky top-0 z-10 flex items-center gap-1.5 px-3 py-1 bg-accent/10 border-b border-accent/20 text-[10px] text-accent-bright font-mono">
            <span className="opacity-70">⌘</span> click a symbol to jump to its definition
          </div>
        )}
        <div className="min-w-max">
          {lines.map((line, idx) => {
            const lineNum = idx + 1;
            const isTarget = targetLine === lineNum;
            const isSearchMatch = !isTarget && searchTerm && line.toLowerCase().includes(searchTerm.toLowerCase());
            const htmlContent = canHighlight
              ? tokenize(line)
              : line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

            return (
              <div
                key={idx}
                ref={isTarget ? targetRef : undefined}
                className={clsx(
                  "flex font-mono text-[11px] leading-5",
                  isTarget
                    ? "bg-[#d29922]/15 border-l-2 border-[#d29922]"
                    : isSearchMatch
                    ? "bg-accent/10"
                    : "hover:bg-accent/[.03]"
                )}
              >
                <span className={clsx(
                  "select-none w-10 shrink-0 text-right pr-3 border-r border-border/40 mr-3",
                  isTarget ? "text-[#d29922] font-semibold" : "text-text-muted"
                )}>
                  {lineNum}
                </span>
                <span
                  className="whitespace-pre text-foreground"
                  dangerouslySetInnerHTML={{ __html: htmlContent }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Definition popup */}
      {popup && (
        <DefinitionPopup
          popup={popup}
          onJump={(file, line) => { setPopup(null); onJumpToFile(file, line); }}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

// ── Search results panel ──────────────────────────────────────────────────────

function SearchResultsPanel({
  results,
  query,
  meta,
  onJump,
  onClose,
}: {
  results: SearchResult[];
  query: string;
  meta: { count: number; capped?: boolean; deep?: boolean } | null;
  onJump: (file: string, line: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 bg-bg-primary z-10 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <Search className="h-4 w-4 text-accent-bright" />
        <span className="text-[13px] font-semibold">
          {meta?.capped ? `${results.length}+` : results.length} result{results.length !== 1 ? "s" : ""} for
          <span className="font-mono text-accent-bright ml-1">{query}</span>
        </span>
        {meta?.deep && (
          <span className="text-[10px] font-mono bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded px-1.5 py-0.5">
            deep
          </span>
        )}
        {meta?.capped && (
          <span className="text-[10px] text-text-muted font-mono">cap reached</span>
        )}
        <button
          onClick={onClose}
          className="ml-auto p-1 rounded text-text-muted hover:text-foreground hover:bg-bg-elevated cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {results.map((r, i) => (
          <button
            key={i}
            onClick={() => onJump(r.file, r.line)}
            className="w-full flex items-start gap-3 px-4 py-2 hover:bg-accent/[.04] transition-colors cursor-pointer text-left border-b border-border/20"
          >
            <span className="font-mono text-[10px] text-text-muted shrink-0 mt-0.5 w-8 text-right">{r.line}</span>
            <div className="min-w-0">
              <div className="font-mono text-[10px] text-accent-bright truncate">{r.file}</div>
              <div className="font-mono text-[11px] text-foreground truncate mt-0.5">{r.match}</div>
            </div>
          </button>
        ))}
        {results.length === 0 && (
          <div className="text-center text-text-muted text-[13px] py-12">No results found</div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SourcePageInner() {
  const searchParams = useSearchParams();
  const [packages, setPackages] = useState<string[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<string>(searchParams.get("pkg") ?? "");
  const [status, setStatus] = useState<DecompileStatus>({ status: "idle" });
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [selectedFile, setSelectedFile] = useState<TreeNode | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [targetLine, setTargetLine] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchMeta, setSearchMeta] = useState<{ count: number; capped?: boolean; deep?: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [deepSearch, setDeepSearch] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load available packages ───────────────────────────────────────────────

  useEffect(() => {
    const qPkg = searchParams.get("pkg");
    api<{ packages: string[] }>("/decompile/packages")
      .then(r => {
        const pkgs = r.packages ?? [];
        // Merge query-param pkg into the list if not already present
        if (qPkg && !pkgs.includes(qPkg)) pkgs.unshift(qPkg);
        setPackages(pkgs);
        if (!selectedPkg && pkgs.length > 0) {
          setSelectedPkg(qPkg ?? pkgs[0]);
        } else if (qPkg && selectedPkg !== qPkg) {
          setSelectedPkg(qPkg);
        }
      })
      .catch(() => {
        if (qPkg) { setPackages([qPkg]); setSelectedPkg(qPkg); }
      });
  }, []);

  // ── Check status when package changes ─────────────────────────────────────

  const checkStatus = useCallback(async (pkg: string) => {
    if (!pkg) return;
    try {
      const s = await api<DecompileStatus>(`/decompile/status?package=${encodeURIComponent(pkg)}`);
      setStatus(s);
      if (s.status === "ready") {
        // Load tree
        const t = await api<TreeNode>(`/decompile/tree?package=${encodeURIComponent(pkg)}`);
        setTree(t);
        setSelectedFile(null);
        setFileContent(null);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!selectedPkg) return;
    setTree(null);
    setSelectedFile(null);
    setFileContent(null);
    setTargetLine(null);
    setSearchResults(null);
    setShowSearchPanel(false);
    checkStatus(selectedPkg);
  }, [selectedPkg, checkStatus]);

  // ── Poll while running ─────────────────────────────────────────────────────

  useEffect(() => {
    if (status.status === "running") {
      // Poll fast while decompiling so log lines arrive quickly
      pollRef.current = setInterval(() => checkStatus(selectedPkg), 800);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status.status, selectedPkg, checkStatus]);

  // ── Trigger decompile ─────────────────────────────────────────────────────

  async function triggerDecompile() {
    if (!selectedPkg) return;
    setStatus({ status: "running", progress: 0 });
    try {
      await api<unknown>("/decompile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: selectedPkg }),
      });
      checkStatus(selectedPkg);
    } catch (e: unknown) {
      setStatus({ status: "error", error: String(e) });
    }
  }

  // ── Load file ─────────────────────────────────────────────────────────────

  async function openFile(node: TreeNode, jumpLine?: number) {
    if (!node.is_file) return;
    setSelectedFile(node);
    setLoadingFile(true);
    setShowSearchPanel(false);
    setTargetLine(jumpLine ?? null);
    try {
      const fc = await api<FileContent>(
        `/decompile/file?package=${encodeURIComponent(selectedPkg)}&path=${encodeURIComponent(node.path)}`
      );
      setFileContent(fc);
    } catch {
      setFileContent(null);
    } finally {
      setLoadingFile(false);
    }
  }

  // jumpToFile: build a synthetic TreeNode from the file path so we don't need
  // to walk the lazy-loaded tree (which is only 3 levels deep and will miss
  // deeply-nested search results).
  function jumpToFile(filePath: string, line: number) {
    const syntheticNode: TreeNode = {
      name: filePath.split("/").pop() ?? filePath,
      path: filePath,
      is_file: true,
    };
    openFile(syntheticNode, line);
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async function runSearch(q: string, opts?: { deep?: boolean; cs?: boolean }) {
    if (!q || !selectedPkg) return;
    setSearching(true);
    setShowSearchPanel(true);
    const isDeep = opts?.deep ?? deepSearch;
    const isCS = opts?.cs ?? caseSensitive;
    try {
      const qs = new URLSearchParams({
        package: selectedPkg,
        q,
        ...(isDeep ? { deep: "1" } : {}),
        ...(isCS ? { case: "1" } : {}),
      });
      const r = await api<SearchResponse>(`/decompile/search?${qs}`);
      setSearchResults(r.results ?? []);
      setSearchMeta({ count: r.count, capped: r.capped, deep: r.deep });
      setSearchQuery(q);
    } catch {
      setSearchResults([]);
      setSearchMeta(null);
    } finally {
      setSearching(false);
    }
  }

  // ── Add new package selector ──────────────────────────────────────────────

  const [pkgInput, setPkgInput] = useState("");

  // ── Rendering helpers ─────────────────────────────────────────────────────

  // No packages available
  if (packages.length === 0 && status.status === "idle") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted">
        <Code2 className="h-10 w-10 opacity-25" />
        <div className="text-center">
          <p className="text-[14px] font-medium text-foreground">No decompiled source yet</p>
          <p className="text-[12px] text-text-muted mt-1">Enter a package name below to start</p>
        </div>
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            value={pkgInput}
            onChange={e => setPkgInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && pkgInput) { setSelectedPkg(pkgInput); setPackages([pkgInput]); }}}
            placeholder="com.example.app"
            className="font-mono text-[12px] bg-bg-elevated border border-border rounded-lg px-3 py-2 outline-none focus:border-accent/50 text-foreground w-52"
          />
          <button
            onClick={() => { if (pkgInput) { setSelectedPkg(pkgInput); setPackages([pkgInput]); }}}
            className="px-4 py-2 rounded-lg bg-accent/10 text-accent-bright text-[12px] font-medium hover:bg-accent/20 transition-colors cursor-pointer border border-accent/20"
          >
            Start
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0 bg-bg-secondary">
        <Code2 className="h-4 w-4 text-accent-bright shrink-0" />
        <span className="text-[13px] font-semibold">Source</span>

        {/* Package selector */}
        <div className="flex items-center gap-1.5 ml-2">
          <Package className="h-3.5 w-3.5 text-text-muted" />
          <select
            value={selectedPkg}
            onChange={e => setSelectedPkg(e.target.value)}
            className="font-mono text-[11px] bg-bg-elevated border border-border rounded px-2 py-1 text-foreground outline-none cursor-pointer"
          >
            {packages.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Manual package input */}
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={pkgInput}
            onChange={e => setPkgInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && pkgInput) {
                setPackages(prev => prev.includes(pkgInput) ? prev : [...prev, pkgInput]);
                setSelectedPkg(pkgInput);
                setPkgInput("");
              }
            }}
            placeholder="Add package…"
            className="font-mono text-[11px] bg-bg-elevated border border-border rounded px-2 py-1 text-foreground outline-none focus:border-accent/50 w-44 placeholder:text-text-muted"
          />
        </div>

        {/* Decompile / Re-decompile button */}
        {status.status !== "running" && (
          <button
            onClick={triggerDecompile}
            className={clsx(
              "flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-colors cursor-pointer",
              status.status === "ready"
                ? "text-text-muted border-border hover:text-foreground hover:bg-bg-elevated"
                : "text-accent-bright bg-accent/10 border-accent/20 hover:bg-accent/20"
            )}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {status.status === "ready" ? "Re-decompile" : "Decompile"}
          </button>
        )}

        {/* Search */}
        {status.status === "ready" && (
          <div className="flex items-center gap-2 ml-auto">
            {/* Toggle: case-sensitive */}
            <button
              onClick={() => setCaseSensitive(c => !c)}
              title="Case-sensitive search"
              className={clsx(
                "px-2 py-1 rounded text-[10px] font-mono border transition-colors cursor-pointer",
                caseSensitive
                  ? "bg-accent/10 text-accent-bright border-accent/30"
                  : "text-text-muted border-border hover:text-foreground hover:border-border-light"
              )}
            >
              Aa
            </button>

            {/* Toggle: deep search */}
            <button
              onClick={() => setDeepSearch(d => !d)}
              title="Deep search — all file types, 500 match cap"
              className={clsx(
                "px-2 py-1 rounded text-[10px] font-mono border transition-colors cursor-pointer",
                deepSearch
                  ? "bg-orange-500/10 text-orange-400 border-orange-500/30"
                  : "text-text-muted border-border hover:text-foreground hover:border-border-light"
              )}
            >
              Deep
            </button>

            {/* Search input */}
            <div className="flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1">
              <Search className="h-3.5 w-3.5 text-text-muted" />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") runSearch(searchInput); }}
                placeholder={deepSearch ? "Deep search…" : "Search source…"}
                className="font-mono text-[11px] bg-transparent outline-none placeholder:text-text-muted w-44 text-foreground"
              />
              {searching && <Loader2 className="h-3 w-3 text-accent-bright animate-spin" />}
            </div>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Running / idle state overlays */}
        {status.status === "running" && (
          <div className="flex flex-col items-center justify-center w-full gap-5 px-8 max-w-2xl mx-auto">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 text-accent-bright animate-spin shrink-0" />
              <div>
                <p className="text-[14px] font-semibold text-foreground">Decompiling</p>
                <p className="text-[11px] text-text-muted font-mono mt-0.5">{selectedPkg}</p>
              </div>
            </div>

            {/* Progress bar + phase label */}
            <div className="w-full max-w-sm">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-text-muted font-mono">
                  {decompilePhaseLabel(status.progress, status.log)}
                </span>
                <span className="text-[10px] font-mono text-text-muted/60">
                  {formatElapsed(status.elapsed_ms)}
                </span>
              </div>
              <div className="w-full bg-bg-elevated rounded-full h-1.5 overflow-hidden">
                {(status.progress ?? 0) <= 7 ? (
                  /* Indeterminate shimmer while in loading/processing phase */
                  <div className="h-full w-1/3 bg-accent-bright rounded-full animate-[shimmer_1.4s_ease-in-out_infinite]"
                    style={{ animation: "shimmer 1.4s ease-in-out infinite" }}
                  />
                ) : (
                  <div
                    className="h-full bg-accent-bright rounded-full transition-all duration-500"
                    style={{ width: `${status.progress ?? 2}%` }}
                  />
                )}
              </div>
            </div>

            {/* Live log output */}
            <div className="w-full max-w-sm">
              <div className="font-mono text-[10px] bg-bg-elevated border border-border rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 border-b border-border text-text-muted text-[9px] uppercase tracking-widest">
                  Output
                </div>
                <div className="px-3 py-2 space-y-0.5 min-h-[60px]">
                  {(status.log && status.log.length > 0)
                    ? status.log.slice(-8).map((l, i) => (
                        <div
                          key={i}
                          className={`truncate ${
                            l.startsWith("ERROR") ? "text-[#f85149]"
                            : l.includes("complete") || l.includes("ready") ? "text-good"
                            : l.startsWith("Starting") || l.startsWith("jadx") || l.startsWith("Downloading") || l.startsWith("Download") ? "text-accent-bright"
                            : "text-text-muted"
                          }`}
                          title={l}
                        >
                          {l}
                        </div>
                      ))
                    : <div className="text-text-muted">Waiting for jadx output…</div>
                  }
                </div>
              </div>
            </div>
          </div>
        )}

        {status.status === "error" && (
          <div className="flex flex-col items-center justify-center w-full gap-3">
            <AlertCircle className="h-8 w-8 text-[#f85149]" />
            <p className="text-[14px] font-semibold text-foreground">Decompilation failed</p>
            <pre className="font-mono text-[11px] text-[#f85149] bg-[#f85149]/10 border border-[#f85149]/20 rounded-lg px-4 py-3 max-w-lg w-full overflow-auto">
              {status.error}
            </pre>
            <p className="text-[11px] text-text-muted">
              jadx will be downloaded automatically on retry
            </p>
            <button
              onClick={triggerDecompile}
              className="text-[12px] text-accent-bright border border-accent/20 rounded-lg px-4 py-2 hover:bg-accent/10 transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {status.status === "idle" && selectedPkg && (
          <div className="flex flex-col items-center justify-center w-full gap-4">
            <Code2 className="h-10 w-10 opacity-25 text-text-muted" />
            <div className="text-center">
              <p className="text-[14px] font-medium text-foreground">No source for <span className="font-mono text-accent-bright">{selectedPkg}</span></p>
              <p className="text-[12px] text-text-muted mt-1">Run jadx to decompile the APK</p>
            </div>
            <button
              onClick={triggerDecompile}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent/10 text-accent-bright border border-accent/20 text-[13px] font-medium hover:bg-accent/20 transition-colors cursor-pointer"
            >
              <Code2 className="h-4 w-4" />
              Decompile APK
            </button>
            <p className="text-[11px] text-text-muted">jadx is downloaded automatically if not installed</p>
          </div>
        )}

        {status.status === "ready" && tree && (
          <>
            {/* File tree */}
            <div className="w-64 shrink-0 border-r border-border flex flex-col overflow-hidden">
              <div className="px-3 py-2 border-b border-border/50 shrink-0">
                <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
                  Files · {status.fileCount ?? "?"}
                </span>
              </div>
              <div className="flex-1 overflow-auto py-1 pr-1">
                {tree.children?.map(child => (
                  <FileTreeNode
                    key={child.path || child.name}
                    node={child}
                    depth={0}
                    selectedPath={selectedFile?.path ?? null}
                    pkg={selectedPkg}
                    onSelect={openFile}
                    defaultExpand={false}
                  />
                ))}
              </div>
            </div>

            {/* Source panel */}
            <div className="flex-1 overflow-hidden relative">
              {/* Search results overlay */}
              {showSearchPanel && (
                <SearchResultsPanel
                  results={searchResults ?? []}
                  query={searchQuery}
                  meta={searchMeta}
                  onJump={jumpToFile}
                  onClose={() => setShowSearchPanel(false)}
                />
              )}

              {loadingFile && (
                <div className="absolute inset-0 flex items-center justify-center bg-bg-primary/80 z-10">
                  <Loader2 className="h-6 w-6 animate-spin text-accent-bright" />
                </div>
              )}

              {fileContent && !showSearchPanel && (
                <SourceViewer
                  file={fileContent}
                  searchTerm={searchInput}
                  targetLine={targetLine}
                  pkg={selectedPkg}
                  onJumpToFile={jumpToFile}
                />
              )}

              {!fileContent && !loadingFile && !showSearchPanel && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
                  <ZoomIn className="h-8 w-8 opacity-20" />
                  <p className="text-[12px]">Select a file from the tree to view source</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function SourcePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full text-text-muted text-[13px]">
        Loading…
      </div>
    }>
      <SourcePageInner />
    </Suspense>
  );
}

// communityScripts.ts — fetch + sessionStorage cache for the GitHub-backed script index.

export interface CommunityScriptEntry {
  id: string;
  name: string;
  description: string;
  frameworks: string[];   // ["flutter", "react-native", "cordova", ...] — empty means universal
  tags: string[];         // ["ssl", "bypass", "pinning", ...]
  author: string;
  path: string;           // relative to library/ in repo, e.g. "community/flutter-advanced.js"
  updatedAt?: string;
}

const REPO = "https://raw.githubusercontent.com/pentium-solver/sniff/main";
const INDEX_URL = `${REPO}/library/_index.json`;
const INDEX_CACHE_KEY = "sniff_cs_index";

let indexInflight: Promise<CommunityScriptEntry[]> | null = null;

export async function fetchCommunityScripts(): Promise<CommunityScriptEntry[]> {
  try {
    const cached = sessionStorage.getItem(INDEX_CACHE_KEY);
    if (cached) return JSON.parse(cached) as CommunityScriptEntry[];
  } catch { /* ignore */ }

  if (indexInflight) return indexInflight;

  indexInflight = fetch(INDEX_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<CommunityScriptEntry[]>;
    })
    .then((data) => {
      const entries = Array.isArray(data) ? data : [];
      try { sessionStorage.setItem(INDEX_CACHE_KEY, JSON.stringify(entries)); } catch { /* full */ }
      indexInflight = null;
      return entries;
    })
    .catch(() => {
      indexInflight = null;
      return [] as CommunityScriptEntry[];
    });

  return indexInflight;
}

export async function fetchCommunityScriptContent(path: string): Promise<string> {
  const res = await fetch(`${REPO}/library/${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function invalidateCommunityScripts(): void {
  try { sessionStorage.removeItem(INDEX_CACHE_KEY); } catch { /* ignore */ }
}

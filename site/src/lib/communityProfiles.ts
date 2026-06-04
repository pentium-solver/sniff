// communityProfiles.ts — fetch + sessionStorage cache for the GitHub-backed profile index.

import type { FingerprintProfile } from "./profiles";

// Shape of one entry in profiles/_index.json
export interface CommunityProfileEntry {
  id: string;
  name: string;
  path: string;         // relative to profiles/ in the repo, e.g. "browsers/chrome-130-android.json"
  category?: string;    // "browser" | "app" | "vpn" | etc.
  browser?: string;
  version?: string;
  device?: string;
  os?: string;
  ja4?: string;         // abbreviated — shown in list, not full
  submittedBy?: string;
  updatedAt?: string;
}

const REPO = "https://raw.githubusercontent.com/pentium-solver/sniff/main";
const INDEX_URL = `${REPO}/profiles/_index.json`;
const INDEX_CACHE_KEY = "sniff_cp_index";

let indexInflight: Promise<CommunityProfileEntry[]> | null = null;

export async function fetchCommunityIndex(): Promise<CommunityProfileEntry[]> {
  try {
    const cached = sessionStorage.getItem(INDEX_CACHE_KEY);
    if (cached) return JSON.parse(cached) as CommunityProfileEntry[];
  } catch { /* ignore */ }

  if (indexInflight) return indexInflight;

  indexInflight = fetch(INDEX_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<CommunityProfileEntry[]>;
    })
    .then((data) => {
      const entries = Array.isArray(data) ? data : [];
      try { sessionStorage.setItem(INDEX_CACHE_KEY, JSON.stringify(entries)); } catch { /* full */ }
      indexInflight = null;
      return entries;
    })
    .catch(() => {
      indexInflight = null;
      return [] as CommunityProfileEntry[];
    });

  return indexInflight;
}

export async function fetchCommunityProfile(path: string): Promise<FingerprintProfile> {
  const res = await fetch(`${REPO}/profiles/${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<FingerprintProfile>;
}

export function invalidateCommunityIndex(): void {
  try { sessionStorage.removeItem(INDEX_CACHE_KEY); } catch { /* ignore */ }
}

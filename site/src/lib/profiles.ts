// profiles.ts — localStorage-backed fingerprint profile library.
// Profiles are named, annotated TLS fingerprints saved for reuse.

import type { CapturedFingerprint } from "./types";

const STORAGE_KEY = "sniff_fp_profiles";

export interface FingerprintProfile {
  id: string;
  name: string;
  device?: string;   // "Pixel 4a 5G"
  browser?: string;  // "Brave"
  version?: string;  // "1.74.48"
  os?: string;       // "Android 13"
  notes?: string;
  fingerprint: CapturedFingerprint;
  savedAt: number;
}

export function listProfiles(): FingerprintProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FingerprintProfile[]) : [];
  } catch {
    return [];
  }
}

export function saveProfile(
  p: Omit<FingerprintProfile, "id" | "savedAt">
): FingerprintProfile {
  const profile: FingerprintProfile = {
    ...p,
    id: crypto.randomUUID(),
    savedAt: Date.now(),
  };
  const list = listProfiles();
  list.unshift(profile);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  return profile;
}

export function deleteProfile(id: string): void {
  const list = listProfiles().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function exportProfilesJSON(ids?: string[]): string {
  const list = ids ? listProfiles().filter((p) => ids.includes(p.id)) : listProfiles();
  return JSON.stringify(list, null, 2);
}

export function importProfilesJSON(json: string): number {
  const parsed = JSON.parse(json) as FingerprintProfile[];
  const existing = listProfiles();
  const existingIds = new Set(existing.map((p) => p.id));
  const fresh = parsed.filter((p) => !existingIds.has(p.id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...fresh]));
  return fresh.length;
}

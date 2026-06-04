import { api } from "./api";

export interface DetectedProtection {
  name: string;
  category: "antibot" | "cert-pinning" | "anti-tamper" | "root-detection" | "hook-detection" | "attestation";
  evidence: string[];
}

const STORAGE_KEY = "sniff_pt_cache";

function loadCache(): Record<string, DetectedProtection[]> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, DetectedProtection[]>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch { /* storage full */ }
}

const inflight = new Map<string, Promise<DetectedProtection[]>>();

export function invalidateCachedProtections(pkg: string): void {
  if (!pkg) return;
  try {
    const cache = loadCache();
    delete cache[pkg];
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
  inflight.delete(pkg);
}

export async function detectProtections(pkg: string, force = false): Promise<DetectedProtection[]> {
  if (!pkg) return [];

  if (!force) {
    const cache = loadCache();
    if (cache[pkg]) return cache[pkg];
    if (inflight.has(pkg)) return inflight.get(pkg)!;
  }

  const qs = force ? `&force=1` : "";
  const promise = api<{ protections: DetectedProtection[] }>(
    `/detect/protections?package=${encodeURIComponent(pkg)}${qs}`
  )
    .then((res) => {
      const updated = loadCache();
      updated[pkg] = res.protections ?? [];
      saveCache(updated);
      inflight.delete(pkg);
      return updated[pkg];
    })
    .catch(() => {
      inflight.delete(pkg);
      return [] as DetectedProtection[];
    });

  inflight.set(pkg, promise);
  return promise;
}

export function getCachedProtections(pkg: string): DetectedProtection[] | null {
  if (!pkg) return null;
  return loadCache()[pkg] ?? null;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

export const CATEGORY_COLORS: Record<DetectedProtection["category"], string> = {
  "antibot":        "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "cert-pinning":   "bg-[#f85149]/10 text-[#f85149] border-[#f85149]/20",
  "anti-tamper":    "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "root-detection": "bg-[#d29922]/10 text-[#d29922] border-[#d29922]/20",
  "hook-detection": "bg-[#f85149]/10 text-[#f85149] border-[#f85149]/20",
  "attestation":    "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

export const CATEGORY_LABELS: Record<DetectedProtection["category"], string> = {
  "antibot":        "Antibot",
  "cert-pinning":   "Cert Pinning",
  "anti-tamper":    "Anti-tamper",
  "root-detection": "Root Check",
  "hook-detection": "Hook Detection",
  "attestation":    "Attestation",
};

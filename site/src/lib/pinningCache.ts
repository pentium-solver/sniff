import { api } from "./api";

export interface PinEvidence {
  file: string;    // zip entry / DEX file where pattern was found
  match: string;   // the matching string/pattern
  line?: number;
}

export interface PinMechanism {
  id: string;
  name: string;
  description: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];   // short evidence strings (same shape as protections)
  classes?: string[];   // class names (only available when jadx-based)
}

export interface HardcodedPin {
  hash: string;
  file: string;
  line?: number;
}

export interface PinningAnalysis {
  package: string;
  mechanisms: PinMechanism[];
  pins: HardcodedPin[];
  script: string;
  script_name: string;
  summary: string;
  elapsed_ms: number;
}

const STORAGE_KEY = "sniff_pin_cache";

function loadCache(): Record<string, PinningAnalysis> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, PinningAnalysis>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {}
}

const inflight = new Map<string, Promise<PinningAnalysis>>();

export function getCachedPinning(pkg: string): PinningAnalysis | null {
  if (!pkg) return null;
  return loadCache()[pkg] ?? null;
}

export function invalidateCachedPinning(pkg: string): void {
  if (!pkg) return;
  try {
    const cache = loadCache();
    delete cache[pkg];
    saveCache(cache);
  } catch {}
  inflight.delete(pkg);
}

export async function analyzePinning(
  pkg: string,
  force = false
): Promise<PinningAnalysis> {
  if (!force) {
    const cache = loadCache();
    if (cache[pkg]) return cache[pkg];
    if (inflight.has(pkg)) return inflight.get(pkg)!;
  }

  const qs = force ? "&force=1" : "";
  const promise = api<PinningAnalysis>(
    `/detect/pinning?package=${encodeURIComponent(pkg)}${qs}`
  )
    .then((result) => {
      const cache = loadCache();
      cache[pkg] = result;
      saveCache(cache);
      inflight.delete(pkg);
      return result;
    })
    .catch((e) => {
      inflight.delete(pkg);
      throw e;
    });

  inflight.set(pkg, promise);
  return promise;
}

export const CONFIDENCE_COLORS: Record<PinMechanism["confidence"], string> = {
  high:   "text-bad bg-bad/10 border-bad/20",
  medium: "text-warn bg-warn/10 border-warn/20",
  low:    "text-text-muted bg-bg-tertiary border-border",
};

export const CONFIDENCE_LABELS: Record<PinMechanism["confidence"], string> = {
  high:   "HIGH",
  medium: "MED",
  low:    "LOW",
};

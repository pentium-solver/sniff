import { api } from "./api";

export interface FrameworkResult {
  framework: string;   // "flutter" | "react-native" | "cordova" | "capacitor" | "xamarin" | "unity" | "unreal" | "godot" | "cocos2d" | "nativescript" | "titanium" | "adobe-air" | "libgdx" | "native" | "unknown"
  confidence: string;  // "high" | "medium" | "low"
  indicators: string[];
}

const STORAGE_KEY = "sniff_fw_cache";

function loadCache(): Record<string, FrameworkResult> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, FrameworkResult>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch { /* storage full */ }
}

/** In-flight requests so we don't fire duplicate fetches. */
const inflight = new Map<string, Promise<FrameworkResult>>();

export function invalidateCachedFramework(pkg: string): void {
  if (!pkg) return;
  try {
    const cache = loadCache();
    delete cache[pkg];
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
  inflight.delete(pkg); // also cancel any in-flight dedup
}

export async function detectFramework(pkg: string, force = false): Promise<FrameworkResult> {
  if (!pkg) return { framework: "unknown", confidence: "low", indicators: [] };

  if (!force) {
    const cache = loadCache();
    if (cache[pkg]) return cache[pkg];
    // Deduplicate concurrent calls for the same package.
    if (inflight.has(pkg)) return inflight.get(pkg)!;
  }

  const qs = force ? `&force=1` : "";
  const promise = api<FrameworkResult>(
    `/detect/framework?package=${encodeURIComponent(pkg)}${qs}`
  )
    .then((result) => {
      const updated = loadCache();
      updated[pkg] = result;
      saveCache(updated);
      inflight.delete(pkg);
      return result;
    })
    .catch(() => {
      inflight.delete(pkg);
      return { framework: "unknown", confidence: "low", indicators: [] } as FrameworkResult;
    });

  inflight.set(pkg, promise);
  return promise;
}

export function getCachedFramework(pkg: string): FrameworkResult | null {
  if (!pkg) return null;
  return loadCache()[pkg] ?? null;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

export const FRAMEWORK_LABELS: Record<string, string> = {
  "flutter":       "Flutter",
  "react-native":  "React Native",
  "cordova":       "Cordova",
  "capacitor":     "Capacitor",
  "xamarin":       "Xamarin",
  "unity":         "Unity",
  "unreal":        "Unreal",
  "godot":         "Godot",
  "cocos2d":       "Cocos2d",
  "nativescript":  "NativeScript",
  "titanium":      "Titanium",
  "adobe-air":     "Adobe AIR",
  "libgdx":        "libGDX",
  "native":        "Native",
  "unknown":       "Unknown",
};

export const FRAMEWORK_COLORS: Record<string, string> = {
  "flutter":       "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  "react-native":  "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "cordova":       "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "capacitor":     "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "xamarin":       "bg-blue-600/10 text-blue-300 border-blue-600/20",
  "unity":         "bg-bg-tertiary text-text-secondary border-border",
  "unreal":        "bg-bg-tertiary text-text-secondary border-border",
  "godot":         "bg-blue-400/10 text-blue-300 border-blue-400/20",
  "cocos2d":       "bg-green-500/10 text-green-400 border-green-500/20",
  "nativescript":  "bg-sky-500/10 text-sky-400 border-sky-500/20",
  "titanium":      "bg-gray-500/10 text-gray-400 border-gray-500/20",
  "adobe-air":     "bg-red-500/10 text-red-400 border-red-500/20",
  "libgdx":        "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "native":        "bg-bg-tertiary text-text-muted border-border",
  "unknown":       "bg-bg-tertiary text-text-muted border-border",
};

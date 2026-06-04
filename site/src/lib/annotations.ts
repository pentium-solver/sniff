// annotations.ts — localStorage-backed annotation store for flows and fingerprints.
// Keyed by capture ID (flow._id or fingerprint.id).
// Uses an in-process pub/sub so all useAnnotation hooks re-render on any mutation.

const STORAGE_KEY = "sniff_annotations";

export interface Annotation {
  label?: string;   // custom rename
  pinned: boolean;
  tags: string[];   // e.g. ["auth", "interesting", "token"]
  note?: string;    // freeform text
  updatedAt: number;
}

function defaultAnnotation(): Annotation {
  return { pinned: false, tags: [], updatedAt: 0 };
}

// ── pub/sub ────────────────────────────────────────────────────────────────
const listeners = new Set<() => void>();

export function subscribeAnnotations(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn());
}

// ── storage ────────────────────────────────────────────────────────────────
export function getAllAnnotations(): Record<string, Annotation> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Annotation>) : {};
  } catch {
    return {};
  }
}

export function getAnnotation(id: string): Annotation {
  return getAllAnnotations()[id] ?? defaultAnnotation();
}

export function setAnnotation(id: string, patch: Partial<Annotation>): void {
  const all = getAllAnnotations();
  all[id] = { ...defaultAnnotation(), ...all[id], ...patch, updatedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage quota — fail silently
  }
  notify();
}

export function clearAnnotation(id: string): void {
  const all = getAllAnnotations();
  delete all[id];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
  notify();
}

const STORAGE_KEY = "sniff_backend_url";
const DEFAULT_URL = "http://localhost:9090";

export function getBackendUrl(): string {
  if (typeof window === "undefined") return DEFAULT_URL;
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_URL;
}

export function setBackendUrl(url: string) {
  localStorage.setItem(STORAGE_KEY, url.replace(/\/+$/, ""));
}

export function clearBackendUrl() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isConfigured(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export async function checkHealth(url?: string): Promise<boolean> {
  const base = url || getBackendUrl();
  try {
    const res = await fetch(`${base}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

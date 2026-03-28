import type { Flow, LogEntry } from "./types";
import { getBackendUrl } from "./connection";

function apiBase(): string {
  return getBackendUrl() + "/api";
}

export async function api<T = any>(
  path: string,
  opts?: RequestInit
): Promise<T> {
  const res = await fetch(apiBase() + path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiPost<T = any>(path: string, body: any): Promise<T> {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function apiPut<T = any>(path: string, body: any): Promise<T> {
  return api(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function flowsToHar(flows: Flow[]): object {
  return {
    log: {
      version: "1.2",
      creator: { name: "sniff!", version: "1.0" },
      entries: flows.map((f) => ({
        startedDateTime: new Date(f.ts * 1000).toISOString(),
        time: 0,
        request: {
          method: f.method,
          url: f.url,
          httpVersion: "HTTP/1.1",
          headers: Object.entries(f.req_headers || {}).map(([name, value]) => ({ name, value })),
          queryString: (() => {
            try {
              const u = new URL(f.url);
              const qs: { name: string; value: string }[] = [];
              u.searchParams.forEach((v, k) => qs.push({ name: k, value: v }));
              return qs;
            } catch { return []; }
          })(),
          cookies: [],
          headersSize: -1,
          bodySize: f.req_size || 0,
          ...(f.req_body ? { postData: { mimeType: "application/octet-stream", text: f.req_body } } : {}),
        },
        response: {
          status: f.status,
          statusText: "",
          httpVersion: "HTTP/1.1",
          headers: Object.entries(f.resp_headers || {}).map(([name, value]) => ({ name, value })),
          cookies: [],
          content: {
            size: f.resp_size || 0,
            mimeType: f.content_type || "application/octet-stream",
            text: f.resp_body || "",
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: f.resp_size || 0,
        },
        cache: {},
        timings: { send: 0, wait: 0, receive: 0 },
      })),
    },
  };
}

export function downloadJson(data: object, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatBytes(b: number | null | undefined): string {
  if (b == null || b < 0) return "-";
  if (b === 0) return "0";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " K";
  return (b / (1024 * 1024)).toFixed(1) + " M";
}

export type SSECallbacks = {
  onFlow: (flow: Flow) => void;
  onLog: (entry: LogEntry) => void;
  onState: (state: { capturing: boolean; captureMode: string; captureName: string }) => void;
  onClear: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
};

export function connectSSE(callbacks: SSECallbacks): () => void {
  let es: EventSource | null = null;
  let dead = false;
  let retryTimer: ReturnType<typeof setTimeout>;

  function connect() {
    if (dead) return;
    es = new EventSource(apiBase() + "/events");

    es.addEventListener("open", () => {
      callbacks.onConnect();
    });

    es.addEventListener("error", () => {
      callbacks.onDisconnect();
      es?.close();
      if (!dead) {
        retryTimer = setTimeout(connect, 3000);
      }
    });

    es.addEventListener("flow", (e) => {
      callbacks.onFlow(JSON.parse(e.data));
    });

    es.addEventListener("log", (e) => {
      callbacks.onLog(JSON.parse(e.data));
    });

    es.addEventListener("state", (e) => {
      const s = JSON.parse(e.data);
      callbacks.onState(s);
    });

    es.addEventListener("clear", () => {
      callbacks.onClear();
    });
  }

  connect();

  return () => {
    dead = true;
    clearTimeout(retryTimer);
    es?.close();
  };
}

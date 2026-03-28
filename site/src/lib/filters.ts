import type { Flow } from "./types";

export const resourceTypes = [
  "All",
  "XHR",
  "JS",
  "CSS",
  "Images",
  "Fonts",
  "Media",
  "HTML",
  "Other",
] as const;

export type ResourceType = (typeof resourceTypes)[number];

const extMatch = (url: string, exts: string[]) =>
  exts.some((ext) => {
    const path = url.split("?")[0].toLowerCase();
    return path.endsWith("." + ext);
  });

export function classifyFlow(flow: Flow): ResourceType {
  const ct = (flow.content_type || "").toLowerCase();
  const url = flow.url || "";
  const reqCt =
    flow.req_headers?.["content-type"] ||
    flow.req_headers?.["Content-Type"] ||
    "";

  // HTML
  if (ct.includes("text/html") || extMatch(url, ["html", "htm"])) return "HTML";

  // JS
  if (
    ct.includes("javascript") ||
    ct.includes("ecmascript") ||
    extMatch(url, ["js", "mjs", "cjs", "jsx"])
  )
    return "JS";

  // CSS
  if (ct.includes("text/css") || extMatch(url, ["css"])) return "CSS";

  // Images
  if (
    ct.startsWith("image/") ||
    extMatch(url, ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif", "heic"])
  )
    return "Images";

  // Fonts
  if (
    ct.startsWith("font/") ||
    ct.includes("woff") ||
    ct.includes("opentype") ||
    ct.includes("truetype") ||
    extMatch(url, ["woff", "woff2", "ttf", "otf", "eot"])
  )
    return "Fonts";

  // Media
  if (
    ct.startsWith("audio/") ||
    ct.startsWith("video/") ||
    extMatch(url, ["mp4", "webm", "mp3", "m4a", "mov", "wav", "aac", "ogg"])
  )
    return "Media";

  // XHR — JSON/XML content, or fetch metadata hints
  const xrw =
    flow.req_headers?.["X-Requested-With"] ||
    flow.req_headers?.["x-requested-with"] ||
    "";
  const secDest =
    flow.req_headers?.["Sec-Fetch-Dest"] ||
    flow.req_headers?.["sec-fetch-dest"] ||
    "";
  if (
    ct.includes("json") ||
    ct.includes("xml") ||
    reqCt.toLowerCase().includes("json") ||
    xrw.toLowerCase() === "xmlhttprequest" ||
    secDest === "empty"
  )
    return "XHR";

  return "Other";
}

export function filterByResourceType(flows: Flow[], type: ResourceType): Flow[] {
  if (type === "All") return flows;
  return flows.filter((f) => classifyFlow(f) === type);
}

export interface SearchMatch {
  flowIndex: number;
  field: "url" | "host" | "path" | "req_header" | "resp_header" | "req_body" | "resp_body" | "status";
  key?: string; // header name
  line?: number;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

export function deepSearch(flows: Flow[], query: string): SearchMatch[] {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const matches: SearchMatch[] = [];
  const MAX = 500;

  for (let i = 0; i < flows.length && matches.length < MAX; i++) {
    const f = flows[i];

    // URL
    const urlIdx = f.url.toLowerCase().indexOf(q);
    if (urlIdx >= 0) {
      matches.push({
        flowIndex: i,
        field: "url",
        snippet: f.url,
        matchStart: urlIdx,
        matchEnd: urlIdx + query.length,
      });
    }

    // Status
    if (String(f.status).includes(query)) {
      matches.push({
        flowIndex: i,
        field: "status",
        snippet: String(f.status),
        matchStart: 0,
        matchEnd: query.length,
      });
    }

    // Request headers
    for (const [k, v] of Object.entries(f.req_headers || {})) {
      const valIdx = v.toLowerCase().indexOf(q);
      const keyIdx = k.toLowerCase().indexOf(q);
      if (valIdx >= 0 || keyIdx >= 0) {
        const target = valIdx >= 0 ? v : k;
        const idx = valIdx >= 0 ? valIdx : keyIdx;
        matches.push({
          flowIndex: i,
          field: "req_header",
          key: k,
          snippet: `${k}: ${v}`,
          matchStart: valIdx >= 0 ? k.length + 2 + valIdx : keyIdx,
          matchEnd: (valIdx >= 0 ? k.length + 2 + valIdx : keyIdx) + query.length,
        });
        if (matches.length >= MAX) break;
      }
    }

    // Response headers
    for (const [k, v] of Object.entries(f.resp_headers || {})) {
      const valIdx = v.toLowerCase().indexOf(q);
      const keyIdx = k.toLowerCase().indexOf(q);
      if (valIdx >= 0 || keyIdx >= 0) {
        matches.push({
          flowIndex: i,
          field: "resp_header",
          key: k,
          snippet: `${k}: ${v}`,
          matchStart: valIdx >= 0 ? k.length + 2 + valIdx : keyIdx,
          matchEnd: (valIdx >= 0 ? k.length + 2 + valIdx : keyIdx) + query.length,
        });
        if (matches.length >= MAX) break;
      }
    }

    // Request body
    if (f.req_body) {
      const bodyIdx = f.req_body.toLowerCase().indexOf(q);
      if (bodyIdx >= 0) {
        const start = Math.max(0, bodyIdx - 40);
        const end = Math.min(f.req_body.length, bodyIdx + query.length + 40);
        matches.push({
          flowIndex: i,
          field: "req_body",
          snippet: (start > 0 ? "…" : "") + f.req_body.slice(start, end) + (end < f.req_body.length ? "…" : ""),
          matchStart: bodyIdx - start + (start > 0 ? 1 : 0),
          matchEnd: bodyIdx - start + (start > 0 ? 1 : 0) + query.length,
        });
      }
    }

    // Response body
    if (f.resp_body) {
      const bodyIdx = f.resp_body.toLowerCase().indexOf(q);
      if (bodyIdx >= 0) {
        const start = Math.max(0, bodyIdx - 40);
        const end = Math.min(f.resp_body.length, bodyIdx + query.length + 40);
        matches.push({
          flowIndex: i,
          field: "resp_body",
          snippet: (start > 0 ? "…" : "") + f.resp_body.slice(start, end) + (end < f.resp_body.length ? "…" : ""),
          matchStart: bodyIdx - start + (start > 0 ? 1 : 0),
          matchEnd: bodyIdx - start + (start > 0 ? 1 : 0) + query.length,
        });
      }
    }
  }

  return matches;
}

const RECENT_KEY = "sniff_recent_hars";

export interface RecentHar {
  name: string;
  size: number;
  entryCount: number;
  date: string;
  data: string; // JSON stringified HAR
}

export function getRecentHars(): RecentHar[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveRecentHar(har: RecentHar) {
  const list = getRecentHars().filter((h) => h.name !== har.name);
  list.unshift(har);
  // Keep last 10, but cap total storage (~20MB limit)
  const trimmed = list.slice(0, 10);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full — drop oldest entries
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed.slice(0, 3)));
    } catch {}
  }
}

export function removeRecentHar(name: string) {
  const list = getRecentHars().filter((h) => h.name !== name);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

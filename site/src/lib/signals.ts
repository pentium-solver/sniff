import type { Flow } from "./types";

// ── Types ────────────────────────────────────────────────────────────────────

export type SignalType =
  | "jwt"
  | "bearer"
  | "basic-auth"
  | "api-key"
  | "aws-key"
  | "insecure-http"
  | "grpc";

export interface Signal {
  type: SignalType;
  label: string;
  value: string;
  decoded?: Record<string, unknown>; // jwt: { header, payload }
  location: "req-header" | "resp-header" | "req-body" | "resp-body" | "url";
  headerName?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AWS_KEY_RE = /AKIA[A-Z0-9]{16}/;
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

const API_KEY_HEADERS = new Set([
  "x-api-key", "x-apikey", "api-key", "apikey", "api_key",
  "x-token", "x-access-token", "x-auth-token",
  "x-secret-key", "x-secret", "authorization-token",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function b64url(s: string): string {
  return s.replace(/-/g, "+").replace(/_/g, "/");
}

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(atob(b64url(s)));
    if (j && typeof j === "object") return j;
  } catch { /* not JSON */ }
  return null;
}

function decodeJWT(
  token: string
): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = tryParse(parts[0]);
  const payload = tryParse(parts[1]);
  if (!header || !payload) return null;
  return { header, payload };
}

function formatExpiry(exp: number): string {
  const delta = exp - Math.floor(Date.now() / 1000);
  if (delta < 0) return "expired";
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

function jwtLabel(decoded: { header: Record<string, unknown>; payload: Record<string, unknown> }): string {
  const alg = (decoded.header.alg as string) ?? "?";
  const exp = decoded.payload.exp;
  const expPart = typeof exp === "number" ? `, exp: ${formatExpiry(exp)}` : "";
  const sub = decoded.payload.sub;
  const subPart = typeof sub === "string" ? `, sub: ${sub.slice(0, 20)}` : "";
  return `JWT (alg: ${alg}${expPart}${subPart})`;
}

function isApiKeyHeader(name: string): boolean {
  const l = name.toLowerCase();
  return API_KEY_HEADERS.has(l) || l.includes("api-key") || l.includes("api_key") || l.includes("apikey");
}

function pushAwsKey(
  text: string,
  location: Signal["location"],
  headerName: string | undefined,
  out: Signal[]
): void {
  const m = text.match(AWS_KEY_RE);
  if (m) {
    out.push({
      type: "aws-key",
      label: "AWS Access Key ID",
      value: m[0],
      location,
      headerName,
    });
  }
}

function scanBodyForJWTs(text: string, location: Signal["location"], out: Signal[]): void {
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  JWT_RE.lastIndex = 0;
  while ((match = JWT_RE.exec(text)) !== null) {
    const token = match[0];
    if (seen.has(token)) continue;
    seen.add(token);
    const decoded = decodeJWT(token);
    if (!decoded) continue;
    out.push({
      type: "jwt",
      label: jwtLabel(decoded),
      value: token,
      decoded: { header: decoded.header, payload: decoded.payload },
      location,
    });
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function detectSignals(flow: Flow): Signal[] {
  const out: Signal[] = [];

  // ── URL ──────────────────────────────────────────────────────────────────
  if (flow.url?.startsWith("http://")) {
    out.push({
      type: "insecure-http",
      label: "Unencrypted HTTP",
      value: flow.url,
      location: "url",
    });
  }

  // ── Request headers ───────────────────────────────────────────────────────
  for (const [k, v] of Object.entries(flow.req_headers ?? {})) {
    const lower = k.toLowerCase();

    if (lower === "authorization") {
      const lv = v.toLowerCase();
      if (lv.startsWith("bearer ")) {
        const token = v.slice(7).trim();
        const decoded = decodeJWT(token);
        if (decoded) {
          out.push({
            type: "jwt",
            label: jwtLabel(decoded),
            value: token,
            decoded: { header: decoded.header, payload: decoded.payload },
            location: "req-header",
            headerName: k,
          });
        } else {
          out.push({
            type: "bearer",
            label: "Bearer token",
            value: token,
            location: "req-header",
            headerName: k,
          });
        }
      } else if (lv.startsWith("basic ")) {
        try {
          const decoded = atob(v.slice(6).trim());
          const user = decoded.split(":")[0];
          out.push({
            type: "basic-auth",
            label: `Basic auth — user: ${user}`,
            value: decoded,
            location: "req-header",
            headerName: k,
          });
        } catch { /* invalid base64 */ }
      }
      continue;
    }

    if (lower === "content-type" && v.toLowerCase().startsWith("application/grpc")) {
      out.push({ type: "grpc", label: "gRPC request", value: v, location: "req-header", headerName: k });
      continue;
    }

    if (isApiKeyHeader(lower) && v.length >= 20) {
      out.push({
        type: "api-key",
        label: `API key (${k})`,
        value: v,
        location: "req-header",
        headerName: k,
      });
    }

    pushAwsKey(v, "req-header", k, out);
  }

  // ── Response headers ──────────────────────────────────────────────────────
  for (const [k, v] of Object.entries(flow.resp_headers ?? {})) {
    const lower = k.toLowerCase();
    if (lower === "content-type" && v.toLowerCase().startsWith("application/grpc")) {
      if (!out.some((s) => s.type === "grpc")) {
        out.push({ type: "grpc", label: "gRPC response", value: v, location: "resp-header", headerName: k });
      }
    }
    pushAwsKey(v, "resp-header", k, out);
  }

  // ── Bodies ────────────────────────────────────────────────────────────────
  if (flow.req_body) {
    scanBodyForJWTs(flow.req_body, "req-body", out);
    pushAwsKey(flow.req_body, "req-body", undefined, out);
  }
  if (flow.resp_body) {
    scanBodyForJWTs(flow.resp_body, "resp-body", out);
    pushAwsKey(flow.resp_body, "resp-body", undefined, out);
  }

  return out;
}

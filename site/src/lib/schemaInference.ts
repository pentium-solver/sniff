import type { Flow } from "./types";

// ── Schema types ──────────────────────────────────────────────────────────────

export type FieldType = "string" | "number" | "boolean" | "null" | "object" | "array" | "mixed";
export type EntropyClass = "static" | "dynamic" | "high-entropy";

export interface FieldSchema {
  type: FieldType;
  nullable: boolean;
  example?: unknown;
  children?: Record<string, FieldSchema>;
  items?: FieldSchema;
  entropy?: EntropyClass;
  format?: string; // "uuid" | "date-time" | "uri" | "email"
}

export interface HeaderAnalysis {
  name: string;
  entropy: EntropyClass;
  pattern?: string; // "jwt" | "bearer" | "basic-auth" | "uuid" | "hmac-sha256" | "hmac-sha512" | "base64" | "timestamp"
  example?: string;
  sampleValues: string[];
}

export interface EndpointSchema {
  method: string;
  path: string;
  host: string;
  requestHeaders: HeaderAnalysis[];
  requestBody: Record<string, FieldSchema> | null;
  responses: Record<number, { body: Record<string, FieldSchema> | null }>;
  sampleCount: number;
  authRequired: boolean;
}

// ── Type inference ────────────────────────────────────────────────────────────

function inferType(v: unknown): FieldType {
  if (v === null) return "null";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  return "string";
}

function inferFormat(v: string): string | undefined {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return "uuid";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return "date-time";
  if (/^https?:\/\//.test(v)) return "uri";
  if (/^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/.test(v)) return "email";
  return undefined;
}

function buildSchema(v: unknown): FieldSchema {
  const type = inferType(v);
  const schema: FieldSchema = { type, nullable: type === "null" };

  if (type !== "null" && v !== undefined) schema.example = v;

  if (type === "string" && typeof v === "string") {
    const fmt = inferFormat(v);
    if (fmt) schema.format = fmt;
  }

  if (type === "object" && v !== null && typeof v === "object" && !Array.isArray(v)) {
    schema.children = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      schema.children[k] = buildSchema(val);
    }
  }

  if (type === "array" && Array.isArray(v) && v.length > 0) {
    schema.items = buildSchema(v[0]);
    for (let i = 1; i < Math.min(v.length, 5); i++) {
      schema.items = mergeFieldSchema(schema.items, buildSchema(v[i]));
    }
  }

  return schema;
}

function mergeFieldSchema(a: FieldSchema, b: FieldSchema): FieldSchema {
  if (a.type === b.type) {
    const merged: FieldSchema = {
      type: a.type,
      nullable: a.nullable || b.nullable,
      example: a.example ?? b.example,
      format: a.format ?? b.format,
    };

    if (a.type === "object" && a.children && b.children) {
      merged.children = { ...a.children };
      for (const [k, bSchema] of Object.entries(b.children)) {
        if (merged.children[k]) {
          merged.children[k] = mergeFieldSchema(merged.children[k], bSchema);
        } else {
          merged.children[k] = { ...bSchema, nullable: true };
        }
      }
      for (const k of Object.keys(a.children)) {
        if (!b.children[k] && merged.children[k]) {
          merged.children[k] = { ...merged.children[k], nullable: true };
        }
      }
    }

    if (a.type === "array" && a.items && b.items) {
      merged.items = mergeFieldSchema(a.items, b.items);
    }

    return merged;
  }

  // Different types — handle null specially
  if (a.type === "null") return { ...b, nullable: true };
  if (b.type === "null") return { ...a, nullable: true };

  return { type: "mixed", nullable: a.nullable || b.nullable, example: a.example ?? b.example };
}

function mergeBodySchema(
  existing: Record<string, FieldSchema>,
  incoming: Record<string, FieldSchema>
): Record<string, FieldSchema> {
  const merged = { ...existing };
  for (const [k, s] of Object.entries(incoming)) {
    if (merged[k]) merged[k] = mergeFieldSchema(merged[k], s);
    else merged[k] = { ...s, nullable: true };
  }
  // Fields in existing but not incoming become optional
  for (const k of Object.keys(existing)) {
    if (!incoming[k]) merged[k] = { ...merged[k], nullable: true };
  }
  return merged;
}

// ── Header entropy analysis ───────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT_RE  = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SHA512_RE = /^[0-9a-f]{128}$/;
const B64_RE  = /^[A-Za-z0-9+/=]{32,}$/;
const UNIX_TS_RE = /^\d{10}$|^\d{13}$/;

function detectHeaderPattern(values: string[]): string | undefined {
  const s = (values[0] ?? "").trim();
  if (JWT_RE.test(s)) return "jwt";
  if (/^Bearer /.test(s)) return "bearer";
  if (/^Basic /.test(s)) return "basic-auth";
  if (SHA256_RE.test(s)) return "hmac-sha256";
  if (SHA512_RE.test(s)) return "hmac-sha512";
  if (UUID_RE.test(s)) return "uuid";
  if (UNIX_TS_RE.test(s)) return "timestamp";
  if (B64_RE.test(s) && !values.every(v => v === s)) return "base64";
  return undefined;
}

function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let e = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

function classifyHeaderEntropy(values: string[]): EntropyClass {
  if (values.length === 0) return "static";
  if (values.every(v => v === values[0])) return "static";

  const s = (values[0] ?? "").trim();
  if (JWT_RE.test(s) || SHA256_RE.test(s) || SHA512_RE.test(s)) return "high-entropy";

  const ent = shannonEntropy(s);
  if (ent > 4.5) return "high-entropy";
  return "dynamic";
}

// ── Main export ───────────────────────────────────────────────────────────────

const SKIP_HEADERS = new Set([
  "content-length", "transfer-encoding", "connection", "host",
  ":method", ":path", ":scheme", ":authority", "accept-encoding",
]);

export function inferSchema(flows: Flow[]): EndpointSchema[] {
  type GroupEntry = { flows: Flow[]; method: string; path: string; host: string };
  const groups = new Map<string, GroupEntry>();

  for (const flow of flows) {
    let p = flow.path;
    if (!p) {
      try { p = new URL(flow.url).pathname; } catch { p = "/"; }
    }
    const key = `${flow.host}\x00${flow.method}\x00${p}`;
    let g = groups.get(key);
    if (!g) {
      g = { flows: [], method: flow.method, path: p, host: flow.host };
      groups.set(key, g);
    }
    if (g.flows.length < 50) g.flows.push(flow);
  }

  const result: EndpointSchema[] = [];

  for (const g of groups.values()) {
    // ── Collect header values ────────────────────────────────────────────────
    const headerValues = new Map<string, string[]>();
    for (const flow of g.flows) {
      for (const [k, v] of Object.entries(flow.req_headers ?? {})) {
        if (SKIP_HEADERS.has(k.toLowerCase())) continue;
        const arr = headerValues.get(k) ?? [];
        if (arr.length < 15) {
          if (!arr.includes(v)) arr.push(v);
          headerValues.set(k, arr);
        }
      }
    }

    const requestHeaders: HeaderAnalysis[] = [];
    for (const [name, values] of headerValues.entries()) {
      requestHeaders.push({
        name,
        entropy: classifyHeaderEntropy(values),
        pattern: detectHeaderPattern(values),
        example: values[0],
        sampleValues: values.slice(0, 5),
      });
    }
    // High-entropy first so they float to the top
    const rank: Record<EntropyClass, number> = { "high-entropy": 0, dynamic: 1, static: 2 };
    requestHeaders.sort((a, b) => rank[a.entropy] - rank[b.entropy] || a.name.localeCompare(b.name));

    // ── Auth check ───────────────────────────────────────────────────────────
    const authRequired = g.flows.some(f =>
      Object.keys(f.req_headers ?? {}).some(k => {
        const lk = k.toLowerCase();
        return lk === "authorization" || lk === "x-api-key" || lk === "x-auth-token";
      })
    );

    // ── Request body ─────────────────────────────────────────────────────────
    let requestBody: Record<string, FieldSchema> | null = null;
    for (const flow of g.flows) {
      if (!flow.req_body) continue;
      try {
        const parsed = JSON.parse(flow.req_body);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const flowSchema: Record<string, FieldSchema> = {};
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            flowSchema[k] = buildSchema(v);
          }
          requestBody = requestBody ? mergeBodySchema(requestBody, flowSchema) : flowSchema;
        }
      } catch { /* not JSON */ }
    }

    // ── Response schemas ─────────────────────────────────────────────────────
    const responses: Record<number, { body: Record<string, FieldSchema> | null }> = {};
    for (const flow of g.flows) {
      if (!responses[flow.status]) responses[flow.status] = { body: null };
      if (!flow.resp_body) continue;
      try {
        const parsed = JSON.parse(flow.resp_body);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const flowSchema: Record<string, FieldSchema> = {};
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            flowSchema[k] = buildSchema(v);
          }
          const cur = responses[flow.status].body;
          responses[flow.status].body = cur ? mergeBodySchema(cur, flowSchema) : flowSchema;
        }
      } catch { /* not JSON */ }
    }

    result.push({
      method: g.method,
      path: g.path,
      host: g.host,
      requestHeaders,
      requestBody,
      responses,
      sampleCount: g.flows.length,
      authRequired,
    });
  }

  return result;
}

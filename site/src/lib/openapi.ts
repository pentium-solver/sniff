import type { EndpointSchema, FieldSchema } from "./schemaInference";

// ── OpenAPI schema node ───────────────────────────────────────────────────────

interface OASSchema {
  type?: string;
  format?: string;
  nullable?: boolean;
  example?: unknown;
  properties?: Record<string, OASSchema>;
  additionalProperties?: boolean;
  items?: OASSchema;
  description?: string;
}

function fieldToOAS(f: FieldSchema): OASSchema {
  if (f.type === "mixed" || f.type === "null") {
    return { type: "string", nullable: true, description: "mixed type" };
  }

  const s: OASSchema = {};

  if (f.type === "object") {
    s.type = "object";
    if (f.children && Object.keys(f.children).length > 0) {
      s.properties = {};
      for (const [k, v] of Object.entries(f.children)) {
        s.properties[k] = fieldToOAS(v);
      }
    } else {
      s.additionalProperties = true;
    }
  } else if (f.type === "array") {
    s.type = "array";
    s.items = f.items ? fieldToOAS(f.items) : { type: "string" };
  } else {
    s.type = f.type; // string | number | boolean
  }

  if (f.format) s.format = f.format;
  if (f.nullable) s.nullable = true;
  if (f.example !== undefined && f.example !== null) {
    // Only include primitive examples to keep the output readable
    if (typeof f.example !== "object") s.example = f.example;
  }

  return s;
}

// ── Minimal YAML serializer ───────────────────────────────────────────────────

function needsQuote(s: string): boolean {
  return (
    s === "" ||
    /^[\s]|[\s]$/.test(s) ||
    /[:{}[\],#|>&*!?@`%"']/.test(s) ||
    /^\d/.test(s) ||
    s === "true" || s === "false" || s === "null" || s === "~"
  );
}

function yStr(s: string): string {
  return needsQuote(s) ? `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"` : s;
}

function yScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return yStr(v);
  return String(v);
}

function dumpYAML(v: unknown, indent: number, inlineThreshold = 3): string {
  const pad = " ".repeat(indent);

  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return yScalar(v);

  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return v.map(item => {
      const dumped = dumpYAML(item, indent + 2);
      if (dumped.includes("\n")) {
        return `\n${pad}- ${dumped.trimStart()}`;
      }
      return `\n${pad}- ${dumped}`;
    }).join("");
  }

  // Object
  const entries = Object.entries(v as Record<string, unknown>).filter(([, val]) => val !== undefined);
  if (entries.length === 0) return "{}";

  return entries.map(([k, val]) => {
    const key = yStr(k);
    if (val === null || val === undefined) return `\n${pad}${key}: null`;
    if (typeof val !== "object") return `\n${pad}${key}: ${yScalar(val)}`;
    const dumped = dumpYAML(val, indent + 2, inlineThreshold);
    if (dumped === "{}") return `\n${pad}${key}: {}`;
    if (dumped === "[]") return `\n${pad}${key}: []`;
    return `\n${pad}${key}:${dumped}`;
  }).join("");
}

// ── OpenAPI builder ───────────────────────────────────────────────────────────

function parametersFromPath(path: string): { name: string; in: string; required: boolean; schema: { type: string } }[] {
  const params: { name: string; in: "path"; required: true; schema: { type: "string" } }[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    params.push({ name: m[1], in: "path", required: true, schema: { type: "string" } });
  }
  return params;
}

function securityScheme(endpoints: EndpointSchema[]) {
  const schemes: Record<string, unknown> = {};
  const authHeaders = new Set<string>();

  for (const ep of endpoints) {
    for (const h of ep.requestHeaders) {
      const lk = h.name.toLowerCase();
      if (lk === "authorization") {
        if (h.pattern === "bearer" || h.pattern === "jwt") {
          authHeaders.add("bearerAuth");
        } else {
          authHeaders.add("apiKeyAuth");
        }
      } else if (lk === "x-api-key" || lk === "x-auth-token") {
        authHeaders.add("apiKeyHeader");
      }
    }
  }

  if (authHeaders.has("bearerAuth")) {
    schemes["bearerAuth"] = { type: "http", scheme: "bearer", bearerFormat: "JWT" };
  }
  if (authHeaders.has("apiKeyAuth")) {
    schemes["apiKeyAuth"] = { type: "http", scheme: "bearer" };
  }
  if (authHeaders.has("apiKeyHeader")) {
    schemes["apiKeyHeader"] = { type: "apiKey", in: "header", name: "X-Api-Key" };
  }

  return Object.keys(schemes).length > 0 ? schemes : undefined;
}

export interface OpenAPIDoc {
  yaml: string;
  json: string;
}

export function generateOpenAPI(endpoints: EndpointSchema[], appName = "Captured API"): OpenAPIDoc {
  // Group by host → normalize paths
  const hostGroups = new Map<string, EndpointSchema[]>();
  for (const ep of endpoints) {
    const arr = hostGroups.get(ep.host) ?? [];
    arr.push(ep);
    hostGroups.set(ep.host, arr);
  }

  // Pick primary host (most endpoints)
  let primaryHost = "";
  let maxCount = 0;
  for (const [host, eps] of hostGroups.entries()) {
    if (eps.length > maxCount) { maxCount = eps.length; primaryHost = host; }
  }

  const schemes = securityScheme(endpoints);

  // Build paths object
  const paths: Record<string, Record<string, unknown>> = {};

  for (const ep of endpoints) {
    const normPath = ep.path || "/";
    if (!paths[normPath]) paths[normPath] = {};

    const method = ep.method.toLowerCase();
    const params = parametersFromPath(normPath);

    // Query params from history (not currently tracked per endpoint, skip)
    const operation: Record<string, unknown> = {
      summary: `${ep.method} ${normPath}`,
      "x-sniff-host": ep.host,
      "x-sniff-samples": ep.sampleCount,
      parameters: params.length > 0 ? params : undefined,
    };

    // Request body
    if (ep.requestBody && ["post", "put", "patch"].includes(method)) {
      const props: Record<string, OASSchema> = {};
      for (const [k, v] of Object.entries(ep.requestBody)) {
        props[k] = fieldToOAS(v);
      }
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", properties: props },
          },
        },
      };
    }

    // Responses
    const responsesBlock: Record<string, unknown> = {};
    for (const [code, resp] of Object.entries(ep.responses)) {
      const statusDesc = Number(code) < 300 ? "OK"
        : Number(code) < 400 ? "Redirect"
        : Number(code) < 500 ? "Client Error"
        : "Server Error";

      if (resp.body) {
        const props: Record<string, OASSchema> = {};
        for (const [k, v] of Object.entries(resp.body)) {
          props[k] = fieldToOAS(v);
        }
        responsesBlock[String(code)] = {
          description: statusDesc,
          content: {
            "application/json": {
              schema: { type: "object", properties: props },
            },
          },
        };
      } else {
        responsesBlock[String(code)] = { description: statusDesc };
      }
    }
    if (Object.keys(responsesBlock).length === 0) {
      responsesBlock["200"] = { description: "OK" };
    }
    operation.responses = responsesBlock;

    if (ep.authRequired && schemes) {
      const schemeNames = Object.keys(schemes).map(k => ({ [k]: [] }));
      operation.security = schemeNames;
    }

    paths[normPath][method] = operation;
  }

  const servers = [...hostGroups.keys()].map(h => ({
    url: `https://${h}`,
    description: h,
  }));

  const doc: Record<string, unknown> = {
    openapi: "3.0.0",
    info: {
      title: appName,
      version: "captured",
      description: `Auto-generated by sniff! from ${endpoints.reduce((s, e) => s + e.sampleCount, 0)} captured flows. Fields marked x-sniff-* are metadata.`,
    },
    "x-sniff-generated": true,
    servers,
    paths,
  };

  if (schemes) {
    doc.components = { securitySchemes: schemes };
  }

  const json = JSON.stringify(doc, null, 2);

  // YAML — build manually for readability
  const lines: string[] = [
    `openapi: "3.0.0"`,
    `info:`,
    `  title: ${yStr(appName)}`,
    `  version: "captured"`,
    `  description: ${yStr(`Auto-generated by sniff! from ${endpoints.reduce((s, e) => s + e.sampleCount, 0)} captured flows`)}`,
    `x-sniff-generated: true`,
    `servers:`,
    ...servers.map(s => `  - url: ${yStr(s.url)}\n    description: ${yStr(s.description)}`),
    `paths:`,
  ];

  for (const [path, methods] of Object.entries(paths)) {
    lines.push(`  ${yStr(path)}:`);
    for (const [method, op] of Object.entries(methods)) {
      lines.push(`    ${method}:`);
      const o = op as Record<string, unknown>;
      lines.push(`      summary: ${yStr(o.summary as string)}`);
      if ((o["x-sniff-host"] as string)) lines.push(`      x-sniff-host: ${yStr(o["x-sniff-host"] as string)}`);
      if ((o["x-sniff-samples"] as number)) lines.push(`      x-sniff-samples: ${o["x-sniff-samples"]}`);
      if (o.parameters && Array.isArray(o.parameters) && o.parameters.length > 0) {
        lines.push(`      parameters:`);
        for (const p of o.parameters as { name: string; in: string; required: boolean; schema: { type: string } }[]) {
          lines.push(`        - name: ${p.name}`);
          lines.push(`          in: ${p.in}`);
          lines.push(`          required: ${p.required}`);
          lines.push(`          schema:`);
          lines.push(`            type: ${p.schema.type}`);
        }
      }
      if (o.requestBody) {
        lines.push(...dumpYAML({ requestBody: o.requestBody }, 6).split("\n").filter(Boolean).map(l => "      " + l.trimStart() !== l ? l : "      " + l));
      }
      // Responses
      lines.push(`      responses:`);
      const resps = o.responses as Record<string, { description: string; content?: unknown }>;
      for (const [code, resp] of Object.entries(resps)) {
        lines.push(`        "${code}":`);
        lines.push(`          description: ${yStr(resp.description)}`);
        if (resp.content) {
          lines.push(`          content:`);
          lines.push(`            application/json:`);
          lines.push(`              schema:`);
          lines.push(`                type: object`);
          const schema = (resp.content as { "application/json": { schema: { properties: Record<string, OASSchema> } } })["application/json"]?.schema;
          if (schema?.properties) {
            lines.push(`                properties:`);
            for (const [field, fSchema] of Object.entries(schema.properties)) {
              lines.push(`                  ${yStr(field)}:`);
              lines.push(`                    type: ${(fSchema as OASSchema).type ?? "string"}`);
              if ((fSchema as OASSchema).format) lines.push(`                    format: ${(fSchema as OASSchema).format}`);
              if ((fSchema as OASSchema).nullable) lines.push(`                    nullable: true`);
            }
          }
        }
      }
    }
  }

  if (schemes) {
    lines.push(`components:`);
    lines.push(`  securitySchemes:`);
    for (const [name, scheme] of Object.entries(schemes)) {
      lines.push(`    ${name}:`);
      const s = scheme as Record<string, string>;
      for (const [k, v] of Object.entries(s)) {
        lines.push(`      ${k}: ${yStr(v)}`);
      }
    }
  }

  return { yaml: lines.join("\n") + "\n", json };
}

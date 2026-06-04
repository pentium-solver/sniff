# sniff! — Reverse Engineering Roadmap

Static analysis + dynamic correlation. The goal is to make sniff! the tool
that closes the loop between captured traffic and the source that generated it.
Every feature below flows from that north star.

---

## Current State (baseline)

- Live HTTPS traffic capture via mitmdump + Frida SSL unpinning
- TLS fingerprint capture (JA4/JA3)
- Flow viewer with JWT/secret detection, edit+replay, notes/tags/pins
- API Map: deduplicated METHOD+path surface from live traffic
- APK analysis: framework detection (14 frameworks) + protection detection (35 SDKs)
- Secrets page: cross-flow aggregation of keys, tokens, credentials

---

## Phase E — Reverse Engineering Core

### E1. API Schema Inference + OpenAPI Export

**What it does:**
Turns captured traffic into structured API documentation automatically.
Every JSON request and response body across all flows is parsed, merged per
endpoint, and turned into a typed schema. Export as OpenAPI 3.0 YAML.

**Why it matters:**
Passive API documentation from 10 minutes of app usage. Useful even for
non-security work (mobile devs documenting their own backend, QA teams,
partner integrations). Makes the API Map page genuinely useful rather than
just a deduplicated list of paths.

**Technical implementation:**

*Frontend (`site/src/app/dashboard/api-map/page.tsx` + new `schemaInference.ts`):*

```typescript
// lib/schemaInference.ts
interface FieldSchema {
  type: "string" | "number" | "boolean" | "null" | "object" | "array" | "mixed";
  nullable: boolean;
  example?: unknown;
  children?: Record<string, FieldSchema>; // for objects
  items?: FieldSchema;                    // for arrays
  entropy?: "static" | "dynamic" | "high-entropy"; // computed from sample variance
}

interface EndpointSchema {
  method: string;
  path: string;
  host: string;
  requestHeaders: Record<string, FieldSchema>;
  requestBody?: Record<string, FieldSchema>;
  responses: Record<number, { body?: Record<string, FieldSchema> }>; // keyed by status
  sampleCount: number;
  authRequired: boolean; // any sample had Authorization header
}

function inferSchema(flows: Flow[]): EndpointSchema[]
function mergeSchema(a: FieldSchema, b: FieldSchema): FieldSchema
function fieldEntropy(values: unknown[]): "static" | "dynamic" | "high-entropy"
  // static: all values identical
  // dynamic: values change but low entropy (incrementing counters, timestamps)
  // high-entropy: base64/hex of 20+ chars, UUID format, HMAC-length strings
```

*API Map page upgrades:*
- Schema panel opens when you click an endpoint (right-side drawer or expanded row)
- Request schema: table of field name / type / entropy / example value
- Response schema: same, per status code
- "Export OpenAPI" button: generates YAML blob download
  - Correct `paths`, `requestBody` (application/json), `responses` sections
  - `securitySchemes` auto-detected from Authorization header patterns
  - `servers` populated from captured host
- Header entropy column: per-header badges — `static` (gray) / `dynamic` (yellow) / `⚡ computed` (orange)
  - A header that changes on every request to the same endpoint is likely a signature or token

*OpenAPI YAML structure:*
```yaml
openapi: "3.0.0"
info:
  title: "{AppName} API"
  version: "captured"
servers:
  - url: "https://{host}"
paths:
  /v2/users/{userId}:
    get:
      parameters:
        - name: userId
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: string }
                  name: { type: string }
```

**Files changed:**
- `site/src/lib/schemaInference.ts` — new
- `site/src/app/dashboard/api-map/page.tsx` — schema panel + export
- `site/src/app/dashboard/api-map/SchemaPanel.tsx` — new component
- `site/src/lib/openapi.ts` — new, YAML serializer

---

### E2. APK Decompilation (jadx integration)

**What it does:**
Runs jadx on the pulled APK, streams progress, caches the output tree on disk.
Exposes the decompiled source via a file-tree API so the frontend can render
a navigable, searchable source viewer.

**Why it matters:**
Every other feature in this phase — Retrofit mapping, signature reversal, POW
analysis — needs the decompiled source. This is the keystone. Without it,
everything is inference from traffic. With it, we can show "here is the exact
method that built this request."

**Dependencies:**
- jadx: `brew install jadx` or download from https://github.com/skylot/jadx/releases
- sniff installs it automatically if missing (same pattern as other tools)
- Output cached at `~/.sniff/jadx/{pkg}/` — persistent across server restarts
- Large APKs (100+ MB) take 20–60s to decompile; progress streamed via SSE

**New Go routes (`web.go`):**

```
POST /api/decompile
  body: { "package": "com.example.app" }
  → starts decompilation job, returns { "jobId": "..." }
  → pulls APK via getOrPullAPK() then runs jadx subprocess
  → output written to ~/.sniff/jadx/com_example_app/

GET  /api/decompile/status?package=com.example.app
  → SSE stream: { "event": "progress", "data": "Decompiling 42%" }
             or { "event": "done", "data": { "fileCount": 1847 } }
             or { "event": "error", "data": "jadx not found" }

GET  /api/decompile/tree?package=com.example.app
  → returns directory tree as JSON:
    { "name": "com", "children": [ { "name": "example", "children": [...] } ] }

GET  /api/decompile/file?package=com.example.app&path=com/example/api/ApiService.java
  → returns { "content": "public interface ApiService { ... }" }

GET  /api/decompile/search?package=com.example.app&q=getUserProfile
  → full-text grep of decompiled output
  → returns [ { "file": "...", "line": 42, "match": "getUserProfile(...)" } ]
```

**Go implementation notes:**

```go
// Decompile job manager — at most one job per package concurrently
type decompileJob struct {
    pkg      string
    outDir   string
    started  time.Time
    done     chan struct{}
    err      error
    progress atomic.Int32 // 0–100
}

var (
    decompileMu   sync.Mutex
    decompileJobs = map[string]*decompileJob{}
)

func jadxBinary() (string, error) {
    // Check PATH, ~/.sniff/bin/jadx, then offer to download
}

func runDecompile(pkg, apkPath, outDir string) error {
    cmd := exec.CommandContext(ctx, "jadx",
        "--deobf",           // deobfuscation pass
        "--deobf-min", "3",  // minimum name length to deobf
        "-d", outDir,
        apkPath,
    )
    // Stream stderr to progress channel (jadx prints "INFO  - done: N%" lines)
}
```

**Frontend — new page `site/src/app/dashboard/source/page.tsx`:**

Layout: VS Code–style split
- Left: file tree (collapsible, icon per type — `.java` vs `.kt` vs `.xml`)
- Right: source viewer
  - Syntax highlighted (use a lightweight highlighter, `highlight.js` or `prism`)
  - Line numbers
  - "Find in file" (Ctrl+F)
  - Breadcrumb: `com > example > api > ApiService.java`
- Toolbar: search box → hits across entire codebase → click to jump to file+line

**Sidebar entry:** `{ href: "/dashboard/source", icon: Code2, label: "Source" }`

**Decompile trigger:**
- Apps page "Analyze APK" button gets a second option: "Decompile" 
- Or: Source page shows "No source yet" empty state with a Decompile button
- Progress shown as a progress bar with live percentage from SSE

**Caching:**
- `~/.sniff/jadx/{safe_pkg}/` persists forever (decompiling a 100MB APK once is enough)
- Status endpoint returns `{ "ready": true }` immediately if outDir exists
- Manual "re-decompile" button to invalidate and re-run

---

### E3. Retrofit API Mapping

**What it does:**
After decompilation, scans the source for Retrofit interface annotations and
extracts the complete declared API surface — including endpoints never called
during a capture session. Correlates with live traffic.

**Why it matters:**
Live traffic only shows what the app actually called during your session.
Retrofit extraction shows everything it CAN call. Unauthenticated endpoints,
admin functions, deprecated v1 paths, debug endpoints — all show up here even
if they were never triggered in testing.

**Retrofit annotation patterns to extract:**

```java
// Standard Retrofit 2
@GET("v2/feed")
@POST("users/{userId}/follow")
@PUT("posts/{postId}")
@DELETE("messages/{messageId}")
@PATCH("profile")
@HEAD("health")

// With base URL override
@GET("https://cdn.example.com/assets/{assetId}")

// Headers
@Headers({"X-App-Platform: android", "Content-Type: application/json"})

// Parameters
Call<Response> getUser(
    @Path("userId") String userId,
    @Query("fields") String fields,
    @Header("X-Session-Token") String token,
    @Body UserUpdateRequest body
)
```

**Go extraction (`web.go` or new `retrofit.go`):**

```
GET /api/retrofit?package=com.example.app
→ Scans ~/.sniff/jadx/{pkg}/ for all .java and .kt files
→ Parses Retrofit annotations with regex + basic AST traversal
→ Returns:
{
  "endpoints": [
    {
      "method": "GET",
      "path": "/v2/feed",
      "fullClass": "com.example.api.FeedService",
      "methodName": "getFeed",
      "pathParams": ["userId"],
      "queryParams": ["limit", "cursor"],
      "headers": ["X-Session-Token"],
      "bodyType": null,
      "returnType": "FeedResponse",
      "sourceFile": "com/example/api/FeedService.java",
      "sourceLine": 42
    }
  ],
  "baseUrls": ["https://api.example.com/", "https://cdn.example.com/"]
}
```

**Extraction strategy:**
1. Find all files containing `@GET`, `@POST`, etc.
2. For each annotation, extract the URL pattern string
3. Walk back to the method signature to find `@Path`, `@Query`, `@Header`, `@Body`
4. Walk back further to find the interface declaration and any `@Headers` class-level annotations
5. Look for `Retrofit.Builder()` calls in the same package to find base URLs

**Frontend — Retrofit tab on API Map page:**
- Toggle between "Live Traffic" and "Declared (Retrofit)"
- Declared view shows all extracted endpoints, including ones with zero captures
- Color coding:
  - Green: captured in live traffic → click to see matching flows
  - Yellow: declared but not yet captured → "not seen in this session"
  - Gray: deprecated (if URL contains "v1" and there's a matching "v2" endpoint)
- Click any declared endpoint → pre-populated Edit+Replay with the path pattern
  filled in, params as editable placeholders

**"Uncaptured endpoint" highlight** — the key security use case:
Endpoints declared in Retrofit but never triggered = potential IDOR/auth bypass
candidates that weren't exercised. Flag these prominently.

---

### E4. Header & Signature Analysis

**What it does:**
For each endpoint in the API Map, analyze header values across all captured
instances to classify headers as static, dynamic, or cryptographically computed.
When decompiled source is available, correlate the computed header back to the
method that builds it.

**Why it matters:**
Custom auth schemes, request signing, anti-replay tokens — these are the
first thing a researcher needs to understand to replay requests. sniff! should
surface "this header is a HMAC-SHA256 of [body bytes] + [timestamp]" without
requiring the researcher to read the decompiled code manually.

**Header classification algorithm:**

```typescript
// For each (endpoint, headerName) pair:
// Collect all observed values across captures

function classifyHeader(values: string[]): HeaderAnalysis {
  if (allSame(values)) return { type: "static", value: values[0] };

  const patterns = detectPatterns(values);
  // UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}/i
  // HMAC-SHA256: /^[0-9a-f]{64}$/
  // HMAC-SHA512: /^[0-9a-f]{128}$/
  // JWT: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
  // Base64: /^[A-Za-z0-9+/]+=*$/ with length >= 32
  // Timestamp: parseable as unix seconds or millis
  // Incrementing: values form a monotonically increasing sequence

  const entropy = shannonEntropy(values);

  return {
    type: "dynamic",
    pattern: patterns,          // ["hmac-sha256", "base64"]
    entropy,                    // bits
    correlatesWithTimestamp: checkTimeCorrelation(values),
    correlatesWithBody: checkBodyCorrelation(values, flows),
    possibleAlgorithm: inferAlgorithm(patterns, entropy),
  };
}

function inferAlgorithm(patterns, entropy): string | null {
  if (patterns.includes("hmac-sha256")) return "HMAC-SHA256 (64 hex chars)";
  if (patterns.includes("jwt")) return "JWT";
  if (patterns.includes("uuid")) return "UUID v4 (random nonce)";
  if (entropy > 4.5 && patterns.includes("base64")) return "High-entropy base64 (likely HMAC or AES)";
  if (patterns.includes("timestamp")) return "Unix timestamp";
  return null;
}
```

**Source correlation (requires E2):**
```
GET /api/header-source?package=com.example.app&header=X-App-Signature
→ Searches decompiled source for the header name string
→ Returns the code that builds it:
{
  "file": "com/example/RequestSigner.java",
  "line": 87,
  "snippet": "request.addHeader(\"X-App-Signature\", hmac.sign(body + timestamp, SECRET_KEY));"
}
```

**Frontend — Header Analysis drawer in API Map:**
- Per-header rows in the endpoint schema panel
- Badge: `STATIC` / `UUID` / `HMAC-SHA256` / `JWT` / `TIMESTAMP` / `UNKNOWN-DYNAMIC`
- "View source" button (if decompiled) → jumps to Source page at the signing function
- "Copy values" → last N observed values for manual analysis

**Signature cracking hints:**
If the decompiled source shows a signing key as a string literal or constant:
- Extract and display it: "Signing key: `a8f3bc...` (found in `Constants.java:34`)"
- If the key is derived from device properties, show the derivation function

---

### E5. POW & Challenge-Response Detection

**What it does:**
Identifies endpoints and flows where the app performs a challenge-response
or proof-of-work cycle before the actual request succeeds. Maps the pattern,
identifies the algorithm, and where possible extracts the implementation
from decompiled source.

**POW patterns to detect:**

*Akamai BMP / Cyberfend:*
- `_abck` cookie: 700+ char base64, changes after each "sensor data" submission
- `ak_bmsc` cookie: set on first page load, used in subsequent requests
- `sensor_data` body field on POST to `/_bm/async_validate` or similar
- Pattern: GET → 403 → POST sensor_data → GET again → 200

*TikTok / ByteDance:*
- `X-Gorgon` / `X-Khronos` header pair
  - X-Khronos: unix timestamp
  - X-Gorgon: HMAC(md5(params + body) + timestamp + device_id, key)
- Can be extracted and reimplemented from decompiled source

*HUMAN / PerimeterX:*
- `_pxhd` / `_pxde` cookies
- `X-PX-Authorization` header

*Generic POW:*
- Request fails 429/403, app sleeps, retries with a new header value
- Request sequence: POST /challenge → { challenge: "..." } → POST /solve → { token: "..." } → original request with token

**Detection algorithm:**
```go
// In broker/flow analyzer
func detectPOWChains(flows []capturedFlow) []powChain {
    // Group flows by session (cookie/device-id correlation)
    // Find 403→200 sequences to the same endpoint within 5 seconds
    // Flag headers that differ between the failed and successful attempt
    // Those differing headers are the POW response
}
```

**Frontend:**
- Flow table: `⚡ POW` badge on flows that are part of a detected challenge chain
- Click → shows the full chain: challenge request → solve request → final request
- "POW Anatomy" panel: shows which headers changed, what pattern they match
- If source available: "View signing implementation" link

**Akamai sensor_data decoder:**
The sensor_data field is documented by security researchers and has a known
structure (base64 JSON with device signals). Add a decoder that parses it
and shows the individual signals (accelerometer, touch patterns, etc.) —
useful for understanding what they're collecting and how to spoof it.

---

### E6. IDOR & Auth Surface Map

**What it does:**
Automatically flags endpoints that are likely IDOR candidates or have
authentication bypass potential, based on traffic patterns.

**Detection rules:**

```typescript
// IDOR candidates
function flagIDOR(endpoints: ApiEndpoint[]): IDORCandidate[] {
  return endpoints.filter(e => {
    const segments = e.path.split("/");
    return segments.some(s =>
      /^\d+$/.test(s) ||           // numeric ID: /users/12345
      /^[0-9a-f-]{36}$/.test(s)   // UUID: /items/550e8400-...
    );
  }).map(e => ({
    endpoint: e,
    idType: detectIdType(e.path),
    suggestion: `Try replacing ID with adjacent values (N-1, N+1) or another user's ID`,
  }));
}

// Auth bypass candidates
function flagAuthBypass(flows: Flow[]): AuthBypassCandidate[] {
  // Endpoints that appear both with and without Authorization header
  // Endpoints that return 200 on OPTIONS without auth (CORS misconfiguration)
  // Endpoints with consistent 200 status even when auth header is malformed
}

// Privilege escalation candidates
function flagPrivEsc(flows: Flow[]): PrivEscCandidate[] {
  // Same endpoint called with different user contexts
  // Parameters that look like role flags: ?admin=true, ?role=user
  // Response body contains privilege-level fields that differ across captures
}
```

**Frontend — Security Findings page (`/dashboard/findings`):**
- Three sections: IDOR Candidates / Auth Bypass / Privilege Escalation
- Each finding: endpoint, evidence, severity estimate, "Open in Replay" button
- One-click IDOR test: auto-generate 5 Replay tab requests with ID ± 1, ± 100, etc.
- Filter by severity, by host

---

### E7. Request Rebuilder from Decompiled Source

**What it does:**
Given a Retrofit method (from E3) or a manually located code path (from E2),
construct a fully editable request in the Replay tab — URL with path params
as editable fields, query params, headers from `@Headers` annotations, body
schema from the `@Body` type.

**Why it matters:**
Researchers often know which API method they want to call (found in source)
but the method was never triggered in a captured session. This bridges that
gap: find the method in Source, click "Build Request," get a pre-populated
Replay tab.

**Implementation:**

```
GET /api/request-builder?package=com.example.app&class=com.example.api.FeedService&method=getUserFeed
→ Returns a ReplayRequest pre-populated from the Retrofit method signature:
{
  "method": "GET",
  "url": "https://api.example.com/v2/users/{userId}/feed?limit=20",
  "headers": {
    "X-App-Platform": "android",
    "X-App-Version": "{appVersion}",
    "Authorization": "Bearer {token}"
  },
  "body": null,
  "pathParams": [{ "name": "userId", "type": "string", "example": "" }],
  "queryParams": [{ "name": "limit", "type": "integer", "default": 20 }],
  "templateVars": ["appVersion", "token"]
}
```

Template variables (like `{token}`) are shown as editable fields in the Replay
tab — not raw `{placeholders}` in the URL. The researcher fills them in before
sending.

**Frontend integration:**
- Source page: every Retrofit method has a "Build Request" button
- Retrofit map (E3 declared endpoints view): same button per row
- Opens the full Replay tab pre-populated — same component already built

---

## Implementation Order

| Step | Feature | Scope | Dependencies | Est. |
|------|---------|-------|-------------|------|
| 1 | E1: Schema inference + OpenAPI export | Frontend only | None | 2 days |
| 2 | E2: jadx integration + Source page | Go + React | jadx binary | 2 days |
| 3 | E3: Retrofit extraction | Go (grep/parse) | E2 | 1.5 days |
| 4 | E7: Request rebuilder from source | Go + React | E3 | 1 day |
| 5 | E4: Header/signature analysis | Frontend + Go search | None (E2 for source link) | 1.5 days |
| 6 | E6: IDOR/auth surface map | Frontend only | None | 1 day |
| 7 | E5: POW/challenge detection | Go + React | E4 for context | 2 days |

Total: ~11 development days for full phase.

Start with E1 + E2 in parallel — they're independent and both unblock everything downstream.

---

## New Files

```
web.go                         ← new routes: /api/decompile/*, /api/retrofit, /api/header-source, /api/request-builder
retrofit.go                    ← new file: Retrofit annotation parser
decompile.go                   ← new file: jadx job manager, file tree, search

site/src/app/dashboard/
  source/page.tsx               ← new: decompiled source viewer
  findings/page.tsx             ← new: IDOR/auth surface map

site/src/lib/
  schemaInference.ts            ← new: JSON schema merger + field entropy
  openapi.ts                    ← new: OpenAPI 3.0 YAML serializer
  powDetection.ts               ← new: POW chain detection

site/src/components/dashboard/
  SchemaPanel.tsx               ← new: endpoint schema drawer in API Map
  SourceViewer.tsx              ← new: syntax-highlighted source display
  RetrofitMap.tsx               ← new: declared vs. captured endpoint table
  HeaderAnalysis.tsx            ← new: per-header entropy + pattern display

site/src/components/dashboard/Sidebar.tsx   ← add Source + Findings entries
```

---

## Key Design Decisions

**jadx vs. apktool:**
jadx gives readable Java/Kotlin directly. apktool gives smali (bytecode-level).
jadx is the right choice for source correlation and Retrofit parsing.
Run both: jadx for source, apktool for resource extraction (manifest, layout XMLs).
apktool is lighter and faster; jadx is the expensive step.

**Decompilation caching:**
Once decompiled, never re-run unless the user explicitly requests it. The
`~/.sniff/jadx/{pkg}/` directory is the source of truth. Size: a 100MB APK
produces ~50–200MB of decompiled source. Disk usage is the tradeoff.

**Search implementation:**
Don't index — just `grep -r`. The decompiled source is already on disk,
grep across it at query time is fast enough for interactive use (< 500ms for
a typical app). Add ripgrep (`rg`) as an optional faster alternative.

**Retrofit parser approach:**
Regex, not full AST. A full Java/Kotlin parser is overkill and fragile.
Retrofit annotations are syntactically distinctive and the information we need
(annotation type, URL string, parameter annotations) is extractable with targeted
regex. Handle ProGuard obfuscation by also scanning for Kotlin metadata annotations.

**OpenAPI fidelity:**
The generated spec is a starting point, not a ground truth. JSON schema inference
from traffic samples will have gaps (optional fields that weren't in captured samples,
union types). Mark the spec as `x-sniff-generated: true` and document that it's
inferred. The researcher should validate it, not blindly trust it.

**Security of the decompile endpoint:**
The decompile API runs `jadx` as a subprocess with the APK path. Since sniff!
runs locally and the user is the researcher, no sandboxing needed. The APK was
already pulled from the device — we're just decompiling what's already on disk.

---

## Competitive Positioning

| Feature | sniff! (after this) | powhttp.com | jadx standalone | apktool standalone |
|---------|--------------------|-----------|-----------------|--------------------|
| Live traffic capture | ✅ | ✅ | ❌ | ❌ |
| Request replay + edit | ✅ | ✅ | ❌ | ❌ |
| API Map from traffic | ✅ | partial | ❌ | ❌ |
| Schema inference + OpenAPI | ✅ E1 | ❌ | ❌ | ❌ |
| Decompiled source viewer | ✅ E2 | ❌ | ✅ separate tool | ❌ |
| Retrofit endpoint extraction | ✅ E3 | ❌ | manual | ❌ |
| Header entropy analysis | ✅ E4 | ❌ | ❌ | ❌ |
| POW/challenge detection | ✅ E5 | ❌ | ❌ | ❌ |
| IDOR surface map | ✅ E6 | ❌ | ❌ | ❌ |
| Source-correlated request builder | ✅ E7 | ❌ | ❌ | ❌ |
| Protection detection (35 SDKs) | ✅ existing | ❌ | ❌ | ❌ |
| TLS fingerprinting (JA4/JA3) | ✅ existing | ❌ | ❌ | ❌ |

The combination of live traffic + static analysis + source correlation in one
tool with a clean UI is the differentiator. No existing tool does all of this.
Researchers currently context-switch between 4–5 separate tools for a workflow
that sniff! would collapse into one.

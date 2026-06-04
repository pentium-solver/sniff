package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"
)

// safeGo launches fn in a goroutine with a deferred panic recovery.
// Any panic is logged with a full stack trace instead of killing the process.
func safeGo(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[PANIC:%s] %v\n%s", name, r, debug.Stack())
			}
		}()
		fn()
	}()
}

// ── SSE Event ───────────────────────────────────────────────────────────────

type sseEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// ── State Broker ────────────────────────────────────────────────────────────

type stateBroker struct {
	mu sync.RWMutex

	settings    settings
	flows       []capturedFlow
	statusLines []logEntry
	capturing   bool
	captureMode captureMode
	captureName string
	appPID      int

	mitmdump    *mitmdumpManager
	frida       *fridaManager
	flowChan    chan capturedFlow
	logChan     chan logEntry
	captureStop chan struct{}

	// Fingerprint mode
	fingerprints         []capturedFingerprint
	fingerprintCapturing bool
	fingerprintStop      chan struct{}

	// SSE subscribers
	sseMu      sync.Mutex
	sseClients map[chan sseEvent]struct{}
}

func newStateBroker(s settings) *stateBroker {
	return &stateBroker{
		settings:    s,
		mitmdump:    &mitmdumpManager{},
		frida:       &fridaManager{},
		sseClients:  make(map[chan sseEvent]struct{}),
		captureMode: captureModeStandard,
	}
}

func (b *stateBroker) subscribe() chan sseEvent {
	ch := make(chan sseEvent, 100)
	b.sseMu.Lock()
	b.sseClients[ch] = struct{}{}
	b.sseMu.Unlock()
	return ch
}

func (b *stateBroker) unsubscribe(ch chan sseEvent) {
	b.sseMu.Lock()
	delete(b.sseClients, ch)
	b.sseMu.Unlock()
}

func (b *stateBroker) broadcast(evt sseEvent) {
	b.sseMu.Lock()
	defer b.sseMu.Unlock()
	for ch := range b.sseClients {
		select {
		case ch <- evt:
		default:
		}
	}
}

func (b *stateBroker) addLog(msg, style string) {
	entry := logEntry{Time: time.Now().Format("15:04:05"), Msg: msg, Style: style}
	b.mu.Lock()
	b.statusLines = append(b.statusLines, entry)
	if len(b.statusLines) > 200 {
		b.statusLines = b.statusLines[len(b.statusLines)-200:]
	}
	b.mu.Unlock()
	b.broadcast(sseEvent{Type: "log", Data: entry})
}

func (b *stateBroker) addFlow(flow capturedFlow) {
	b.mu.Lock()
	b.flows = append(b.flows, flow)
	b.mu.Unlock()
	b.broadcast(sseEvent{Type: "flow", Data: flow})
}

func (b *stateBroker) addFingerprint(fp capturedFingerprint) {
	b.mu.Lock()
	b.fingerprints = append(b.fingerprints, fp)
	b.mu.Unlock()
	b.broadcast(sseEvent{Type: "fingerprint", Data: fp})
}

func (b *stateBroker) broadcastFingerprintState() {
	b.mu.RLock()
	active := b.fingerprintCapturing
	b.mu.RUnlock()
	b.broadcast(sseEvent{Type: "fingerprint_state", Data: map[string]interface{}{
		"active": active,
	}})
}

func (b *stateBroker) setState(capturing bool) {
	b.mu.Lock()
	b.capturing = capturing
	b.mu.Unlock()
	b.broadcast(sseEvent{Type: "state", Data: map[string]interface{}{
		"capturing":   capturing,
		"captureMode": b.captureModeLabel(),
		"captureName": b.captureName,
	}})
}

func (b *stateBroker) captureModeLabel() string {
	switch b.captureMode {
	case captureModeLinkedInCronet:
		return "LinkedIn Cronet"
	case captureModeSignupHandoff:
		return "Signup Handoff"
	case captureModeMitmOnly:
		return "Mitm Only"
	case captureModeDailyPay:
		return "DailyPay"
	case captureModeSpeedway:
		return "Speedway"
	case captureModePapaJohns:
		return "Papa Johns"
	case captureModeLinkedInReplay:
		return "LinkedIn Replay"
	default:
		return "Standard"
	}
}

// ── Web Server ──────────────────────────────────────────────────────────────

type webServer struct {
	broker  *stateBroker
	siteDir string // non-empty in --local mode: serve site/out/ from disk
}

func runWebServer(s settings, local bool) {
	broker := newStateBroker(s)
	ws := &webServer{broker: broker}

	if local {
		// Locate site/out/ relative to the binary or CWD.
		for _, candidate := range []string{
			filepath.Join(baseDir, "site", "out"),
			filepath.Join(baseDir, "..", "site", "out"),
			"site/out",
		} {
			if info, err := os.Stat(candidate); err == nil && info.IsDir() {
				ws.siteDir = candidate
				break
			}
		}
		if ws.siteDir == "" {
			fmt.Fprintf(os.Stderr,
				"\033[33m  ⚠ --local: site/out/ not found. Run 'make site' first.\033[0m\n\n")
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", ws.handleIndex)
	mux.HandleFunc("/api/health", ws.handleHealth)
	mux.HandleFunc("/api/state", ws.handleState)
	mux.HandleFunc("/api/flows", ws.handleFlows)
	mux.HandleFunc("/api/settings", ws.handleSettings)
	mux.HandleFunc("/api/device", ws.handleDevice)
	mux.HandleFunc("/api/device/ping", ws.handleDevicePing)
	mux.HandleFunc("/api/device/frida/start", ws.handleStartFrida)
	mux.HandleFunc("/api/device/proxy/clear", ws.handleClearProxy)
	mux.HandleFunc("/api/apps", ws.handleApps)
	mux.HandleFunc("/api/scripts", ws.handleScripts)
	mux.HandleFunc("/api/scripts/content", ws.handleScriptContent)
	mux.HandleFunc("/api/scripts/custom", ws.handleScriptCustom)
	mux.HandleFunc("/api/capture/start", ws.handleCaptureStart)
	mux.HandleFunc("/api/capture/stop", ws.handleCaptureStop)
	mux.HandleFunc("/api/capture/clear", ws.handleCaptureClear)
	mux.HandleFunc("/api/export", ws.handleExport)
	mux.HandleFunc("/api/fingerprint/start", ws.handleFingerprintStart)
	mux.HandleFunc("/api/fingerprint/stop", ws.handleFingerprintStop)
	mux.HandleFunc("/api/fingerprints", ws.handleFingerprints)
	mux.HandleFunc("/api/events", ws.handleSSE)
	mux.HandleFunc("/api/browse", ws.handleBrowse)
	mux.HandleFunc("/api/detect/frida", ws.handleDetectFrida)
	mux.HandleFunc("/api/detect/framework", ws.handleDetectFramework)
	mux.HandleFunc("/api/detect/protections", ws.handleDetectProtections)
	mux.HandleFunc("/api/detect/pinning", ws.handleDetectPinning)
	mux.HandleFunc("/api/replay", ws.handleReplay)
	mux.HandleFunc("/api/decompile", ws.handleDecompile)
	mux.HandleFunc("/api/decompile/status", ws.handleDecompileStatus)
	mux.HandleFunc("/api/decompile/packages", ws.handleDecompilePackages)
	mux.HandleFunc("/api/decompile/tree", ws.handleDecompileTree)
	mux.HandleFunc("/api/decompile/file", ws.handleDecompileFile)
	mux.HandleFunc("/api/decompile/search", ws.handleDecompileSearch)
	mux.HandleFunc("/api/decompile/definition", ws.handleDecompileDefinition)
	mux.HandleFunc("/api/decompile/pinning", ws.handlePinningAnalysis)

	// Wrap mux with CORS middleware + optional debug request logging.
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			corsHeaders(w)
			if r.Method == "OPTIONS" {
				w.WriteHeader(204)
				return
			}
			if debugMode {
				t0 := time.Now()
				defer func() {
					debugLog("HTTP %s %s (%dms)", r.Method, r.URL.RequestURI(), time.Since(t0).Milliseconds())
				}()
			}
		}
		mux.ServeHTTP(w, r)
	})

	addr := fmt.Sprintf(":%d", s.WebPort)
	localURL := fmt.Sprintf("http://localhost%s", addr)
	fmt.Printf("\n")
	fmt.Printf("  \033[1msniff!\033[0m running on %s\n", localURL)
	if local && ws.siteDir != "" {
		fmt.Printf("  \033[2mLocal mode — serving site/out/ at\033[0m\n")
		fmt.Printf("  \033[34m%s\033[0m\n", localURL)
	} else if local {
		fmt.Printf("  \033[33m  site/out/ not found — run 'make site' to build the frontend\033[0m\n")
		fmt.Printf("  \033[2mAPI only at\033[0m \033[34m%s/api/\033[0m\n", localURL)
	} else {
		fmt.Printf("  \033[2mOpen the dashboard to connect:\033[0m\n")
		fmt.Printf("  \033[34mhttps://sniff.cloud/connect\033[0m\n")
	}
	fmt.Printf("\n")

	// Auto-open browser (skip if SNIFF_NO_OPEN is set, e.g. dev mode)
	if os.Getenv("SNIFF_NO_OPEN") == "" {
		go func() {
			time.Sleep(500 * time.Millisecond)
			if local {
				exec.Command("open", localURL).Run()
			} else {
				exec.Command("open", "https://sniff.cloud/connect").Run()
			}
		}()
	}

	// Graceful shutdown on SIGINT
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		fmt.Println("\nShutting down...")
		broker.mu.RLock()
		capturing := broker.capturing
		broker.mu.RUnlock()
		if capturing {
			ws.doStopCapture()
		}
		os.Exit(0)
	}()

	if err := http.ListenAndServe(addr, handler); err != nil {
		fmt.Fprintf(os.Stderr, "web server: %v\n", err)
		os.Exit(1)
	}
}

func jsonResponse(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func corsHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

// ── Handlers ────────────────────────────────────────────────────────────────

func (ws *webServer) handleIndex(w http.ResponseWriter, r *http.Request) {
	// Serve index.html for all non-API routes (SPA client-side routing)
	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}

	// --local mode: serve Next.js static export from disk (site/out/).
	// Next.js export writes each route as <route>.html, so we try both
	// the exact path and a .html-suffixed variant before falling back to
	// the root index.html for deep client-side routes.
	if ws.siteDir != "" {
		urlPath := r.URL.Path
		if urlPath == "/" {
			urlPath = "/index.html"
		}

		// Try exact path on disk
		diskPath := filepath.Join(ws.siteDir, filepath.FromSlash(urlPath))
		if info, err := os.Stat(diskPath); err == nil && !info.IsDir() {
			http.ServeFile(w, r, diskPath)
			return
		}

		// Try appending .html (Next.js export: /dashboard/capture → dashboard/capture.html)
		if !strings.HasSuffix(urlPath, ".html") {
			htmlPath := diskPath + ".html"
			if info, err := os.Stat(htmlPath); err == nil && !info.IsDir() {
				http.ServeFile(w, r, htmlPath)
				return
			}
		}

		// SPA fallback: serve root index.html for unmatched client-side routes
		http.ServeFile(w, r, filepath.Join(ws.siteDir, "index.html"))
		return
	}

	// Default (hosted) mode: serve embedded legacy web/ assets.
	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}
	if f, err := webContent.Open(path[1:]); err == nil {
		f.Close()
		http.FileServerFS(webContent).ServeHTTP(w, r)
		return
	}

	// SPA fallback
	data, _ := fs.ReadFile(webContent, "index.html")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}

func (ws *webServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, map[string]string{"status": "ok"})
}

func (ws *webServer) handleState(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	b := ws.broker
	b.mu.RLock()
	defer b.mu.RUnlock()
	jsonResponse(w, map[string]interface{}{
		"settings":    b.settings,
		"capturing":   b.capturing,
		"captureMode": b.captureModeLabel(),
		"captureName": b.captureName,
		"flowCount":   len(b.flows),
		"logCount":    len(b.statusLines),
	})
}

func (ws *webServer) handleFlows(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	b := ws.broker
	b.mu.RLock()
	flows := make([]capturedFlow, len(b.flows))
	copy(flows, b.flows)
	b.mu.RUnlock()

	// Support getting a single flow by index
	idStr := r.URL.Query().Get("id")
	if idStr != "" {
		idx, err := strconv.Atoi(idStr)
		if err != nil || idx < 0 || idx >= len(flows) {
			http.Error(w, "invalid flow id", 404)
			return
		}
		jsonResponse(w, flows[idx])
		return
	}

	jsonResponse(w, flows)
}

func (ws *webServer) handleSettings(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	b := ws.broker

	if r.Method == "PUT" || r.Method == "POST" {
		var body struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		b.mu.Lock()
		b.settings.SetField(body.Key, body.Value)
		b.settings.Save()
		b.mu.Unlock()
		jsonResponse(w, map[string]string{"status": "ok"})
		return
	}

	b.mu.RLock()
	s := b.settings
	b.mu.RUnlock()

	// Return settings as key-value pairs with labels
	type field struct {
		Key   string `json:"key"`
		Label string `json:"label"`
		Value string `json:"value"`
	}
	var fields []field
	for _, sf := range settingsFields {
		fields = append(fields, field{Key: sf.Key, Label: sf.Label, Value: s.GetField(sf.Key)})
	}
	jsonResponse(w, fields)
}

// ── Device info cache ─────────────────────────────────────────────────────────
// Multiple dashboard components call /api/device on load. Without a cache each
// call runs 9 parallel ADB commands, spiking to 27+ concurrent ADB connections.
// A 5-second TTL collapses concurrent calls into one.

var (
	devCacheMu  sync.Mutex
	devCache    *deviceInfo
	devCacheAt  time.Time
	devCacheTTL = 5 * time.Second
)

func fetchDeviceInfoCached(fridaServer string) deviceInfo {
	devCacheMu.Lock()
	defer devCacheMu.Unlock()
	if devCache != nil && time.Since(devCacheAt) < devCacheTTL {
		debugLog("handleDevice: serving cached device info (age %dms)", time.Since(devCacheAt).Milliseconds())
		return *devCache
	}
	info := fetchDeviceInfo(fridaServer)
	devCache = &info
	devCacheAt = time.Now()
	return info
}

func (ws *webServer) handleDevice(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	t0 := time.Now()

	if !adbConnected() {
		jsonResponse(w, map[string]interface{}{
			"connected": false,
			"error":     "No ADB device connected",
		})
		return
	}

	b := ws.broker
	b.mu.RLock()
	fridaServer := b.settings.FridaServer
	b.mu.RUnlock()
	info := fetchDeviceInfoCached(fridaServer)
	debugLog("handleDevice completed in %dms", time.Since(t0).Milliseconds())
	jsonResponse(w, map[string]interface{}{
		"connected": true,
		"info":      info,
	})
}

// handleDevicePing is a fast ADB liveness check — only runs `adb devices`,
// used by the ConnectionToast so the full APK pull doesn't block it.
func (ws *webServer) handleDevicePing(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	t0 := time.Now()
	ok, detail, rawOut := adbPing()
	elapsed := time.Since(t0).Milliseconds()
	debugLog("handleDevicePing → connected=%v detail=%q elapsed=%dms", ok, detail, elapsed)
	if !ok {
		// Always log failures so we can diagnose dropped connections
		log.Printf("[ADB PING FAIL] elapsed=%dms detail=%q raw=%q", elapsed, detail, rawOut)
	} else if elapsed > 2000 {
		// Slow-but-successful ping — worth knowing about
		log.Printf("[ADB PING SLOW] %dms — system may be under load", elapsed)
	}
	jsonResponse(w, map[string]interface{}{
		"connected":  ok,
		"detail":     detail,
		"elapsed_ms": elapsed,
	})
}

func (ws *webServer) handleStartFrida(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}
	b := ws.broker
	b.mu.RLock()
	fridaPath := b.settings.FridaServer
	b.mu.RUnlock()

	go func() {
		adbShell(fmt.Sprintf("su -c '%s &'", fridaPath))
	}()
	jsonResponse(w, map[string]string{"status": "starting"})
}

func (ws *webServer) handleClearProxy(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}
	adbClearProxy()
	jsonResponse(w, map[string]string{"status": "ok"})
}

func (ws *webServer) handleApps(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	apps := loadApps()
	jsonResponse(w, apps)
}

func (ws *webServer) handleScripts(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	scripts := fridaScripts()
	// Append custom scripts
	customs := loadCustomScripts()
	scripts = append(scripts, customs...)
	jsonResponse(w, scripts)
}

func (ws *webServer) handleScriptContent(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "id required", 400)
		return
	}
	// Find the script by ID
	all := fridaScripts()
	all = append(all, loadCustomScripts()...)
	var path string
	for _, s := range all {
		if s.ID == id {
			path = s.Path
			break
		}
	}
	if path == "" {
		http.Error(w, "script not found", 404)
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]string{"id": id, "content": string(data), "path": path})
}

func customScriptsDir() string {
	dir := filepath.Join(baseDir, "frida_scripts", "custom")
	os.MkdirAll(dir, 0755)
	return dir
}

func loadCustomScripts() []fridaScript {
	dir := customScriptsDir()
	var scripts []fridaScript
	entries, err := os.ReadDir(dir)
	if err != nil {
		return scripts
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".js") {
			continue
		}
		name := strings.TrimSuffix(e.Name(), ".js")
		id := "custom_" + name
		// Try to read metadata from first line comment: // META: label=CUSTOM color=cyan desc=My script
		path := filepath.Join(dir, e.Name())
		label := "CUSTOM"
		color := "cyan"
		desc := "User-created script"
		data, err := os.ReadFile(path)
		if err == nil {
			firstLine := strings.SplitN(string(data), "\n", 2)[0]
			if strings.HasPrefix(firstLine, "// META:") {
				meta := firstLine[8:]
				for _, part := range strings.Fields(meta) {
					kv := strings.SplitN(part, "=", 2)
					if len(kv) != 2 {
						continue
					}
					switch kv[0] {
					case "label":
						label = kv[1]
					case "color":
						color = kv[1]
					case "desc":
						desc = strings.ReplaceAll(kv[1], "_", " ")
					case "name":
						name = strings.ReplaceAll(kv[1], "_", " ")
					}
				}
			}
		}
		scripts = append(scripts, fridaScript{
			ID:         id,
			Name:       name,
			Label:      label,
			LabelColor: color,
			Path:       path,
			Desc:       desc,
		})
	}
	return scripts
}

func (ws *webServer) handleScriptCustom(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	switch r.Method {
	case "POST":
		// Create new script
		var body struct {
			Name    string `json:"name"`
			Content string `json:"content"`
			Label   string `json:"label"`
			Desc    string `json:"desc"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if body.Name == "" || body.Content == "" {
			http.Error(w, "name and content required", 400)
			return
		}
		// Sanitize filename
		safeName := strings.ReplaceAll(strings.ToLower(body.Name), " ", "_")
		safeName = strings.Map(func(r rune) rune {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
				return r
			}
			return -1
		}, safeName)
		if safeName == "" {
			http.Error(w, "invalid name", 400)
			return
		}
		filename := safeName + ".js"
		path := filepath.Join(customScriptsDir(), filename)
		// Prepend metadata
		label := body.Label
		if label == "" {
			label = "CUSTOM"
		}
		desc := body.Desc
		if desc == "" {
			desc = "User-created script"
		}
		metaLine := fmt.Sprintf("// META: name=%s label=%s desc=%s\n",
			strings.ReplaceAll(body.Name, " ", "_"),
			label,
			strings.ReplaceAll(desc, " ", "_"))
		content := metaLine + body.Content
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		jsonResponse(w, map[string]string{"status": "created", "id": "custom_" + safeName, "path": path})

	case "PUT":
		// Update existing script
		var body struct {
			ID      string `json:"id"`
			Content string `json:"content"`
			Label   string `json:"label"`
			Desc    string `json:"desc"`
			Name    string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		// Find the script
		all := fridaScripts()
		all = append(all, loadCustomScripts()...)
		var path string
		for _, s := range all {
			if s.ID == body.ID {
				path = s.Path
				break
			}
		}
		if path == "" {
			http.Error(w, "script not found", 404)
			return
		}
		content := body.Content
		// If it's a custom script, update metadata
		if strings.HasPrefix(body.ID, "custom_") {
			name := body.Name
			if name == "" {
				name = strings.TrimPrefix(body.ID, "custom_")
			}
			label := body.Label
			if label == "" {
				label = "CUSTOM"
			}
			desc := body.Desc
			if desc == "" {
				desc = "User-created script"
			}
			// Strip old meta line if present
			if strings.HasPrefix(content, "// META:") {
				if idx := strings.Index(content, "\n"); idx >= 0 {
					content = content[idx+1:]
				}
			}
			metaLine := fmt.Sprintf("// META: name=%s label=%s desc=%s\n",
				strings.ReplaceAll(name, " ", "_"),
				label,
				strings.ReplaceAll(desc, " ", "_"))
			content = metaLine + content
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		jsonResponse(w, map[string]string{"status": "updated"})

	case "DELETE":
		id := r.URL.Query().Get("id")
		if id == "" || !strings.HasPrefix(id, "custom_") {
			http.Error(w, "can only delete custom scripts", 400)
			return
		}
		customs := loadCustomScripts()
		var path string
		for _, s := range customs {
			if s.ID == id {
				path = s.Path
				break
			}
		}
		if path == "" {
			http.Error(w, "script not found", 404)
			return
		}
		if err := os.Remove(path); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		jsonResponse(w, map[string]string{"status": "deleted"})

	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (ws *webServer) handleCaptureStart(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}

	b := ws.broker
	b.mu.RLock()
	if b.capturing {
		b.mu.RUnlock()
		http.Error(w, "already capturing", 409)
		return
	}
	b.mu.RUnlock()

	var body struct {
		Mode          string `json:"mode"`
		Package       string `json:"package"`
		ScriptContent string `json:"script_content"` // optional: save + use this script for the session
		ScriptName    string `json:"script_name"`    // required if ScriptContent provided
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}

	// Update package if provided
	if body.Package != "" {
		b.mu.Lock()
		b.settings.Package = body.Package
		b.settings.Save()
		b.mu.Unlock()
	}

	// If a script was provided inline, save it to custom scripts and activate it.
	if body.ScriptContent != "" {
		name := body.ScriptName
		if name == "" {
			name = "sniff_autounpin"
		}
		safeName := strings.ReplaceAll(strings.ToLower(name), "-", "_")
		safeName = strings.Map(func(r rune) rune {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
				return r
			}
			return -1
		}, safeName)
		if safeName == "" {
			safeName = "sniff_autounpin"
		}
		scriptFilePath := filepath.Join(customScriptsDir(), safeName+".js")
		metaLine := fmt.Sprintf("// META: name=%s label=AUTO-UNPIN desc=Auto-generated_SSL_unpinning_script\n", safeName)
		_ = os.WriteFile(scriptFilePath, []byte(metaLine+body.ScriptContent), 0644)
		b.mu.Lock()
		b.settings.FridaScriptID = "custom_" + safeName
		b.settings.Save()
		b.mu.Unlock()
	}

	// Parse mode
	mode := captureModeStandard
	switch strings.ToLower(body.Mode) {
	case "mitm_only", "mitmonly":
		mode = captureModeMitmOnly
	case "signup_handoff", "signuphandoff":
		mode = captureModeSignupHandoff
	case "linkedin_cronet", "linkedincronet":
		mode = captureModeLinkedInCronet
	case "linkedin_replay", "linkedinreplay":
		mode = captureModeLinkedInReplay
	case "dailypay":
		mode = captureModeDailyPay
	case "speedway":
		mode = captureModeSpeedway
	case "papajohns":
		mode = captureModePapaJohns
	}

	b.mu.Lock()
	b.flows = nil
	b.statusLines = nil
	b.captureMode = mode
	pkg := b.settings.Package
	suffix := ""
	switch mode {
	case captureModeMitmOnly:
		suffix = "_mitm_only"
	case captureModeSignupHandoff:
		suffix = "_signup_handoff"
	case captureModeLinkedInCronet:
		suffix = "_linkedin_cronet"
	case captureModeLinkedInReplay:
		suffix = "_linkedin_replay"
	case captureModeDailyPay:
		suffix = "_dailypay"
	case captureModeSpeedway:
		suffix = "_speedway"
	case captureModePapaJohns:
		suffix = "_papajohns"
	}
	parts := strings.Split(pkg, ".")
	tail := parts[len(parts)-1]
	b.captureName = fmt.Sprintf("%s%s_%s", tail, suffix, time.Now().Format("20060102_150405"))
	b.capturing = true
	b.flowChan = make(chan capturedFlow, 100)
	b.logChan = make(chan logEntry, 50)
	b.captureStop = make(chan struct{})
	b.mu.Unlock()

	b.setState(true)

	// Build a temporary model to reuse captureSequence
	safeGo("captureSequence", func() { ws.runCaptureSequence(mode) })

	// Drain channels in background
	safeGo("drainChannels", ws.drainChannels)

	jsonResponse(w, map[string]string{"status": "started", "name": b.captureName})
}

func (ws *webServer) runCaptureSequence(mode captureMode) {
	b := ws.broker
	b.mu.RLock()
	s := b.settings
	b.mu.RUnlock()

	// Create a temporary model for the capture sequence functions
	m := &model{
		settings: s,
		mitmdump: b.mitmdump,
		frida:    b.frida,
	}

	m.captureSequence(b.logChan, b.flowChan, b.captureStop, mode)
}

func (ws *webServer) drainChannels() {
	b := ws.broker
	b.mu.RLock()
	flowCh := b.flowChan
	logCh := b.logChan
	stopCh := b.captureStop
	b.mu.RUnlock()

	// Drain log channel (closed by captureSequence when done)
	safeGo("drainLog", func() {
		for entry := range logCh {
			b.addLog(entry.Msg, entry.Style)
		}
		// Log channel closed = capture sequence done
		b.mu.Lock()
		b.capturing = false
		b.mu.Unlock()
		b.setState(false)
	})

	// Drain flow channel (not explicitly closed, stops when stopCh closes)
	safeGo("drainFlow", func() {
		for {
			select {
			case <-stopCh:
				// Drain remaining
				for {
					select {
					case flow := <-flowCh:
						b.addFlow(flow)
					default:
						return
					}
				}
			case flow := <-flowCh:
				b.addFlow(flow)
			}
		}
	})
}

func (ws *webServer) handleCaptureStop(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}
	ws.doStopCapture()
	jsonResponse(w, map[string]string{"status": "stopped"})
}

func (ws *webServer) doStopCapture() {
	b := ws.broker
	b.mu.Lock()
	if b.captureStop != nil {
		close(b.captureStop)
		b.captureStop = nil
	}
	b.capturing = false
	b.mu.Unlock()

	b.frida.Detach()
	b.mitmdump.Stop()
	adbClearProxy()

	// Papa Johns cleanup
	if b.captureMode == captureModePapaJohns {
		adbShell("su -c 'iptables -t nat -F OUTPUT'")
		adbShell("su -c 'kill $(pidof tproxy-connect)'")
	}

	b.setState(false)
}

func (ws *webServer) handleCaptureClear(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}
	b := ws.broker
	b.mu.Lock()
	b.flows = nil
	b.mu.Unlock()
	b.broadcast(sseEvent{Type: "clear", Data: nil})
	jsonResponse(w, map[string]string{"status": "cleared"})
}

func (ws *webServer) handleExport(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}
	b := ws.broker
	b.mu.RLock()
	flows := make([]capturedFlow, len(b.flows))
	copy(flows, b.flows)
	s := b.settings
	name := b.captureName
	b.mu.RUnlock()

	if len(flows) == 0 {
		http.Error(w, "no flows to export", 400)
		return
	}

	if name == "" {
		name = "capture"
	}

	dir := s.CapturesDir
	if dir == "" {
		dir = "/tmp"
	}
	os.MkdirAll(dir, 0755)

	var count int
	var err error
	var path string

	if s.ExportFormat == "har" {
		path = filepath.Join(dir, name+".har")
		count, err = exportHAR(flows, path)
	} else {
		path = filepath.Join(dir, name+".json")
		count, err = exportJSON(flows, path)
	}

	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	jsonResponse(w, map[string]interface{}{
		"count": count,
		"path":  path,
	})
}

// ── Fingerprint Mode Handlers ────────────────────────────────────────────────

func (ws *webServer) handleFingerprintStart(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}

	b := ws.broker
	b.mu.RLock()
	alreadyActive := b.fingerprintCapturing
	b.mu.RUnlock()
	if alreadyActive {
		http.Error(w, "fingerprint capture already running", 409)
		return
	}

	var body struct {
		Package string `json:"package"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	pkg := body.Package
	if pkg == "" {
		b.mu.RLock()
		pkg = b.settings.Package
		b.mu.RUnlock()
	} else {
		b.mu.Lock()
		b.settings.Package = pkg
		b.settings.Save()
		b.mu.Unlock()
	}

	b.mu.Lock()
	b.fingerprints = nil
	b.fingerprintCapturing = true
	b.fingerprintStop = make(chan struct{})
	stopCh := b.fingerprintStop
	b.mu.Unlock()

	b.broadcastFingerprintState()

	safeGo("fingerprintCapture", func() { ws.runFingerprintCapture(pkg, stopCh) })

	jsonResponse(w, map[string]interface{}{"status": "started", "package": pkg})
}

func (ws *webServer) handleFingerprintStop(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}

	b := ws.broker
	b.mu.Lock()
	if b.fingerprintStop != nil {
		close(b.fingerprintStop)
		b.fingerprintStop = nil
	}
	b.fingerprintCapturing = false
	b.mu.Unlock()

	b.broadcastFingerprintState()
	jsonResponse(w, map[string]string{"status": "stopped"})
}

func (ws *webServer) handleFingerprints(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	b := ws.broker
	b.mu.RLock()
	fps := make([]capturedFingerprint, len(b.fingerprints))
	copy(fps, b.fingerprints)
	active := b.fingerprintCapturing
	b.mu.RUnlock()
	jsonResponse(w, map[string]interface{}{
		"fingerprints": fps,
		"active":       active,
	})
}

// ── SSE ──────────────────────────────────────────────────────────────────────

func (ws *webServer) handleSSE(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", 500)
		return
	}

	ch := ws.broker.subscribe()
	defer ws.broker.unsubscribe(ch)

	// Send initial state + replay existing logs
	b := ws.broker
	b.mu.RLock()
	initData, _ := json.Marshal(map[string]interface{}{
		"capturing":            b.capturing,
		"captureMode":          b.captureModeLabel(),
		"captureName":          b.captureName,
		"flowCount":            len(b.flows),
		"fingerprintCapturing": b.fingerprintCapturing,
		"fingerprintCount":     len(b.fingerprints),
	})
	logsCopy := make([]logEntry, len(b.statusLines))
	copy(logsCopy, b.statusLines)
	// Replay existing fingerprints to new SSE subscriber
	fpsCopy := make([]capturedFingerprint, len(b.fingerprints))
	copy(fpsCopy, b.fingerprints)
	b.mu.RUnlock()
	fmt.Fprintf(w, "event: state\ndata: %s\n\n", initData)
	for _, entry := range logsCopy {
		logData, _ := json.Marshal(entry)
		fmt.Fprintf(w, "event: log\ndata: %s\n\n", logData)
	}
	// Replay fingerprints to new subscriber
	for _, fp := range fpsCopy {
		fpData, _ := json.Marshal(fp)
		fmt.Fprintf(w, "event: fingerprint\ndata: %s\n\n", fpData)
	}
	flusher.Flush()

	// Keepalive: send an SSE comment every 15 s so proxies/browsers don't
	// silently drop idle connections. EventSource only reconnects on errors,
	// not on silent hangs — this guarantees the client sees a write failure.
	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepalive.C:
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		case evt := <-ch:
			data, _ := json.Marshal(evt.Data)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evt.Type, data)
			flusher.Flush()
		}
	}
}

// ── handleBrowse — directory listing for the folder picker ───────────────────
//
// GET /api/browse?path=/some/dir
// Returns { path, parent, entries:[{name,is_dir}] }
// Only directories are returned (no files — we're picking a folder, not a file).
func (ws *webServer) handleBrowse(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	p := r.URL.Query().Get("path")
	if p == "" {
		var err error
		p, err = os.UserHomeDir()
		if err != nil {
			p = "/"
		}
	}
	p = filepath.Clean(p)

	// If path doesn't exist or isn't a directory, fall back to its parent.
	if info, err := os.Stat(p); err != nil || !info.IsDir() {
		p = filepath.Dir(p)
	}

	entries, err := os.ReadDir(p)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type entry struct {
		Name string `json:"name"`
	}
	var dirs []entry
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		// Skip hidden directories on all platforms
		if strings.HasPrefix(name, ".") {
			continue
		}
		dirs = append(dirs, entry{Name: name})
	}

	parent := filepath.Dir(p)
	if parent == p {
		parent = "" // already at filesystem root
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"path":    p,
		"parent":  parent,
		"entries": dirs,
	})
}

// ── handleDetectFrida — find frida-server candidates on device ───────────────
//
// GET /api/detect/frida
// Probes common on-device paths and returns those that exist and are executable.
func (ws *webServer) handleDetectFrida(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	candidates := []string{
		"/data/local/tmp/frida-server",
		"/data/local/tmp/frida-server64",
		"/data/local/tmp/frida-server-arm64",
		"/data/local/tmp/fs-helper-64",
		"/data/local/tmp/fs-helper",
		"/data/local/tmp/fs",
	}

	// Build a single compound shell script — one ADB round-trip.
	var checks []string
	for _, p := range candidates {
		checks = append(checks, fmt.Sprintf("[ -x '%s' ] && echo '%s'", p, p))
	}
	out := adbShell(strings.Join(checks, "; "))

	var found []string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && strings.HasPrefix(line, "/") {
			found = append(found, line)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"paths": found})
}

// ── handleReplay — execute a modified HTTP request from the Mac ──────────────
//
// POST /api/replay
// body: { method, url, headers:{k:v}, body }
// Returns the response status, headers, body, and duration.
// TLS verification is intentionally disabled — this is a security testing tool.
func (ws *webServer) handleReplay(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	if r.Method == "OPTIONS" {
		w.WriteHeader(204)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}

	type replayReq struct {
		Method  string            `json:"method"`
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
		Body    string            `json:"body"`
	}
	type replayResp struct {
		Status     int               `json:"status"`
		StatusText string            `json:"status_text"`
		Headers    map[string]string `json:"headers"`
		Body       string            `json:"body"`
		Encoding   string            `json:"encoding"` // "" or "base64"
		DurationMs int64             `json:"duration_ms"`
		Error      string            `json:"error,omitempty"`
	}

	var req replayReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if req.URL == "" {
		http.Error(w, "url required", 400)
		return
	}
	if req.Method == "" {
		req.Method = "GET"
	}

	// Build the outbound request, honouring the browser's connection lifetime.
	var bodyReader io.Reader
	if req.Body != "" {
		bodyReader = strings.NewReader(req.Body)
	}
	httpReq, err := http.NewRequestWithContext(r.Context(), req.Method, req.URL, bodyReader)
	if err != nil {
		jsonResponse(w, replayResp{Error: err.Error()})
		return
	}
	for k, v := range req.Headers {
		if strings.HasPrefix(k, ":") {
			continue // skip HTTP/2 pseudo-headers
		}
		httpReq.Header.Set(k, v)
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}

	start := time.Now()
	resp, err := client.Do(httpReq)
	elapsed := time.Since(start).Milliseconds()
	if err != nil {
		jsonResponse(w, replayResp{Error: err.Error(), DurationMs: elapsed})
		return
	}
	defer resp.Body.Close()

	// Cap body at 10 MB.
	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 10<<20))

	// Flatten response headers (take first value per key).
	respHeaders := make(map[string]string, len(resp.Header))
	for k, vs := range resp.Header {
		respHeaders[k] = strings.Join(vs, ", ")
	}

	// Encode body: UTF-8 text as-is, binary as base64.
	var bodyStr, encoding string
	if utf8.Valid(bodyBytes) {
		bodyStr = string(bodyBytes)
	} else {
		bodyStr = base64.StdEncoding.EncodeToString(bodyBytes)
		encoding = "base64"
	}

	jsonResponse(w, replayResp{
		Status:     resp.StatusCode,
		StatusText: resp.Status,
		Headers:    respHeaders,
		Body:       bodyStr,
		Encoding:   encoding,
		DurationMs: elapsed,
	})
}

// ── Shared APK cache ──────────────────────────────────────────────────────────
//
// Both framework and protection detection pull the APK from the device.
// We cache the local path so the second call reuses the already-pulled file.
// Temp files live in os.TempDir() for the process lifetime.

var (
	apkPathsMu sync.RWMutex
	apkPaths   = map[string]string{} // pkg → local temp file path

	// Per-package pull mutexes — allows Marriott and LinkedIn to pull concurrently
	// without either blocking the other. Only one pull per package at a time.
	apkPullMus sync.Map // pkg → *sync.Mutex
)

func apkPullMu(pkg string) *sync.Mutex {
	mu, _ := apkPullMus.LoadOrStore(pkg, &sync.Mutex{})
	return mu.(*sync.Mutex)
}

// getOrPullAPK ensures the base APK for the given package is available as a
// local file, pulling it from the device if needed.
func getOrPullAPK(pkg string) (string, error) {
	// Fast path: already cached.
	apkPathsMu.RLock()
	if p, ok := apkPaths[pkg]; ok {
		if _, err := os.Stat(p); err == nil {
			apkPathsMu.RUnlock()
			return p, nil
		}
	}
	apkPathsMu.RUnlock()

	// Per-package lock — lets different packages pull concurrently.
	mu := apkPullMu(pkg)
	mu.Lock()
	defer mu.Unlock()

	// Double-check: another goroutine for the same pkg may have just pulled it.
	apkPathsMu.RLock()
	if p, ok := apkPaths[pkg]; ok {
		if _, err := os.Stat(p); err == nil {
			apkPathsMu.RUnlock()
			return p, nil
		}
	}
	apkPathsMu.RUnlock()

	// Ask device for the APK path.
	pmOut := adbShell(fmt.Sprintf("pm path %s 2>/dev/null", pkg))
	var apkDevicePath string
	for _, line := range strings.Split(pmOut, "\n") {
		if strings.HasPrefix(line, "package:") {
			apkDevicePath = strings.TrimPrefix(strings.TrimSpace(line), "package:")
			break
		}
	}
	if apkDevicePath == "" {
		debugLog("getOrPullAPK: package not found on device: %s", pkg)
		return "", fmt.Errorf("package not found: %s", pkg)
	}
	debugLog("getOrPullAPK: pulling %s → %s", pkg, apkDevicePath)

	// Sanitise package name for use as a filename.
	safe := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return r
		}
		return '_'
	}, pkg)
	tmpFile := filepath.Join(os.TempDir(), fmt.Sprintf("sniff_apk_%s.apk", safe))

	// 60-second timeout on the pull — large APKs (130 MB) take ~3–5s over USB.
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	t0 := time.Now()
	if err := exec.CommandContext(ctx, "adb", "pull", apkDevicePath, tmpFile).Run(); err != nil {
		debugLog("getOrPullAPK: pull failed for %s: %v", pkg, err)
		return "", fmt.Errorf("adb pull: %w", err)
	}

	if fi, err := os.Stat(tmpFile); err == nil {
		debugLog("getOrPullAPK: pulled %s → %.1f MB in %dms", pkg, float64(fi.Size())/(1<<20), time.Since(t0).Milliseconds())
	}

	apkPathsMu.Lock()
	apkPaths[pkg] = tmpFile
	apkPathsMu.Unlock()
	return tmpFile, nil
}

// ── Framework Detection ───────────────────────────────────────────────────────
//
// GET /api/detect/framework?package=com.example.app
//
// Opens the APK as a ZIP and scans entry names against known framework
// signatures. No DEX parsing needed — native library filenames and asset
// paths are sufficient for high-confidence detection of 14+ frameworks.

type frameworkResult struct {
	Framework  string   `json:"framework"`  // e.g. "flutter"
	Confidence string   `json:"confidence"` // "high" | "medium" | "low"
	Indicators []string `json:"indicators"` // matched entry names
}

var (
	fwCacheMu sync.RWMutex
	fwCache   = map[string]frameworkResult{}
)

// fwSignature maps native library basenames and asset path substrings to a
// framework name.  We only inspect ZIP entry names — no DEX parsing.
type fwSig struct {
	framework string
	// lib: .so basenames to look for anywhere under lib/
	lib []string
	// assets: substrings that must appear in an entry path starting with "assets/"
	assets []string
	// weight: higher = shown first when multiple match
	weight int
}

var fwSignatures = []fwSig{
	{
		framework: "flutter",
		lib:       []string{"libflutter.so"},
		assets:    []string{"flutter_assets/"},
		weight:    10,
	},
	{
		framework: "react-native",
		lib:       []string{"libreactnativejni.so", "libreact_nativemodule_core.so"},
		assets:    []string{"assets/index.android.bundle"},
		weight:    9,
	},
	{
		// Hermes-only RN: no libreactnativejni but has index.android.bundle + libhermes
		framework: "react-native",
		lib:       []string{"libhermes.so"},
		assets:    []string{"assets/index.android.bundle"},
		weight:    9,
	},
	{
		framework: "capacitor",
		lib:       []string{"libcapacitor.so"},
		assets:    []string{"assets/public/capacitor.js", "assets/public/"},
		weight:    8,
	},
	{
		framework: "cordova",
		lib:       []string{"libcordova.so"},
		assets:    []string{"assets/www/cordova.js", "assets/www/cordova"},
		weight:    8,
	},
	{
		// Cordova with no .so: detect via cordova.js alone (high confidence)
		framework: "cordova",
		assets:    []string{"assets/www/cordova.js"},
		weight:    8,
	},
	{
		framework: "xamarin",
		lib:       []string{"libmono.so", "libmonodroid.so", "libmonosgen-2.0.so"},
		assets:    []string{"assets/assemblies/", "assets/AssemblyList.json"},
		weight:    7,
	},
	{
		framework: "unity",
		lib:       []string{"libunity.so", "libunityplayer.so"},
		assets:    []string{"assets/bin/Data/"},
		weight:    7,
	},
	{
		framework: "unreal",
		lib:       []string{"libUE4.so", "libUnreal.so", "libUE4Game.so", "libUnrealGame.so"},
		assets:    []string{"assets/UE4Game/", "assets/UE5Game/"},
		weight:    7,
	},
	{
		framework: "godot",
		lib:       []string{"libgodot_android.so"},
		assets:    []string{"assets/main.pck"},
		weight:    7,
	},
	{
		framework: "cocos2d",
		lib:       []string{"libcocos2d.so", "libcocos2dcpp.so"},
		weight:    6,
	},
	{
		framework: "nativescript",
		lib:       []string{"libnativescript.so"},
		assets:    []string{"assets/tns_modules/"},
		weight:    6,
	},
	{
		framework: "titanium",
		lib:       []string{"libkroll.so"},
		assets:    []string{"assets/titanium.js"},
		weight:    6,
	},
	{
		framework: "adobe-air",
		lib:       []string{"libflashplayer.so", "libadobeair.so"},
		assets:    []string{"assets/META-INF/AIR/", "assets/mimetype"},
		weight:    5,
	},
	{
		framework: "libgdx",
		// libGDX is pure-Java; no distinctive .so, but has a gdx.jar pattern
		assets: []string{"assets/data/gdxVersion"},
		weight: 5,
	},
}

func detectFrameworkFromAPK(apkPath string) frameworkResult {
	zr, err := zip.OpenReader(apkPath)
	if err != nil {
		return frameworkResult{Framework: "unknown", Confidence: "low"}
	}
	defer zr.Close()

	// Collect all entry names for fast scanning.
	entries := make([]string, 0, len(zr.File))
	for _, f := range zr.File {
		entries = append(entries, f.Name)
	}

	type candidate struct {
		sig        fwSig
		indicators []string
		libHits    int
		assetHits  int
	}

	// Score each signature.
	var best *candidate
	seen := map[string]bool{} // deduplicate by framework name if multiple sigs match

	for i := range fwSignatures {
		sig := fwSignatures[i]
		c := candidate{sig: sig}

		for _, entry := range entries {
			// Check lib/ directory for .so basenames
			if strings.HasPrefix(entry, "lib/") && strings.HasSuffix(entry, ".so") {
				base := path.Base(entry)
				for _, lib := range sig.lib {
					if base == lib {
						c.indicators = append(c.indicators, entry)
						c.libHits++
					}
				}
			}
			// Check asset paths
			for _, asset := range sig.assets {
				if strings.Contains(entry, asset) {
					c.indicators = append(c.indicators, entry)
					c.assetHits++
				}
			}
		}

		if len(c.indicators) == 0 {
			continue
		}

		// Require at least one indicator from each non-empty category that has
		// entries (so a sig that lists both lib and assets needs both to match).
		if len(sig.lib) > 0 && c.libHits == 0 {
			continue
		}
		if len(sig.assets) > 0 && c.assetHits == 0 {
			continue
		}

		if !seen[sig.framework] {
			seen[sig.framework] = true
			if best == nil || sig.weight > best.sig.weight {
				best = &c
			}
		}
	}

	if best == nil {
		return frameworkResult{Framework: "native", Confidence: "low", Indicators: []string{}}
	}

	// Confidence: high if both lib and asset hit, medium if only one category.
	conf := "medium"
	if best.libHits > 0 && (len(best.sig.assets) == 0 || best.assetHits > 0) {
		conf = "high"
	} else if best.assetHits > 0 && len(best.sig.lib) == 0 {
		conf = "high"
	}

	// Deduplicate indicators.
	seen2 := map[string]bool{}
	var uniq []string
	for _, ind := range best.indicators {
		if !seen2[ind] {
			seen2[ind] = true
			uniq = append(uniq, ind)
		}
	}

	return frameworkResult{
		Framework:  best.sig.framework,
		Confidence: conf,
		Indicators: uniq,
	}
}

func (ws *webServer) handleDetectFramework(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	pkg := strings.TrimSpace(r.URL.Query().Get("package"))
	if pkg == "" {
		http.Error(w, "package required", 400)
		return
	}
	force := r.URL.Query().Get("force") == "1"

	// Serve from cache if available (unless force-refresh requested).
	if !force {
		fwCacheMu.RLock()
		if cached, ok := fwCache[pkg]; ok {
			fwCacheMu.RUnlock()
			jsonResponse(w, cached)
			return
		}
		fwCacheMu.RUnlock()
	} else {
		// Evict cached APK path so a fresh pull happens too.
		apkPathsMu.Lock()
		delete(apkPaths, pkg)
		apkPathsMu.Unlock()
	}

	apkPath, err := getOrPullAPK(pkg)
	if err != nil {
		jsonResponse(w, frameworkResult{
			Framework:  "unknown",
			Confidence: "low",
			Indicators: []string{err.Error()},
		})
		return
	}

	result := detectFrameworkFromAPK(apkPath)

	fwCacheMu.Lock()
	fwCache[pkg] = result
	fwCacheMu.Unlock()

	jsonResponse(w, result)
}

// ── Protection Detection ──────────────────────────────────────────────────────
//
// GET /api/detect/protections?package=com.example.app
//
// Decompresses every classes*.dex entry in the APK and byte-searches for known
// SDK package names, API hostnames, and library strings. Also checks .so
// basenames and asset paths. Covers antibot SDKs, cert-pinning libraries,
// anti-tamper wrappers, root/hook detection, and attestation APIs.
//
// DEX class names are stored as UTF-8 strings in the uncompressed DEX data,
// so bytes.Contains(dexBytes, []byte("com.perimeterx")) is fast and reliable.

type detectedProtection struct {
	Name     string   `json:"name"`
	Category string   `json:"category"` // "antibot"|"cert-pinning"|"anti-tamper"|"root-detection"|"hook-detection"|"attestation"
	Evidence []string `json:"evidence"`
}

var (
	ptCacheMu sync.RWMutex
	ptCache   = map[string][]detectedProtection{}
)

type protectionSig struct {
	name     string
	category string
	dex      []string // byte strings to find in decompressed DEX content
	libs     []string // .so basenames to match under lib/*/
	assets   []string // substrings of ZIP entry paths
}

var protectionSigs = []protectionSig{
	// ── Antibot / anti-fraud ─────────────────────────────────────────────────
	{
		name:     "PerimeterX / HUMAN Security",
		category: "antibot",
		dex:      []string{"com.perimeterx", "com.humansecurity", "perimeterx.net", "px-cloud.net", "px-cdn.net"},
	},
	{
		// Acquired Cyberfend 2016 — SDK may ship the com.cyberfend namespace (older)
		// or just the initializeAkamaiBMPSDK entry-point string (newer obfuscated builds).
		// Asset file akamai_bmp_encrypted_endpoints.json is the most reliable indicator.
		name:     "Akamai Bot Manager",
		category: "antibot",
		dex:      []string{"com/cyberfend/cyfsecurity", "com.cyberfend.cyfsecurity", "SensorDataBuilder", "CYFBotManClient", "com.akamai.botman", "initializeAkamaiBMPSDK", "AkamaiBMPSDK", "x-acf-sensor-data"},
		libs:     []string{"libakamaibmp.so"},
		assets:   []string{"akamai_bmp_encrypted_endpoints"},
	},
	{
		// Forter mobile fraud detection — uses obfuscated asset directory with
		// fs-config.properties, fs-mapping.properties, and WebviewSocket.html.
		name:     "Forter",
		category: "antibot",
		dex:      []string{"com.forter", "com/forter/"},
		assets:   []string{"fs-config.properties", "fs-mapping.properties"},
	},
	{
		name:     "DataDome",
		category: "antibot",
		dex:      []string{"com.datadome", "datadome.co", "api.datadome.co"},
	},
	{
		name:     "Imperva / Incapsula",
		category: "antibot",
		dex:      []string{"com.imperva", "com.incapsula", "incapsula.com"},
		libs:     []string{"libimperva.so", "libincapsula.so"},
	},
	{
		name:     "F5 Shape Security",
		category: "antibot",
		dex:      []string{"com.shapesecurity", "com.f5.shape", "shapesecurity.com"},
		libs:     []string{"libshape.so"},
	},
	{
		name:     "ThreatMetrix (LexisNexis)",
		category: "antibot",
		dex:      []string{"com.threatmetrix", "threatmetrix.com"},
		libs:     []string{"libthreatmetrix.so", "libtmx.so"},
	},
	{
		name:     "Kasada",
		category: "antibot",
		dex:      []string{"com.kasada"},
		libs:     []string{"libkasada.so"},
	},
	{
		name:     "Arkose Labs / FunCaptcha",
		category: "antibot",
		dex:      []string{"com.arkoselabs", "com.funcaptcha", "arkoselabs.com"},
	},
	{
		name:     "TrustDecision / TrustDevice",
		category: "antibot",
		dex:      []string{"com.trustdecision", "com.trustdevice", "trustdecision.com"},
		libs:     []string{"libtrustdevice.so", "libtrustsdk.so"},
	},
	{
		name:     "Seon",
		category: "antibot",
		dex:      []string{"io.seon", "seon.io"},
	},
	{
		name:     "Radware ShieldSquare",
		category: "antibot",
		dex:      []string{"com.radware.shieldsquare", "shieldsquare.com"},
	},
	{
		name:     "Kount",
		category: "antibot",
		dex:      []string{"com.kount", "kount.com", "kount.net"},
	},
	{
		name:     "Signifyd",
		category: "antibot",
		dex:      []string{"com.signifyd", "signifyd.com"},
	},
	{
		// Behavioral biometrics — used by many banks, insurance, and travel apps.
		name:     "BioCatch",
		category: "antibot",
		dex:      []string{"com/biocatch/client/android/sdk", "com.biocatch.client.android.sdk", "com.biocatch"},
	},
	{
		// Device fingerprinting / location intelligence.
		name:     "Incognia",
		category: "antibot",
		dex:      []string{"com.incognia", "com/incognia/Incognia", "repo.incognia.com"},
	},
	// ── Certificate pinning ───────────────────────────────────────────────────
	{
		name:     "OkHttp Certificate Pinning",
		category: "cert-pinning",
		dex:      []string{"okhttp3.CertificatePinner", "Lokhttp3/CertificatePinner;"},
	},
	{
		name:     "TrustKit",
		category: "cert-pinning",
		dex:      []string{"com.datatheorem.android.trustkit", "TrustKit"},
	},
	// NSC pinning is detected separately via XML file inspection (see detectNSCPinning).
	// ── Anti-tamper ───────────────────────────────────────────────────────────
	{
		name:     "Appdome",
		category: "anti-tamper",
		dex:      []string{"com.appdome"},
		libs:     []string{"libfusionsdkbridge.so", "libAppdome.so", "libfusionfencing.so"},
		assets:   []string{"appdome_manifest", "assets/appdome/"},
	},
	{
		name:     "Guardsquare DexGuard",
		category: "anti-tamper",
		dex:      []string{"com.guardsquare"},
	},
	{
		name:     "Arxan / Irdeto",
		category: "anti-tamper",
		dex:      []string{"com.arxan", "com.irdeto"},
		libs:     []string{"libarxan.so", "libirdeto.so"},
	},
	{
		name:     "Promon SHIELD",
		category: "anti-tamper",
		dex:      []string{"com.promon.shield", "promon.no"},
		libs:     []string{"libpromon.so"},
	},
	{
		name:     "Verimatrix",
		category: "anti-tamper",
		dex:      []string{"com.verimatrix"},
	},
	// ── Root / jailbreak detection ────────────────────────────────────────────
	{
		name:     "RootBeer",
		category: "root-detection",
		dex:      []string{"com.scottyab.rootbeer"},
	},
	{
		name:     "RootTools",
		category: "root-detection",
		dex:      []string{"com.stericson.RootTools"},
	},
	{
		// Mobile threat defense — zDefend SDK or standalone zIPS app detection.
		name:     "Zimperium zDefend",
		category: "root-detection",
		dex:      []string{"com.zimperium", "zimperium.com"},
		libs:     []string{"libzimperium.so", "libz9.so"},
	},
	// ── Attestation ───────────────────────────────────────────────────────────
	{
		name:     "Google SafetyNet",
		category: "attestation",
		dex:      []string{"com.google.android.gms.safetynet", "SafetyNetClient"},
	},
	{
		name:     "Google Play Integrity",
		category: "attestation",
		dex:      []string{"com.google.android.play.core.integrity", "IntegrityManager", "StandardIntegrityManager"},
	},
	{
		// Firebase App Check — newer attestation layer wrapping Play Integrity / SafetyNet.
		name:     "Firebase App Check",
		category: "attestation",
		dex:      []string{"com.google.firebase.appcheck", "com/google/firebase/appcheck/FirebaseAppCheck", "PlayIntegrityAppCheckProviderFactory", "AppCheckToken"},
	},
	{
		// reCAPTCHA Enterprise for Android — separate from Play Services reCAPTCHA.
		name:     "reCAPTCHA Enterprise",
		category: "attestation",
		dex:      []string{"com.google.android.recaptcha", "com/google/android/recaptcha/RecaptchaClient", "RecaptchaAction"},
	},
	// ── Hook / instrumentation detection ─────────────────────────────────────
	{
		name:     "Xposed Detection",
		category: "hook-detection",
		dex:      []string{"de.robv.android.xposed", "XposedBridge", "XposedHelpers", "com.saurik.substrate"},
	},
	{
		// Apps that actively check for Frida in /proc/maps or by name.
		name:     "Frida Detection",
		category: "hook-detection",
		dex:      []string{"frida-agent", "FRIDA_AGENT", "gum-js-loop", "gmain-frida", "/tmp/frida"},
		libs:     []string{"libfrida-gadget.so"},
	},
}

func detectProtectionsFromAPK(apkPath string) []detectedProtection {
	t0 := time.Now()
	debugLog("detectProtections: opening %s", apkPath)

	zr, err := zip.OpenReader(apkPath)
	if err != nil {
		debugLog("detectProtections: zip open error: %v", err)
		return nil
	}
	defer zr.Close()

	// Collect file-level metadata without reading content.
	var libFiles, entryPaths []string
	var totalDexSize uint64
	for _, f := range zr.File {
		entryPaths = append(entryPaths, f.Name)
		if strings.HasPrefix(f.Name, "lib/") && strings.HasSuffix(f.Name, ".so") {
			libFiles = append(libFiles, path.Base(f.Name))
		}
		if strings.HasSuffix(f.Name, ".dex") {
			totalDexSize += f.UncompressedSize64
		}
	}
	debugLog("detectProtections: %d entries, %d libs, total DEX uncompressed %.1f MB",
		len(entryPaths), len(libFiles), float64(totalDexSize)/(1<<20))

	// Per-signature evidence accumulator.
	type state struct {
		seen     map[string]bool
		evidence []string
	}
	states := make([]state, len(protectionSigs))
	for i := range states {
		states[i].seen = make(map[string]bool)
	}
	addEvidence := func(i int, ev string) {
		if !states[i].seen[ev] {
			states[i].seen[ev] = true
			states[i].evidence = append(states[i].evidence, ev)
		}
	}

	// Check native library filenames.
	for i, sig := range protectionSigs {
		for _, lib := range sig.libs {
			for _, lf := range libFiles {
				if lf == lib {
					addEvidence(i, "lib/"+lib)
				}
			}
		}
	}

	// Check ZIP entry paths for asset/resource patterns.
	for i, sig := range protectionSigs {
		for _, assetPat := range sig.assets {
			for _, ep := range entryPaths {
				if strings.Contains(ep, assetPat) {
					addEvidence(i, ep)
					break
				}
			}
		}
	}

	// Decompress and scan each DEX file sequentially.
	// Each file is read, scanned, then discarded — peak memory is just one file
	// at a time (capped at 30 MB). No total-budget cap: TikTok has 30+ DEX files
	// and protections can be anywhere, so we must scan all of them.
	const perDexLimit = 30 << 20 // 30 MB per-file cap
	var totalRead int
	for _, f := range zr.File {
		if !strings.HasSuffix(f.Name, ".dex") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			debugLog("detectProtections: open %s error: %v", f.Name, err)
			continue
		}
		td := time.Now()
		dexContent, err := io.ReadAll(io.LimitReader(rc, perDexLimit))
		rc.Close()
		if err != nil || len(dexContent) == 0 {
			debugLog("detectProtections: read %s error=%v len=%d", f.Name, err, len(dexContent))
			continue
		}
		totalRead += len(dexContent)
		debugLog("detectProtections: scanned %s — %.1f MB in %dms (running total %.1f MB)",
			f.Name, float64(len(dexContent))/(1<<20), time.Since(td).Milliseconds(), float64(totalRead)/(1<<20))

		for i, sig := range protectionSigs {
			for _, pat := range sig.dex {
				if bytes.Contains(dexContent, []byte(pat)) {
					addEvidence(i, pat)
				}
			}
		}
		dexContent = nil // allow GC before reading next file
	}
	debugLog("detectProtections: DEX scan done in %dms — %d MB scanned across all files", time.Since(t0).Milliseconds(), totalRead>>20)

	// Collect results, capping evidence at 3 items per protection.
	var results []detectedProtection
	for i, sig := range protectionSigs {
		if len(states[i].evidence) == 0 {
			continue
		}
		ev := states[i].evidence
		if len(ev) > 3 {
			ev = ev[:3]
		}
		results = append(results, detectedProtection{
			Name:     sig.name,
			Category: sig.category,
			Evidence: ev,
		})
	}

	// ── Network Security Config (NSC) certificate pinning ─────────────────────
	// Detect via the XML file — apps can pin without OkHttp by using NSC directly.
	for _, f := range zr.File {
		if !strings.HasSuffix(f.Name, ".xml") {
			continue
		}
		base := path.Base(f.Name)
		if base != "network_security_config.xml" && base != "security_config.xml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		xmlContent, err := io.ReadAll(io.LimitReader(rc, 64<<10)) // 64 KB max
		rc.Close()
		if err != nil {
			continue
		}
		if bytes.Contains(xmlContent, []byte("<pin-set")) || bytes.Contains(xmlContent, []byte("pin digest=")) {
			results = append(results, detectedProtection{
				Name:     "Network Security Config Pinning",
				Category: "cert-pinning",
				Evidence: []string{f.Name},
			})
		}
		break
	}

	return results
}

func (ws *webServer) handleDetectProtections(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	pkg := strings.TrimSpace(r.URL.Query().Get("package"))
	if pkg == "" {
		http.Error(w, "package required", 400)
		return
	}
	force := r.URL.Query().Get("force") == "1"

	// Serve from cache if available (unless force-refresh requested).
	if !force {
		ptCacheMu.RLock()
		if cached, ok := ptCache[pkg]; ok {
			ptCacheMu.RUnlock()
			jsonResponse(w, map[string]any{"protections": cached})
			return
		}
		ptCacheMu.RUnlock()
	} else {
		// Evict backend cache entry so we rescan.
		ptCacheMu.Lock()
		delete(ptCache, pkg)
		ptCacheMu.Unlock()
	}

	apkPath, err := getOrPullAPK(pkg)
	if err != nil {
		jsonResponse(w, map[string]any{
			"protections": []detectedProtection{},
			"error":       err.Error(),
		})
		return
	}

	protections := detectProtectionsFromAPK(apkPath)
	if protections == nil {
		protections = []detectedProtection{}
	}

	ptCacheMu.Lock()
	ptCache[pkg] = protections
	ptCacheMu.Unlock()

	jsonResponse(w, map[string]any{"protections": protections})
}

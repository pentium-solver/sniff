package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

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
	broker *stateBroker
}

func runWebServer(s settings) {
	broker := newStateBroker(s)
	ws := &webServer{broker: broker}

	mux := http.NewServeMux()
	mux.HandleFunc("/", ws.handleIndex)
	mux.HandleFunc("/api/health", ws.handleHealth)
	mux.HandleFunc("/api/state", ws.handleState)
	mux.HandleFunc("/api/flows", ws.handleFlows)
	mux.HandleFunc("/api/settings", ws.handleSettings)
	mux.HandleFunc("/api/device", ws.handleDevice)
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
	mux.HandleFunc("/api/events", ws.handleSSE)

	// Wrap mux with CORS middleware for cross-origin hosted frontend
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			corsHeaders(w)
			if r.Method == "OPTIONS" {
				w.WriteHeader(204)
				return
			}
		}
		mux.ServeHTTP(w, r)
	})

	addr := fmt.Sprintf(":%d", s.WebPort)
	fmt.Printf("\n")
	fmt.Printf("  \033[1msniff!\033[0m backend running on http://localhost%s\n", addr)
	fmt.Printf("  \033[2mOpen the dashboard to connect:\033[0m\n")
	fmt.Printf("  \033[34mhttps://sniff.cloud/connect\033[0m\n")
	fmt.Printf("\n")

	// Auto-open browser (skip if SNIFF_NO_OPEN is set, e.g. dev mode)
	if os.Getenv("SNIFF_NO_OPEN") == "" {
		go func() {
			time.Sleep(500 * time.Millisecond)
			exec.Command("open", "https://sniff.cloud/connect").Run()
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

	// Try to serve the exact file
	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}
	if f, err := webContent.Open(path[1:]); err == nil {
		f.Close()
		http.FileServerFS(webContent).ServeHTTP(w, r)
		return
	}

	// SPA fallback: serve index.html for all routes
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

func (ws *webServer) handleDevice(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)

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
	info := fetchDeviceInfo(fridaServer)
	jsonResponse(w, map[string]interface{}{
		"connected": true,
		"info":      info,
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
		Mode    string `json:"mode"`
		Package string `json:"package"`
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
	go ws.runCaptureSequence(mode)

	// Drain channels in background
	go ws.drainChannels()

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
	go func() {
		for entry := range logCh {
			b.addLog(entry.Msg, entry.Style)
		}
		// Log channel closed = capture sequence done
		b.mu.Lock()
		b.capturing = false
		b.mu.Unlock()
		b.setState(false)
	}()

	// Drain flow channel (not explicitly closed, stops when stopCh closes)
	go func() {
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
	}()
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
		"capturing":   b.capturing,
		"captureMode": b.captureModeLabel(),
		"captureName": b.captureName,
		"flowCount":   len(b.flows),
	})
	logsCopy := make([]logEntry, len(b.statusLines))
	copy(logsCopy, b.statusLines)
	b.mu.RUnlock()
	fmt.Fprintf(w, "event: state\ndata: %s\n\n", initData)
	for _, entry := range logsCopy {
		logData, _ := json.Marshal(entry)
		fmt.Fprintf(w, "event: log\ndata: %s\n\n", logData)
	}
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case evt := <-ch:
			data, _ := json.Marshal(evt.Data)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evt.Type, data)
			flusher.Flush()
		}
	}
}

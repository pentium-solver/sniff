package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/xlock-dev/sniff/internal/ai"
	"github.com/xlock-dev/sniff/internal/analysis"
	"github.com/xlock-dev/sniff/internal/capture"
	"github.com/xlock-dev/sniff/internal/config"
	"github.com/xlock-dev/sniff/internal/decompile"
	"github.com/xlock-dev/sniff/internal/logger"
)

// Server handles the HTTP API and SSE streaming.
type Server struct {
	engine    *capture.Engine
	decompile *decompile.Manager
	analysis  *analysis.EndpointMap
	ai        ai.Provider
	config    *config.Config
	mux       *http.ServeMux
	siteDir   string

	// SSE subscribers
	sseMu      sync.Mutex
	sseClients map[chan Event]struct{}
}

// Event represents an SSE message.
type Event struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// NewServer creates a new API server.
func NewServer(engine *capture.Engine, decomp *decompile.Manager, cfg *config.Config, analysisMap *analysis.EndpointMap) *Server {
	var aiProv ai.Provider
	if key := os.Getenv("OPENAI_API_KEY"); key != "" {
		aiProv = ai.NewOpenAIProvider(key)
		logger.Info("AI intelligence enabled (OpenAI)")
	}

	s := &Server{
		engine:     engine,
		decompile:  decomp,
		analysis:   analysisMap,
		ai:         aiProv,
		config:     cfg,
		mux:        http.NewServeMux(),
		sseClients: make(map[chan Event]struct{}),
		siteDir:    "site/out", // Default to local site dir
	}
	s.routes()
	return s
}

func (s *Server) routes() {
	// Public routes
	s.mux.HandleFunc("/api/health", s.handleHealth)
	s.mux.HandleFunc("/api/login", s.handleLogin)

	// Protected routes
	protected := http.NewServeMux()
	protected.HandleFunc("/api/state", s.handleState)
	protected.HandleFunc("/api/flows", s.handleFlows)
	protected.HandleFunc("/api/capture/start", s.handleStart)
	protected.HandleFunc("/api/capture/stop", s.handleStop)
	protected.HandleFunc("/api/capture/clear", s.handleCaptureClear)
	protected.HandleFunc("/api/events", s.handleEvents)

	// Device & Apps
	protected.HandleFunc("/api/device", s.handleDevice)
	protected.HandleFunc("/api/device/ping", s.handleDevicePing)
	protected.HandleFunc("/api/device/frida/start", s.handleDeviceFridaStart)
	protected.HandleFunc("/api/device/proxy/clear", s.handleDeviceProxyClear)
	protected.HandleFunc("/api/apps", s.handleApps)
	protected.HandleFunc("/api/scripts", s.handleScripts)
	protected.HandleFunc("/api/settings", s.handleSettings)
	protected.HandleFunc("/api/export", s.handleExport)
	protected.HandleFunc("/api/fingerprints", s.handleFingerprints)

	// Analysis
	protected.HandleFunc("/api/analysis/endpoints", s.handleAnalysisEndpoints)
	protected.HandleFunc("/api/analysis/openapi", s.handleAnalysisOpenAPI)
	protected.HandleFunc("/api/analysis/ai/context", s.handleAIContext)
	protected.HandleFunc("/api/analysis/correlate", s.handleAnalysisCorrelate)
	protected.HandleFunc("/api/analysis/audit", s.handleAnalysisAudit)

	// Detection (Legacy Frontend Support)
	protected.HandleFunc("/api/detect/frida", s.handleDetectFrida)
	protected.HandleFunc("/api/detect/framework", s.handleDetectFramework)
	protected.HandleFunc("/api/detect/protections", s.handleDetectProtections)
	protected.HandleFunc("/api/detect/pinning", s.handleDetectPinning)

	// Decompilation
	protected.HandleFunc("/api/decompile", s.handleDecompile)
	protected.HandleFunc("/api/decompile/tree", s.handleDecompileTree)
	protected.HandleFunc("/api/decompile/file", s.handleDecompileFile)
	protected.HandleFunc("/api/decompile/discover", s.handleDecompileDiscover)

	// Apply auth middleware to all protected routes
	s.mux.Handle("/api/", s.authMiddleware(protected))

	// Static Dashboard handler (Fallback for anything not /api/)
	s.mux.HandleFunc("/", s.handleStatic)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Global CORS Headers MUST be set before anything else
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")

	// Handle preflight requests immediately and successfully
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Serve the actual request
	s.mux.ServeHTTP(w, r)
}

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}

	path := filepath.Join(s.siteDir, r.URL.Path)
	
	// 1. Check if exact path exists
	fi, err := os.Stat(path)
	if err == nil && !fi.IsDir() {
		http.ServeFile(w, r, path)
		return
	}

	// 2. Try .html suffix (for clean Next.js routes)
	if err := s.tryServeHTML(w, r, path+".html"); err == nil {
		return
	}

	// 3. Fallback to index.html (SPA routing)
	http.ServeFile(w, r, filepath.Join(s.siteDir, "index.html"))
}

func (s *Server) tryServeHTML(w http.ResponseWriter, r *http.Request, path string) error {
	fi, err := os.Stat(path)
	if err == nil && !fi.IsDir() {
		http.ServeFile(w, r, path)
		return nil
	}
	return os.ErrNotExist
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "version": "0.1.0-alpha"})
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	state := s.engine.GetState()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"state": state,
	})
}

func (s *Server) handleFlows(w http.ResponseWriter, r *http.Request) {
	// For now, return empty array to prevent 404s.
	// In a full implementation, the Engine would store flows.
	json.NewEncoder(w).Encode([]interface{}{})
}

func (s *Server) handleDevice(w http.ResponseWriter, r *http.Request) {
	info, err := s.engine.GetADB().GetDeviceInfo(r.Context(), s.config.FridaServer)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"connected": info.Connected,
		"info":      info,
	})
}

func (s *Server) handleDevicePing(w http.ResponseWriter, r *http.Request) {
	// A fast ADB liveness check
	connected := s.engine.GetADB().Connected(r.Context())
	
	detail := "Ready"
	if !connected {
		detail = "No device found"
	}
	
	json.NewEncoder(w).Encode(map[string]interface{}{
		"connected": connected,
		"detail":    detail,
	})
}

func (s *Server) handleCaptureClear(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		// Frontend expects an array of key/value pairs
		fields := []map[string]interface{}{
			{"key": "package", "value": s.config.Package},
			{"key": "frida_script_id", "value": s.config.FridaScriptID},
			{"key": "host_ip", "value": s.config.HostIP},
			{"key": "frida_server", "value": s.config.FridaServer},
		}
		json.NewEncoder(w).Encode(fields)
		return
	}

	if r.Method == "PUT" {
		var req struct {
			Key   string      `json:"key"`
			Value interface{} `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Convert value to string for simple fields
		valStr := fmt.Sprintf("%v", req.Value)

		switch req.Key {
		case "package":
			s.config.Package = valStr
		case "frida_script_id":
			s.config.FridaScriptID = valStr
		case "host_ip":
			s.config.HostIP = valStr
		case "frida_server":
			s.config.FridaServer = valStr
		}
		s.config.Save()
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	}
}

func (s *Server) handleScripts(w http.ResponseWriter, r *http.Request) {
	// For now, return a hardcoded list of scripts so the frontend dropdown works.
	scripts := []map[string]string{
		{
			"ID": "universal",
			"Name": "Universal Unpinner",
			"Label": "General",
			"Desc": "Bypasses common SSL pinning (OkHttp, TrustManager, etc.)",
		},
		{
			"ID": "proxy_only",
			"Name": "Proxy Only (No Unpinning)",
			"Label": "Network",
			"Desc": "Only sets up the proxy, no Frida injection.",
		},
	}
	json.NewEncoder(w).Encode(scripts)
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AdapterID string `json:"adapter_id"`
		Package   string `json:"package"`
		ScriptID  string `json:"script_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Default to android if not specified (backward compatibility/convenience)
	if req.AdapterID == "" {
		req.AdapterID = "android"
	}

	if err := s.engine.Start(req.AdapterID, req.Package, req.ScriptID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	if err := s.engine.Stop(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	ch := make(chan Event, 100)
	s.sseMu.Lock()
	s.sseClients[ch] = struct{}{}
	s.sseMu.Unlock()

	defer func() {
		s.sseMu.Lock()
		delete(s.sseClients, ch)
		s.sseMu.Unlock()
	}()

	for {
		select {
		case ev := <-ch:
			data, _ := json.Marshal(ev.Data)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, string(data))
			w.(http.Flusher).Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "not_implemented_yet"})
}

func (s *Server) handleFingerprints(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode([]interface{}{})
}

func (s *Server) handleDeviceFridaStart(w http.ResponseWriter, r *http.Request) {
	if err := s.engine.GetFrida().StartServer(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) handleDeviceProxyClear(w http.ResponseWriter, r *http.Request) {
	if err := s.engine.GetADB().ClearProxy(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) handleApps(w http.ResponseWriter, r *http.Request) {
	apps, err := s.engine.GetADB().ListApps(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(apps)
}

func (s *Server) handleDecompile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Package string `json:"package"`
		APKPath string `json:"apk_path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := s.decompile.Start(r.Context(), req.Package, req.APKPath); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) handleDecompileTree(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	tree, err := s.decompile.GetTree(pkg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(tree)
}

func (s *Server) handleDecompileFile(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	path := r.URL.Query().Get("path")
	content, err := s.decompile.GetFileContent(pkg, path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"content": content})
}

func (s *Server) handleDecompileDiscover(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	outDir := filepath.Join(s.config.BaseDir, "jadx", strings.ReplaceAll(pkg, ".", "_"), "sources")

	endpoints, err := analysis.ScanForEndpoints(outDir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(endpoints)
}

func (s *Server) handleAnalysisEndpoints(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(s.analysis.GetSummary())
}

func (s *Server) handleAnalysisOpenAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/yaml")
	w.Write([]byte(s.analysis.GenerateOpenAPI()))
}

func (s *Server) handleAnalysisAudit(w http.ResponseWriter, r *http.Request) {
	apkPath := r.URL.Query().Get("apk_path")
	if apkPath == "" {
		http.Error(w, "missing apk_path", http.StatusBadRequest)
		return
	}

	protections, err := analysis.ScanAPKForProtections(apkPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(protections)
}

func (s *Server) handleAnalysisCorrelate(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	header := r.URL.Query().Get("header")

	if pkg == "" || header == "" {
		http.Error(w, "missing package or header", http.StatusBadRequest)
		return
	}

	outDir := filepath.Join(s.config.BaseDir, "jadx", strings.ReplaceAll(pkg, ".", "_"), "sources")

	matches, err := analysis.CorrelateSignature(outDir, header)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(matches)
}

func (s *Server) handleDetectFrida(w http.ResponseWriter, r *http.Request) {
	// Stub for frontend compatibility. Real implementation would probe device.
	json.NewEncoder(w).Encode(map[string]interface{}{
		"paths": []string{s.config.FridaServer},
	})
}

func (s *Server) handleDetectFramework(w http.ResponseWriter, r *http.Request) {
	apkPath := r.URL.Query().Get("apk_path")
	if apkPath == "" {
		pkg := r.URL.Query().Get("package")
		if pkg == "" {
			http.Error(w, "missing package", http.StatusBadRequest)
			return
		}
		var err error
		apkPath, err = s.engine.GetADB().GetAPKPath(r.Context(), pkg)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to find APK: %v", err), http.StatusInternalServerError)
			return
		}
		localAPK := filepath.Join(s.config.BaseDir, "cache", pkg+".apk")
		if !fileExists(localAPK) {
			s.engine.GetADB().PullAPK(r.Context(), apkPath, localAPK)
		}
		apkPath = localAPK
	}

	result := analysis.DetectFramework(apkPath)
	json.NewEncoder(w).Encode(result)
}

func (s *Server) handleDetectProtections(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	if pkg == "" {
		http.Error(w, "missing package", http.StatusBadRequest)
		return
	}

	apkPath := r.URL.Query().Get("apk_path")
	if apkPath == "" {
		remotePath, err := s.engine.GetADB().GetAPKPath(r.Context(), pkg)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to find APK: %v", err), http.StatusInternalServerError)
			return
		}
		localAPK := filepath.Join(s.config.BaseDir, "cache", pkg+".apk")
		os.MkdirAll(filepath.Dir(localAPK), 0755)
		if r.URL.Query().Get("force") == "1" || !fileExists(localAPK) {
			s.engine.GetADB().PullAPK(r.Context(), remotePath, localAPK)
		}
		apkPath = localAPK
	}

	protections, err := analysis.ScanAPKForProtections(apkPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	frontendProtections := make([]map[string]interface{}, 0, len(protections))
	for _, p := range protections {
		category := p.Category
		if category == "" {
			category = "anti-tamper"
		}
		frontendProtections = append(frontendProtections, map[string]interface{}{
			"name":     p.Name,
			"category": category,
			"evidence": p.Evidence,
		})
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"protections": frontendProtections,
	})
}

func (s *Server) handleDetectPinning(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	if pkg == "" {
		http.Error(w, "missing package", http.StatusBadRequest)
		return
	}

	apkPath := r.URL.Query().Get("apk_path")
	if apkPath == "" {
		var err error
		remotePath, err := s.engine.GetADB().GetAPKPath(r.Context(), pkg)
		if err == nil {
			localAPK := filepath.Join(s.config.BaseDir, "cache", pkg+".apk")
			if !fileExists(localAPK) {
				s.engine.GetADB().PullAPK(r.Context(), remotePath, localAPK)
			}
			apkPath = localAPK
		}
	}

	if apkPath != "" {
		result := analysis.AnalyzePinningFromAPK(pkg, apkPath)
		json.NewEncoder(w).Encode(result)
	} else {
		// Fallback
		json.NewEncoder(w).Encode(map[string]interface{}{
			"package":    pkg,
			"mechanisms": []interface{}{},
			"pins":       []interface{}{},
			"script":     "",
			"script_name": "",
			"summary":    "0 mechanism(s)",
			"elapsed_ms": 0,
		})
	}
}

func (s *Server) handleAIContext(w http.ResponseWriter, r *http.Request) {
	if s.ai == nil {
		http.Error(w, "AI features not enabled", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Method string `json:"method"`
		URL    string `json:"url"`
		Body   string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	explanation, err := s.ai.ContextualizeFlow(r.Context(), req.Method, req.URL, req.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"explanation": explanation})
}

// Helper to check if file exists
func fileExists(filename string) bool {
	info, err := os.Stat(filename)
	if os.IsNotExist(err) {
		return false
	}
	return !info.IsDir()
}

// Broadcast sends an event to all connected SSE clients.
func (s *Server) Broadcast(ev Event) {
	s.sseMu.Lock()
	defer s.sseMu.Unlock()
	for ch := range s.sseClients {
		select {
		case ch <- ev:
		default:
			logger.Warn("SSE client buffer full, dropping event", "type", ev.Type)
		}
	}
}

package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/atotto/clipboard"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ── View States ──────────────────────────────────────────────────────────────

type viewState int

const (
	stateMenu viewState = iota
	stateSettings
	stateScripts
	stateCapture
	stateDetail
	stateLogs
	stateDevice
	stateApps
	stateProcs
	stateAppModes
)

// ── Styles ───────────────────────────────────────────────────────────────────

var (
	titleStyle  = lipgloss.NewStyle().Bold(true)
	dimStyle    = lipgloss.NewStyle().Faint(true)
	boldStyle   = lipgloss.NewStyle().Bold(true)
	cyanStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("6"))
	greenStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))
	yellowStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("3"))
	redStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))
	magStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("5"))
	blueStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("4"))

	panelBorder = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("6")).
			Padding(0, 1)
	focusedBorder = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("3")).
			Padding(0, 1)
	dimBorder = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("8")).
			Padding(0, 1)
	keyStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("6"))
)

func labelStyle(color string) lipgloss.Style {
	c := map[string]string{
		"green": "2", "cyan": "6", "yellow": "3",
		"magenta": "5", "blue": "4", "red": "1",
	}
	return lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color(c[color]))
}

// ── Frida Script Registry ────────────────────────────────────────────────────

type fridaScript struct {
	ID         string
	Name       string
	Label      string
	LabelColor string
	Path       string
	Desc       string
}

var baseDir string

const handoffConfigDevicePath = "/data/local/tmp/pilot_fj_handoff_config.json"
const fridaProxyConfigDevicePath = "/data/local/tmp/frida_proxy_config.json"

func initBaseDir() {
	exe, err := os.Executable()
	if err != nil {
		baseDir = "."
	} else {
		baseDir = filepath.Dir(filepath.Dir(exe))
	}
	// Fallback: use relative to CWD if scripts not found
	if _, err := os.Stat(filepath.Join(baseDir, "frida_universal_unpin.js")); err != nil {
		// Try parent of sniff-tui/
		cwd, _ := os.Getwd()
		parent := filepath.Dir(cwd)
		if _, err := os.Stat(filepath.Join(parent, "frida_universal_unpin.js")); err == nil {
			baseDir = parent
		} else {
			baseDir = cwd
		}
	}
}

func scriptPath(rel string) string {
	return filepath.Join(baseDir, rel)
}

func fridaScripts() []fridaScript {
	return []fridaScript{
		{"universal", "Universal SSL Unpin", "BEST", "green",
			scriptPath("frida_universal_unpin.js"),
			"Hooks everything: TrustManager, OkHttp, Conscrypt, ProxySelector, HostnameVerifier, WebView, TrustKit, Appmattus, Netty, Splunk crash fix. Use this first."},
		{"trustmanager", "TrustManager Only", "LIGHTWEIGHT", "cyan",
			scriptPath("frida_scripts/trustmanager_only.js"),
			"Minimal hooks — just Android platform TLS. Lowest crash risk. Good for basic apps, WebView, HttpsURLConnection."},
		{"okhttp", "OkHttp Pinner + Proxy", "OKHTTP APPS", "yellow",
			scriptPath("frida_scripts/okhttp_pinner.js"),
			"OkHttp CertificatePinner + custom ProxySelector scanning. Good for Retrofit/OkHttp apps that ignore system proxy."},
		{"proxy_only", "Proxy Redirect Only", "DIAGNOSTIC", "magenta",
			scriptPath("frida_scripts/proxy_only.js"),
			"Forces traffic through proxy WITHOUT SSL bypass. Use to test if CA is already trusted."},
		{"webview", "WebView + HttpsURLConnection", "HYBRID APPS", "blue",
			scriptPath("frida_scripts/webview_bypass.js"),
			"WebView auto-proceed + HttpsURLConnection bypass. Good for Cordova, Ionic, banking apps."},
		{"react_native", "React Native", "RN APPS", "blue",
			scriptPath("frida_scripts/react_native_bypass.js"),
			"RN OkHttpClientProvider + TrustKit + platform TrustManager."},
		{"flutter", "Flutter / Dart", "FLUTTER", "red",
			scriptPath("frida_scripts/flutter_bypass.js"),
			"Native BoringSSL in libflutter.so. Requires iptables redirect or transparent proxy."},
		{"pilot_fj", "Pilot Flying J", "APP-SPECIFIC", "red",
			scriptPath("frida_scripts/pilot_fj.js"),
			"Proven on com.pilottravelcenters.mypilot. Hooks bE1.select, ON.a, TrustManagerImpl, Splunk. Proxy IP hardcoded."},
	}
}

func pilotSignupHandoffScript() fridaScript {
	return fridaScript{
		ID:         "pilot_fj_signup_handoff",
		Name:       "Pilot Signup Handoff",
		Label:      "HANDOFF",
		LabelColor: "red",
		Path:       scriptPath("frida_scripts/pilot_fj_signup_handoff.js"),
		Desc:       "Pilot-specific signup handoff: leave PingOne direct, freeze on the callback, enable proxy, then resume to capture immediate post-signup app traffic.",
	}
}

func linkedInCronetScript() fridaScript {
	return fridaScript{
		ID:         "linkedin_cronet",
		Name:       "LinkedIn Cronet Patch",
		Label:      "LINKEDIN",
		LabelColor: "blue",
		Path:       scriptPath("frida_scripts/linkedin_cronet_patch.js"),
		Desc:       "Spawn-time LinkedIn-specific Cronet patch: disable QUIC, warmup URL, DNS remap, and stale-DNS treatment before network init, then keep a minimal TLS bypass active for MITM.",
	}
}

func linkedInChallengeTraceScript() fridaScript {
	return fridaScript{
		ID:         "linkedin_challenge_trace",
		Name:       "LinkedIn Challenge Trace",
		Label:      "LI-REPLAY",
		LabelColor: "magenta",
		Path:       scriptPath("frida_scripts/linkedin_challenge_trace.js"),
		Desc:       "Hooks LinkedIn auth challenge flow: LiAuthImpl, LiAuthWebActivity, WebView checkpoint URLs, JSBridge, and CookieManager.",
	}
}

func dailyPayScript() fridaScript {
	return fridaScript{
		ID:         "dailypay",
		Name:       "DailyPay SSL Bypass",
		Label:      "DAILYPAY",
		LabelColor: "red",
		Path:       scriptPath("frida_scripts/dailypay_bypass.js"),
		Desc:       "DailyPay-specific: universal SSL unpin + APEX conscrypt cert injection for WebView/Chromium.",
	}
}

func speedwayScript() fridaScript {
	return fridaScript{
		ID:         "speedway",
		Name:       "Speedway SSL Bypass",
		Label:      "SPEEDWAY",
		LabelColor: "red",
		Path:       scriptPath("frida_scripts/speedway_bypass.js"),
		Desc:       "Speedway/7-Eleven-specific: OkHttp3 CertificatePinner, TrustManagerImpl, Distil/Imperva ABP stub, DataTheorem neutralize, connection pool eviction.",
	}
}

func papajohnsScript() fridaScript {
	return fridaScript{
		ID:         "papajohns",
		Name:       "Papa Johns Flutter Bypass",
		Label:      "PAPAJOHNS",
		LabelColor: "red",
		Path:       scriptPath("frida_scripts/papajohns_bypass.js"),
		Desc:       "Papa Johns Flutter app: BoringSSL native patch + Java TrustManager fallback. Uses tproxy-connect + iptables for routing (Flutter ignores system proxy).",
	}
}

// ── Settings ─────────────────────────────────────────────────────────────────

type settings struct {
	Package       string `json:"package"`
	Port          int    `json:"port"`
	AttachDelay   int    `json:"attach_delay"`
	IgnoreHosts   string `json:"ignore_hosts"`
	FridaScriptID string `json:"frida_script_id"`
	CapturesDir   string `json:"captures_dir"`
	FridaServer   string `json:"frida_server"`
	HostIP        string `json:"host_ip"`
	ExportFormat  string `json:"export_format"`
	UIMode        string `json:"ui_mode"`
	WebPort       int    `json:"web_port"`
}

func settingsPath() string { return filepath.Join(baseDir, "settings.json") }

func defaultSettings() settings {
	home, _ := os.UserHomeDir()
	return settings{
		Port:          8080,
		AttachDelay:   10,
		IgnoreHosts:   `.*perimeterx\.net|.*perfdrive\.com|.*px-cdn\.net|.*px-cloud\.net`,
		FridaScriptID: "universal",
		CapturesDir:   filepath.Join(home, "coding", "ios-re", "captures"),
		FridaServer:   "/data/local/tmp/fs-helper-64",
		ExportFormat:  "json",
		UIMode:        "tui",
		WebPort:       9090,
	}
}

func loadSettings() settings {
	s := defaultSettings()
	data, err := os.ReadFile(settingsPath())
	if err == nil {
		json.Unmarshal(data, &s)
	}
	return s
}

func (s *settings) Save() {
	data, _ := json.MarshalIndent(s, "", "  ")
	os.WriteFile(settingsPath(), data, 0644)
}

func (s *settings) GetScript() fridaScript {
	for _, sc := range fridaScripts() {
		if sc.ID == s.FridaScriptID {
			return sc
		}
	}
	return fridaScripts()[0]
}

type settingsField struct {
	Key   string
	Label string
}

var settingsFields = []settingsField{
	{"package", "Package name"},
	{"port", "Proxy port"},
	{"attach_delay", "Frida attach delay (s)"},
	{"ignore_hosts", "Ignore hosts (regex|regex)"},
	{"captures_dir", "Captures directory"},
	{"frida_server", "Frida server path (device)"},
	{"host_ip", "Host IP (blank=auto)"},
	{"export_format", "Export format (json/har)"},
	{"ui_mode", "UI mode (tui/web)"},
	{"web_port", "Web UI port"},
}

func (s *settings) GetField(key string) string {
	switch key {
	case "package":
		return s.Package
	case "port":
		return strconv.Itoa(s.Port)
	case "attach_delay":
		return strconv.Itoa(s.AttachDelay)
	case "ignore_hosts":
		return s.IgnoreHosts
	case "captures_dir":
		return s.CapturesDir
	case "frida_server":
		return s.FridaServer
	case "host_ip":
		return s.HostIP
	case "export_format":
		return s.ExportFormat
	case "ui_mode":
		return s.UIMode
	case "web_port":
		return strconv.Itoa(s.WebPort)
	}
	return ""
}

func (s *settings) SetField(key, val string) {
	switch key {
	case "package":
		s.Package = val
	case "port":
		if v, err := strconv.Atoi(val); err == nil {
			s.Port = v
		}
	case "attach_delay":
		if v, err := strconv.Atoi(val); err == nil {
			s.AttachDelay = v
		}
	case "ignore_hosts":
		s.IgnoreHosts = val
	case "captures_dir":
		s.CapturesDir = val
	case "frida_server":
		s.FridaServer = val
	case "host_ip":
		s.HostIP = val
	case "export_format":
		s.ExportFormat = val
	case "ui_mode":
		s.UIMode = val
	case "web_port":
		if v, err := strconv.Atoi(val); err == nil {
			s.WebPort = v
		}
	}
}

// ── ADB Controller ───────────────────────────────────────────────────────────

func adbShell(cmd string) string {
	ctx, cancel := execTimeout(10)
	defer cancel()
	out, _ := exec.CommandContext(ctx, "adb", "shell", cmd).Output()
	return strings.TrimSpace(strings.ReplaceAll(string(out), "\r", ""))
}

func hostCmd(cmd string) string {
	ctx, cancel := execTimeout(10)
	defer cancel()
	out, _ := exec.CommandContext(ctx, "bash", "-c", cmd).Output()
	return strings.TrimSpace(string(out))
}

func execTimeout(secs int) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), time.Duration(secs)*time.Second)
}

// Redo with proper timeout
func runCmd(name string, args ...string) string {
	cmd := exec.Command(name, args...)
	cmd.Env = os.Environ()
	done := make(chan struct{})
	var out []byte
	go func() {
		out, _ = cmd.Output()
		close(done)
	}()
	select {
	case <-done:
		return strings.TrimSpace(strings.ReplaceAll(string(out), "\r", ""))
	case <-time.After(10 * time.Second):
		cmd.Process.Kill()
		return ""
	}
}

func adbRun(shellCmd string) string {
	return runCmd("adb", "shell", shellCmd)
}

func adbConnected() bool {
	out := runCmd("adb", "devices")
	for _, line := range strings.Split(out, "\n")[1:] {
		if strings.Contains(line, "\tdevice") {
			return true
		}
	}
	return false
}

type deviceInfo struct {
	Model        string
	Android      string
	SDK          string
	SELinux      string
	FridaRunning bool
	Proxy        string
	HostIP       string
	Connected    bool
}

func fetchDeviceInfo(fridaServer string) deviceInfo {
	return deviceInfo{
		Model:        adbRun("getprop ro.product.model"),
		Android:      adbRun("getprop ro.build.version.release"),
		SDK:          adbRun("getprop ro.build.version.sdk"),
		SELinux:      adbRun("su -c 'getenforce'"),
		FridaRunning: adbFridaRunning(fridaServer),
		Proxy:        adbGetProxy(),
		HostIP:       detectHostIP(),
		Connected:    adbConnected(),
	}
}

func adbFridaRunning(serverPath string) bool {
	base := filepath.Base(serverPath)
	out := adbRun(fmt.Sprintf("su -c 'pidof %s 2>/dev/null || echo no'", base))
	return out != "no" && out != ""
}

func adbGetProxy() string {
	out := adbRun("settings get global http_proxy")
	if out == "" || out == ":0" || out == "null" {
		return ""
	}
	return out
}

func detectHostIP() string {
	ip := hostCmd("ipconfig getifaddr en0 2>/dev/null")
	if ip == "" {
		ip = hostCmd("ifconfig en0 2>/dev/null | grep 'inet ' | awk '{print $2}'")
	}
	return ip
}

func adbSetProxy(host string, port int) {
	adbRun(fmt.Sprintf("settings put global http_proxy %s:%d", host, port))
}

func adbClearProxy()          { adbRun("settings put global http_proxy :0") }
func adbSELinuxPermissive()   { adbRun("su -c 'setenforce 0'") }
func adbSELinuxEnforcing()    { adbRun("su -c 'setenforce 1'") }
func adbForceStop(pkg string) { adbRun(fmt.Sprintf("am force-stop %s", pkg)) }

func adbLaunchApp(pkg string) {
	adbRun(fmt.Sprintf("monkey -p %s -c android.intent.category.LAUNCHER 1", pkg))
}

func adbGetPID(pkg string) int {
	out := adbRun(fmt.Sprintf("pidof %s 2>/dev/null || true", pkg))
	pid, err := strconv.Atoi(out)
	if err != nil {
		return 0
	}
	return pid
}

func adbSignalPID(pid int, signal string) error {
	ctx, cancel := execTimeout(10)
	defer cancel()
	return exec.CommandContext(ctx, "adb", "shell", fmt.Sprintf("su -c 'kill -%s %d'", signal, pid)).Run()
}

func adbPushFile(localPath, devicePath string) error {
	ctx, cancel := execTimeout(10)
	defer cancel()
	if err := exec.CommandContext(ctx, "adb", "push", localPath, devicePath).Run(); err != nil {
		return err
	}
	ctx, cancel = execTimeout(10)
	defer cancel()
	return exec.CommandContext(ctx, "adb", "shell", "chmod", "0644", devicePath).Run()
}

func adbWritePilotHandoffConfig(host string, port int, enabled bool) error {
	payload, err := json.Marshal(map[string]interface{}{
		"host":    host,
		"port":    port,
		"enabled": enabled,
		"domains": []string{"pilotflyingj.com", "pilotcloud.net", "contentstack.io"},
	})
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp("", "pilot_fj_handoff_*.json")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(payload); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return adbPushFile(tmpPath, handoffConfigDevicePath)
}

func adbWriteFridaProxyConfig(host string, port int) error {
	payload, err := json.Marshal(map[string]interface{}{
		"host": host,
		"port": port,
	})
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp("", "frida_proxy_config_*.json")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(payload); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return adbPushFile(tmpPath, fridaProxyConfigDevicePath)
}

func adbStartFridaServer(serverPath string) {
	if !adbFridaRunning(serverPath) {
		cmd := exec.Command("adb", "shell", fmt.Sprintf("su -c '%s -D &'", serverPath))
		cmd.Start()
		time.Sleep(2 * time.Second)
	}
}

func adbGetLauncher(pkg string) string {
	out := adbRun(fmt.Sprintf("dumpsys package %s | grep -A1 'android.intent.action.MAIN' | grep '/' | head -1", pkg))
	// Extract component name like com.foo/com.foo.Activity
	for _, part := range strings.Fields(out) {
		if strings.Contains(part, "/") && strings.Contains(part, ".") {
			part = strings.Trim(part, "{} ")
			return part
		}
	}
	return ""
}

func adbRestartActivity(pkg string) string {
	launcher := adbGetLauncher(pkg)
	if launcher != "" {
		adbRun(fmt.Sprintf("am start -n %s --activity-clear-top", launcher))
		return launcher
	}
	adbLaunchApp(pkg)
	return ""
}

func adbCheckConnectivity(host string, port int) bool {
	out := adbRun(fmt.Sprintf("su -c '(echo HEAD / HTTP/1.0; echo) | nc -w 2 %s %d 2>&1 | head -1'", host, port))
	return out != ""
}

func adbListPackages() []string {
	out := adbRun("pm list packages -3 2>/dev/null")
	var pkgs []string
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, "package:") {
			pkgs = append(pkgs, strings.TrimPrefix(line, "package:"))
		}
	}
	return pkgs
}

func adbListRunningApps() []listItem {
	out := adbRun("ps -A -o PID,NAME 2>/dev/null || ps -A")
	var items []listItem
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		name := fields[len(fields)-1]
		if strings.Contains(name, ".") && !strings.HasPrefix(name, "[") {
			items = append(items, listItem{Name: name, ID: name, PID: pid})
		}
	}
	return items
}

func fridaPsApps() []listItem {
	out := runCmd("frida-ps", "-Uai")
	var items []listItem
	for _, line := range strings.Split(out, "\n")[1:] {
		fields := strings.Fields(line)
		if len(fields) >= 3 {
			pid, _ := strconv.Atoi(fields[0])
			name := strings.Join(fields[1:len(fields)-1], " ")
			identifier := fields[len(fields)-1]
			items = append(items, listItem{Name: name, ID: identifier, PID: pid})
		}
	}
	return items
}

func fridaPsProcs() []listItem {
	out := runCmd("frida-ps", "-U")
	var items []listItem
	for _, line := range strings.Split(out, "\n")[1:] {
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			pid, _ := strconv.Atoi(fields[0])
			name := strings.Join(fields[1:], " ")
			items = append(items, listItem{Name: name, ID: name, PID: pid})
		}
	}
	return items
}

// ── Captured Flow ────────────────────────────────────────────────────────────

type capturedFlow struct {
	Timestamp   float64           `json:"ts"`
	Method      string            `json:"method"`
	URL         string            `json:"url"`
	Host        string            `json:"host"`
	Path        string            `json:"path"`
	Status      int               `json:"status"`
	ReqSize     int               `json:"req_size"`
	RespSize    int               `json:"resp_size"`
	ContentType string            `json:"content_type"`
	ReqHeaders  map[string]string `json:"req_headers"`
	RespHeaders map[string]string `json:"resp_headers"`
	ReqBody     *string           `json:"req_body"`
	RespBody    *string           `json:"resp_body"`
}

type flowResourceFilter string

const (
	resourceFilterAll    flowResourceFilter = "all"
	resourceFilterXHR    flowResourceFilter = "xhr"
	resourceFilterJS     flowResourceFilter = "js"
	resourceFilterCSS    flowResourceFilter = "css"
	resourceFilterImages flowResourceFilter = "images"
	resourceFilterFonts  flowResourceFilter = "fonts"
	resourceFilterMedia  flowResourceFilter = "media"
	resourceFilterHTML   flowResourceFilter = "html"
	resourceFilterOther  flowResourceFilter = "other"
)

var resourceFilterOrder = []flowResourceFilter{
	resourceFilterAll,
	resourceFilterXHR,
	resourceFilterJS,
	resourceFilterCSS,
	resourceFilterImages,
	resourceFilterFonts,
	resourceFilterMedia,
	resourceFilterHTML,
	resourceFilterOther,
}

func (f *capturedFlow) Time() time.Time {
	return time.Unix(int64(f.Timestamp), int64((f.Timestamp-float64(int64(f.Timestamp)))*1e9))
}

func (f *capturedFlow) SizeStr() string {
	if f.RespSize >= 1024 {
		return fmt.Sprintf("%dK", f.RespSize/1024)
	}
	if f.RespSize > 0 {
		return strconv.Itoa(f.RespSize)
	}
	return "-"
}

// ── Mitmdump Addon ───────────────────────────────────────────────────────────

const mitmAddon = `import json
from mitmproxy import http
class Capture:
    def response(self, flow: http.HTTPFlow):
        d = {
            "ts": flow.request.timestamp_start,
            "method": flow.request.method,
            "url": flow.request.pretty_url,
            "host": flow.request.host,
            "path": flow.request.path,
            "status": flow.response.status_code if flow.response else 0,
            "req_size": len(flow.request.content) if flow.request.content else 0,
            "resp_size": len(flow.response.content) if flow.response and flow.response.content else 0,
            "content_type": flow.response.headers.get("content-type","") if flow.response else "",
            "req_headers": dict(flow.request.headers),
            "resp_headers": dict(flow.response.headers) if flow.response else {},
            "req_body": flow.request.content.decode("utf-8","replace")[:5000] if flow.request.content else None,
            "resp_body": flow.response.content.decode("utf-8","replace")[:5000] if flow.response and flow.response.content else None,
        }
        with open("/tmp/sniff_flows.jsonl", "a") as f:
            f.write(json.dumps(d, default=str) + "\n")
addons = [Capture()]
`

const jsonlPath = "/tmp/sniff_flows.jsonl"
const addonPath = "/tmp/sniff_addon.py"

// ── Mitmdump Manager ─────────────────────────────────────────────────────────

type mitmdumpManager struct {
	cmd     *exec.Cmd
	running bool
}

func (m *mitmdumpManager) Start(port int, ignoreHosts string) error {
	os.WriteFile(addonPath, []byte(mitmAddon), 0644)
	os.Remove(jsonlPath)

	args := []string{
		"--listen-port", strconv.Itoa(port),
		"--set", "flow_detail=0",
		"-s", addonPath,
	}
	if ignoreHosts != "" {
		args = append(args, "--ignore-hosts", ignoreHosts)
	}

	m.cmd = exec.Command("mitmdump", args...)
	m.cmd.Stdout = nil
	m.cmd.Stderr = nil
	if err := m.cmd.Start(); err != nil {
		return err
	}
	m.running = true
	return nil
}

func (m *mitmdumpManager) Stop() {
	if m.cmd != nil && m.cmd.Process != nil {
		m.cmd.Process.Signal(os.Interrupt)
		done := make(chan error)
		go func() { done <- m.cmd.Wait() }()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			m.cmd.Process.Kill()
		}
	}
	m.running = false
}

// ── Frida Manager ────────────────────────────────────────────────────────────

type fridaManager struct {
	cmd     *exec.Cmd
	logs    []string
	mu      sync.Mutex
	session bool
}

func (f *fridaManager) Attach(pid int, scriptPath, proxyHost string, proxyPort int) error {
	config, _ := json.Marshal(map[string]interface{}{"host": proxyHost, "port": proxyPort})
	os.WriteFile("/tmp/frida_proxy_config.json", config, 0644)
	adbWriteFridaProxyConfig(proxyHost, proxyPort)

	// Kill stale frida processes
	exec.Command("pkill", "-f", "frida -U").Run()
	time.Sleep(500 * time.Millisecond)

	f.mu.Lock()
	f.logs = nil
	f.mu.Unlock()

	f.cmd = exec.Command("frida", "-U", "-p", strconv.Itoa(pid), "-l", scriptPath)
	stdout, err := f.cmd.StdoutPipe()
	if err != nil {
		return err
	}
	f.cmd.Stderr = f.cmd.Stdout
	if err := f.cmd.Start(); err != nil {
		return err
	}
	f.session = true

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			f.mu.Lock()
			f.logs = append(f.logs, line)
			if len(f.logs) > 300 {
				f.logs = f.logs[len(f.logs)-300:]
			}
			f.mu.Unlock()
		}
	}()

	return nil
}

func (f *fridaManager) Spawn(pkg, scriptPath, proxyHost string, proxyPort int) error {
	config, _ := json.Marshal(map[string]interface{}{"host": proxyHost, "port": proxyPort})
	os.WriteFile("/tmp/frida_proxy_config.json", config, 0644)
	adbWriteFridaProxyConfig(proxyHost, proxyPort)

	exec.Command("pkill", "-f", "frida -U").Run()
	time.Sleep(500 * time.Millisecond)

	f.mu.Lock()
	f.logs = nil
	f.mu.Unlock()

	f.cmd = exec.Command("frida", "-U", "-f", pkg, "-l", scriptPath)
	stdout, err := f.cmd.StdoutPipe()
	if err != nil {
		return err
	}
	f.cmd.Stderr = f.cmd.Stdout
	if err := f.cmd.Start(); err != nil {
		return err
	}
	f.session = true

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			f.mu.Lock()
			f.logs = append(f.logs, line)
			if len(f.logs) > 300 {
				f.logs = f.logs[len(f.logs)-300:]
			}
			f.mu.Unlock()
		}
	}()

	return nil
}

func (f *fridaManager) SpawnMultiScript(pkg string, scriptPaths []string, proxyHost string, proxyPort int) error {
	config, _ := json.Marshal(map[string]interface{}{"host": proxyHost, "port": proxyPort})
	os.WriteFile("/tmp/frida_proxy_config.json", config, 0644)
	adbWriteFridaProxyConfig(proxyHost, proxyPort)

	exec.Command("pkill", "-f", "frida -U").Run()
	time.Sleep(500 * time.Millisecond)

	// Concatenate all scripts into a temp file
	combined, err := os.CreateTemp("", "frida-combined-*.js")
	if err != nil {
		return fmt.Errorf("create temp script: %w", err)
	}
	for i, sp := range scriptPaths {
		data, err := os.ReadFile(sp)
		if err != nil {
			combined.Close()
			os.Remove(combined.Name())
			return fmt.Errorf("read script %s: %w", sp, err)
		}
		if i > 0 {
			combined.WriteString("\n\n// ── next script ──\n\n")
		}
		combined.Write(data)
	}
	combined.Close()

	f.mu.Lock()
	f.logs = nil
	f.mu.Unlock()

	f.cmd = exec.Command("frida", "-U", "-f", pkg, "-l", combined.Name())
	stdout, err := f.cmd.StdoutPipe()
	if err != nil {
		os.Remove(combined.Name())
		return err
	}
	f.cmd.Stderr = f.cmd.Stdout
	if err := f.cmd.Start(); err != nil {
		os.Remove(combined.Name())
		return err
	}
	f.session = true

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			f.mu.Lock()
			f.logs = append(f.logs, line)
			if len(f.logs) > 300 {
				f.logs = f.logs[len(f.logs)-300:]
			}
			f.mu.Unlock()
		}
		os.Remove(combined.Name())
	}()

	return nil
}

func (f *fridaManager) GetLogs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.logs))
	copy(out, f.logs)
	return out
}

func (f *fridaManager) Detach() {
	if f.cmd != nil && f.cmd.Process != nil {
		f.cmd.Process.Signal(os.Interrupt)
		done := make(chan error)
		go func() { done <- f.cmd.Wait() }()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			f.cmd.Process.Kill()
		}
	}
	f.cmd = nil
	f.session = false
}

// ── Export ────────────────────────────────────────────────────────────────────

func exportJSON(flows []capturedFlow, path string) (int, error) {
	type entry struct {
		Timestamp   string            `json:"timestamp"`
		Method      string            `json:"method"`
		URL         string            `json:"url"`
		Host        string            `json:"host"`
		Path        string            `json:"path"`
		Status      int               `json:"status"`
		ReqSize     int               `json:"req_size"`
		RespSize    int               `json:"resp_size"`
		ContentType string            `json:"content_type"`
		ReqHeaders  map[string]string `json:"req_headers"`
		RespHeaders map[string]string `json:"resp_headers"`
		ReqBody     *string           `json:"req_body"`
		RespBody    *string           `json:"resp_body"`
	}
	var entries []entry
	for _, f := range flows {
		entries = append(entries, entry{
			Timestamp: f.Time().Format(time.RFC3339), Method: f.Method, URL: f.URL,
			Host: f.Host, Path: f.Path, Status: f.Status, ReqSize: f.ReqSize,
			RespSize: f.RespSize, ContentType: f.ContentType,
			ReqHeaders: f.ReqHeaders, RespHeaders: f.RespHeaders,
			ReqBody: f.ReqBody, RespBody: f.RespBody,
		})
	}
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return 0, err
	}
	return len(entries), os.WriteFile(path, data, 0644)
}

func exportHAR(flows []capturedFlow, path string) (int, error) {
	type harEntry struct {
		StartedDateTime string      `json:"startedDateTime"`
		Time            int         `json:"time"`
		Request         interface{} `json:"request"`
		Response        interface{} `json:"response"`
		Cache           struct{}    `json:"cache"`
		Timings         interface{} `json:"timings"`
	}
	var entries []harEntry
	for _, f := range flows {
		rqh := []map[string]string{}
		for k, v := range f.ReqHeaders {
			rqh = append(rqh, map[string]string{"name": k, "value": v})
		}
		rsh := []map[string]string{}
		for k, v := range f.RespHeaders {
			rsh = append(rsh, map[string]string{"name": k, "value": v})
		}
		rb := ""
		if f.RespBody != nil {
			rb = *f.RespBody
		}
		req := map[string]interface{}{
			"method":      f.Method,
			"url":         f.URL,
			"httpVersion": "HTTP/1.1",
			"headers":     rqh,
			"queryString": []string{},
			"cookies":     []string{},
			"headersSize": -1,
			"bodySize":    f.ReqSize,
		}
		if f.ReqBody != nil {
			req["postData"] = map[string]interface{}{
				"mimeType": headerValue(f.ReqHeaders, "content-type"),
				"text":     *f.ReqBody,
			}
		}
		entries = append(entries, harEntry{
			StartedDateTime: f.Time().Format(time.RFC3339),
			Request: req,
			Response: map[string]interface{}{
				"status": f.Status, "statusText": "", "httpVersion": "HTTP/1.1",
				"headers": rsh, "cookies": []string{},
				"content": map[string]interface{}{
					"size": f.RespSize, "mimeType": f.ContentType, "text": rb,
				},
				"redirectURL": "", "headersSize": -1, "bodySize": f.RespSize,
			},
			Timings: map[string]int{"send": 0, "wait": 0, "receive": 0},
		})
	}
	har := map[string]interface{}{
		"log": map[string]interface{}{
			"version": "1.2",
			"creator": map[string]string{"name": "sniff-tui", "version": "1.0"},
			"entries": entries,
		},
	}
	data, err := json.MarshalIndent(har, "", "  ")
	if err != nil {
		return 0, err
	}
	return len(entries), os.WriteFile(path, data, 0644)
}

// ── List Item ────────────────────────────────────────────────────────────────

type listItem struct {
	Name string
	ID   string
	PID  int
}

type captureMode int

const (
	captureModeStandard captureMode = iota
	captureModeMitmOnly
	captureModeSignupHandoff
	captureModeLinkedInCronet
	captureModeLinkedInReplay
	captureModeDailyPay
	captureModeSpeedway
	captureModePapaJohns
)

// ── Log Entry ────────────────────────────────────────────────────────────────

type logEntry struct {
	Time  string
	Msg   string
	Style string // "green", "red", "yellow", ""
}

// ── Tea Messages ─────────────────────────────────────────────────────────────

type flowMsg capturedFlow
type flowTickMsg time.Time
type captureLogMsg logEntry
type captureDoneMsg struct{}
type deviceInfoMsg deviceInfo
type listDataMsg []listItem
type exportDoneMsg struct {
	Count int
	Path  string
	Err   string
}

// ── Model ────────────────────────────────────────────────────────────────────

type model struct {
	width, height int
	state         viewState

	settings       settings
	settingsCursor int
	editingField   int // -1 = not editing
	editingValue   string

	scriptsCursor int

	flows        []capturedFlow
	selectedFlow int
	filterText   string
	typeFilter   flowResourceFilter
	captureFocus string // "requests" or "logs"
	appPID       int
	captureName  string
	captureMode  captureMode
	capturing    bool

	mitmdump *mitmdumpManager
	frida    *fridaManager
	flowChan chan capturedFlow
	logChan  chan logEntry

	captureStop chan struct{}

	listData   []listItem
	listCursor int
	listFilter string

	deviceInfoCache *deviceInfo

	statusLines []logEntry
	logCursor   int
	logScroll   int

	detailScroll int
}

func initialModel(pkg string) model {
	initBaseDir()
	s := loadSettings()
	if pkg != "" {
		s.Package = pkg
		s.Save()
	}
	return model{
		state:        stateMenu,
		settings:     s,
		editingField: -1,
		typeFilter:   resourceFilterAll,
		captureFocus: "requests",
		captureMode:  captureModeStandard,
		mitmdump:     &mitmdumpManager{},
		frida:        &fridaManager{},
	}
}

func (m model) Init() tea.Cmd {
	return nil
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func (m *model) log(msg, style string) {
	m.statusLines = append(m.statusLines, logEntry{
		Time: time.Now().Format("15:04:05"), Msg: msg, Style: style,
	})
	if len(m.statusLines) > 100 {
		m.statusLines = m.statusLines[len(m.statusLines)-100:]
	}
}

func (m *model) allLogs() []string {
	var lines []string
	for _, l := range m.statusLines {
		lines = append(lines, fmt.Sprintf("[%s] %s", l.Time, l.Msg))
	}
	for _, l := range m.frida.GetLogs() {
		lines = append(lines, "[frida] "+l)
	}
	return lines
}

func (m *model) filteredFlows() []capturedFlow {
	var out []capturedFlow
	for _, f := range m.flows {
		if m.filterText != "" {
			filt := strings.ToLower(m.filterText)
			if !strings.Contains(strings.ToLower(f.URL), filt) &&
				!strings.Contains(strings.ToLower(f.Host), filt) {
				continue
			}
		}
		if !flowMatchesTypeFilter(f, m.typeFilter) {
			continue
		}
		out = append(out, f)
	}
	return out
}

func flowExt(path string) string {
	path = strings.ToLower(path)
	if idx := strings.Index(path, "?"); idx >= 0 {
		path = path[:idx]
	}
	if idx := strings.Index(path, "#"); idx >= 0 {
		path = path[:idx]
	}
	if idx := strings.LastIndex(path, "."); idx >= 0 {
		return path[idx:]
	}
	return ""
}

func headerValue(headers map[string]string, key string) string {
	for k, v := range headers {
		if strings.EqualFold(k, key) {
			return strings.ToLower(v)
		}
	}
	return ""
}

func flowResourceKind(f capturedFlow) flowResourceFilter {
	ct := strings.ToLower(strings.TrimSpace(strings.SplitN(f.ContentType, ";", 2)[0]))
	ext := flowExt(f.Path)
	accept := headerValue(f.ReqHeaders, "Accept")
	xrw := headerValue(f.ReqHeaders, "X-Requested-With")
	secFetchDest := headerValue(f.ReqHeaders, "Sec-Fetch-Dest")

	switch {
	case strings.HasPrefix(ct, "image/"),
		ext == ".png", ext == ".jpg", ext == ".jpeg", ext == ".gif",
		ext == ".webp", ext == ".svg", ext == ".ico", ext == ".bmp",
		ext == ".avif", ext == ".heic":
		return resourceFilterImages
	case strings.Contains(ct, "javascript"),
		strings.Contains(ct, "ecmascript"),
		ext == ".js", ext == ".mjs", ext == ".cjs", ext == ".jsx":
		return resourceFilterJS
	case strings.Contains(ct, "text/css"), ext == ".css":
		return resourceFilterCSS
	case strings.HasPrefix(ct, "font/"),
		strings.Contains(ct, "woff"),
		strings.Contains(ct, "opentype"),
		strings.Contains(ct, "truetype"),
		ext == ".woff", ext == ".woff2", ext == ".ttf", ext == ".otf", ext == ".eot":
		return resourceFilterFonts
	case strings.HasPrefix(ct, "audio/"),
		strings.HasPrefix(ct, "video/"),
		ext == ".mp4", ext == ".webm", ext == ".mp3", ext == ".m4a",
		ext == ".mov", ext == ".wav", ext == ".aac", ext == ".ogg":
		return resourceFilterMedia
	case strings.Contains(ct, "text/html"),
		strings.Contains(ct, "application/xhtml"),
		ext == ".html", ext == ".htm":
		return resourceFilterHTML
	case xrw == "xmlhttprequest",
		secFetchDest == "empty",
		strings.Contains(ct, "json"),
		strings.Contains(ct, "xml"),
		strings.Contains(ct, "graphql"),
		strings.Contains(accept, "application/json"),
		strings.Contains(accept, "text/json"),
		(f.Method != "GET" && f.Method != "HEAD" && ct != ""):
		return resourceFilterXHR
	default:
		return resourceFilterOther
	}
}

func flowMatchesTypeFilter(f capturedFlow, filter flowResourceFilter) bool {
	return filter == resourceFilterAll || flowResourceKind(f) == filter
}

func resourceFilterLabel(filter flowResourceFilter) string {
	switch filter {
	case resourceFilterXHR:
		return "XHR"
	case resourceFilterJS:
		return "JS"
	case resourceFilterCSS:
		return "CSS"
	case resourceFilterImages:
		return "Images"
	case resourceFilterFonts:
		return "Fonts"
	case resourceFilterMedia:
		return "Media"
	case resourceFilterHTML:
		return "HTML"
	case resourceFilterOther:
		return "Other"
	default:
		return "All"
	}
}

func cycleResourceFilter(current flowResourceFilter, reverse bool) flowResourceFilter {
	idx := 0
	for i, filter := range resourceFilterOrder {
		if filter == current {
			idx = i
			break
		}
	}
	if reverse {
		idx--
		if idx < 0 {
			idx = len(resourceFilterOrder) - 1
		}
	} else {
		idx = (idx + 1) % len(resourceFilterOrder)
	}
	return resourceFilterOrder[idx]
}

func (m *model) clampSelectedFlow() {
	flows := m.filteredFlows()
	if len(flows) == 0 {
		m.selectedFlow = 0
		return
	}
	m.selectedFlow = clamp(m.selectedFlow, 0, len(flows)-1)
}

func (m *model) filteredList() []listItem {
	if m.listFilter == "" {
		return m.listData
	}
	filt := strings.ToLower(m.listFilter)
	var out []listItem
	for _, it := range m.listData {
		if strings.Contains(strings.ToLower(it.Name), filt) ||
			strings.Contains(strings.ToLower(it.ID), filt) {
			out = append(out, it)
		}
	}
	return out
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-3] + "..."
}

func (m *model) captureModeLabel() string {
	if m.captureMode == captureModeLinkedInCronet {
		return "LinkedIn Cronet"
	}
	if m.captureMode == captureModeSignupHandoff {
		return "Signup Handoff"
	}
	if m.captureMode == captureModeMitmOnly {
		return "MITM Only"
	}
	if m.captureMode == captureModeDailyPay {
		return "DailyPay"
	}
	if m.captureMode == captureModeSpeedway {
		return "Speedway"
	}
	if m.captureMode == captureModePapaJohns {
		return "Papa Johns"
	}
	return "Standard"
}

func (m *model) packageNameTail() string {
	if m.settings.Package == "" {
		return "capture"
	}
	if idx := strings.LastIndex(m.settings.Package, "."); idx >= 0 && idx+1 < len(m.settings.Package) {
		return m.settings.Package[idx+1:]
	}
	return m.settings.Package
}

func waitForPID(pkg string, stopCh chan struct{}, attempts int, delay time.Duration) int {
	for i := 0; i < attempts; i++ {
		if pid := adbGetPID(pkg); pid > 0 {
			return pid
		}
		if sleepOrStop(stopCh, delay) {
			return 0
		}
	}
	return 0
}

func waitForFridaMarker(f *fridaManager, stopCh chan struct{}, startIdx int, timeout time.Duration, markers ...string) (string, bool) {
	deadline := time.Now().Add(timeout)
	lastIdx := startIdx
	for {
		if time.Now().After(deadline) {
			return "", false
		}
		logs := f.GetLogs()
		if lastIdx > len(logs) {
			lastIdx = len(logs)
		}
		for i := lastIdx; i < len(logs); i++ {
			line := logs[i]
			for _, marker := range markers {
				if strings.Contains(line, marker) {
					return line, true
				}
			}
		}
		lastIdx = len(logs)
		if sleepOrStop(stopCh, 250*time.Millisecond) {
			return "", false
		}
	}
}

func waitForHandoffTrigger(f *fridaManager, stopCh chan struct{}, startIdx int, timeout time.Duration) (string, bool) {
	deadline := time.Now().Add(timeout)
	lastIdx := startIdx
	var readyLine string
	var readyAt time.Time
	for {
		if time.Now().After(deadline) {
			if readyLine != "" {
				return readyLine, true
			}
			return "", false
		}
		logs := f.GetLogs()
		if lastIdx > len(logs) {
			lastIdx = len(logs)
		}
		for i := lastIdx; i < len(logs); i++ {
			line := logs[i]
			if strings.Contains(line, "[HANDOFF] CALLBACK_INTENT") {
				return line, true
			}
			if strings.Contains(line, "[HANDOFF] CALLBACK_READY") && readyLine == "" {
				readyLine = line
				readyAt = time.Now()
			}
		}
		lastIdx = len(logs)
		if readyLine != "" && time.Since(readyAt) >= 1500*time.Millisecond {
			return readyLine, true
		}
		if sleepOrStop(stopCh, 250*time.Millisecond) {
			return "", false
		}
	}
}

// ── Update ───────────────────────────────────────────────────────────────────

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case flowMsg:
		m.flows = append(m.flows, capturedFlow(msg))
		if flows := m.filteredFlows(); len(flows) > 0 {
			m.selectedFlow = len(flows) - 1
		} else {
			m.selectedFlow = 0
		}
		return m, waitForFlow(m.flowChan)

	case flowTickMsg:
		return m, nil

	case captureLogMsg:
		m.statusLines = append(m.statusLines, logEntry(msg))
		if len(m.statusLines) > 100 {
			m.statusLines = m.statusLines[len(m.statusLines)-100:]
		}
		return m, drainLogChan(m.logChan)

	case captureDoneMsg:
		return m, nil

	case deviceInfoMsg:
		info := deviceInfo(msg)
		m.deviceInfoCache = &info
		return m, nil

	case listDataMsg:
		m.listData = []listItem(msg)
		return m, nil

	case exportDoneMsg:
		if msg.Err != "" {
			m.log("Export failed: "+msg.Err, "red")
		} else {
			m.log(fmt.Sprintf("Exported %d flows -> %s", msg.Count, msg.Path), "green")
		}
		return m, nil

	case tea.KeyMsg:
		return m.handleKey(msg)
	}
	return m, nil
}

func (m model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Editing mode intercepts all keys
	if m.editingField >= 0 {
		return m.handleEditing(msg)
	}

	switch m.state {
	case stateMenu:
		return m.handleMenu(msg)
	case stateSettings:
		return m.handleSettings(msg)
	case stateScripts:
		return m.handleScripts(msg)
	case stateCapture:
		return m.handleCapture(msg)
	case stateDetail:
		return m.handleDetail(msg)
	case stateLogs:
		return m.handleLogs(msg)
	case stateDevice:
		return m.handleDevice(msg)
	case stateApps:
		return m.handleAppsProcs(msg)
	case stateProcs:
		return m.handleAppsProcs(msg)
	case stateAppModes:
		return m.handleAppModes(msg)
	}
	return m, nil
}

func (m model) handleAppModes(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "esc":
		m.state = stateMenu
	case "h":
		if m.settings.Package == "" {
			m.log("Set a package first (s=settings or a=apps)", "red")
		} else if m.settings.Package != "com.pilottravelcenters.mypilot" {
			m.log("Signup handoff is Pilot-specific for now", "red")
		} else {
			return m.startSignupHandoffCapture()
		}
	case "k":
		if m.settings.Package == "" {
			m.log("Set a package first (s=settings or a=apps)", "red")
		} else if m.settings.Package != "com.linkedin.android" {
			m.log("LinkedIn Cronet mode is LinkedIn-specific for now", "red")
		} else {
			return m.startLinkedInCronetCapture()
		}
	case "l":
		if m.settings.Package == "" {
			m.log("Set a package first (s=settings or a=apps)", "red")
		} else if m.settings.Package != "com.linkedin.android" {
			m.log("LinkedIn replay mode is LinkedIn-specific", "red")
		} else {
			return m.startLinkedInReplayCapture()
		}
	case "y":
		if m.settings.Package == "" {
			m.log("Set a package first (s=settings or a=apps)", "red")
		} else {
			return m.startDailyPayCapture()
		}
	case "w":
		if m.settings.Package == "" {
			m.log("Set a package first (s=settings or a=apps)", "red")
		} else if m.settings.Package != "com.speedway.mobile" {
			m.log("Speedway mode is for com.speedway.mobile", "red")
		} else {
			return m.startSpeedwayCapture()
		}
	case "j":
		if m.settings.Package == "" {
			m.log("Set a package first (s=settings or a=apps)", "red")
		} else if m.settings.Package != "com.papajohns.android" {
			m.log("Papa Johns mode is for com.papajohns.android", "red")
		} else {
			return m.startPapaJohnsCapture()
		}
	}
	return m, nil
}

func (m model) handleMenu(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "ctrl+c":
		m.cleanup()
		return m, tea.Quit
	case "c":
		if m.settings.Package == "" {
			m.log("Set a package first (s=settings or a=apps)", "red")
		} else {
			return m.startCapture()
		}
	case "m":
		if m.settings.Package == "" {
			m.log("Set a package first (s=settings or a=apps)", "red")
		} else {
			return m.startMitmOnlyCapture()
		}
	case "n":
		m.state = stateAppModes
	case "s":
		m.state = stateSettings
		m.settingsCursor = 0
	case "f":
		m.state = stateScripts
		m.scriptsCursor = 0
	case "d":
		m.state = stateDevice
		m.deviceInfoCache = nil
		return m, fetchDeviceInfoCmd(m.settings.FridaServer)
	case "a":
		m.state = stateApps
		m.listData = nil
		m.listCursor = 0
		m.listFilter = ""
		return m, fetchAppsCmd()
	case "p":
		m.state = stateProcs
		m.listData = nil
		m.listCursor = 0
		m.listFilter = ""
		return m, fetchProcsCmd()
	}
	return m, nil
}

func (m model) handleSettings(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "esc":
		m.state = stateMenu
	case "up", "k":
		m.settingsCursor = clamp(m.settingsCursor-1, 0, len(settingsFields)-1)
	case "down", "j":
		m.settingsCursor = clamp(m.settingsCursor+1, 0, len(settingsFields)-1)
	case "enter", "e":
		m.editingField = m.settingsCursor
		m.editingValue = m.settings.GetField(settingsFields[m.settingsCursor].Key)
	}
	return m, nil
}

func (m model) handleEditing(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter":
		key := settingsFields[m.editingField].Key
		m.settings.SetField(key, m.editingValue)
		m.settings.Save()
		m.editingField = -1
		m.editingValue = ""
	case "esc":
		m.editingField = -1
		m.editingValue = ""
	case "backspace":
		if len(m.editingValue) > 0 {
			m.editingValue = m.editingValue[:len(m.editingValue)-1]
		}
	default:
		if len(msg.String()) == 1 {
			m.editingValue += msg.String()
		}
	}
	return m, nil
}

func (m model) handleScripts(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	scripts := fridaScripts()
	switch msg.String() {
	case "q", "esc":
		m.state = stateMenu
	case "up", "k":
		m.scriptsCursor = clamp(m.scriptsCursor-1, 0, len(scripts)-1)
	case "down", "j":
		m.scriptsCursor = clamp(m.scriptsCursor+1, 0, len(scripts)-1)
	case "enter":
		m.settings.FridaScriptID = scripts[m.scriptsCursor].ID
		m.settings.Save()
		m.log("Script: "+scripts[m.scriptsCursor].Name, "green")
		m.state = stateMenu
	}
	return m, nil
}

func (m model) handleCapture(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "esc":
		m.stopCapture()
		m.state = stateMenu
	case "ctrl+c":
		m.stopCapture()
		m.cleanup()
		return m, tea.Quit
	case "e":
		return m, m.exportCmd()
	case "x":
		m.flows = nil
		m.selectedFlow = 0
		m.log("Flows cleared", "")
	case "r":
		if m.settings.Package != "" && m.appPID > 0 {
			go adbRestartActivity(m.settings.Package)
			m.log("Restarting activity...", "")
		}
	case "tab":
		if m.captureFocus == "requests" {
			m.captureFocus = "logs"
			logs := m.allLogs()
			if len(logs) > 0 {
				m.logScroll = len(logs) - 1
			}
		} else {
			m.captureFocus = "requests"
		}
	case "l":
		m.state = stateLogs
		m.logCursor = 0
	case "y":
		logs := m.allLogs()
		if len(logs) > 0 {
			clipboard.WriteAll(strings.Join(logs, "\n"))
			m.log(fmt.Sprintf("Copied %d log lines", len(logs)), "green")
		}
	case "f":
		if m.filterText != "" {
			m.filterText = ""
			m.log("Filter cleared", "")
		} else {
			parts := strings.Split(m.settings.Package, ".")
			m.filterText = parts[len(parts)-1]
			m.log("Filter: "+m.filterText, "")
		}
		m.clampSelectedFlow()
	case "t":
		m.typeFilter = cycleResourceFilter(m.typeFilter, false)
		m.clampSelectedFlow()
		m.log("Type filter: "+resourceFilterLabel(m.typeFilter), "")
	case "T":
		m.typeFilter = cycleResourceFilter(m.typeFilter, true)
		m.clampSelectedFlow()
		m.log("Type filter: "+resourceFilterLabel(m.typeFilter), "")
	case "up", "k":
		if m.captureFocus == "requests" {
			m.selectedFlow = clamp(m.selectedFlow-1, 0, len(m.filteredFlows())-1)
		} else {
			maxIdx := max(0, len(m.allLogs())-1)
			m.logScroll = clamp(m.logScroll-1, 0, maxIdx)
		}
	case "down", "j":
		if m.captureFocus == "requests" {
			flows := m.filteredFlows()
			m.selectedFlow = clamp(m.selectedFlow+1, 0, len(flows)-1)
		} else {
			maxIdx := max(0, len(m.allLogs())-1)
			m.logScroll = clamp(m.logScroll+1, 0, maxIdx)
		}
	case "i":
		flows := m.filteredFlows()
		if len(flows) == 0 {
			m.log("No flows to inspect", "yellow")
		} else {
			harPath := filepath.Join(os.TempDir(), fmt.Sprintf("sniff_tui_%s.har", time.Now().Format("20060102_150405")))
			if _, err := exportHAR(flows, harPath); err != nil {
				m.log("HAR export failed: "+err.Error(), "red")
			} else {
				inspectorPath := scriptPath("har_inspector.py")
				cmd := exec.Command("python3", inspectorPath, harPath, "--open")
				cmd.Stdout = nil
				cmd.Stderr = nil
				if err := cmd.Start(); err != nil {
					m.log("Failed to start HAR inspector: "+err.Error(), "red")
				} else {
					go cmd.Wait()
					m.log(fmt.Sprintf("HAR inspector opened (%d flows)", len(flows)), "green")
				}
			}
		}
	case "enter":
		if m.captureFocus == "requests" {
			flows := m.filteredFlows()
			if len(flows) > 0 && m.selectedFlow >= 0 && m.selectedFlow < len(flows) {
				m.state = stateDetail
				m.detailScroll = 0
			}
		} else {
			m.state = stateLogs
			m.logCursor = 0
		}
	}
	return m, nil
}

func (m model) handleDetail(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "esc":
		m.state = stateCapture
	case "up", "k":
		m.detailScroll = clamp(m.detailScroll-1, 0, 9999)
	case "down", "j":
		m.detailScroll++
	}
	return m, nil
}

func (m model) handleLogs(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	logs := m.allLogs()
	maxIdx := len(logs) - 1
	if maxIdx < 0 {
		maxIdx = 0
	}
	switch msg.String() {
	case "q", "esc":
		m.state = stateCapture
	case "up", "k":
		m.logCursor = clamp(m.logCursor-1, 0, maxIdx)
	case "down", "j":
		m.logCursor = clamp(m.logCursor+1, 0, maxIdx)
	case "y":
		if m.logCursor < len(logs) {
			clipboard.WriteAll(logs[m.logCursor])
			m.log("Copied line", "green")
		}
	case "Y":
		clipboard.WriteAll(strings.Join(logs, "\n"))
		m.log(fmt.Sprintf("Copied %d lines", len(logs)), "green")
	case "g", "home":
		m.logCursor = 0
	case "G", "end":
		m.logCursor = maxIdx
	}
	return m, nil
}

func (m model) handleDevice(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "esc":
		m.state = stateMenu
	case "r":
		m.deviceInfoCache = nil
		return m, fetchDeviceInfoCmd(m.settings.FridaServer)
	case "f":
		m.log("Starting Frida server...", "")
		return m, runDeviceActionCmd(m.settings.FridaServer, func() {
			adbStartFridaServer(m.settings.FridaServer)
		})
	case "S":
		if m.deviceInfoCache != nil && m.deviceInfoCache.SELinux == "Enforcing" {
			m.log("SELinux -> Permissive", "yellow")
			return m, runDeviceActionCmd(m.settings.FridaServer, adbSELinuxPermissive)
		} else {
			m.log("SELinux -> Enforcing", "green")
			return m, runDeviceActionCmd(m.settings.FridaServer, adbSELinuxEnforcing)
		}
	case "P":
		m.log("Proxy cleared", "green")
		return m, runDeviceActionCmd(m.settings.FridaServer, adbClearProxy)
	}
	return m, nil
}

func (m model) handleAppsProcs(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	filtered := m.filteredList()
	maxIdx := len(filtered) - 1
	if maxIdx < 0 {
		maxIdx = 0
	}
	switch msg.String() {
	case "q", "esc":
		m.state = stateMenu
	case "up", "k":
		m.listCursor = clamp(m.listCursor-1, 0, maxIdx)
	case "down", "j":
		m.listCursor = clamp(m.listCursor+1, 0, maxIdx)
	case "enter":
		if m.listCursor < len(filtered) {
			item := filtered[m.listCursor]
			if strings.Contains(item.ID, ".") {
				m.settings.Package = item.ID
				m.settings.Save()
				m.log("Package: "+item.ID, "green")
				m.state = stateMenu
			}
		}
	case "/":
		m.listFilter = ""
		m.listCursor = 0
	case "backspace":
		if len(m.listFilter) > 0 {
			m.listFilter = m.listFilter[:len(m.listFilter)-1]
			m.listCursor = 0
		}
	default:
		k := msg.String()
		if len(k) == 1 && k[0] >= 32 {
			if k == "k" && m.state == stateApps && m.listFilter == "" {
				if m.listCursor < len(filtered) {
					appID := filtered[m.listCursor].ID
					m.log("Killed: "+appID, "yellow")
					return m, runAppsActionCmd(func() {
						adbForceStop(appID)
					})
				}
				return m, nil
			}
			m.listFilter += k
			m.listCursor = 0
		}
	}
	return m, nil
}

// ── Commands ─────────────────────────────────────────────────────────────────

func fetchDeviceInfoCmd(fridaServer string) tea.Cmd {
	return func() tea.Msg {
		return deviceInfoMsg(fetchDeviceInfo(fridaServer))
	}
}

func fetchAppsCmd() tea.Cmd {
	return func() tea.Msg {
		return listDataMsg(loadApps())
	}
}

func fetchProcsCmd() tea.Cmd {
	return func() tea.Msg {
		return listDataMsg(loadProcs())
	}
}

func loadApps() []listItem {
	items := fridaPsApps()
	if len(items) == 0 {
		for _, p := range adbListPackages() {
			items = append(items, listItem{Name: p, ID: p})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})
	return items
}

func loadProcs() []listItem {
	items := fridaPsProcs()
	if len(items) == 0 {
		items = adbListRunningApps()
	}
	sort.Slice(items, func(i, j int) bool {
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})
	return items
}

func runDeviceActionCmd(fridaServer string, action func()) tea.Cmd {
	return func() tea.Msg {
		if action != nil {
			action()
		}
		return deviceInfoMsg(fetchDeviceInfo(fridaServer))
	}
}

func runAppsActionCmd(action func()) tea.Cmd {
	return func() tea.Msg {
		if action != nil {
			action()
		}
		return listDataMsg(loadApps())
	}
}

func waitForFlow(ch chan capturedFlow) tea.Cmd {
	if ch == nil {
		return nil
	}
	return func() tea.Msg {
		f, ok := <-ch
		if !ok {
			return nil
		}
		return flowMsg(f)
	}
}

func (m *model) exportCmd() tea.Cmd {
	flows := m.filteredFlows()
	if len(flows) == 0 {
		m.log("No flows to export", "yellow")
		return nil
	}
	os.MkdirAll(m.settings.CapturesDir, 0755)
	name := m.captureName
	if name == "" {
		name = fmt.Sprintf("export_%s", time.Now().Format("20060102_150405"))
	}
	format := m.settings.ExportFormat
	return func() tea.Msg {
		var count int
		var path string
		var err error
		if format == "har" {
			path = filepath.Join(m.settings.CapturesDir, name+".har")
			count, err = exportHAR(flows, path)
		} else {
			path = filepath.Join(m.settings.CapturesDir, name+".json")
			count, err = exportJSON(flows, path)
		}
		if err != nil {
			return exportDoneMsg{Err: err.Error()}
		}
		return exportDoneMsg{Count: count, Path: path}
	}
}

// ── Capture Lifecycle ────────────────────────────────────────────────────────

func (m model) startCapture() (model, tea.Cmd) {
	return m.startCaptureMode(captureModeStandard)
}

func (m model) startMitmOnlyCapture() (model, tea.Cmd) {
	return m.startCaptureMode(captureModeMitmOnly)
}

func (m model) startSignupHandoffCapture() (model, tea.Cmd) {
	return m.startCaptureMode(captureModeSignupHandoff)
}

func (m model) startLinkedInCronetCapture() (model, tea.Cmd) {
	return m.startCaptureMode(captureModeLinkedInCronet)
}

func (m model) startLinkedInReplayCapture() (model, tea.Cmd) {
	return m.startCaptureMode(captureModeLinkedInReplay)
}

func (m model) startDailyPayCapture() (model, tea.Cmd) {
	return m.startCaptureMode(captureModeDailyPay)
}

func (m model) startSpeedwayCapture() (model, tea.Cmd) {
	return m.startCaptureMode(captureModeSpeedway)
}

func (m model) startPapaJohnsCapture() (model, tea.Cmd) {
	return m.startCaptureMode(captureModePapaJohns)
}

func (m model) startCaptureMode(mode captureMode) (model, tea.Cmd) {
	m.state = stateCapture
	m.flows = nil
	m.selectedFlow = 0
	m.capturing = true
	m.captureMode = mode
	name := m.packageNameTail()
	if mode == captureModeMitmOnly {
		name += "_mitm_only"
	}
	if mode == captureModeSignupHandoff {
		name += "_signup_handoff"
	}
	if mode == captureModeLinkedInCronet {
		name += "_linkedin_cronet"
	}
	if mode == captureModeLinkedInReplay {
		name += "_linkedin_replay"
	}
	if mode == captureModeDailyPay {
		name += "_dailypay"
	}
	if mode == captureModeSpeedway {
		name += "_speedway"
	}
	if mode == captureModePapaJohns {
		name += "_papajohns"
	}
	m.captureName = fmt.Sprintf("%s_%s", name, time.Now().Format("20060102_150405"))

	m.flowChan = make(chan capturedFlow, 100)
	m.logChan = make(chan logEntry, 50)
	m.captureStop = make(chan struct{})
	m.logScroll = 0

	// Start capture sequence in goroutine, send log messages via channel
	go m.captureSequence(m.logChan, m.flowChan, m.captureStop, mode)

	// Return a command that drains log messages
	return m, tea.Batch(
		drainLogChan(m.logChan),
		waitForFlow(m.flowChan),
	)
}

func drainLogChan(ch chan logEntry) tea.Cmd {
	if ch == nil {
		return nil
	}
	return func() tea.Msg {
		entry, ok := <-ch
		if !ok {
			return captureDoneMsg{}
		}
		return captureLogMsg(entry)
	}
}

func (m model) Update2(msg tea.Msg) (tea.Model, tea.Cmd) { return m, nil }

// Override the flowMsg/captureLogMsg handling to re-subscribe
func (m model) updateCaptureMsg(msg tea.Msg) (model, tea.Cmd) {
	return m, nil
}

func (m *model) captureSequence(logCh chan logEntry, flowCh chan capturedFlow, stopCh chan struct{}, mode captureMode) {
	defer close(logCh)

	send := func(msg, style string) {
		select {
		case <-stopCh:
			return
		case logCh <- logEntry{Time: time.Now().Format("15:04:05"), Msg: msg, Style: style}:
		}
		if sleepOrStop(stopCh, 50*time.Millisecond) {
			return
		}
	}

	send("Checking device...", "")
	if !adbConnected() {
		send("No ADB device!", "red")
		return
	}

	hostIP := m.settings.HostIP
	if hostIP == "" {
		hostIP = detectHostIP()
		if hostIP == "" {
			send("Cannot detect host IP", "red")
			return
		}
	}
	send("Host IP: "+hostIP, "")

	if mode == captureModeMitmOnly {
		m.captureSequenceMitmOnly(send, flowCh, stopCh, hostIP)
		return
	}
	if mode == captureModeSignupHandoff {
		m.captureSequenceSignupHandoff(send, flowCh, stopCh, hostIP)
		return
	}
	if mode == captureModeLinkedInCronet {
		m.captureSequenceLinkedInCronet(send, flowCh, stopCh, hostIP)
		return
	}
	if mode == captureModeLinkedInReplay {
		m.captureSequenceLinkedInReplay(send, flowCh, stopCh, hostIP)
		return
	}
	if mode == captureModeDailyPay {
		m.captureSequenceDailyPay(send, flowCh, stopCh, hostIP)
		return
	}
	if mode == captureModeSpeedway {
		m.captureSequenceSpeedway(send, flowCh, stopCh, hostIP)
		return
	}
	if mode == captureModePapaJohns {
		m.captureSequencePapaJohns(send, flowCh, stopCh, hostIP)
		return
	}
	m.captureSequenceStandard(send, flowCh, stopCh, hostIP)
}

func (m *model) captureSequenceMitmOnly(send func(string, string), flowCh chan capturedFlow, stopCh chan struct{}, hostIP string) {
	pkg := m.settings.Package
	port := m.settings.Port

	send("Stopping "+pkg+"...", "")
	adbForceStop(pkg)
	exec.Command("pkill", "-f", fmt.Sprintf("mitmdump.*%d", port)).Run()
	if sleepOrStop(stopCh, time.Second) {
		return
	}

	send(fmt.Sprintf("Starting mitmdump on :%d...", port), "")
	if err := m.mitmdump.Start(port, m.settings.IgnoreHosts); err != nil {
		send("mitmdump failed: "+err.Error(), "red")
		return
	}
	if sleepOrStop(stopCh, 2*time.Second) {
		return
	}
	send(fmt.Sprintf("Proxy listening on :%d", port), "green")
	go tailJSONL(flowCh, stopCh)

	send(fmt.Sprintf("System proxy -> %s:%d", hostIP, port), "")
	adbSetProxy(hostIP, port)
	if adbCheckConnectivity(hostIP, port) {
		send("Device -> proxy OK", "green")
	} else {
		send(fmt.Sprintf("Device cannot reach %s:%d", hostIP, port), "yellow")
	}

	send("Launching "+pkg+"...", "")
	adbLaunchApp(pkg)

	pid := waitForPID(pkg, stopCh, 30, 200*time.Millisecond)
	if pid == 0 {
		send("App failed to start", "red")
		return
	}
	m.appPID = pid
	send(fmt.Sprintf("App running (pid %d)", pid), "green")
	send("MITM-only capture active - no Frida hooks", "green")
}

func (m *model) captureSequenceStandard(send func(string, string), flowCh chan capturedFlow, stopCh chan struct{}, hostIP string) {
	pkg := m.settings.Package
	port := m.settings.Port
	delay := m.settings.AttachDelay
	server := m.settings.FridaServer
	script := m.settings.GetScript()

	send("SELinux -> permissive", "")
	adbSELinuxPermissive()

	send("Stopping "+pkg+"...", "")
	adbForceStop(pkg)
	exec.Command("pkill", "-f", fmt.Sprintf("mitmdump.*%d", port)).Run()
	exec.Command("pkill", "-f", "frida -U").Run()
	if sleepOrStop(stopCh, time.Second) {
		return
	}

	send("Starting Frida server...", "")
	adbStartFridaServer(server)
	send("Frida server ready", "green")

	send(fmt.Sprintf("Starting mitmdump on :%d...", port), "")
	if err := m.mitmdump.Start(port, m.settings.IgnoreHosts); err != nil {
		send("mitmdump failed: "+err.Error(), "red")
		return
	}
	if sleepOrStop(stopCh, 2*time.Second) {
		return
	}
	send(fmt.Sprintf("Proxy listening on :%d", port), "green")

	send(fmt.Sprintf("System proxy -> %s:%d", hostIP, port), "")
	adbSetProxy(hostIP, port)

	if adbCheckConnectivity(hostIP, port) {
		send("Device -> proxy OK", "green")
	} else {
		send(fmt.Sprintf("Device cannot reach %s:%d", hostIP, port), "yellow")
	}

	// Write frida config
	config, _ := json.Marshal(map[string]interface{}{"host": hostIP, "port": port})
	os.WriteFile("/tmp/frida_proxy_config.json", config, 0644)

	send("Launching "+pkg+"...", "")
	adbLaunchApp(pkg)

	pid := waitForPID(pkg, stopCh, 30, 200*time.Millisecond)
	if pid == 0 {
		send("App failed to start", "red")
		return
	}
	m.appPID = pid
	send(fmt.Sprintf("App running (pid %d)", pid), "green")

	send(fmt.Sprintf("Waiting %ds for ART...", delay), "")
	if sleepOrStop(stopCh, time.Duration(delay)*time.Second) {
		return
	}

	newPID := adbGetPID(pkg)
	if newPID == 0 {
		send("App died during init", "red")
		return
	}
	if newPID != pid {
		send(fmt.Sprintf("App restarted (pid %d)", newPID), "")
		pid = newPID
		m.appPID = pid
	}

	send(fmt.Sprintf("Attaching Frida [%s]...", script.Label), "")
	if err := m.frida.Attach(pid, script.Path, hostIP, port); err != nil {
		send("Frida failed: "+err.Error(), "red")
		return
	}
	send("Frida attached - hooks installing...", "green")

	if sleepOrStop(stopCh, 6*time.Second) {
		return
	}
	send("Hooks active", "green")

	send("Restarting activity...", "")
	launcher := adbRestartActivity(pkg)
	if launcher != "" {
		send("Restarted: "+launcher, "")
	} else {
		send("Relaunched via monkey", "")
	}

	send("Capturing "+pkg+" - press q to stop", "green")

	// Start JSONL tailer
	go tailJSONL(flowCh, stopCh)
}

func (m *model) captureSequenceDailyPay(send func(string, string), flowCh chan capturedFlow, stopCh chan struct{}, hostIP string) {
	pkg := m.settings.Package
	port := m.settings.Port
	server := m.settings.FridaServer
	script := dailyPayScript()

	send("SELinux -> permissive", "")
	adbSELinuxPermissive()

	send("Stopping "+pkg+"...", "")
	adbForceStop(pkg)
	exec.Command("pkill", "-f", fmt.Sprintf("mitmdump.*%d", port)).Run()
	exec.Command("pkill", "-f", "frida -U").Run()
	if sleepOrStop(stopCh, time.Second) {
		return
	}

	send("Starting Frida server...", "")
	adbStartFridaServer(server)
	send("Frida server ready", "green")

	send(fmt.Sprintf("Starting mitmdump on :%d...", port), "")
	if err := m.mitmdump.Start(port, m.settings.IgnoreHosts); err != nil {
		send("mitmdump failed: "+err.Error(), "red")
		return
	}
	if sleepOrStop(stopCh, 2*time.Second) {
		return
	}
	send(fmt.Sprintf("Proxy listening on :%d", port), "green")

	send(fmt.Sprintf("System proxy -> %s:%d", hostIP, port), "")
	adbSetProxy(hostIP, port)

	if adbCheckConnectivity(hostIP, port) {
		send("Device -> proxy OK", "green")
	} else {
		send(fmt.Sprintf("Device cannot reach %s:%d", hostIP, port), "yellow")
	}

	// Write frida config
	config, _ := json.Marshal(map[string]interface{}{"host": hostIP, "port": port})
	os.WriteFile("/tmp/frida_proxy_config.json", config, 0644)

	// ── Prepare APEX cert overlay ──
	// The mitmproxy CA must be in /apex/com.android.conscrypt/cacerts/ for
	// Chromium/WebView to trust it. We prepare the cert store on device first,
	// then mount it into the app's namespace after launch.
	send("Preparing APEX cert store...", "")
	certHash := "c8750f0d" // mitmproxy CA subject_hash_old
	certSetup := fmt.Sprintf(
		"mkdir -p /data/local/tmp/cacerts && "+
			"cp /apex/com.android.conscrypt/cacerts/* /data/local/tmp/cacerts/ 2>/dev/null; "+
			"cp /data/local/tmp/%s.0 /data/local/tmp/cacerts/ 2>/dev/null; "+
			"chmod 644 /data/local/tmp/cacerts/*",
		certHash,
	)
	exec.Command("adb", "shell", "su", "-c", certSetup).Run()
	// Verify cert exists
	out, _ := exec.Command("adb", "shell", "ls", fmt.Sprintf("/data/local/tmp/cacerts/%s.0", certHash)).CombinedOutput()
	if strings.Contains(string(out), certHash) {
		send("APEX cert store ready", "green")
	} else {
		send("Warning: mitmproxy CA cert not found in /data/local/tmp/", "yellow")
		send("Push it with: adb push ~/.mitmproxy/mitmproxy-ca-cert.pem /data/local/tmp/"+certHash+".0", "yellow")
	}

	send("Launching "+pkg+"...", "")
	adbLaunchApp(pkg)

	pid := waitForPID(pkg, stopCh, 30, 200*time.Millisecond)
	if pid == 0 {
		send("App failed to start", "red")
		return
	}
	m.appPID = pid
	send(fmt.Sprintf("App running (pid %d)", pid), "green")

	// ── Mount APEX cert overlay into app's namespace ──
	// Write a script to device to avoid shell quoting nightmares
	send("Injecting mitmproxy CA into app APEX namespace...", "")
	apexScript := fmt.Sprintf(`#!/system/bin/sh
nsenter --mount=/proc/%d/ns/mnt -- /system/bin/mount -t tmpfs tmpfs /apex/com.android.conscrypt/cacerts
nsenter --mount=/proc/%d/ns/mnt -- /system/bin/cp /data/local/tmp/cacerts/* /apex/com.android.conscrypt/cacerts/
nsenter --mount=/proc/%d/ns/mnt -- /system/bin/chmod 644 /apex/com.android.conscrypt/cacerts/*
nsenter --mount=/proc/%d/ns/mnt -- /system/bin/chcon u:object_r:system_security_cacerts_file:s0 /apex/com.android.conscrypt/cacerts/*
echo APEX_DONE
`, pid, pid, pid, pid)
	os.WriteFile("/tmp/apex_inject.sh", []byte(apexScript), 0755)
	exec.Command("adb", "push", "/tmp/apex_inject.sh", "/data/local/tmp/apex_inject.sh").Run()
	exec.Command("adb", "shell", "chmod", "755", "/data/local/tmp/apex_inject.sh").Run()
	mountOut, _ := exec.Command("adb", "shell", "su", "-c", "/data/local/tmp/apex_inject.sh").CombinedOutput()
	if strings.Contains(string(mountOut), "APEX_DONE") {
		send("APEX cert injected into app namespace", "green")
	} else {
		send("APEX mount issue: "+strings.TrimSpace(string(mountOut)), "yellow")
	}

	// Attach Frida BEFORE waiting for ART — we need hooks early for WebView
	send(fmt.Sprintf("Attaching Frida [%s]...", script.Label), "")
	if err := m.frida.Attach(pid, script.Path, hostIP, port); err != nil {
		send("Frida failed: "+err.Error(), "red")
		return
	}
	send("Frida attached - hooks installing...", "green")

	// Wait for hooks to install (script has 3s setTimeout)
	if sleepOrStop(stopCh, 5*time.Second) {
		return
	}
	send("Hooks active", "green")

	// NOW restart activity — WebView will be created AFTER hooks are in place
	send("Restarting activity...", "")
	launcher := adbRestartActivity(pkg)
	if launcher != "" {
		send("Restarted: "+launcher, "")
	} else {
		send("Relaunched via monkey", "")
	}

	send("Capturing "+pkg+" - press q to stop", "green")

	// Start JSONL tailer
	go tailJSONL(flowCh, stopCh)
}

func (m *model) captureSequenceSpeedway(send func(string, string), flowCh chan capturedFlow, stopCh chan struct{}, hostIP string) {
	pkg := "com.speedway.mobile"
	port := m.settings.Port
	server := m.settings.FridaServer
	script := speedwayScript()

	// Speedway-specific ignore hosts: GMS (own TLS), protection SDKs, analytics
	speedwayIgnore := `.*googleapis\.com|.*google\.com|.*gstatic\.com|.*android\.com|.*perimeterx\.net|.*perfdrive\.com|.*px-cdn\.net|.*px-cloud\.net|.*kochava\.com|.*kvaedit\.site|.*dewrain\.life|.*vaicore\.site|.*distil\.it|.*imperva\.com|.*incapsula\.com|.*securetheorem\.com|.*newrelic\.com`

	send("SELinux -> permissive", "")
	adbSELinuxPermissive()

	send("Stopping "+pkg+"...", "")
	adbForceStop(pkg)
	exec.Command("pkill", "-f", fmt.Sprintf("mitmdump.*%d", port)).Run()
	exec.Command("pkill", "-f", "frida -U").Run()
	if sleepOrStop(stopCh, time.Second) {
		return
	}

	send("Starting Frida server...", "")
	adbStartFridaServer(server)
	send("Frida server ready", "green")

	// Use Speedway-specific ignore hosts merged with any user overrides
	ignoreHosts := speedwayIgnore
	if m.settings.IgnoreHosts != "" {
		ignoreHosts = speedwayIgnore + "|" + m.settings.IgnoreHosts
	}

	send(fmt.Sprintf("Starting mitmdump on :%d...", port), "")
	if err := m.mitmdump.Start(port, ignoreHosts); err != nil {
		send("mitmdump failed: "+err.Error(), "red")
		return
	}
	if sleepOrStop(stopCh, 2*time.Second) {
		return
	}
	send(fmt.Sprintf("Proxy listening on :%d", port), "green")

	// Set system proxy BEFORE launch so ignore-hosts take effect
	send(fmt.Sprintf("System proxy -> %s:%d", hostIP, port), "")
	adbSetProxy(hostIP, port)

	if adbCheckConnectivity(hostIP, port) {
		send("Device -> proxy OK", "green")
	} else {
		send(fmt.Sprintf("Device cannot reach %s:%d", hostIP, port), "yellow")
	}

	// Write frida proxy config for the Frida script to read
	config, _ := json.Marshal(map[string]interface{}{"host": hostIP, "port": port})
	os.WriteFile("/tmp/frida_proxy_config.json", config, 0644)
	// Push to device
	exec.Command("adb", "shell", "su", "-c",
		fmt.Sprintf("echo '{\"host\":\"%s\",\"port\":%d}' > /data/local/tmp/frida_proxy_config.json", hostIP, port)).Run()

	// Launch app (initial API calls will fail TLS — hooks not installed yet)
	send("Launching "+pkg+"...", "")
	adbLaunchApp(pkg)

	pid := waitForPID(pkg, stopCh, 30, 200*time.Millisecond)
	if pid == 0 {
		send("App failed to start", "red")
		return
	}
	m.appPID = pid
	send(fmt.Sprintf("App running (pid %d)", pid), "green")

	// Wait 10s for ART JIT to stabilize (Frida spawn crashes ART on this app)
	send("Waiting 10s for ART to settle...", "")
	if sleepOrStop(stopCh, 10*time.Second) {
		return
	}

	// Re-check PID in case it restarted
	newPID := adbGetPID(pkg)
	if newPID == 0 {
		send("App died during ART wait", "red")
		return
	}
	if newPID != pid {
		send(fmt.Sprintf("App restarted (pid %d)", newPID), "")
		pid = newPID
		m.appPID = pid
	}

	// Attach Frida (late attach — 10s+ after launch)
	send(fmt.Sprintf("Attaching Frida [%s] to pid %d...", script.Label, pid), "")
	if err := m.frida.Attach(pid, script.Path, hostIP, port); err != nil {
		send("Frida failed: "+err.Error(), "red")
		return
	}
	send("Frida attached - hooks installing...", "green")

	// Wait 8s for setTimeout(3000) hooks + OkHttp pool eviction
	send("Waiting 8s for hooks + connection pool eviction...", "")
	if sleepOrStop(stopCh, 8*time.Second) {
		return
	}
	send("All hooks active, pools evicted", "green")

	// Restart activity to trigger fresh API calls on clean pool
	send("Restarting activity (fresh connections with hooks active)...", "")
	exec.Command("adb", "shell", "am", "start", "-n",
		"com.speedway.mobile/com.sei.android.MainActivity", "--activity-clear-top").Run()
	if sleepOrStop(stopCh, 3*time.Second) {
		return
	}

	send("Capturing "+pkg+" - press q to stop", "green")

	go tailJSONL(flowCh, stopCh)
}

func (m *model) captureSequencePapaJohns(send func(string, string), flowCh chan capturedFlow, stopCh chan struct{}, hostIP string) {
	pkg := "com.papajohns.android"
	port := m.settings.Port
	tproxyPort := 12345

	send("SELinux -> permissive", "")
	adbSELinuxPermissive()

	send("Stopping "+pkg+"...", "")
	adbForceStop(pkg)
	exec.Command("pkill", "-f", fmt.Sprintf("mitmdump.*%d", port)).Run()
	adbRun("su -c 'kill $(pidof tproxy-connect)' 2>/dev/null")
	adbRun("su -c 'iptables -t nat -F OUTPUT'")
	if sleepOrStop(stopCh, time.Second) {
		return
	}

	// Get app UID for iptables
	uidStr := adbShell(fmt.Sprintf("dumpsys package %s | grep 'uid=' | head -1", pkg))
	appUID := "10281" // default
	if idx := strings.Index(uidStr, "uid="); idx >= 0 {
		rest := uidStr[idx+4:]
		end := strings.IndexAny(rest, " \t\n,)")
		if end > 0 {
			appUID = rest[:end]
		}
	}
	send("App UID: "+appUID, "")

	// Check tproxy-connect binary on device
	tproxyCheck := strings.TrimSpace(adbShell("ls /data/local/tmp/tproxy-connect 2>/dev/null"))
	if tproxyCheck == "" || strings.Contains(tproxyCheck, "No such file") {
		send("tproxy-connect not found on device!", "red")
		send("Build: cd tproxy-connect && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build", "yellow")
		send("Push: adb push tproxy-connect /data/local/tmp/", "yellow")
		return
	}

	send(fmt.Sprintf("Starting mitmdump on :%d...", port), "")
	if err := m.mitmdump.Start(port, m.settings.IgnoreHosts); err != nil {
		send("mitmdump failed: "+err.Error(), "red")
		return
	}
	if sleepOrStop(stopCh, 2*time.Second) {
		return
	}
	send(fmt.Sprintf("Proxy listening on :%d", port), "green")

	// Start tproxy-connect on device
	send("Starting tproxy-connect on device...", "")
	adbRun(fmt.Sprintf("su -c 'nohup /data/local/tmp/tproxy-connect -listen :%d -proxy %s:%d > /data/local/tmp/tproxy.log 2>&1 &'", tproxyPort, hostIP, port))
	if sleepOrStop(stopCh, time.Second) {
		return
	}
	tproxyPID := strings.TrimSpace(adbShell("pidof tproxy-connect"))
	if tproxyPID == "" {
		send("tproxy-connect failed to start!", "red")
		return
	}
	send("tproxy-connect running (pid "+tproxyPID+")", "green")

	// iptables REDIRECT for Flutter traffic (uses app UID)
	send(fmt.Sprintf("iptables REDIRECT UID %s → :%d", appUID, tproxyPort), "")
	adbRun(fmt.Sprintf("su -c 'iptables -t nat -A OUTPUT -p tcp -m owner --uid-owner %s --dport 443 -j REDIRECT --to-port %d'", appUID, tproxyPort))
	adbRun(fmt.Sprintf("su -c 'iptables -t nat -A OUTPUT -p tcp -m owner --uid-owner %s --dport 80 -j REDIRECT --to-port %d'", appUID, tproxyPort))
	send("iptables REDIRECT set", "green")

	// System proxy for Java-layer SDKs (Braze, Firebase, etc)
	send(fmt.Sprintf("System proxy -> %s:%d (for Java SDKs)", hostIP, port), "")
	adbSetProxy(hostIP, port)

	if adbCheckConnectivity(hostIP, port) {
		send("Device -> proxy OK", "green")
	} else {
		send(fmt.Sprintf("Device cannot reach %s:%d", hostIP, port), "yellow")
	}

	// Launch app — no Frida needed, Flutter trusts system CA
	send("Launching "+pkg+" (no Frida needed)...", "")
	adbLaunchApp(pkg)

	pid := waitForPID(pkg, stopCh, 30, 200*time.Millisecond)
	if pid == 0 {
		send("App failed to start", "red")
		return
	}
	m.appPID = pid
	send(fmt.Sprintf("App running (pid %d)", pid), "green")

	send("Capturing "+pkg+" - press q to stop", "green")
	send("Flutter trusts system CA - no SSL bypass needed", "green")

	go tailJSONL(flowCh, stopCh)
}

func (m *model) captureSequenceSignupHandoff(send func(string, string), flowCh chan capturedFlow, stopCh chan struct{}, hostIP string) {
	pkg := m.settings.Package
	port := m.settings.Port
	delay := m.settings.AttachDelay
	server := m.settings.FridaServer
	script := pilotSignupHandoffScript()

	send("SELinux -> permissive", "")
	adbSELinuxPermissive()

	send("Stopping "+pkg+"...", "")
	adbForceStop(pkg)
	exec.Command("pkill", "-f", fmt.Sprintf("mitmdump.*%d", port)).Run()
	exec.Command("pkill", "-f", "frida -U").Run()
	if sleepOrStop(stopCh, time.Second) {
		return
	}

	send("Clearing system proxy for signup...", "")
	adbClearProxy()

	send("Starting Frida server...", "")
	adbStartFridaServer(server)
	send("Frida server ready", "green")

	send(fmt.Sprintf("Starting mitmdump on :%d before signup...", port), "")
	if err := m.mitmdump.Start(port, m.settings.IgnoreHosts); err != nil {
		send("mitmdump failed: "+err.Error(), "red")
		return
	}
	if sleepOrStop(stopCh, 2*time.Second) {
		return
	}
	send(fmt.Sprintf("Proxy listening on :%d", port), "green")
	go tailJSONL(flowCh, stopCh)

	if err := adbWritePilotHandoffConfig(hostIP, port, true); err != nil {
		send("Failed to write handoff config: "+err.Error(), "red")
		return
	}
	send("App proxy handoff enabled (browser still direct)", "green")

	send("Launching "+pkg+"...", "")
	adbLaunchApp(pkg)

	pid := waitForPID(pkg, stopCh, 40, 250*time.Millisecond)
	if pid == 0 {
		send("App failed to start", "red")
		return
	}
	m.appPID = pid
	send(fmt.Sprintf("App running (pid %d)", pid), "green")

	send(fmt.Sprintf("Waiting %ds for ART...", delay), "")
	if sleepOrStop(stopCh, time.Duration(delay)*time.Second) {
		return
	}

	if newPID := adbGetPID(pkg); newPID == 0 {
		send("App died during init", "red")
		return
	} else if newPID != pid {
		send(fmt.Sprintf("App restarted (pid %d)", newPID), "")
		pid = newPID
		m.appPID = pid
	}

	send(fmt.Sprintf("Attaching Frida [%s]...", script.Label), "")
	if err := m.frida.Attach(pid, script.Path, hostIP, port); err != nil {
		send("Frida failed: "+err.Error(), "red")
		return
	}
	send("Handoff hooks installing...", "green")

	if sleepOrStop(stopCh, 6*time.Second) {
		return
	}
	send("Signup handoff armed", "green")
	send("Complete signup in the browser; app traffic is already being proxied", "yellow")

	lastLogIdx := len(m.frida.GetLogs())
	callbackLine, ok := waitForHandoffTrigger(m.frida, stopCh, lastLogIdx, 8*time.Minute)
	if !ok {
		send("Timed out waiting for signup callback", "red")
		return
	}
	send("Callback detected", "green")
	send(callbackLine, "")

	send(fmt.Sprintf("System proxy -> %s:%d", hostIP, port), "")
	adbSetProxy(hostIP, port)
	if adbCheckConnectivity(hostIP, port) {
		send("Device -> proxy OK", "green")
	} else {
		send(fmt.Sprintf("Device cannot reach %s:%d", hostIP, port), "yellow")
	}

	if _, ok := waitForFridaMarker(m.frida, stopCh, len(m.frida.GetLogs()), 4*time.Second, "[PROXY]"); !ok {
		send("No proxied requests yet; nudging activity...", "yellow")
		launcher := adbRestartActivity(pkg)
		if launcher != "" {
			send("Restarted: "+launcher, "")
		} else {
			send("Relaunched via monkey", "")
		}
	}
	send("Capturing immediate post-signup traffic - press q to stop", "green")
}

func (m *model) captureSequenceLinkedInCronet(send func(string, string), flowCh chan capturedFlow, stopCh chan struct{}, hostIP string) {
	pkg := m.settings.Package
	port := m.settings.Port
	server := m.settings.FridaServer
	script := linkedInCronetScript()

	send("SELinux -> permissive", "")
	adbSELinuxPermissive()

	send("Stopping "+pkg+"...", "")
	adbForceStop(pkg)
	exec.Command("pkill", "-f", fmt.Sprintf("mitmdump.*%d", port)).Run()
	exec.Command("pkill", "-f", "frida -U").Run()
	if sleepOrStop(stopCh, time.Second) {
		return
	}

	send("Starting Frida server...", "")
	adbStartFridaServer(server)
	send("Frida server ready", "green")

	send(fmt.Sprintf("Starting mitmdump on :%d...", port), "")
	if err := m.mitmdump.Start(port, m.settings.IgnoreHosts); err != nil {
		send("mitmdump failed: "+err.Error(), "red")
		return
	}
	if sleepOrStop(stopCh, 2*time.Second) {
		return
	}
	send(fmt.Sprintf("Proxy listening on :%d", port), "green")
	go tailJSONL(flowCh, stopCh)

	send(fmt.Sprintf("System proxy -> %s:%d", hostIP, port), "")
	adbSetProxy(hostIP, port)
	if adbCheckConnectivity(hostIP, port) {
		send("Device -> proxy OK", "green")
	} else {
		send(fmt.Sprintf("Device cannot reach %s:%d", hostIP, port), "yellow")
	}

	send(fmt.Sprintf("Spawning Frida [%s]...", script.Label), "")
	if err := m.frida.Spawn(pkg, script.Path, hostIP, port); err != nil {
		send("Frida spawn failed: "+err.Error(), "red")
		return
	}
	send("Spawned under Frida - startup hooks installing...", "green")

	pid := waitForPID(pkg, stopCh, 40, 250*time.Millisecond)
	if pid > 0 {
		m.appPID = pid
		send(fmt.Sprintf("App running (pid %d)", pid), "green")
	}

	if line, ok := waitForFridaMarker(m.frida, stopCh, 0, 8*time.Second, "[CRONET-PATCH] options ctor", "[CRONET-PATCH] init", "[*] LinkedIn Cronet patch ready"); ok {
		send(line, "")
	} else {
		send("Timed out waiting for LinkedIn Cronet startup markers", "yellow")
	}

	send("LinkedIn Cronet capture active - use the app now", "green")
}

func (m *model) captureSequenceLinkedInReplay(send func(string, string), flowCh chan capturedFlow, stopCh chan struct{}, hostIP string) {
	pkg := m.settings.Package
	port := m.settings.Port
	server := m.settings.FridaServer
	cronetScript := linkedInCronetScript()
	challengeScript := linkedInChallengeTraceScript()

	send("SELinux -> permissive", "")
	adbSELinuxPermissive()

	send("Stopping "+pkg+"...", "")
	adbForceStop(pkg)
	exec.Command("pkill", "-f", fmt.Sprintf("mitmdump.*%d", port)).Run()
	exec.Command("pkill", "-f", "frida -U").Run()
	if sleepOrStop(stopCh, time.Second) {
		return
	}

	send("Starting Frida server...", "")
	adbStartFridaServer(server)
	send("Frida server ready", "green")

	send(fmt.Sprintf("Starting mitmdump on :%d...", port), "")
	if err := m.mitmdump.Start(port, m.settings.IgnoreHosts); err != nil {
		send("mitmdump failed: "+err.Error(), "red")
		return
	}
	if sleepOrStop(stopCh, 2*time.Second) {
		return
	}
	send(fmt.Sprintf("Proxy listening on :%d", port), "green")
	go tailJSONL(flowCh, stopCh)

	send(fmt.Sprintf("System proxy -> %s:%d", hostIP, port), "")
	adbSetProxy(hostIP, port)
	if adbCheckConnectivity(hostIP, port) {
		send("Device -> proxy OK", "green")
	} else {
		send(fmt.Sprintf("Device cannot reach %s:%d", hostIP, port), "yellow")
	}

	send(fmt.Sprintf("Spawning Frida [%s + %s]...", cronetScript.Label, challengeScript.Label), "")
	if err := m.frida.SpawnMultiScript(pkg, []string{cronetScript.Path, challengeScript.Path}, hostIP, port); err != nil {
		send("Frida spawn failed: "+err.Error(), "red")
		return
	}
	send("Spawned under Frida - Cronet + challenge trace hooks installing...", "green")

	pid := waitForPID(pkg, stopCh, 40, 250*time.Millisecond)
	if pid > 0 {
		m.appPID = pid
		send(fmt.Sprintf("App running (pid %d)", pid), "green")
	}

	if line, ok := waitForFridaMarker(m.frida, stopCh, 0, 8*time.Second,
		"[CRONET-PATCH] options ctor", "[CRONET-PATCH] init", "[*] LinkedIn Cronet patch ready",
		"[*] LinkedIn challenge trace ready"); ok {
		send(line, "")
	} else {
		send("Timed out waiting for startup markers", "yellow")
	}

	// Wait a bit more for the second script's marker
	if line, ok := waitForFridaMarker(m.frida, stopCh, 0, 4*time.Second,
		"[*] LinkedIn challenge trace ready"); ok {
		send(line, "")
	}

	send("LinkedIn Cronet + challenge trace active - use the app now", "green")
	send("MITM traffic captured + [CHALLENGE] lines in Frida log", "")
}

func tailJSONL(ch chan capturedFlow, stopCh chan struct{}) {
	// Wait for file to exist
	for i := 0; i < 100; i++ {
		select {
		case <-stopCh:
			return
		default:
		}
		if _, err := os.Stat(jsonlPath); err == nil {
			break
		}
		if sleepOrStop(stopCh, 200*time.Millisecond) {
			return
		}
	}

	var offset int64
	for {
		select {
		case <-stopCh:
			return
		default:
		}
		f, err := os.Open(jsonlPath)
		if err != nil {
			if sleepOrStop(stopCh, 500*time.Millisecond) {
				return
			}
			continue
		}
		f.Seek(offset, 0)
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			select {
			case <-stopCh:
				f.Close()
				return
			default:
			}
			line := scanner.Text()
			if line == "" {
				continue
			}
			var flow capturedFlow
			if json.Unmarshal([]byte(line), &flow) == nil && flow.Method != "" {
				select {
				case <-stopCh:
					f.Close()
					return
				case ch <- flow:
				default:
				}
			}
		}
		offset, _ = f.Seek(0, 1) // Current position
		f.Close()
		if sleepOrStop(stopCh, 300*time.Millisecond) {
			return
		}
	}
}

func (m *model) stopCapture() {
	m.log("Stopping capture...", "")
	m.capturing = false
	if m.captureStop != nil {
		close(m.captureStop)
		m.captureStop = nil
	}
	m.frida.Detach()
	m.mitmdump.Stop()
	adbClearProxy()
	if m.captureMode == captureModeSignupHandoff {
		hostIP := m.settings.HostIP
		if hostIP == "" {
			hostIP = detectHostIP()
		}
		if hostIP != "" {
			_ = adbWritePilotHandoffConfig(hostIP, m.settings.Port, false)
		}
	}
	if m.captureMode == captureModePapaJohns {
		adbRun("su -c 'kill $(pidof tproxy-connect)' 2>/dev/null")
		adbRun("su -c 'iptables -t nat -F OUTPUT'")
	}
	if m.captureMode != captureModeMitmOnly {
		adbSELinuxEnforcing()
	}
	if m.flowChan != nil {
		m.flowChan = nil
	}
	m.logChan = nil
	m.appPID = 0
	m.captureMode = captureModeStandard
	m.log("Capture stopped", "green")
}

func (m *model) cleanup() {
	if m.captureStop != nil {
		close(m.captureStop)
		m.captureStop = nil
	}
	m.frida.Detach()
	m.mitmdump.Stop()
	adbClearProxy()
	if m.captureMode == captureModeSignupHandoff {
		hostIP := m.settings.HostIP
		if hostIP == "" {
			hostIP = detectHostIP()
		}
		if hostIP != "" {
			_ = adbWritePilotHandoffConfig(hostIP, m.settings.Port, false)
		}
	}
	if m.captureMode == captureModePapaJohns {
		adbRun("su -c 'kill $(pidof tproxy-connect)' 2>/dev/null")
		adbRun("su -c 'iptables -t nat -F OUTPUT'")
	}
	if m.captureMode != captureModeMitmOnly {
		adbSELinuxEnforcing()
	}
}

// ── View ─────────────────────────────────────────────────────────────────────

func (m model) View() string {
	switch m.state {
	case stateMenu:
		return m.viewMenu()
	case stateSettings:
		return m.viewSettings()
	case stateScripts:
		return m.viewScripts()
	case stateCapture:
		return m.viewCapture()
	case stateDetail:
		return m.viewDetail()
	case stateLogs:
		return m.viewLogs()
	case stateDevice:
		return m.viewDevice()
	case stateApps, stateProcs:
		return m.viewList()
	case stateAppModes:
		return m.viewAppModes()
	}
	return ""
}

func (m model) viewMenu() string {
	pkg := m.settings.Package
	if pkg == "" {
		pkg = dimStyle.Render("not set")
	}
	script := m.settings.GetScript()
	scriptStr := labelStyle(script.LabelColor).Render(script.Label) + " " + script.Name

	s := "\n"
	s += titleStyle.Render("  Android HTTPS Interception") + "\n\n"
	s += fmt.Sprintf("  Package: %s\n", pkg)
	s += fmt.Sprintf("  Script:  %s\n", scriptStr)
	s += fmt.Sprintf("  Port:    %d\n\n", m.settings.Port)
	s += fmt.Sprintf("  %s  Start capture\n", keyStyle.Render("c"))
	s += fmt.Sprintf("  %s  MITM only capture\n", keyStyle.Render("m"))
	s += fmt.Sprintf("  %s  App-specific modes\n", keyStyle.Render("n"))
	s += fmt.Sprintf("  %s  Settings\n", keyStyle.Render("s"))
	s += fmt.Sprintf("  %s  Frida scripts\n", keyStyle.Render("f"))
	s += fmt.Sprintf("  %s  Device info\n", keyStyle.Render("d"))
	s += fmt.Sprintf("  %s  Installed apps\n", keyStyle.Render("a"))
	s += fmt.Sprintf("  %s  Running processes\n", keyStyle.Render("p"))
	s += fmt.Sprintf("  %s  Quit\n", keyStyle.Render("q"))

	// Recent logs
	if len(m.statusLines) > 0 {
		s += "\n"
		start := len(m.statusLines) - 3
		if start < 0 {
			start = 0
		}
		for _, l := range m.statusLines[start:] {
			styled := dimStyle.Render(l.Time + " " + l.Msg)
			if l.Style == "green" {
				styled = dimStyle.Render(l.Time+" ") + greenStyle.Render(l.Msg)
			} else if l.Style == "red" {
				styled = dimStyle.Render(l.Time+" ") + redStyle.Render(l.Msg)
			}
			s += "  " + styled + "\n"
		}
	}

	return s
}

func (m model) viewAppModes() string {
	pkg := m.settings.Package
	if pkg == "" {
		pkg = dimStyle.Render("not set")
	}

	s := "\n"
	s += titleStyle.Render("  App-Specific Capture Modes") + "\n\n"
	s += fmt.Sprintf("  Package: %s\n\n", pkg)
	s += fmt.Sprintf("  %s  Pilot signup handoff capture\n", keyStyle.Render("h"))
	s += fmt.Sprintf("  %s  LinkedIn Cronet capture\n", keyStyle.Render("k"))
	s += fmt.Sprintf("  %s  LinkedIn Cronet + challenge trace\n", keyStyle.Render("l"))
	s += fmt.Sprintf("  %s  DailyPay capture (APEX cert inject)\n", keyStyle.Render("y"))
	s += fmt.Sprintf("  %s  Speedway / 7-Eleven capture\n", keyStyle.Render("w"))
	s += fmt.Sprintf("  %s  Papa Johns capture (Flutter)\n", keyStyle.Render("j"))
	s += "\n"
	s += dimStyle.Render("  q/Esc=back")
	return s
}

func (m model) viewSettings() string {
	s := "\n"
	for i, f := range settingsFields {
		cursor := "  "
		if i == m.settingsCursor {
			cursor = "> "
		}
		val := m.settings.GetField(f.Key)
		if m.editingField == i {
			s += boldStyle.Render(cursor+f.Label+": ") + yellowStyle.Render(m.editingValue+"|") + "\n"
		} else if i == m.settingsCursor {
			s += boldStyle.Render(cursor+f.Label+": "+val) + "\n"
		} else {
			s += dimStyle.Render(cursor+f.Label+": ") + val + "\n"
		}
	}
	s += "\n"
	if m.editingField >= 0 {
		s += dimStyle.Render("  Enter=save  Esc=cancel")
	} else {
		s += dimStyle.Render("  Up/Down=navigate  Enter=edit  q/Esc=back")
	}
	return s
}

func (m model) viewScripts() string {
	scripts := fridaScripts()
	currentID := m.settings.FridaScriptID
	s := "\n"

	for i, sc := range scripts {
		cursor := "  "
		if i == m.scriptsCursor {
			cursor = "> "
		}
		active := " "
		if sc.ID == currentID {
			active = "*"
		}
		label := labelStyle(sc.LabelColor).Render(sc.Label)

		if i == m.scriptsCursor {
			s += fmt.Sprintf("%s%s %s  %s\n", cursor, active, label, boldStyle.Render(sc.Name))
			// Word-wrap description
			words := strings.Fields(sc.Desc)
			line := "     "
			for _, w := range words {
				if len(line)+len(w)+1 > 80 {
					s += dimStyle.Render(line) + "\n"
					line = "     "
				}
				line += w + " "
			}
			if strings.TrimSpace(line) != "" {
				s += dimStyle.Render(line) + "\n"
			}
			s += "\n"
		} else {
			s += fmt.Sprintf("%s%s %s  %s\n", cursor, active, label, sc.Name)
		}
	}

	s += dimStyle.Render("  Up/Down=navigate  Enter=select  q/Esc=back    *=active")
	return s
}

func (m model) viewCapture() string {
	flows := m.filteredFlows()
	total := len(m.flows)
	shown := len(flows)

	fridaStr := greenStyle.Render("hooked")
	if !m.frida.session {
		fridaStr = yellowStyle.Render("detached")
	}
	proxyStr := greenStyle.Render("running")
	if !m.mitmdump.running {
		proxyStr = redStyle.Render("stopped")
	}
	script := m.settings.GetScript()
	if m.captureMode == captureModeMitmOnly {
		script = fridaScript{Name: "None", Label: "MITM", LabelColor: "cyan"}
	} else if m.captureMode == captureModeSignupHandoff {
		script = pilotSignupHandoffScript()
	} else if m.captureMode == captureModeLinkedInCronet {
		script = linkedInCronetScript()
	} else if m.captureMode == captureModeSpeedway {
		script = speedwayScript()
	} else if m.captureMode == captureModeDailyPay {
		script = dailyPayScript()
	} else if m.captureMode == captureModePapaJohns {
		script = papajohnsScript()
	}
	pidStr := "-"
	if m.appPID > 0 {
		pidStr = strconv.Itoa(m.appPID)
	}
	status := fmt.Sprintf(" Proxy: %s  Frida: %s %s  PID: %s  Flows: %d/%d",
		proxyStr, fridaStr, labelStyle(script.LabelColor).Render(script.Label), pidStr, shown, total)
	status += "  Mode: " + yellowStyle.Render(m.captureModeLabel())
	if m.filterText != "" {
		status += "  Filter: " + yellowStyle.Render(m.filterText)
	}
	if m.typeFilter != resourceFilterAll {
		status += "  Type: " + yellowStyle.Render(resourceFilterLabel(m.typeFilter))
	}

	// Request table
	w := m.width
	if w < 40 {
		w = 80
	}
	header := fmt.Sprintf(" %-4s %-7s %-6s %-28s %-*s %8s",
		"#", "Method", "Status", "Host", w-70, "Path", "Size")
	table := dimStyle.Render(header) + "\n"

	maxRows := m.height - 20
	if maxRows < 5 {
		maxRows = 15
	}

	start := 0
	if len(flows) > maxRows {
		start = len(flows) - maxRows
	}
	if m.selectedFlow < start {
		start = m.selectedFlow
	}
	if m.selectedFlow >= start+maxRows {
		start = m.selectedFlow - maxRows + 1
	}

	for i := start; i < start+maxRows && i < len(flows); i++ {
		f := flows[i]
		cursor := " "
		if i == m.selectedFlow {
			cursor = ">"
		}
		method := f.Method
		switch method {
		case "GET":
			method = greenStyle.Render("GET    ")
		case "POST":
			method = yellowStyle.Render("POST   ")
		case "PUT":
			method = blueStyle.Render("PUT    ")
		case "DELETE":
			method = redStyle.Render("DELETE ")
		default:
			method = fmt.Sprintf("%-7s", method)
		}
		statusStr := strconv.Itoa(f.Status)
		if f.Status >= 200 && f.Status < 300 {
			statusStr = greenStyle.Render(fmt.Sprintf("%-6d", f.Status))
		} else if f.Status >= 400 {
			statusStr = redStyle.Render(fmt.Sprintf("%-6d", f.Status))
		} else {
			statusStr = yellowStyle.Render(fmt.Sprintf("%-6d", f.Status))
		}

		pathW := w - 70
		if pathW < 10 {
			pathW = 30
		}
		path := truncate(f.Path, pathW)

		line := fmt.Sprintf("%s%-4d %s %s %-28s %-*s %8s",
			cursor, i+1, method, statusStr, truncate(f.Host, 28), pathW, path, f.SizeStr())
		if i == m.selectedFlow {
			line = boldStyle.Render(line)
		}
		table += line + "\n"
	}

	// Log panel
	reqBorder := panelBorder
	logBorder := dimBorder
	if m.captureFocus == "logs" {
		reqBorder = dimBorder
		logBorder = focusedBorder
	}

	logLines := ""
	if m.captureFocus == "logs" {
		allLogs := m.allLogs()
		if len(allLogs) == 0 {
			logLines = dimStyle.Render("No logs yet") + "\n"
		} else {
			cursor := clamp(m.logScroll, 0, len(allLogs)-1)
			maxVisible := 10
			start := max(0, cursor-maxVisible/2)
			end := min(len(allLogs), start+maxVisible)
			for i := start; i < end; i++ {
				prefix := " "
				if i == cursor {
					prefix = ">"
				}
				line := truncate(allLogs[i], max(20, w-10))
				if i == cursor {
					logLines += boldStyle.Render(prefix+" "+line) + "\n"
				} else if strings.HasPrefix(allLogs[i], "[frida]") {
					logLines += cyanStyle.Faint(true).Render(prefix+" "+line) + "\n"
				} else {
					logLines += dimStyle.Render(prefix+" "+line) + "\n"
				}
			}
		}
	} else {
		fridaLogs := m.frida.GetLogs()
		for _, l := range m.statusLines[max(0, len(m.statusLines)-4):] {
			styled := l.Msg
			if l.Style == "green" {
				styled = greenStyle.Render(l.Msg)
			} else if l.Style == "red" {
				styled = redStyle.Render(l.Msg)
			}
			logLines += dimStyle.Render(l.Time) + " " + styled + "\n"
		}
		for _, fl := range fridaLogs[max(0, len(fridaLogs)-4):] {
			logLines += cyanStyle.Faint(true).Render(fl) + "\n"
		}
	}

	keys := fmt.Sprintf("  %s=stop  %s=export  %s=inspect  %s=clear  %s=restart  %s=filter  %s=type  %s=focus  %s=logs  %s=copy",
		keyStyle.Render("q"), keyStyle.Render("e"), keyStyle.Render("i"), keyStyle.Render("x"),
		keyStyle.Render("r"), keyStyle.Render("f"), keyStyle.Render("t"), keyStyle.Render("Tab"),
		keyStyle.Render("l"), keyStyle.Render("y"))

	return status + "\n" +
		reqBorder.Width(w-4).Render(table) + "\n" +
		logBorder.Width(w-4).Render(logLines) + "\n" +
		keys
}

func (m model) viewDetail() string {
	flows := m.filteredFlows()
	if len(flows) == 0 || m.selectedFlow >= len(flows) {
		return "No flow selected"
	}
	f := flows[m.selectedFlow]

	var lines []string
	lines = append(lines, boldStyle.Render(f.Method+" "+f.URL))
	lines = append(lines, fmt.Sprintf("Status: %d  Time: %s", f.Status, f.Time().Format("15:04:05")))
	lines = append(lines, fmt.Sprintf("Request: %d bytes  Response: %d bytes", f.ReqSize, f.RespSize))
	lines = append(lines, "")
	lines = append(lines, boldStyle.Underline(true).Render("Request Headers"))
	for k, v := range f.ReqHeaders {
		lines = append(lines, "  "+cyanStyle.Render(k)+": "+truncate(v, 100))
	}
	lines = append(lines, "")
	if f.ReqBody != nil && *f.ReqBody != "" {
		lines = append(lines, boldStyle.Underline(true).Render("Request Body"))
		body := *f.ReqBody
		if pretty, ok := prettyJSON(body); ok {
			body = pretty
		}
		for _, l := range strings.Split(body, "\n")[:min(30, len(strings.Split(body, "\n")))] {
			lines = append(lines, "  "+l)
		}
		lines = append(lines, "")
	}
	lines = append(lines, boldStyle.Underline(true).Render("Response Headers"))
	for k, v := range f.RespHeaders {
		lines = append(lines, "  "+cyanStyle.Render(k)+": "+truncate(v, 100))
	}
	if f.RespBody != nil && *f.RespBody != "" {
		lines = append(lines, "")
		lines = append(lines, boldStyle.Underline(true).Render("Response Body"))
		body := *f.RespBody
		if pretty, ok := prettyJSON(body); ok {
			body = pretty
		}
		for _, l := range strings.Split(body, "\n")[:min(50, len(strings.Split(body, "\n")))] {
			lines = append(lines, "  "+l)
		}
	}

	visible := lines[min(m.detailScroll, len(lines)):min(m.detailScroll+m.height-3, len(lines))]
	s := strings.Join(visible, "\n")
	s += "\n\n" + dimStyle.Render("  q/Esc=back  Up/Down=scroll")
	return s
}

func (m model) viewLogs() string {
	logs := m.allLogs()
	if len(logs) == 0 {
		return dimStyle.Render("  No logs yet\n\n") + dimStyle.Render("  q/Esc=back")
	}

	maxVisible := m.height - 4
	if maxVisible < 10 {
		maxVisible = 30
	}
	start := m.logCursor - maxVisible/2
	if start < 0 {
		start = 0
	}
	end := start + maxVisible
	if end > len(logs) {
		end = len(logs)
	}

	s := ""
	for i := start; i < end; i++ {
		cursor := " "
		if i == m.logCursor {
			cursor = ">"
		}
		line := logs[i]
		if i == m.logCursor {
			s += boldStyle.Render(cursor+" "+line) + "\n"
		} else if strings.HasPrefix(line, "[frida]") {
			s += cyanStyle.Render(cursor+" "+line) + "\n"
		} else {
			s += dimStyle.Render(cursor+" "+line) + "\n"
		}
	}

	s += fmt.Sprintf("\n  %d/%d    %s=navigate  %s=copy line  %s=copy all  %s=top/bottom  %s=back",
		m.logCursor+1, len(logs),
		keyStyle.Render("Up/Down"), keyStyle.Render("y"), keyStyle.Render("Y"),
		keyStyle.Render("g/G"), keyStyle.Render("q"))
	return s
}

func (m model) viewDevice() string {
	if m.deviceInfoCache == nil {
		return "\n  " + dimStyle.Render("Loading device info...") + "\n\n  " + dimStyle.Render("q=back")
	}
	info := m.deviceInfoCache
	conn := greenStyle.Render("Yes")
	if !info.Connected {
		conn = redStyle.Render("No")
	}
	sel := greenStyle.Render(info.SELinux)
	if info.SELinux == "Permissive" {
		sel = yellowStyle.Render("Permissive")
	}
	frida := greenStyle.Render("Running")
	if !info.FridaRunning {
		frida = redStyle.Render("Stopped")
	}
	proxy := dimStyle.Render("None")
	if info.Proxy != "" {
		proxy = yellowStyle.Render(info.Proxy)
	}

	s := "\n"
	s += titleStyle.Render("  Device Info") + "\n\n"
	s += fmt.Sprintf("  Connected:  %s\n", conn)
	s += fmt.Sprintf("  Model:      %s\n", info.Model)
	s += fmt.Sprintf("  Android:    %s\n", info.Android)
	s += fmt.Sprintf("  SDK:        %s\n", info.SDK)
	s += fmt.Sprintf("  SELinux:    %s\n", sel)
	s += fmt.Sprintf("  Frida:      %s\n", frida)
	s += fmt.Sprintf("  Sys Proxy:  %s\n", proxy)
	s += fmt.Sprintf("  Host IP:    %s\n\n", info.HostIP)
	s += fmt.Sprintf("  %s  Refresh\n", keyStyle.Render("r"))
	s += fmt.Sprintf("  %s  Start Frida server\n", keyStyle.Render("f"))
	s += fmt.Sprintf("  %s  Toggle SELinux\n", keyStyle.Render("S"))
	s += fmt.Sprintf("  %s  Clear proxy\n", keyStyle.Render("P"))
	s += fmt.Sprintf("  %s  Back\n", keyStyle.Render("q"))
	return s
}

func (m model) viewList() string {
	title := "Installed Apps"
	if m.state == stateProcs {
		title = "Running Processes"
	}
	filtered := m.filteredList()

	if m.listData == nil {
		return "\n  " + dimStyle.Render("Loading...") + "\n\n  " + dimStyle.Render("q=back")
	}

	s := "\n " + titleStyle.Render(title) + "\n\n"

	maxRows := m.height - 8
	if maxRows < 5 {
		maxRows = 20
	}
	start := m.listCursor - maxRows/2
	if start < 0 {
		start = 0
	}
	end := start + maxRows
	if end > len(filtered) {
		end = len(filtered)
	}

	for i := start; i < end; i++ {
		item := filtered[i]
		cursor := " "
		if i == m.listCursor {
			cursor = ">"
		}
		pidStr := dimStyle.Render("-")
		if item.PID > 0 {
			pidStr = greenStyle.Render(strconv.Itoa(item.PID))
		}
		line := fmt.Sprintf("%s %-6s %-25s %s", cursor, pidStr, truncate(item.Name, 25), item.ID)
		if i == m.listCursor {
			s += boldStyle.Render(line) + "\n"
		} else {
			s += line + "\n"
		}
	}

	filterStr := ""
	if m.listFilter != "" {
		filterStr = "  Filter: " + yellowStyle.Render(m.listFilter) + "  "
	}
	s += fmt.Sprintf("\n %s%d/%d items    %s",
		filterStr, len(filtered), len(m.listData),
		dimStyle.Render("Up/Down=nav  Enter=select  Type=filter  Esc=back"))
	if m.state == stateApps {
		s += "  " + dimStyle.Render("k=kill")
	}
	return s
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func prettyJSON(s string) (string, bool) {
	var v interface{}
	if json.Unmarshal([]byte(s), &v) == nil {
		b, err := json.MarshalIndent(v, "", "  ")
		if err == nil {
			return string(b), true
		}
	}
	return "", false
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func sleepOrStop(stopCh chan struct{}, d time.Duration) bool {
	select {
	case <-stopCh:
		return true
	case <-time.After(d):
		return false
	}
}

// ── Main ─────────────────────────────────────────────────────────────────────

func main() {
	var pkg string
	webFlag := false
	for _, arg := range os.Args[1:] {
		if arg == "--web" || arg == "-web" {
			webFlag = true
		} else if !strings.HasPrefix(arg, "-") && pkg == "" {
			pkg = arg
		}
	}

	initBaseDir()
	s := loadSettings()
	if pkg != "" {
		s.Package = pkg
		s.Save()
	}

	if s.UIMode == "web" || webFlag {
		runWebServer(s)
		return
	}

	m := initialModel(pkg)
	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

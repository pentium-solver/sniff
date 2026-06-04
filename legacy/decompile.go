package main

import (
	"archive/zip"
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

// ── Storage path ─────────────────────────────────────────────────────────────

func jadxDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".sniff", "jadx")
}

func jadxOutDir(pkg string) string {
	safe := strings.NewReplacer(".", "_", "/", "_").Replace(pkg)
	return filepath.Join(jadxDir(), safe)
}

// ── jadx binary — auto-download if missing ────────────────────────────────────

var jadxDownloadMu sync.Mutex

func jadxDistBin() string {
	home, _ := os.UserHomeDir()
	bin := "jadx"
	if runtime.GOOS == "windows" {
		bin = "jadx.bat"
	}
	return filepath.Join(home, ".sniff", "bin", "jadx-dist", "bin", bin)
}

// ensureJadx returns the jadx binary path, downloading it if necessary.
// logFn receives human-readable progress lines.
func ensureJadx(logFn func(string)) (string, error) {
	// 1. System PATH
	if p, err := exec.LookPath("jadx"); err == nil {
		return p, nil
	}
	// 2. Our download location
	if distBin := jadxDistBin(); fileExists(distBin) {
		return distBin, nil
	}
	// 3. Homebrew / common system paths
	for _, p := range []string{
		"/opt/homebrew/bin/jadx",
		"/usr/local/bin/jadx",
		"/usr/bin/jadx",
	} {
		if fileExists(p) {
			return p, nil
		}
	}

	// 4. Auto-download from GitHub releases
	jadxDownloadMu.Lock()
	defer jadxDownloadMu.Unlock()
	// Re-check after lock — another job may have already downloaded it
	if distBin := jadxDistBin(); fileExists(distBin) {
		return distBin, nil
	}
	return downloadJadx(logFn)
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func downloadJadx(logFn func(string)) (string, error) {
	logFn("jadx not found — fetching latest release from GitHub...")

	// ── 1. Resolve latest release ──────────────────────────────────────────
	client := &http.Client{Timeout: 30 * time.Second}
	req, _ := http.NewRequest("GET", "https://api.github.com/repos/skylot/jadx/releases/latest", nil)
	req.Header.Set("User-Agent", "sniff!/1.0")
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch jadx release info: %w", err)
	}
	defer resp.Body.Close()

	var release struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
			Size               int    `json:"size"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return "", fmt.Errorf("parse jadx release info: %w", err)
	}

	// Find jadx-VERSION.zip (not jadx-gui-*.zip)
	var dlURL string
	var dlSize int
	for _, a := range release.Assets {
		n := a.Name
		if strings.HasPrefix(n, "jadx-") && strings.HasSuffix(n, ".zip") && !strings.Contains(n, "gui") {
			dlURL = a.BrowserDownloadURL
			dlSize = a.Size
			break
		}
	}
	if dlURL == "" {
		// Fallback: any zip
		for _, a := range release.Assets {
			if strings.HasSuffix(a.Name, ".zip") {
				dlURL = a.BrowserDownloadURL
				dlSize = a.Size
				break
			}
		}
	}
	if dlURL == "" {
		return "", fmt.Errorf("no jadx zip found in release %s", release.TagName)
	}

	mb := float64(dlSize) / (1 << 20)
	logFn(fmt.Sprintf("Downloading jadx %s (%.1f MB)...", release.TagName, mb))

	// ── 2. Download to temp file ───────────────────────────────────────────
	zipPath := filepath.Join(os.TempDir(), "sniff_jadx_download.zip")
	dlResp, err := http.Get(dlURL) //nolint:noctx
	if err != nil {
		return "", fmt.Errorf("download jadx: %w", err)
	}
	defer dlResp.Body.Close()

	zf, err := os.Create(zipPath)
	if err != nil {
		return "", fmt.Errorf("create temp zip: %w", err)
	}

	// Progress reporting: every 5 MB
	downloaded := int64(0)
	lastReport := int64(-1 << 30)
	buf := make([]byte, 32*1024)
	for {
		n, readErr := dlResp.Body.Read(buf)
		if n > 0 {
			if _, werr := zf.Write(buf[:n]); werr != nil {
				zf.Close()
				return "", fmt.Errorf("write zip: %w", werr)
			}
			downloaded += int64(n)
			if downloaded-lastReport >= 5*(1<<20) {
				if dlSize > 0 {
					pct := int(downloaded * 100 / int64(dlSize))
					logFn(fmt.Sprintf("Downloading jadx... %d%% (%.0f / %.0f MB)",
						pct, float64(downloaded)/(1<<20), mb))
				} else {
					logFn(fmt.Sprintf("Downloading jadx... %.0f MB", float64(downloaded)/(1<<20)))
				}
				lastReport = downloaded
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			zf.Close()
			return "", fmt.Errorf("download: %w", readErr)
		}
	}
	zf.Close()
	logFn(fmt.Sprintf("Download complete (%.0f MB) — extracting...", float64(downloaded)/(1<<20)))

	// ── 3. Extract to ~/.sniff/bin/jadx-dist/ ─────────────────────────────
	home, _ := os.UserHomeDir()
	destDir := filepath.Join(home, ".sniff", "bin", "jadx-dist")
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return "", fmt.Errorf("mkdir jadx-dist: %w", err)
	}

	if err := extractZipStrip(zipPath, destDir); err != nil {
		return "", fmt.Errorf("extract jadx: %w", err)
	}
	os.Remove(zipPath)

	// ── 4. Locate and chmod the binary ────────────────────────────────────
	binPath := jadxDistBin()
	if !fileExists(binPath) {
		// Walk and find any "jadx" or "jadx.bat" file
		_ = filepath.WalkDir(destDir, func(p string, d fs.DirEntry, _ error) error {
			if !d.IsDir() && (d.Name() == "jadx" || d.Name() == "jadx.bat") {
				binPath = p
				return io.EOF // stop walk
			}
			return nil
		})
	}
	if !fileExists(binPath) {
		return "", fmt.Errorf("jadx binary not found after extraction in %s", destDir)
	}
	if runtime.GOOS != "windows" {
		os.Chmod(binPath, 0o755)
	}

	logFn(fmt.Sprintf("jadx %s ready at %s", release.TagName, binPath))
	return binPath, nil
}

// extractZipStrip extracts a zip to destDir, stripping the first path component
// (e.g., "jadx-1.5.1/bin/jadx" → "bin/jadx").
func extractZipStrip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		// Strip first component
		parts := strings.SplitN(filepath.ToSlash(f.Name), "/", 2)
		if len(parts) < 2 || parts[1] == "" {
			continue
		}
		rel := filepath.FromSlash(parts[1])
		dest := filepath.Join(destDir, rel)

		// Guard against zip-slip
		if !strings.HasPrefix(dest, destDir+string(filepath.Separator)) {
			continue
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(dest, 0o755)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(dest)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		out.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// ── Decompile job manager ─────────────────────────────────────────────────────

type decompileJob struct {
	pkg     string
	outDir  string
	created time.Time
	done    chan struct{}
	err     error
	prog    atomic.Int32 // 0–100

	mu      sync.Mutex
	lines   []string // last N log lines
	running bool     // goroutine has been launched
}

func (j *decompileJob) addLine(line string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if len(j.lines) >= 200 {
		j.lines = j.lines[1:]
	}
	j.lines = append(j.lines, line)
}

func (j *decompileJob) lastLines(n int) []string {
	j.mu.Lock()
	defer j.mu.Unlock()
	if len(j.lines) <= n {
		cp := make([]string, len(j.lines))
		copy(cp, j.lines)
		return cp
	}
	cp := make([]string, n)
	copy(cp, j.lines[len(j.lines)-n:])
	return cp
}

var (
	decompileMu   sync.Mutex
	decompileJobs = map[string]*decompileJob{}
)

func getOrStartJob(pkg string) *decompileJob {
	decompileMu.Lock()
	defer decompileMu.Unlock()
	if j, ok := decompileJobs[pkg]; ok {
		return j
	}
	j := &decompileJob{
		pkg:     pkg,
		outDir:  jadxOutDir(pkg),
		created: time.Now(),
		done:    make(chan struct{}),
	}
	decompileJobs[pkg] = j
	return j
}

func runDecompileJob(j *decompileJob, apkPath string) {
	defer close(j.done)

	bin, err := ensureJadx(j.addLine)
	if err != nil {
		j.err = err
		j.addLine("ERROR: " + err.Error())
		return
	}

	if err := os.MkdirAll(j.outDir, 0o755); err != nil {
		j.err = fmt.Errorf("mkdir: %w", err)
		j.addLine("ERROR: " + j.err.Error())
		return
	}

	// --deobf intentionally omitted: on large enterprise APKs (10k+ classes)
	// deobfuscation requires a full call-graph pass before any class is written,
	// adding 5–30 minutes of invisible "loading/processing" time. Raw class names
	// are sufficient for security analysis.
	args := []string{
		"--no-res",           // skip resources — faster, source code only
		"--show-bad-code",    // include decompile-failed stubs so search still finds them
		"-d", j.outDir,
		apkPath,
	}

	j.addLine(fmt.Sprintf("Starting jadx: %s", filepath.Base(apkPath)))

	cmd := exec.Command(bin, args...)
	cmd.Stdin = nil // no interactive prompts

	// Give the JVM more heap — default 2 GB is often not enough for large apps.
	// JAVA_OPTS is respected by the jadx launch script on all platforms.
	cmd.Env = append(os.Environ(), "JAVA_OPTS=-Xmx4g")

	// Capture BOTH stdout and stderr — jadx sends progress to stdout
	// on some builds, stderr on others. Use os.Pipe to combine.
	pr, pw, pipeErr := os.Pipe()
	if pipeErr != nil {
		j.err = fmt.Errorf("pipe: %w", pipeErr)
		j.addLine("ERROR: " + j.err.Error())
		return
	}
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		pw.Close()
		pr.Close()
		j.err = fmt.Errorf("start jadx: %w", err)
		j.addLine("ERROR: " + j.err.Error())
		return
	}
	// Close the write end in the parent — only jadx writes to it.
	pw.Close()

	j.addLine("jadx running — large APKs can take 2–5 min in the loading phase")

	// ── Heartbeat goroutine ─────────────────────────────────────────────────────
	// Logs elapsed time every 30 s so the UI stays visibly alive during the
	// loading/processing phases that produce no progress output.
	heartbeatStop := make(chan struct{})
	safeGo("decompileHeartbeat", func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		start := time.Now()
		for {
			select {
			case <-ticker.C:
				j.addLine(fmt.Sprintf("⏱ still running — %s elapsed", time.Since(start).Round(time.Second)))
			case <-heartbeatStop:
				return
			}
		}
	})

	// Stream output; parse progress lines.
	// jadx outputs: "INFO  - done: 42%"  or  "INFO  - done: 42% of 5000 classes"
	// It also outputs "INFO - loading ..." and "INFO - processing ..." before counting.
	scanner := bufio.NewScanner(pr)
	scanner.Buffer(make([]byte, 512*1024), 512*1024)
	for scanner.Scan() {
		line := scanner.Text()
		j.addLine(line)

		lower := strings.ToLower(line)

		// Phase markers — set synthetic progress so the bar is never stuck at 0%
		if strings.Contains(lower, "loading") && j.prog.Load() == 0 {
			j.prog.Store(2)
		} else if strings.Contains(lower, "processing") && j.prog.Load() <= 2 {
			j.prog.Store(5)
		}

		// Real jadx percentage
		if idx := strings.Index(line, "done: "); idx >= 0 {
			rest := strings.TrimSpace(line[idx+6:])
			tok := rest
			if sp := strings.IndexAny(rest, " \t"); sp > 0 {
				tok = rest[:sp]
			}
			tok = strings.TrimSuffix(tok, "%")
			if n, err2 := strconv.Atoi(tok); err2 == nil && n >= 0 && n <= 100 {
				// Map real 0–100 to 8–99 so it stays above the phase markers
				mapped := 8 + (n*91)/100
				j.prog.Store(int32(mapped))
			}
		}
	}
	pr.Close()
	close(heartbeatStop)

	j.err = cmd.Wait()
	if j.err != nil {
		j.addLine("ERROR: jadx exited non-zero: " + j.err.Error())
	} else {
		j.prog.Store(100)
		j.addLine("Decompilation complete ✓")
	}
}

// ── File tree ─────────────────────────────────────────────────────────────────

type treeNode struct {
	Name        string      `json:"name"`
	Path        string      `json:"path"`        // relative path from jadxOutDir
	IsFile      bool        `json:"is_file"`
	HasChildren bool        `json:"has_children"` // true for un-expanded dirs
	Children    []*treeNode `json:"children,omitempty"`
}

// buildTreeLimited builds the tree under rootDir to maxDepth levels.
// Paths in nodes are relative to outDir (the package jadx root, not rootDir).
func buildTreeLimited(rootDir, outDir string, maxDepth int) (*treeNode, error) {
	rootRel, _ := filepath.Rel(outDir, rootDir)
	if rootRel == "." {
		rootRel = ""
	}
	root := &treeNode{Name: filepath.Base(rootDir), Path: rootRel}

	entries, err := os.ReadDir(rootDir)
	if err != nil {
		return root, err
	}

	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		absPath := filepath.Join(rootDir, name)
		rel, _ := filepath.Rel(outDir, absPath)

		if e.IsDir() {
			node := &treeNode{Name: name, Path: rel, IsFile: false}
			if maxDepth > 1 {
				child, _ := buildTreeLimited(absPath, outDir, maxDepth-1)
				node.Children = child.Children
				node.HasChildren = len(node.Children) > 0
			} else {
				// Check if directory is non-empty without reading it all
				sub, _ := os.ReadDir(absPath)
				node.HasChildren = len(sub) > 0
			}
			root.Children = append(root.Children, node)
		} else {
			root.Children = append(root.Children, &treeNode{
				Name:   name,
				Path:   rel,
				IsFile: true,
			})
		}
	}

	return root, nil
}

// buildTree kept for compatibility — full depth for small outputs.
func buildTree(rootDir string) (*treeNode, error) {
	return buildTreeLimited(rootDir, rootDir, 99)
}

// ── List decompiled packages ─────────────────────────────────────────────────

func listDecompiledPackages() []string {
	base := jadxDir()
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil
	}
	var pkgs []string
	for _, e := range entries {
		if e.IsDir() {
			// Reverse the safe name back to package name (heuristic)
			name := strings.ReplaceAll(e.Name(), "_", ".")
			pkgs = append(pkgs, name)
		}
	}
	return pkgs
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// POST /api/decompile
// body: { "package": "com.example.app" }
func (ws *webServer) handleDecompile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var req struct {
		Package string `json:"package"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Package == "" {
		http.Error(w, "missing package", 400)
		return
	}
	pkg := req.Package
	outDir := jadxOutDir(pkg)

	// Already decompiled?
	if _, err := os.Stat(outDir); err == nil {
		jsonResponse(w, map[string]interface{}{
			"status": "ready",
			"outDir": outDir,
		})
		return
	}

	j := getOrStartJob(pkg)

	select {
	case <-j.done:
		// Job already finished
		if j.err != nil {
			jsonResponse(w, map[string]interface{}{"status": "error", "error": j.err.Error()})
		} else {
			jsonResponse(w, map[string]interface{}{"status": "ready"})
		}
		return
	default:
		// Check if job is already running (chan not closed yet)
		// If lines are empty and prog is 0 and elapsed < 1s, it's just starting
	}

	// Launch goroutine only once — guard with j.running flag
	j.mu.Lock()
	shouldStart := !j.running
	if shouldStart {
		j.running = true
	}
	j.mu.Unlock()

	if shouldStart {
		go func() {
			apkPath, err := getOrPullAPK(pkg)
			if err != nil {
				j.err = fmt.Errorf("APK pull: %w", err)
				j.addLine("ERROR: " + j.err.Error())
				close(j.done)
				return
			}
			runDecompileJob(j, apkPath)
		}()
	}

	jsonResponse(w, map[string]interface{}{"status": "running"})
}

// GET /api/decompile/status?package=com.example.app
func (ws *webServer) handleDecompileStatus(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	if pkg == "" {
		http.Error(w, "missing package", 400)
		return
	}

	outDir := jadxOutDir(pkg)

	// Already finished (no active job)?
	decompileMu.Lock()
	j, hasJob := decompileJobs[pkg]
	decompileMu.Unlock()

	if !hasJob {
		// Check if already on disk
		if _, err := os.Stat(outDir); err == nil {
			// Count files
			var count int
			filepath.WalkDir(outDir, func(_ string, d fs.DirEntry, _ error) error {
				if d != nil && !d.IsDir() {
					count++
				}
				return nil
			})
			jsonResponse(w, map[string]interface{}{
				"status":    "ready",
				"progress":  100,
				"fileCount": count,
			})
		} else {
			jsonResponse(w, map[string]interface{}{"status": "idle"})
		}
		return
	}

	prog := j.prog.Load()
	lines := j.lastLines(10)
	elapsedMs := time.Since(j.created).Milliseconds()

	select {
	case <-j.done:
		if j.err != nil {
			jsonResponse(w, map[string]interface{}{
				"status":     "error",
				"error":      j.err.Error(),
				"progress":   int(prog),
				"log":        lines,
				"elapsed_ms": elapsedMs,
			})
		} else {
			var count int
			filepath.WalkDir(outDir, func(_ string, d fs.DirEntry, _ error) error {
				if d != nil && !d.IsDir() {
					count++
				}
				return nil
			})
			jsonResponse(w, map[string]interface{}{
				"status":     "ready",
				"progress":   100,
				"fileCount":  count,
				"log":        lines,
				"elapsed_ms": elapsedMs,
			})
		}
	default:
		jsonResponse(w, map[string]interface{}{
			"status":     "running",
			"progress":   int(prog),
			"log":        lines,
			"elapsed_ms": elapsedMs,
		})
	}
}

// GET /api/decompile/packages
func (ws *webServer) handleDecompilePackages(w http.ResponseWriter, r *http.Request) {
	pkgs := listDecompiledPackages()

	// Also include actively running jobs
	decompileMu.Lock()
	for pkg, j := range decompileJobs {
		select {
		case <-j.done:
			if j.err == nil {
				found := false
				for _, p := range pkgs {
					if p == pkg {
						found = true
						break
					}
				}
				if !found {
					pkgs = append(pkgs, pkg)
				}
			}
		default:
			// still running — include it
			found := false
			for _, p := range pkgs {
				if p == pkg {
					found = true
					break
				}
			}
			if !found {
				pkgs = append(pkgs, pkg)
			}
		}
	}
	decompileMu.Unlock()

	if pkgs == nil {
		pkgs = []string{}
	}
	jsonResponse(w, map[string]interface{}{"packages": pkgs})
}

// GET /api/decompile/tree?package=com.example.app[&path=subdir][&depth=2]
// Returns the tree rooted at `path` (default: root) to `depth` levels (default: 3).
// Leaf directories whose children haven't been fetched have has_children=true but empty Children.
func (ws *webServer) handleDecompileTree(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	if pkg == "" {
		http.Error(w, "missing package", 400)
		return
	}

	outDir := jadxOutDir(pkg)
	if _, err := os.Stat(outDir); err != nil {
		http.Error(w, "not decompiled yet", 404)
		return
	}

	subPath := filepath.Clean(r.URL.Query().Get("path"))
	if subPath == "." {
		subPath = ""
	}

	depth := 3
	if d, err := strconv.Atoi(r.URL.Query().Get("depth")); err == nil && d > 0 && d <= 10 {
		depth = d
	}

	rootDir := outDir
	if subPath != "" {
		rootDir = filepath.Join(outDir, subPath)
		// Guard against traversal
		if !strings.HasPrefix(rootDir, outDir) {
			http.Error(w, "forbidden", 403)
			return
		}
	}

	tree, err := buildTreeLimited(rootDir, outDir, depth)
	if err != nil {
		http.Error(w, "failed to build tree: "+err.Error(), 500)
		return
	}
	jsonResponse(w, tree)
}

// GET /api/decompile/file?package=com.example.app&path=com/example/Api.java
func (ws *webServer) handleDecompileFile(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	rel := r.URL.Query().Get("path")
	if pkg == "" || rel == "" {
		http.Error(w, "missing params", 400)
		return
	}

	// Security: no path traversal
	rel = filepath.Clean(rel)
	if strings.HasPrefix(rel, "..") {
		http.Error(w, "forbidden", 403)
		return
	}

	full := filepath.Join(jadxOutDir(pkg), rel)
	data, err := os.ReadFile(full)
	if err != nil {
		http.Error(w, "file not found", 404)
		return
	}

	// Truncate very large files at 4000 lines to avoid huge payloads
	content := string(data)
	if !utf8.ValidString(content) {
		http.Error(w, "binary file", 415)
		return
	}
	lines := strings.Split(content, "\n")
	truncated := false
	if len(lines) > 4000 {
		lines = lines[:4000]
		truncated = true
	}

	jsonResponse(w, map[string]interface{}{
		"path":      rel,
		"content":   strings.Join(lines, "\n"),
		"lines":     len(lines),
		"truncated": truncated,
	})
}

// GET /api/decompile/search?package=com.example.app&q=getUserProfile&ext=java
// ── Search types ──────────────────────────────────────────────────────────────

type searchMatch struct {
	File  string `json:"file"`
	Line  int    `json:"line"`
	Match string `json:"match"`
}

// GET /api/decompile/search?package=com.example.app&q=getUserProfile[&deep=1][&case=1]
// Delegates to rg or grep — never WalkDir, so it doesn't block the server.
func (ws *webServer) handleDecompileSearch(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	q := r.URL.Query().Get("q")
	if pkg == "" || q == "" {
		http.Error(w, "missing params", 400)
		return
	}

	deep := r.URL.Query().Get("deep") == "1"
	cs := r.URL.Query().Get("case") == "1"

	outDir := jadxOutDir(pkg)
	if _, err := os.Stat(outDir); err != nil {
		http.Error(w, "not decompiled yet", 404)
		return
	}

	maxMatches := 200
	if deep {
		maxMatches = 500
	}

	t0 := time.Now()
	matches, capped, tool, err := runSearch(outDir, q, deep, cs, maxMatches)
	elapsed := time.Since(t0).Milliseconds()

	if err != nil {
		http.Error(w, "search error: "+err.Error(), 500)
		return
	}
	if matches == nil {
		matches = []searchMatch{}
	}

	debugLog("search %q deep=%v cs=%v → %d results, capped=%v, tool=%s (%dms)",
		q, deep, cs, len(matches), capped, tool, elapsed)

	jsonResponse(w, map[string]interface{}{
		"query":      q,
		"deep":       deep,
		"case":       cs,
		"count":      len(matches),
		"capped":     capped,
		"tool":       tool,
		"elapsed_ms": elapsed,
		"results":    matches,
	})
}

// runSearch delegates to rg → grep → Go fallback in order of speed.
func runSearch(outDir, query string, deep, cs bool, maxMatches int) ([]searchMatch, bool, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Prefer ripgrep
	if rg, err := exec.LookPath("rg"); err == nil {
		m, capped, err := rgSearch(ctx, rg, outDir, query, deep, cs, maxMatches)
		if err == nil || ctx.Err() == context.DeadlineExceeded {
			return m, capped, "rg", nil
		}
	}

	// Fall back to grep (always available on macOS/Linux)
	if grep, err := exec.LookPath("grep"); err == nil {
		m, capped, err := grepSearch(ctx, grep, outDir, query, deep, cs, maxMatches)
		if err == nil || ctx.Err() == context.DeadlineExceeded {
			return m, capped, "grep", nil
		}
	}

	// Last resort: Go WalkDir with the 30s context
	m, capped, err := goSearch(ctx, outDir, query, deep, cs, maxMatches)
	return m, capped, "go", err
}

// source file globs for normal (non-deep) search
var srcGlobs = []string{"*.java", "*.kt", "*.xml", "*.json", "*.proto", "*.gradle"}

func rgSearch(ctx context.Context, rgBin, outDir, query string, deep, cs bool, maxMatches int) ([]searchMatch, bool, error) {
	args := []string{
		"--line-number",
		"--no-heading",
		"--fixed-strings",
		"--color", "never",
		"--max-count", "20", // per-file cap so one huge file can't dominate
	}
	if !cs {
		args = append(args, "--ignore-case")
	}
	if !deep {
		for _, g := range srcGlobs {
			args = append(args, "--glob", g)
		}
	}
	args = append(args, "--", query, outDir)

	out, err := exec.CommandContext(ctx, rgBin, args...).Output()
	capped := ctx.Err() == context.DeadlineExceeded

	if err != nil && !capped {
		if ex, ok := err.(*exec.ExitError); ok && ex.ExitCode() == 1 {
			return []searchMatch{}, false, nil // exit 1 = no matches, not an error
		}
		return nil, false, err
	}

	m, c := parseGrepLines(string(out), outDir, maxMatches)
	return m, c || capped, nil
}

func grepSearch(ctx context.Context, grepBin, outDir, query string, deep, cs bool, maxMatches int) ([]searchMatch, bool, error) {
	args := []string{"-rn", "-F"} // recursive, line-numbers, fixed-string
	if !cs {
		args = append(args, "-i")
	}
	args = append(args, "-I") // skip binary files
	args = append(args, "-m", "20") // per-file cap
	if !deep {
		for _, g := range srcGlobs {
			args = append(args, "--include="+g)
		}
	}
	args = append(args, "--", query, outDir)

	out, err := exec.CommandContext(ctx, grepBin, args...).Output()
	capped := ctx.Err() == context.DeadlineExceeded

	if err != nil && !capped {
		if ex, ok := err.(*exec.ExitError); ok && ex.ExitCode() == 1 {
			return []searchMatch{}, false, nil
		}
		return nil, false, err
	}

	m, c := parseGrepLines(string(out), outDir, maxMatches)
	return m, c || capped, nil
}

// parseGrepLines parses "absPath:lineNum:content" output from grep/rg.
func parseGrepLines(raw, outDir string, maxMatches int) ([]searchMatch, bool) {
	var matches []searchMatch
	for _, line := range strings.SplitAfter(raw, "\n") {
		line = strings.TrimRight(line, "\r\n")
		if line == "" || len(matches) >= maxMatches {
			break
		}
		// Split at first two colons: path:linenum:content
		// Paths on macOS/Linux never contain ':', so this is safe.
		i1 := strings.Index(line, ":")
		if i1 < 0 {
			continue
		}
		rest := line[i1+1:]
		i2 := strings.Index(rest, ":")
		if i2 < 0 {
			continue
		}

		absFile := line[:i1]
		lineNum, err := strconv.Atoi(rest[:i2])
		if err != nil {
			continue
		}
		content := strings.TrimSpace(rest[i2+1:])

		rel, err := filepath.Rel(outDir, absFile)
		if err != nil || strings.HasPrefix(rel, "..") {
			rel = absFile
		}

		matches = append(matches, searchMatch{File: rel, Line: lineNum, Match: content})
	}
	return matches, len(matches) >= maxMatches
}

// goSearch is the last-resort fallback — reads files in Go with context cancellation.
func goSearch(ctx context.Context, outDir, query string, deep, cs bool, maxMatches int) ([]searchMatch, bool, error) {
	srcExts := map[string]bool{".java": true, ".kt": true, ".xml": true, ".json": true, ".proto": true, ".gradle": true}
	qLower := strings.ToLower(query)

	var matches []searchMatch
	err := filepath.WalkDir(outDir, func(p string, d fs.DirEntry, werr error) error {
		if werr != nil || d.IsDir() {
			return nil
		}
		if ctx.Err() != nil || len(matches) >= maxMatches {
			return filepath.SkipAll
		}
		if !deep && !srcExts[filepath.Ext(d.Name())] {
			return nil
		}
		data, err := os.ReadFile(p)
		if err != nil || !utf8.ValidString(string(data)) {
			return nil
		}
		rel, _ := filepath.Rel(outDir, p)
		perFile := 0
		for i, line := range strings.Split(string(data), "\n") {
			if ctx.Err() != nil || len(matches) >= maxMatches || perFile >= 20 {
				break
			}
			hit := cs && strings.Contains(line, query) ||
				!cs && strings.Contains(strings.ToLower(line), qLower)
			if hit {
				matches = append(matches, searchMatch{File: rel, Line: i + 1, Match: strings.TrimSpace(line)})
				perFile++
			}
		}
		return nil
	})
	return matches, len(matches) >= maxMatches, err
}


// ── Definition lookup ─────────────────────────────────────────────────────────

// GET /api/decompile/definition?package=com.example&symbol=MyClass
// Tries definition patterns in priority order. Returns first non-empty hit.
func (ws *webServer) handleDecompileDefinition(w http.ResponseWriter, r *http.Request) {
	pkg := r.URL.Query().Get("package")
	sym := strings.TrimSpace(r.URL.Query().Get("symbol"))
	if pkg == "" || len(sym) < 2 {
		http.Error(w, "missing params", 400)
		return
	}
	// Reject obviously invalid symbols (operators, numbers, single chars)
	if !validSymbol(sym) {
		jsonResponse(w, map[string]interface{}{"symbol": sym, "results": []int{}, "kind": ""})
		return
	}

	outDir := jadxOutDir(pkg)
	if _, err := os.Stat(outDir); err != nil {
		http.Error(w, "not decompiled yet", 404)
		return
	}

	type defMatch struct {
		File  string `json:"file"`
		Line  int    `json:"line"`
		Match string `json:"match"`
		Kind  string `json:"kind"`
	}

	// Priority order: most-specific definition patterns first.
	// All searches are case-sensitive and limited to source file extensions.
	patterns := []struct {
		query string
		kind  string
	}{
		{"class " + sym, "class"},
		{"interface " + sym, "interface"},
		{"enum " + sym, "enum"},
		{"record " + sym, "record"},
		{"sealed class " + sym, "class"},
		{"data class " + sym, "class"},
		{"object " + sym, "object"},  // Kotlin singleton/companion
		{"fun " + sym + "(", "function"},  // Kotlin top-level function
		{") " + sym + "(", "method"},      // Java method (return type precedes name)
		{"void " + sym + "(", "method"},
		{"static " + sym + "(", "method"},
		{sym + "(", "constructor"},
		{" " + sym + " =", "field"},
		{" " + sym + ";", "field"},
	}

	t0 := time.Now()
	for _, p := range patterns {
		hits, _, _, err := runSearch(outDir, p.query, false, true, 8)
		if err != nil || len(hits) == 0 {
			continue
		}
		// Filter out comment lines and keep only definition-looking results
		var results []defMatch
		for _, h := range hits {
			trimmed := strings.TrimSpace(h.Match)
			if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "*") ||
				strings.HasPrefix(trimmed, "/*") {
				continue
			}
			results = append(results, defMatch{
				File:  h.File,
				Line:  h.Line,
				Match: h.Match,
				Kind:  p.kind,
			})
			if len(results) >= 5 {
				break
			}
		}
		if len(results) == 0 {
			continue
		}
		debugLog("definition %q → %d results (kind=%s, %dms)", sym, len(results), p.kind, time.Since(t0).Milliseconds())
		jsonResponse(w, map[string]interface{}{
			"symbol":  sym,
			"kind":    p.kind,
			"results": results,
		})
		return
	}

	debugLog("definition %q → not found (%dms)", sym, time.Since(t0).Milliseconds())
	jsonResponse(w, map[string]interface{}{
		"symbol":  sym,
		"kind":    "",
		"results": []defMatch{},
	})
}

// validSymbol checks that the string looks like a Java/Kotlin identifier.
func validSymbol(s string) bool {
	if len(s) < 2 || len(s) > 200 {
		return false
	}
	for _, r := range s {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '_' || r == '$') {
			return false
		}
	}
	return true
}

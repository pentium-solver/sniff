package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ── Shared types ──────────────────────────────────────────────────────────────

// PinMechanism is an identified SSL-pinning technique.
// Evidence is a slice of short human-readable strings (DEX file name, pattern, etc.)
// — same shape as detectedProtection.Evidence so the frontend reuses the same UI.
type PinMechanism struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Confidence  string   `json:"confidence"` // "high" | "medium" | "low"
	Evidence    []string `json:"evidence"`
	Classes     []string `json:"classes,omitempty"` // set by jadx-based deep analysis
}

type HardcodedPin struct {
	Hash string `json:"hash"` // e.g. "sha256/abc123=="
	File string `json:"file"` // which APK entry / source file
}

type PinningAnalysis struct {
	Package   string         `json:"package"`
	Mechanism []PinMechanism `json:"mechanisms"`
	Pins      []HardcodedPin `json:"pins"`
	Script    string         `json:"script"`
	ScriptName string        `json:"script_name"`
	Summary   string         `json:"summary"`
	ElapsedMs int64          `json:"elapsed_ms"`
	Source    string         `json:"source"` // "apk" | "jadx"
}

// ── APK-level scanner ─────────────────────────────────────────────────────────
//
// Scans the raw APK (zip) for pinning evidence using the same DEX byte-search
// approach as detectProtectionsFromAPK. No decompilation required.
// Runs in the same time budget as framework + protections detection.

type apkPinSig struct {
	id         string
	name       string
	desc       string
	confidence string
	// DEX byte patterns (ASCII — class descriptors use '/' not '.')
	dex []string
	// Zip entry path substrings
	assets []string
}

var apkPinSigs = []apkPinSig{
	{
		id:         "okhttp3-certpinner",
		name:       "OkHttp3 CertificatePinner",
		desc:       "App uses OkHttp3's built-in certificate pinning via CertificatePinner.Builder().add()",
		confidence: "high",
		dex:        []string{"okhttp3/CertificatePinner", "CertificatePinner"},
	},
	{
		id:         "okhttp2-certpinner",
		name:       "OkHttp2 CertificatePinner",
		desc:       "App uses legacy OkHttp2 certificate pinning",
		confidence: "high",
		dex:        []string{"com/squareup/okhttp/CertificatePinner"},
	},
	{
		id:         "custom-trustmanager",
		name:       "Custom X509TrustManager",
		desc:       "App implements a custom TrustManager — likely performs manual certificate chain validation",
		confidence: "high",
		dex:        []string{"checkServerTrusted", "X509TrustManager"},
	},
	{
		id:         "network-security-config",
		name:       "NetworkSecurityConfig Pins",
		desc:       "App declares certificate pins in Android's network_security_config.xml",
		confidence: "high",
		assets:     []string{"network_security_config", "security_config"},
		dex:        []string{"network_security_config"},
	},
	{
		id:         "webview-ssl",
		name:       "WebViewClient SSL Override",
		desc:       "App overrides WebView's SSL error handler — WebView connections need a separate hook",
		confidence: "medium",
		dex:        []string{"onReceivedSslError"},
	},
	{
		id:         "trustkit",
		name:       "TrustKit",
		desc:       "App uses the TrustKit library for advanced certificate pinning",
		confidence: "high",
		dex:        []string{"com/datatheorem/android/trustkit", "datatheorem/android/trustkit"},
	},
	{
		id:         "conscrypt",
		name:       "Conscrypt SSL Provider",
		desc:       "App uses Google's Conscrypt SSL provider — may have custom pinning at the native layer",
		confidence: "low",
		dex:        []string{"org/conscrypt"},
	},
	{
		id:         "httpsurlconn",
		name:       "HttpsURLConnection",
		desc:       "App configures HttpsURLConnection with a custom SSL socket factory or hostname verifier",
		confidence: "low",
		dex:        []string{"setSSLSocketFactory", "javax/net/ssl/HttpsURLConnection"},
	},
	{
		id:         "hostname-verifier",
		name:       "Custom HostnameVerifier",
		desc:       "App implements a custom HostnameVerifier — may restrict connections to specific hostnames",
		confidence: "medium",
		dex:        []string{"HostnameVerifier"},
	},
	{
		id:         "apache-httpclient",
		name:       "Apache HttpClient (legacy)",
		desc:       "App uses the legacy Apache HttpClient SSL stack",
		confidence: "low",
		dex:        []string{"org/apache/http/conn/ssl"},
	},
}

// pinHashRe matches OkHttp-style pin strings: sha256/<base64> or sha1/<base64>
var pinHashRe = regexp.MustCompile(`sha(?:256|1)/[A-Za-z0-9+/=]{20,}`)

func detectPinningFromAPK(pkg, apkPath string) *PinningAnalysis {
	t0 := time.Now()
	// Initialize slices as non-nil so they serialize as [] not null.
	a := &PinningAnalysis{
		Package:   pkg,
		Source:    "apk",
		Mechanism: []PinMechanism{},
		Pins:      []HardcodedPin{},
	}

	zr, err := zip.OpenReader(apkPath)
	if err != nil {
		a.Summary = "could not open APK: " + err.Error()
		return a
	}
	defer zr.Close()

	// Track per-sig evidence; avoid duplicates.
	type sigState struct {
		seen map[string]bool
		evs  []string
	}
	states := make([]sigState, len(apkPinSigs))
	for i := range states {
		states[i].seen = make(map[string]bool)
	}
	addEv := func(i int, s string) {
		if !states[i].seen[s] {
			states[i].seen[s] = true
			if len(states[i].evs) < 4 {
				states[i].evs = append(states[i].evs, s)
			}
		}
	}

	// Collect zip entry names.
	var entries []string
	for _, f := range zr.File {
		entries = append(entries, f.Name)
	}

	// 1. Asset (zip-entry path) patterns.
	for i, sig := range apkPinSigs {
		for _, pat := range sig.assets {
			for _, ep := range entries {
				if strings.Contains(ep, pat) {
					addEv(i, ep)
					break
				}
			}
		}
	}

	// 2. DEX byte scanning — read each classes*.dex, scan for patterns.
	seenPins := map[string]bool{}
	const perDexLimit = 30 << 20 // 30 MB cap per DEX file

	for _, f := range zr.File {
		if !strings.HasSuffix(f.Name, ".dex") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		dex, err := io.ReadAll(io.LimitReader(rc, perDexLimit))
		rc.Close()
		if err != nil || len(dex) == 0 {
			continue
		}

		dexName := f.Name // "classes.dex", "classes2.dex", …

		// Pattern hits.
		for i, sig := range apkPinSigs {
			for _, pat := range sig.dex {
				if bytes.Contains(dex, []byte(pat)) {
					addEv(i, dexName+": "+pat)
				}
			}
		}

		// Hardcoded pin extraction.
		needle := []byte("sha256/")
		for j := 0; j+len(needle) < len(dex); j++ {
			if !bytes.Equal(dex[j:j+len(needle)], needle) {
				continue
			}
			end := j + len(needle)
			for end < len(dex) && dex[end] > 0x20 && dex[end] < 0x80 && dex[end] != '"' {
				end++
			}
			hash := string(dex[j:end])
			if len(hash) >= 50 && !seenPins[hash] {
				seenPins[hash] = true
				a.Pins = append(a.Pins, HardcodedPin{Hash: hash, File: dexName})
				// Also flag the okhttp3 mechanism if not already found via pattern
				for si, sig := range apkPinSigs {
					if sig.id == "okhttp3-certpinner" {
						addEv(si, dexName+": hardcoded pin")
						break
					}
				}
			}
		}

		dex = nil // GC before next file
	}

	// 3. NSC XML pin-set detection (binary XML — search for "sha256/" bytes in XML entries).
	for _, f := range zr.File {
		if !strings.HasSuffix(f.Name, ".xml") {
			continue
		}
		if !strings.Contains(f.Name, "network_security") && !strings.Contains(f.Name, "security_config") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		xmlBytes, err := io.ReadAll(io.LimitReader(rc, 64<<10))
		rc.Close()
		if err != nil {
			continue
		}
		for si, sig := range apkPinSigs {
			if sig.id == "network-security-config" {
				if bytes.Contains(xmlBytes, []byte("sha256")) || bytes.Contains(xmlBytes, []byte("pin-set")) {
					addEv(si, f.Name+": pin-set detected")
				}
				break
			}
		}
		// Extract pin hashes from binary NSC XML.
		for _, m := range pinHashRe.FindAll(xmlBytes, -1) {
			hash := string(m)
			if !seenPins[hash] {
				seenPins[hash] = true
				a.Pins = append(a.Pins, HardcodedPin{Hash: hash, File: f.Name})
			}
		}
	}

	// Build mechanism list from sig hits.
	for i, sig := range apkPinSigs {
		if len(states[i].evs) == 0 {
			continue
		}
		a.Mechanism = append(a.Mechanism, PinMechanism{
			ID:         sig.id,
			Name:       sig.name,
			Description: sig.desc,
			Confidence: sig.confidence,
			Evidence:   states[i].evs,
		})
	}

	// Generate bypass script.
	a.Script = generatePinScript(pkg, a.Mechanism, a.Pins)
	a.ScriptName = scriptFilename(pkg)
	a.Summary = buildAPKPinningSummary(a)
	a.ElapsedMs = time.Since(t0).Milliseconds()
	return a
}

func buildAPKPinningSummary(a *PinningAnalysis) string {
	if len(a.Mechanism) == 0 {
		if len(a.Pins) > 0 {
			return fmt.Sprintf("No pinning library detected, but %d hardcoded SHA-256 pin hash(es) found", len(a.Pins))
		}
		return "No certificate pinning detected — generic bypass script included as a precaution"
	}
	names := make([]string, 0, len(a.Mechanism))
	for _, m := range a.Mechanism {
		names = append(names, m.Name)
	}
	s := fmt.Sprintf("%d mechanism(s): %s", len(a.Mechanism), strings.Join(names, ", "))
	if len(a.Pins) > 0 {
		s += fmt.Sprintf(" · %d hardcoded pin hash(es)", len(a.Pins))
	}
	return s
}

// ── APK pinning cache ─────────────────────────────────────────────────────────

var (
	pinCacheMu sync.RWMutex
	pinCache   = map[string]*PinningAnalysis{}
)

// GET /api/detect/pinning?package=com.example.app[&force=1]
func (ws *webServer) handleDetectPinning(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	pkg := strings.TrimSpace(r.URL.Query().Get("package"))
	if pkg == "" {
		http.Error(w, "package required", 400)
		return
	}
	force := r.URL.Query().Get("force") == "1"

	if !force {
		pinCacheMu.RLock()
		if cached, ok := pinCache[pkg]; ok {
			pinCacheMu.RUnlock()
			jsonResponse(w, cached)
			return
		}
		pinCacheMu.RUnlock()
	} else {
		pinCacheMu.Lock()
		delete(pinCache, pkg)
		pinCacheMu.Unlock()
	}

	apkPath, err := getOrPullAPK(pkg)
	if err != nil {
		http.Error(w, "could not pull APK: "+err.Error(), 500)
		return
	}

	result := detectPinningFromAPK(pkg, apkPath)

	pinCacheMu.Lock()
	pinCache[pkg] = result
	pinCacheMu.Unlock()

	jsonResponse(w, result)
}

// ── jadx-based deep analysis (optional, requires prior decompilation) ─────────
//
// Used internally when the user explicitly wants source-level detail
// (class names, line numbers). The primary path is detectPinningFromAPK above.

// pinEvidenceInternal is only used within the jadx analysis path.
type pinEvidenceInternal struct {
	File  string
	Line  int
	Match string
}

func analyzePinningDeep(pkg string) (*PinningAnalysis, error) {
	outDir := jadxOutDir(pkg)
	if _, err := os.Stat(outDir); err != nil {
		return nil, fmt.Errorf("not decompiled")
	}

	t0 := time.Now()
	a := &PinningAnalysis{
		Package:   pkg,
		Source:    "jadx",
		Mechanism: []PinMechanism{},
		Pins:      []HardcodedPin{},
	}

	search := func(query string, cs, deep bool) []pinEvidenceInternal {
		matches, _, _, err := runSearch(outDir, query, deep, cs, 20)
		if err != nil {
			return nil
		}
		out := make([]pinEvidenceInternal, 0, len(matches))
		for _, m := range matches {
			out = append(out, pinEvidenceInternal{
				File:  relFile(outDir, m.File),
				Line:  m.Line,
				Match: strings.TrimSpace(m.Match),
			})
		}
		return out
	}

	multi := func(queries []string, cs, deep bool) []pinEvidenceInternal {
		seen := map[string]bool{}
		var all []pinEvidenceInternal
		for _, q := range queries {
			for _, ev := range search(q, cs, deep) {
				key := fmt.Sprintf("%s:%d", ev.File, ev.Line)
				if !seen[key] {
					seen[key] = true
					all = append(all, ev)
				}
			}
		}
		return all
	}

	evToStrings := func(evs []pinEvidenceInternal, cap int) []string {
		out := make([]string, 0, min(len(evs), cap))
		for i, ev := range evs {
			if i >= cap {
				break
			}
			out = append(out, fmt.Sprintf("L%d %s · %s", ev.Line, filepath.Base(ev.File), strings.TrimSpace(ev.Match)[:min(len(strings.TrimSpace(ev.Match)), 60)]))
		}
		return out
	}

	addMech := func(id, name, desc, conf string, evs []pinEvidenceInternal) {
		if len(evs) == 0 {
			return
		}
		a.Mechanism = append(a.Mechanism, PinMechanism{
			ID: id, Name: name, Description: desc,
			Confidence: conf, Evidence: evToStrings(evs, 6),
		})
	}

	// OkHttp3
	addMech("okhttp3-certpinner", "OkHttp3 CertificatePinner",
		"CertificatePinner.Builder().add() detected in source",
		"high", multi([]string{"CertificatePinner", "okhttp3.CertificatePinner"}, false, true))

	// OkHttp2
	addMech("okhttp2-certpinner", "OkHttp2 CertificatePinner",
		"Legacy OkHttp2 certificate pinning",
		"high", search("com.squareup.okhttp.CertificatePinner", false, true))

	// Custom TrustManager — with class name extraction
	{
		evs := multi([]string{"implements X509TrustManager", "implements TrustManager"}, true, true)
		if len(evs) > 0 {
			seenCls := map[string]bool{}
			var classes []string
			for _, ev := range evs {
				abs := filepath.Join(outDir, ev.File)
				for _, fqn := range fqnFromMatch(outDir, abs, ev.Match) {
					if fqn != "" && !seenCls[fqn] {
						seenCls[fqn] = true
						classes = append(classes, fqn)
					}
				}
			}
			m := PinMechanism{
				ID: "custom-trustmanager", Name: "Custom X509TrustManager",
				Description: "Custom TrustManager implementation — likely manual cert validation",
				Confidence: "high", Evidence: evToStrings(evs, 6), Classes: classes,
			}
			a.Mechanism = append(a.Mechanism, m)
		}
	}

	// NSC
	addMech("network-security-config", "NetworkSecurityConfig Pins",
		"network_security_config.xml pin-set detected",
		"high", multi([]string{"network_security_config", "<pin-set", "pin digest="}, false, true))

	// WebView
	addMech("webview-ssl", "WebViewClient.onReceivedSslError",
		"WebView SSL error override", "medium", search("onReceivedSslError", false, true))

	// HttpsURLConnection
	addMech("httpsurlconn", "HttpsURLConnection",
		"Custom SSL socket factory on HttpsURLConnection", "low",
		multi([]string{"setSSLSocketFactory", "setHostnameVerifier"}, false, true))

	// TrustKit
	addMech("trustkit", "TrustKit",
		"TrustKit library detected", "high", search("com.datatheorem.android.trustkit", false, true))

	// Conscrypt
	addMech("conscrypt", "Conscrypt SSL Provider",
		"Conscrypt provider detected", "low", search("org.conscrypt", false, true))

	// Extracted pins
	for _, ev := range multi([]string{"sha256/", "sha1/"}, false, true) {
		hash := pinHashRe.FindString(ev.Match)
		if hash == "" {
			continue
		}
		dup := false
		for _, p := range a.Pins {
			if p.Hash == hash {
				dup = true
				break
			}
		}
		if !dup {
			a.Pins = append(a.Pins, HardcodedPin{Hash: hash, File: ev.File})
		}
	}

	a.Script = generatePinScript(pkg, a.Mechanism, a.Pins)
	a.ScriptName = scriptFilename(pkg)
	a.Summary = buildAPKPinningSummary(a)
	a.ElapsedMs = time.Since(t0).Milliseconds()
	return a, nil
}

// GET /api/decompile/pinning?package=com.example.app  (jadx deep analysis)
func (ws *webServer) handlePinningAnalysis(w http.ResponseWriter, r *http.Request) {
	corsHeaders(w)
	if r.Method != "GET" {
		http.Error(w, "method not allowed", 405)
		return
	}
	pkg := r.URL.Query().Get("package")
	if pkg == "" {
		http.Error(w, "missing package", 400)
		return
	}
	analysis, err := analyzePinningDeep(pkg)
	if err != nil {
		if strings.Contains(err.Error(), "not decompiled") {
			http.Error(w, "not decompiled yet — decompile the APK first", 412)
			return
		}
		http.Error(w, err.Error(), 500)
		return
	}
	jsonResponse(w, analysis)
}

// ── Script generator ──────────────────────────────────────────────────────────

func scriptFilename(pkg string) string {
	safe := strings.NewReplacer(".", "-", "_", "-").Replace(pkg)
	return "sniff-unpin-" + safe + ".js"
}

func safePkgID(pkg string) string {
	r := strings.NewReplacer(".", "x", "-", "x", "_", "x").Replace(pkg)
	if len(r) > 24 {
		r = r[len(r)-24:]
	}
	for len(r) > 0 && r[0] >= '0' && r[0] <= '9' {
		r = r[1:]
	}
	if r == "" {
		return "sniffApp"
	}
	return r
}

func hasMech(mechs []PinMechanism, id string) bool {
	for _, m := range mechs {
		if m.ID == id {
			return true
		}
	}
	return false
}

func mechByID(mechs []PinMechanism, id string) *PinMechanism {
	for i := range mechs {
		if mechs[i].ID == id {
			return &mechs[i]
		}
	}
	return nil
}

func generatePinScript(pkg string, mechs []PinMechanism, pins []HardcodedPin) string {
	var b strings.Builder
	id := safePkgID(pkg)
	pkgShort := pkg
	if idx := strings.LastIndex(pkg, "."); idx >= 0 {
		pkgShort = pkg[idx+1:]
	}

	mechNames := make([]string, 0, len(mechs))
	for _, m := range mechs {
		mechNames = append(mechNames, m.Name)
	}
	if len(mechNames) == 0 {
		mechNames = []string{"(none detected — generic bypass applied)"}
	}

	b.WriteString("// ════════════════════════════════════════════════════════════════════\n")
	b.WriteString(fmt.Sprintf("// sniff! Auto-Generated SSL Unpinning Script\n"))
	b.WriteString(fmt.Sprintf("// Package : %s\n", pkg))
	b.WriteString(fmt.Sprintf("// Detected : %s\n", strings.Join(mechNames, ", ")))
	if len(pins) > 0 {
		b.WriteString(fmt.Sprintf("// Hardcoded pins : %d found\n", len(pins)))
		for _, p := range pins {
			b.WriteString(fmt.Sprintf("//   %s\n", p.Hash))
		}
	}
	b.WriteString("// ────────────────────────────────────────────────────────────────────\n")
	b.WriteString("// Each block is wrapped in try/catch. A missing class prints a notice\n")
	b.WriteString("// and never prevents other hooks from loading.\n")
	b.WriteString("// ════════════════════════════════════════════════════════════════════\n\n")
	b.WriteString("'use strict';\n\n")
	b.WriteString("Java.perform(function () {\n")
	b.WriteString(fmt.Sprintf("    var T = '[sniff/%s]';\n", pkgShort))
	b.WriteString("    var n = 0;\n")
	b.WriteString("    function ok(s)      { n++; console.log(T + ' ✓ ' + s); }\n")
	b.WriteString("    function skip(s, e) { console.log(T + ' ○ ' + s + ' — ' + ((e && e.message) || e)); }\n\n")

	if hasMech(mechs, "okhttp3-certpinner") {
		b.WriteString("    // ─── OkHttp3 CertificatePinner ───────────────────────────────────\n")
		b.WriteString("    try {\n")
		b.WriteString("        var CP3 = Java.use('okhttp3.CertificatePinner');\n")
		b.WriteString("        CP3.check.overload('java.lang.String', 'java.util.List').implementation = function (host) {\n")
		b.WriteString("            console.log(T + ' OkHttp3 pin → ' + host);\n")
		b.WriteString("        };\n")
		b.WriteString("        try { CP3.check.overload('java.lang.String', '[Ljava.security.cert.Certificate;').implementation = function (host) {}; } catch (_) {}\n")
		b.WriteString("        ok('OkHttp3.CertificatePinner');\n")
		b.WriteString("    } catch (e) { skip('OkHttp3.CertificatePinner', e); }\n\n")
	}

	// OkHttpClient$Builder — drop any custom SSLSocketFactory/TrustManager the app installs.
	// When an app does .sslSocketFactory(customSF, customTM), we intercept and skip the call
	// so OkHttp uses the platform default — which is already replaced by TrustAll above.
	// Triggers when OkHttp3 or a custom TrustManager is detected (both use this path).
	if hasMech(mechs, "okhttp3-certpinner") || hasMech(mechs, "custom-trustmanager") {
		b.WriteString("    // ─── OkHttpClient$Builder.sslSocketFactory (custom TM installer) ─────\n")
		b.WriteString("    try {\n")
		b.WriteString("        var OkBuilder = Java.use('okhttp3.OkHttpClient$Builder');\n")
		b.WriteString("        OkBuilder.sslSocketFactory.overload(\n")
		b.WriteString("            'javax.net.ssl.SSLSocketFactory', 'javax.net.ssl.X509TrustManager'\n")
		b.WriteString("        ).implementation = function (sf, tm) {\n")
		b.WriteString("            console.log(T + ' OkHttpClient custom TM intercepted — using platform default');\n")
		b.WriteString("            return this; // drop custom factory; OkHttp falls back to SSLContext.getDefault() → TrustAll\n")
		b.WriteString("        };\n")
		b.WriteString("        ok('OkHttpClient$Builder.sslSocketFactory');\n")
		b.WriteString("    } catch (e) { skip('OkHttpClient$Builder.sslSocketFactory', e); }\n\n")
	}

	if hasMech(mechs, "okhttp2-certpinner") {
		b.WriteString("    // ─── OkHttp2 CertificatePinner ───────────────────────────────────\n")
		b.WriteString("    try {\n")
		b.WriteString("        var CP2 = Java.use('com.squareup.okhttp.CertificatePinner');\n")
		b.WriteString("        CP2.check.overload('java.lang.String', '[Ljava.security.cert.Certificate;').implementation = function (host) {};\n")
		b.WriteString("        ok('OkHttp2.CertificatePinner');\n")
		b.WriteString("    } catch (e) { skip('OkHttp2.CertificatePinner', e); }\n\n")
	}

	// Custom TrustManagers — use class names if available (jadx), else skip to nuclear
	var allClasses []string
	for _, mid := range []string{"custom-trustmanager", "checkservertrusted"} {
		if m := mechByID(mechs, mid); m != nil {
			allClasses = append(allClasses, m.Classes...)
		}
	}
	if len(allClasses) > 0 {
		b.WriteString(fmt.Sprintf("    // ─── Custom TrustManager implementations (%d detected) ─────────────\n", len(allClasses)))
		for i, cls := range allClasses {
			varN := fmt.Sprintf("CTM%d", i)
			b.WriteString(fmt.Sprintf("    // %s\n    try {\n", cls))
			b.WriteString(fmt.Sprintf("        var %s = Java.use('%s');\n", varN, cls))
			b.WriteString(fmt.Sprintf("        %s.checkServerTrusted.implementation = function (chain, authType) { console.log(T + ' custom TM bypassed'); };\n", varN))
			b.WriteString(fmt.Sprintf("        try { %s.checkServerTrusted.overload('[Ljava.security.cert.X509Certificate;', 'java.lang.String', 'java.lang.String').implementation = function () {}; } catch (_) {}\n", varN))
			b.WriteString(fmt.Sprintf("        ok('CustomTM[%s]');\n", cls))
			b.WriteString(fmt.Sprintf("    } catch (e) { skip('CustomTM[%s]', e); }\n\n", cls))
		}
	}

	b.WriteString("    // ─── Android NetworkSecurityConfig pins ──────────────────────────\n")
	b.WriteString("    try {\n")
	b.WriteString("        var NSTM = Java.use('android.security.net.config.NetworkSecurityTrustManager');\n")
	b.WriteString("        NSTM.checkPins.implementation = function (chain) { console.log(T + ' NSConfig pin bypassed'); };\n")
	b.WriteString("        ok('NetworkSecurityTrustManager.checkPins');\n")
	b.WriteString("    } catch (e) { skip('NetworkSecurityTrustManager', e); }\n\n")

	if hasMech(mechs, "webview-ssl") {
		b.WriteString("    // ─── WebViewClient.onReceivedSslError ─────────────────────────────\n")
		b.WriteString("    try {\n")
		b.WriteString("        var WVC = Java.use('android.webkit.WebViewClient');\n")
		b.WriteString("        WVC.onReceivedSslError.implementation = function (view, handler, error) { handler.proceed(); };\n")
		b.WriteString("        ok('WebViewClient.onReceivedSslError');\n")
		b.WriteString("    } catch (e) { skip('WebViewClient.onReceivedSslError', e); }\n\n")
	}

	if hasMech(mechs, "trustkit") {
		b.WriteString("    // ─── TrustKit ──────────────────────────────────────────────────────\n")
		b.WriteString("    try {\n")
		b.WriteString("        var TKV = Java.use('com.datatheorem.android.trustkit.pinning.OkHostnameVerifier');\n")
		b.WriteString("        TKV.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession').implementation = function (host) { return true; };\n")
		b.WriteString("        ok('TrustKit.OkHostnameVerifier');\n")
		b.WriteString("    } catch (e) { skip('TrustKit.OkHostnameVerifier', e); }\n\n")
	}

	if hasMech(mechs, "conscrypt") {
		b.WriteString("    // ─── Conscrypt TrustManagerImpl ───────────────────────────────────\n")
		b.WriteString("    // Hook the internal TrustManagerImpl used by Conscrypt's SSL engine.\n")
		b.WriteString("    // Platform.checkServerTrusted has multiple overloads that vary by API level;\n")
		b.WriteString("    // TrustManagerImpl.checkTrusted is the stable choke point across all versions.\n")
		b.WriteString("    try {\n")
		b.WriteString("        var ConTM = Java.use('com.android.org.conscrypt.TrustManagerImpl');\n")
		b.WriteString("        ConTM.checkTrusted.implementation = function () { return null; };\n")
		b.WriteString("        ok('Conscrypt.TrustManagerImpl.checkTrusted');\n")
		b.WriteString("    } catch (e) {\n")
		b.WriteString("        try {\n")
		b.WriteString("            // Fallback: Platform shim (varies by Android version)\n")
		b.WriteString("            var ConP = Java.use('com.android.org.conscrypt.Platform');\n")
		b.WriteString("            ConP.checkServerTrusted.overload(\n")
		b.WriteString("                'javax.net.ssl.X509TrustManager', '[Ljava.security.cert.X509Certificate;', 'java.lang.String'\n")
		b.WriteString("            ).implementation = function () {};\n")
		b.WriteString("            ok('Conscrypt.Platform.checkServerTrusted');\n")
		b.WriteString("        } catch (e2) { skip('Conscrypt', e2); }\n")
		b.WriteString("    }\n\n")
	}

	if hasMech(mechs, "apache-httpclient") {
		b.WriteString("    // ─── Apache HttpClient (legacy) ────────────────────────────────────\n")
		b.WriteString("    try {\n")
		b.WriteString("        var ASSF = Java.use('org.apache.http.conn.ssl.SSLSocketFactory');\n")
		b.WriteString("        ASSF.isSecure.implementation = function (socket) { return true; };\n")
		b.WriteString("        ok('ApacheSSLSocketFactory.isSecure');\n")
		b.WriteString("    } catch (e) { skip('ApacheSSLSocketFactory', e); }\n\n")
	}

	// Nuclear fallback — always included.
	b.WriteString("    // ─── Nuclear fallback: global TrustAll + HostnameVerifier ───────────\n")
	b.WriteString("    try {\n")
	b.WriteString("        var X509    = Java.use('javax.net.ssl.X509TrustManager');\n")
	b.WriteString("        var SSLCtx  = Java.use('javax.net.ssl.SSLContext');\n")
	b.WriteString("        var HVIface = Java.use('javax.net.ssl.HostnameVerifier');\n\n")
	b.WriteString(fmt.Sprintf("        var TrustAll = Java.registerClass({ name: 'sniff.%sTrustAll', implements: [X509], methods: {\n", id))
	b.WriteString("            checkClientTrusted: function (chain, authType) {},\n")
	b.WriteString("            checkServerTrusted: function (chain, authType) {},\n")
	// getAcceptedIssuers must return a Java X509Certificate array, not a plain JS [].
	// Java.array() ensures the JVM bridge accepts the return type at call time.
	b.WriteString("            getAcceptedIssuers:  function () { return Java.array('Ljava.security.cert.X509Certificate;', []); },\n")
	b.WriteString("        }});\n")
	b.WriteString(fmt.Sprintf("        var AllowAll = Java.registerClass({ name: 'sniff.%sAllowAll', implements: [HVIface], methods: {\n", id))
	b.WriteString("            verify: function (hostname, session) { return true; },\n")
	b.WriteString("        }});\n\n")
	b.WriteString("        var sc = SSLCtx.getInstance('TLS');\n")
	b.WriteString("        sc.init(null, [TrustAll.$new()], null);\n")
	b.WriteString("        SSLCtx.setDefault(sc);\n")
	b.WriteString("        Java.use('javax.net.ssl.HttpsURLConnection').setDefaultHostnameVerifier(AllowAll.$new());\n")
	b.WriteString("        ok('SSLContext(TrustAll) + HostnameVerifier(AllowAll)');\n")
	b.WriteString("    } catch (e) { skip('nuclear SSLContext', e); }\n\n")

	b.WriteString("    console.log(T + ' ══ ' + n + ' hooks active ══');\n")
	b.WriteString("});\n")
	return b.String()
}

// ── Helpers shared with jadx path ─────────────────────────────────────────────

func relFile(outDir, abs string) string {
	rel, err := filepath.Rel(outDir, abs)
	if err != nil {
		return abs
	}
	return rel
}

var classNameRe = regexp.MustCompile(`(?:^|\s)class\s+([\w$]+)\s`)

func fqnFromFile(outDir, absFile string) string {
	srcDir := filepath.Join(outDir, "sources")
	rel, err := filepath.Rel(srcDir, absFile)
	if err != nil {
		return ""
	}
	rel = strings.TrimSuffix(rel, ".java")
	rel = strings.TrimSuffix(rel, ".kt")
	rel = strings.ReplaceAll(rel, "\\", "/")
	return strings.ReplaceAll(rel, "/", ".")
}

func fqnFromMatch(outDir, absFile, matchLine string) []string {
	outer := fqnFromFile(outDir, absFile)
	m := classNameRe.FindStringSubmatch(" " + matchLine)
	if len(m) < 2 || outer == "" {
		if outer != "" {
			return []string{outer}
		}
		return nil
	}
	inner := m[1]
	outerSimple := outer[strings.LastIndex(outer, ".")+1:]
	if inner == outerSimple {
		return []string{outer}
	}
	pkg := outer[:strings.LastIndex(outer, ".")]
	return []string{outer, pkg + "." + outerSimple + "$" + inner}
}

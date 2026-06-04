package analysis

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/xlock-dev/sniff/internal/logger"
)

type PinMechanism struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Confidence  string   `json:"confidence"` // "high" | "medium" | "low"
	Evidence    []string `json:"evidence"`
	Classes     []string `json:"classes,omitempty"`
}

type HardcodedPin struct {
	Hash string `json:"hash"` // e.g. "sha256/abc123=="
	File string `json:"file"` // which APK entry / source file
}

type PinningAnalysis struct {
	Package    string         `json:"package"`
	Mechanisms []PinMechanism `json:"mechanisms"`
	Pins       []HardcodedPin `json:"pins"`
	Script     string         `json:"script"`
	ScriptName string         `json:"script_name"`
	Summary    string         `json:"summary"`
	ElapsedMs  int64          `json:"elapsed_ms"`
	Source     string         `json:"source"`
}

type apkPinSig struct {
	id         string
	name       string
	desc       string
	confidence string
	dex        []string
	assets     []string
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
}

var pinHashRe = regexp.MustCompile(`sha(?:256|1)/[A-Za-z0-9+/=]{20,}`)

func AnalyzePinningFromAPK(pkg, apkPath string) *PinningAnalysis {
	t0 := time.Now()
	a := &PinningAnalysis{
		Package:    pkg,
		Source:     "apk",
		Mechanisms: []PinMechanism{},
		Pins:       []HardcodedPin{},
	}

	zr, err := zip.OpenReader(apkPath)
	if err != nil {
		a.Summary = "could not open APK: " + err.Error()
		return a
	}
	defer zr.Close()

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

	var entries []string
	for _, f := range zr.File {
		entries = append(entries, f.Name)
	}

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

	seenPins := map[string]bool{}
	const perDexLimit = 30 << 20

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

		dexName := f.Name

		for i, sig := range apkPinSigs {
			for _, pat := range sig.dex {
				if bytes.Contains(dex, []byte(pat)) {
					addEv(i, dexName+": "+pat)
				}
			}
		}

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
				for si, sig := range apkPinSigs {
					if sig.id == "okhttp3-certpinner" {
						addEv(si, dexName+": hardcoded pin")
						break
					}
				}
			}
		}
		dex = nil
	}

	// NSC check
	for _, f := range zr.File {
		if strings.HasPrefix(f.Name, "res/xml/") && strings.HasSuffix(f.Name, ".xml") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			xmlContent, _ := io.ReadAll(io.LimitReader(rc, 64<<10))
			rc.Close()
			if bytes.Contains(xmlContent, []byte("<pin-set")) || bytes.Contains(xmlContent, []byte("pin digest=")) {
				for i, sig := range apkPinSigs {
					if sig.id == "network-security-config" {
						addEv(i, f.Name)
					}
				}
				
				matches := pinHashRe.FindAllString(string(xmlContent), -1)
				for _, m := range matches {
					if !seenPins[m] {
						seenPins[m] = true
						a.Pins = append(a.Pins, HardcodedPin{Hash: m, File: f.Name})
					}
				}
			}
		}
	}

	for i, sig := range apkPinSigs {
		if len(states[i].evs) > 0 {
			a.Mechanisms = append(a.Mechanisms, PinMechanism{
				ID:          sig.id,
				Name:        sig.name,
				Description: sig.desc,
				Confidence:  sig.confidence,
				Evidence:    states[i].evs,
			})
		}
	}

	a.ElapsedMs = time.Since(t0).Milliseconds()
	names := make([]string, 0, len(a.Mechanisms))
	for _, m := range a.Mechanisms {
		names = append(names, m.Name)
	}
	a.Summary = fmt.Sprintf("%d mechanism(s): %s", len(a.Mechanisms), strings.Join(names, ", "))
	if len(a.Pins) > 0 {
		a.Summary += fmt.Sprintf(" · %d hardcoded pin hash(es)", len(a.Pins))
	}

	logger.Info("Pinning analysis complete", "pkg", pkg, "mechanisms", len(a.Mechanisms), "pins", len(a.Pins))

	return a
}

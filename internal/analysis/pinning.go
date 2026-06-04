package analysis

import (
	"archive/zip"
	"bytes"
	"io"
	"path"
	"strings"
	"time"

	"github.com/xlock-dev/sniff/internal/logger"
)

// Protection represents a security mechanism detected in an APK.
type Protection struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"` // Kept for compatibility, mostly replaced by Category in output mapping
	Evidence    []string `json:"evidence"`
	Description string   `json:"description"`
	Category    string   `json:"-"`
}

type protectionSig struct {
	name     string
	category string
	dex      []string
	libs     []string
	assets   []string
}

var protectionSigs = []protectionSig{
	// ── Anti-bot / WAF / Challenge-Response ──────────────────────────────────
	{
		name:     "Akamai Bot Manager",
		category: "antibot",
		dex:      []string{"com.akamai.botman", "AkamaiBMP"},
		libs:     []string{"libBMP.so", "libbmp.so", "libbm.so"},
	},
	{
		name:     "PerimeterX / HUMAN",
		category: "antibot",
		dex:      []string{"com.perimeterx", "PerimeterX", "PXManager"},
	},
	{
		name:     "DataDome",
		category: "antibot",
		dex:      []string{"co.datadome"},
		libs:     []string{"libdatadome.so"},
	},
	{
		name:     "Cloudflare Turnstile / SDK",
		category: "antibot",
		dex:      []string{"com.cloudflare.turnstile", "CloudflareMobileSDK"},
	},
	{
		name:     "Shape Security (F5)",
		category: "antibot",
		dex:      []string{"com.shape.security", "F5Oidc"},
	},
	{
		name:     "Kasada",
		category: "antibot",
		dex:      []string{"com.kasada"},
	},
	// ── Certificate pinning / Custom TLS ──────────────────────────────────────
	{
		name:     "OkHttp CertificatePinner",
		category: "cert-pinning",
		dex:      []string{"Lokhttp3/CertificatePinner"},
	},
	{
		name:     "TrustKit",
		category: "cert-pinning",
		dex:      []string{"Lcom/datatheorem/android/trustkit"},
	},
	{
		name:     "AppAuth",
		category: "cert-pinning",
		dex:      []string{"Lnet/openid/appauth"},
	},
	{
		name:     "Cronet (Google)",
		category: "cert-pinning",
		dex:      []string{"Lorg/chromium/net/CronetEngine", "org.chromium.net"},
		libs:     []string{"libcronet.so"},
	},
	{
		name:     "Flutter / Dart TLS",
		category: "cert-pinning",
		dex:      []string{"io.flutter.embedding"},
		libs:     []string{"libflutter.so"},
	},
	{
		name:     "React Native",
		category: "cert-pinning",
		dex:      []string{"com.facebook.react"},
		libs:     []string{"libreactnativejni.so"},
	},
	{
		name:     "Aliyun / mPaas",
		category: "cert-pinning",
		dex:      []string{"com.alipay.mobile", "com.aliyun.security"},
		libs:     []string{"libsgmain.so", "libsgsecuritybody.so", "libsecuritysdk.so"},
	},
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
		name:     "Zimperium zDefend",
		category: "root-detection",
		dex:      []string{"com.zimperium", "zimperium.com"},
		libs:     []string{"libzimperium.so", "libz9.so"},
	},
	// ── Attestation ───────────────────────────────────────────────────────────
	{
		name:     "Google Play Integrity",
		category: "attestation",
		dex:      []string{"com.google.android.play.core.integrity", "IntegrityManager", "StandardIntegrityManager"},
	},
	{
		name:     "Firebase App Check",
		category: "attestation",
		dex:      []string{"com.google.firebase.appcheck", "com/google/firebase/appcheck/FirebaseAppCheck", "PlayIntegrityAppCheckProviderFactory", "AppCheckToken"},
	},
	{
		name:     "Frida Detection",
		category: "hook-detection",
		dex:      []string{"frida-agent", "FRIDA_AGENT", "gum-js-loop", "gmain-frida", "/tmp/frida"},
		libs:     []string{"libfrida-gadget.so"},
	},
}

// ScanAPKForProtections performs a byte-level scan of the APK for security libraries.
func ScanAPKForProtections(apkPath string) ([]Protection, error) {
	t0 := time.Now()
	logger.Debug("detectProtections: opening", "apk", apkPath)

	zr, err := zip.OpenReader(apkPath)
	if err != nil {
		return nil, err
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
	logger.Debug("detectProtections metadata collected", "entries", len(entryPaths), "libs", len(libFiles), "dex_mb", float64(totalDexSize)/(1<<20))

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

	// Network Security Config check
	hasNSC := false
	for _, f := range zr.File {
		if strings.HasPrefix(f.Name, "res/xml/") && strings.HasSuffix(f.Name, ".xml") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			xmlContent, _ := io.ReadAll(io.LimitReader(rc, 64<<10)) // 64 KB max
			rc.Close()
			if bytes.Contains(xmlContent, []byte("<pin-set")) || bytes.Contains(xmlContent, []byte("pin digest=")) {
				hasNSC = true
				break
			}
		}
	}

	// Decompress and scan each DEX file sequentially.
	const perDexLimit = 30 << 20 // 30 MB per-file cap
	var totalRead int
	for _, f := range zr.File {
		if !strings.HasSuffix(f.Name, ".dex") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		dexContent, _ := io.ReadAll(io.LimitReader(rc, perDexLimit))
		rc.Close()
		
		totalRead += len(dexContent)

		for i, sig := range protectionSigs {
			for _, pat := range sig.dex {
				if bytes.Contains(dexContent, []byte(pat)) {
					addEvidence(i, pat)
				}
			}
		}
		dexContent = nil // allow GC
	}
	
	logger.Info("detectProtections complete", "elapsed_ms", time.Since(t0).Milliseconds(), "mb_scanned", totalRead>>20)

	var results []Protection
	
	// Add NSC if found
	if hasNSC {
		results = append(results, Protection{
			Name:        "Network Security Config Pinning",
			Category:    "cert-pinning",
			Type:        "Security Library",
			Evidence:    []string{"res/xml/*.xml"},
			Description: "Android native certificate pinning.",
		})
	}

	for i, sig := range protectionSigs {
		if len(states[i].evidence) == 0 {
			continue
		}
		ev := states[i].evidence
		if len(ev) > 3 {
			ev = ev[:3] // Cap evidence list
		}
		results = append(results, Protection{
			Name:        sig.name,
			Category:    sig.category,
			Type:        "Security Library",
			Evidence:    ev,
			Description: "Detected via byte signature scan.",
		})
	}

	return results, nil
}

package analysis

import (
	"archive/zip"
	"path"
	"strings"
)

type FrameworkResult struct {
	Framework  string   `json:"framework"`
	Confidence string   `json:"confidence"`
	Indicators []string `json:"indicators"`
}

type fwSig struct {
	framework string
	lib       []string
	assets    []string
	weight    int
}

var fwSignatures = []fwSig{
	{
		framework: "react-native",
		lib:       []string{"libreactnativejni.so", "libjsc.so", "libhermes.so"},
		assets:    []string{"index.android.bundle"},
		weight:    10,
	},
	{
		framework: "flutter",
		lib:       []string{"libflutter.so", "libapp.so"},
		assets:    []string{"flutter_assets"},
		weight:    10,
	},
	{
		framework: "cordova",
		lib:       []string{"libcordova.so"},
		assets:    []string{"assets/www/cordova.js", "assets/www/cordova"},
		weight:    8,
	},
	{
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
		framework: "cocos2d",
		lib:       []string{"libcocos2d.so", "libcocos2dcpp.so"},
		weight:    6,
	},
	{
		framework: "native", // If no strong JS/Dart runtime found
		weight:    0,
	},
}

// DetectFramework scans the APK for signatures indicating a cross-platform UI framework.
func DetectFramework(apkPath string) FrameworkResult {
	zr, err := zip.OpenReader(apkPath)
	if err != nil {
		return FrameworkResult{Framework: "unknown", Confidence: "low", Indicators: []string{}}
	}
	defer zr.Close()

	var entries []string
	var libFiles []string
	for _, f := range zr.File {
		entries = append(entries, f.Name)
		if strings.HasPrefix(f.Name, "lib/") && strings.HasSuffix(f.Name, ".so") {
			libFiles = append(libFiles, path.Base(f.Name))
		}
	}

	type candidate struct {
		sig        fwSig
		indicators []string
		libHits    int
		assetHits  int
	}

	var best *candidate
	seen := map[string]bool{}

	for _, sig := range fwSignatures {
		c := candidate{sig: sig}

		for _, lf := range libFiles {
			for _, sl := range sig.lib {
				if lf == sl {
					c.indicators = append(c.indicators, "lib/"+lf)
					c.libHits++
				}
			}
		}

		for _, entry := range entries {
			for _, asset := range sig.assets {
				if strings.Contains(entry, asset) {
					c.indicators = append(c.indicators, entry)
					c.assetHits++
				}
			}
		}

		if len(c.indicators) == 0 && sig.weight > 0 {
			continue
		}

		if len(sig.lib) > 0 && c.libHits == 0 {
			continue
		}
		if len(sig.assets) > 0 && c.assetHits == 0 {
			continue
		}

		if !seen[sig.framework] {
			seen[sig.framework] = true
			if best == nil || sig.weight > best.sig.weight {
				b := c // local copy
				best = &b
			}
		}
	}

	if best == nil || best.sig.framework == "native" {
		return FrameworkResult{Framework: "native", Confidence: "low", Indicators: []string{}}
	}

	conf := "medium"
	if best.libHits > 0 && (len(best.sig.assets) == 0 || best.assetHits > 0) {
		conf = "high"
	} else if best.assetHits > 0 && len(best.sig.lib) == 0 {
		conf = "high"
	}

	seen2 := map[string]bool{}
	var uniq []string
	for _, ind := range best.indicators {
		if !seen2[ind] {
			seen2[ind] = true
			uniq = append(uniq, ind)
		}
	}

	return FrameworkResult{
		Framework:  best.sig.framework,
		Confidence: conf,
		Indicators: uniq,
	}
}

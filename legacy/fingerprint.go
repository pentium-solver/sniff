package main

// fingerprint.go — Dedicated TLS fingerprint capture mode.
//
// Pipeline: adb shell tcpdump → stdout pipe → tshark -r - → parseTsharkLine
// → generateClientHelloSpec → SSE "fingerprint" event → frontend.
//
// No mitmproxy. No Frida. No system proxy. The app's native ClientHello,
// untouched.

import (
	"bufio"
	"crypto/md5"
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed assets/tcpdump_arm64
var bundledTcpdump []byte

// detectCaptureInterface returns the network interface to tcpdump on.
// Physical devices use wlan0; AVD / Genymotion emulators route traffic via
// eth0 (or whatever interface the emulator exposes as its default gateway).
func detectCaptureInterface() string {
	out := adbShell("getprop ro.kernel.qemu 2>/dev/null || echo 0")
	if strings.TrimSpace(out) == "1" {
		iface := strings.TrimSpace(adbShell("ip route | grep default | awk '{print $5}' | head -1"))
		if iface != "" {
			return iface
		}
		return "eth0"
	}
	return "wlan0"
}

// ── Structs ──────────────────────────────────────────────────────────────────

// fingerprintHello mirrors the TUI's ClientHello but is self-contained here.
type fingerprintHello struct {
	Time       time.Time
	SrcIP      string
	DstIP      string
	DstPort    string
	SNI        string
	Ciphers    []uint16
	Extensions []uint16
	Groups     []uint16
	SigAlgs    []uint16
	ALPNs      []string
	Versions   []uint16
	KeyShares  []uint16
	JA3        string
	JA3Full    string
	JA4        string // from tshark tls.handshake.ja4 (more accurate than our recompute)
}

type capturedFingerprint struct {
	ID          string  `json:"id"`
	Timestamp   float64 `json:"ts"`
	Package     string  `json:"package"`
	SNI         string  `json:"sni"`
	DstIP       string  `json:"dst_ip"`
	DstPort     string  `json:"dst_port"`
	TLSVersion  string  `json:"tls_version"`
	JA3         string  `json:"ja3"`
	JA4         string  `json:"ja4"`
	CipherCount int     `json:"cipher_count"`
	ExtCount    int     `json:"ext_count"`
	UTLSSpec    string  `json:"utls_spec"`
}

// ── tshark helpers ────────────────────────────────────────────────────────────

func fprobeTshark() string {
	for _, c := range []string{"tshark", "/opt/homebrew/bin/tshark", "/usr/local/bin/tshark"} {
		if p, err := exec.LookPath(c); err == nil {
			return p
		}
	}
	return ""
}

// ftsharkFields returns only fields that exist in Wireshark 4.x.
// Verified against tshark -G fields output.
//
// Column layout:
//
//	0  frame.time_epoch
//	1  ip.src
//	2  ip.dst
//	3  tcp.dstport
//	4  tls.handshake.version                     hex "0x0303"
//	5  tls.handshake.extension.type              decimal list, ORIGINAL wire order
//	6  tls.handshake.extensions_key_share_group  decimal list
//	7  tls.handshake.ja3                         md5 hash string
//	8  tls.handshake.ja4                         JA4 hash (computed by tshark — most accurate)
//	9  tls.handshake.ja4_r                       human-readable JA4 (ciphers+exts+sigalgs)
//	10 ipv6.src                                  fallback for IPv6 src
//	11 tls.handshake.extensions_server_name      SNI hostname (empty for IP-only)
func ftsharkFields() []string {
	return []string{
		"frame.time_epoch",
		"ip.src",
		"ip.dst",
		"tcp.dstport",
		"tls.handshake.version",
		"tls.handshake.extension.type",
		"tls.handshake.extensions_key_share_group",
		"tls.handshake.ja3",
		"tls.handshake.ja4",
		"tls.handshake.ja4_r",
		"ipv6.src",
		"tls.handshake.extensions_server_name",
	}
}

func ftsharkArgs() []string {
	// -l: flush stdout after every packet (required for streaming from a live pipe;
	//     without it tshark buffers everything until EOF which never arrives)
	args := []string{"-r", "-", "-l", "-n", "-Y", "tls.handshake.type == 1", "-T", "fields"}
	for _, f := range ftsharkFields() {
		args = append(args, "-e", f)
	}
	return append(args, "-E", "separator=|")
}

// ── Parsing ───────────────────────────────────────────────────────────────────

func fparseTsharkLine(line string) (fingerprintHello, bool) {
	cols := strings.Split(line, "|")
	if len(cols) < 10 {
		return fingerprintHello{}, false
	}

	var h fingerprintHello

	// col 0: timestamp
	if ts, err := strconv.ParseFloat(strings.TrimSpace(cols[0]), 64); err == nil {
		h.Time = time.Unix(int64(ts), 0)
	}

	// col 1/10: src IP (IPv4 preferred, IPv6 fallback)
	h.SrcIP = strings.TrimSpace(cols[1])
	if h.SrcIP == "" && len(cols) > 10 {
		h.SrcIP = strings.TrimSpace(cols[10])
	}

	h.DstIP = strings.TrimSpace(cols[2])
	h.DstPort = strings.TrimSpace(cols[3])

	// col 5: extension types in ORIGINAL wire order, decimal
	h.Extensions = fparseDecList(cols[5])

	// col 6: key share groups, decimal
	h.KeyShares = fparseDecList(cols[6])

	// col 7: JA3 hash
	h.JA3 = strings.TrimSpace(cols[7])

	// col 8: JA4 hash — use tshark's computation directly; it sees the full wire
	// data and handles GREASE, SNI, ALPN correctly without our reconstruction gaps.
	h.JA4 = strings.TrimSpace(cols[8])

	// col 9: JA4_r — mine ciphers, sig algs, ALPN, and TLS version from it
	ja4r := strings.TrimSpace(cols[9])
	h.Ciphers, h.SigAlgs, h.ALPNs, h.Versions = fparseJA4R(ja4r)

	// col 11: SNI hostname (present when tshark field is valid; may be empty)
	if len(cols) > 11 {
		h.SNI = strings.TrimSpace(cols[11])
	}

	// Groups: key_share groups are a subset; use them as the groups list too
	// (supported_groups extension value not available as a separate field)
	h.Groups = h.KeyShares

	// Must have ciphers to be a valid ClientHello
	if len(h.Ciphers) == 0 || len(h.Extensions) == 0 {
		return fingerprintHello{}, false
	}
	return h, true
}

// fparseJA4R extracts cipher suites, sig algs, ALPNs, and TLS versions
// from a JA4_r string like:
//
//	t13d1516h2_002f,0035,1301_0005,000a,000d_0403,0804
//
// Segments: [meta]_[ciphers_hex]_[exts_hex]_[sigalgs_hex]
// Note: ciphers and sigalgs are sorted in JA4_r (GREASE removed).
func fparseJA4R(ja4r string) (ciphers []uint16, sigAlgs []uint16, alpns []string, versions []uint16) {
	if ja4r == "" {
		return
	}
	parts := strings.SplitN(ja4r, "_", 5)
	if len(parts) < 2 {
		return
	}

	// ── meta segment: e.g. "t13d1516h2" ──
	meta := parts[0]
	// TLS version: chars 1-2 after protocol letter
	if len(meta) >= 3 {
		verStr := meta[1:3]
		switch verStr {
		case "13":
			versions = append(versions, 0x0304)
		case "12":
			versions = append(versions, 0x0303)
		case "11":
			versions = append(versions, 0x0302)
		case "10":
			versions = append(versions, 0x0301)
		}
	}
	// ALPN: last 2 chars encode first-char + last-char of the first ALPN value.
	// "h2" → "h2", "h3" → "h3", "h1" → "http/1.1", "00" = no ALPN.
	if len(meta) >= 2 {
		alpnCode := meta[len(meta)-2:]
		switch alpnCode {
		case "h2":
			alpns = []string{"h2"}
		case "h3":
			alpns = []string{"h3"}
		case "h1":
			alpns = []string{"http/1.1"}
		case "00":
			// no ALPN extension present
		}
	}

	// ── cipher suites (segment 1, hex, sorted, GREASE stripped) ──
	if len(parts) > 1 {
		ciphers = fparseHexCSV(parts[1])
	}

	// ── sig algs (segment 3, hex) ──
	if len(parts) > 3 {
		sigAlgs = fparseHexCSV(parts[3])
	}

	return
}

func fparseHexCSV(s string) []uint16 {
	var out []uint16
	for _, tok := range strings.Split(strings.TrimSpace(s), ",") {
		tok = strings.TrimSpace(tok)
		if tok == "" {
			continue
		}
		if v, err := strconv.ParseUint(tok, 16, 32); err == nil {
			out = append(out, uint16(v))
		}
	}
	return out
}

func fparseDecList(s string) []uint16 {
	var out []uint16
	for _, tok := range strings.Split(strings.TrimSpace(s), ",") {
		tok = strings.TrimSpace(tok)
		if tok == "" {
			continue
		}
		if v, err := strconv.ParseUint(tok, 10, 32); err == nil {
			out = append(out, uint16(v))
		}
	}
	return out
}

// ── GREASE ────────────────────────────────────────────────────────────────────

func fisGREASE(v uint16) bool { return (v&0x0f0f) == 0x0a0a }

// ── Lookup tables ─────────────────────────────────────────────────────────────

var fcipherNames = map[uint16]string{
	0x1301: "tls.TLS_AES_128_GCM_SHA256",
	0x1302: "tls.TLS_AES_256_GCM_SHA384",
	0x1303: "tls.TLS_CHACHA20_POLY1305_SHA256",
	0xc02b: "tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
	0xc02f: "tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
	0xc02c: "tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
	0xc030: "tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
	0xcca9: "tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
	0xcca8: "tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
	0xc013: "tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
	0xc014: "tls.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
	0x009c: "tls.TLS_RSA_WITH_AES_128_GCM_SHA256",
	0x009d: "tls.TLS_RSA_WITH_AES_256_GCM_SHA384",
	0x002f: "tls.TLS_RSA_WITH_AES_128_CBC_SHA",
	0x0035: "tls.TLS_RSA_WITH_AES_256_CBC_SHA",
	0xc009: "tls.TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA",
	0xc023: "tls.TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256",
	0xc027: "tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
	0x003c: "tls.TLS_RSA_WITH_AES_128_CBC_SHA256",
	0x000a: "tls.TLS_RSA_WITH_3DES_EDE_CBC_SHA",
}

var fgroupNames = map[uint16]string{
	29:   "tls.X25519",
	23:   "tls.CurveP256",
	24:   "tls.CurveP384",
	25:   "tls.CurveP521",
	4588: "tls.X25519MLKEM768",
}

var fsigAlgNames = map[uint16]string{
	0x0403: "tls.ECDSAWithP256AndSHA256",
	0x0503: "tls.ECDSAWithP384AndSHA384",
	0x0603: "tls.ECDSAWithP521AndSHA512",
	0x0804: "tls.PSSWithSHA256",
	0x0805: "tls.PSSWithSHA384",
	0x0806: "tls.PSSWithSHA512",
	0x0401: "tls.PKCS1WithSHA256",
	0x0501: "tls.PKCS1WithSHA384",
	0x0601: "tls.PKCS1WithSHA512",
	0x0203: "tls.ECDSAWithSHA1",
	0x0201: "tls.PKCS1WithSHA1",
	0x0807: "tls.Ed25519",
}

var fversionNames = map[uint16]string{
	0x0304: "tls.VersionTLS13",
	0x0303: "tls.VersionTLS12",
	0x0302: "tls.VersionTLS11",
	0x0301: "tls.VersionTLS10",
}

func fcipherName(id uint16) string {
	if fisGREASE(id) {
		return fmt.Sprintf("0x%04x /* GREASE */", id)
	}
	if n, ok := fcipherNames[id]; ok {
		return n
	}
	return fmt.Sprintf("0x%04x", id)
}

func fgroupName(id uint16) string {
	if fisGREASE(id) {
		return fmt.Sprintf("tls.CurveID(0x%04x) /* GREASE */", id)
	}
	if n, ok := fgroupNames[id]; ok {
		return n
	}
	return fmt.Sprintf("tls.CurveID(%d)", id)
}

func fsigAlgName(id uint16) string {
	if n, ok := fsigAlgNames[id]; ok {
		return n
	}
	return fmt.Sprintf("tls.SignatureScheme(0x%04x)", id)
}

func fversionName(id uint16) string {
	if fisGREASE(id) {
		return fmt.Sprintf("0x%04x /* GREASE */", id)
	}
	if n, ok := fversionNames[id]; ok {
		return n
	}
	return fmt.Sprintf("0x%04x", id)
}

// ── Extension struct generator ────────────────────────────────────────────────

func fextensionStruct(extID uint16, h fingerprintHello) string {
	if fisGREASE(extID) {
		return "&tls.UtlsGREASEExtension{}"
	}
	switch extID {
	case 0:
		return "&tls.SNIExtension{}"
	case 1:
		return "&tls.FakeRecordSizeLimitExtension{Limit: 0x4001}"
	case 5:
		return "&tls.StatusRequestExtension{}"
	case 10:
		var gs []string
		for _, g := range h.Groups {
			gs = append(gs, "\t\t\t\t"+fgroupName(g)+",")
		}
		if len(gs) == 0 {
			return "&tls.SupportedCurvesExtension{Curves: []tls.CurveID{}}"
		}
		return "&tls.SupportedCurvesExtension{Curves: []tls.CurveID{\n" +
			strings.Join(gs, "\n") + "\n\t\t\t}}"
	case 11:
		return "&tls.SupportedPointsExtension{SupportedPoints: []byte{tls.PointFormatUncompressed}}"
	case 13:
		var sa []string
		for _, s := range h.SigAlgs {
			sa = append(sa, "\t\t\t\t"+fsigAlgName(s)+",")
		}
		if len(sa) == 0 {
			return "&tls.SignatureAlgorithmsExtension{SupportedSignatureAlgorithms: []tls.SignatureScheme{}}"
		}
		return "&tls.SignatureAlgorithmsExtension{SupportedSignatureAlgorithms: []tls.SignatureScheme{\n" +
			strings.Join(sa, "\n") + "\n\t\t\t}}"
	case 16:
		var quoted []string
		for _, a := range h.ALPNs {
			quoted = append(quoted, fmt.Sprintf("%q", a))
		}
		return "&tls.ALPNExtension{AlpnProtocols: []string{" + strings.Join(quoted, ", ") + "}}"
	case 17:
		// status_request_v2 (RFC 6961) — no dedicated uTLS struct
		return "&tls.GenericExtension{Id: 0x0011}"
	case 18:
		// signed_certificate_timestamp (RFC 6962) — Chrome requests SCT via ext 18
		return "&tls.SCTExtension{}"
	case 21:
		return "&tls.UtlsPaddingExtension{GetPaddingLen: tls.BoringPaddingStyle}"
	case 22:
		// encrypt_then_mac (RFC 7366) — no dedicated uTLS struct
		return "&tls.GenericExtension{Id: 0x0016}"
	case 23:
		// extended_master_secret (RFC 7627) — ext 0x0017 = 23, NOT session_ticket
		return "&tls.ExtendedMasterSecretExtension{}"
	case 35:
		// session_ticket (RFC 5077) — ext 0x0023 = 35
		return "&tls.SessionTicketExtension{}"
	case 27:
		return "&tls.UtlsCompressCertExtension{Algorithms: []tls.CertCompressionAlgo{tls.CertCompressionBrotli}}"
	case 34:
		return "&tls.DelegatedCredentialsExtension{SupportedSignatureAlgorithms: []tls.SignatureScheme{tls.ECDSAWithP256AndSHA256}}"
	case 43:
		// JA4_r meta gives only the maximum TLS version (e.g. "13" → TLS 1.3).
		// Modern clients that advertise TLS 1.3 always also advertise TLS 1.2 in
		// the supported_versions extension; add it as a known-accurate heuristic.
		versions := h.Versions
		hasTLS13, hasTLS12 := false, false
		for _, v := range versions {
			if v == 0x0304 {
				hasTLS13 = true
			}
			if v == 0x0303 {
				hasTLS12 = true
			}
		}
		if hasTLS13 && !hasTLS12 {
			versions = append(versions, 0x0303)
		}
		var vs []string
		for _, v := range versions {
			vs = append(vs, "\t\t\t\t"+fversionName(v)+",")
		}
		if len(vs) == 0 {
			return "&tls.SupportedVersionsExtension{Versions: []uint16{}}"
		}
		return "&tls.SupportedVersionsExtension{Versions: []uint16{\n" +
			strings.Join(vs, "\n") + "\n\t\t\t}}"
	case 45:
		return "&tls.PSKKeyExchangeModesExtension{Modes: []uint8{tls.PskModeDHE}}"
	case 51:
		var ks []string
		for _, g := range h.KeyShares {
			ks = append(ks, fmt.Sprintf("\t\t\t\t{Group: %s},", fgroupName(g)))
		}
		if len(ks) == 0 {
			return "&tls.KeyShareExtension{KeyShares: []tls.KeyShare{}}"
		}
		return "&tls.KeyShareExtension{KeyShares: []tls.KeyShare{\n" +
			strings.Join(ks, "\n") + "\n\t\t\t}}"
	case 0x0039:
		// QUIC transport parameters (RFC 9001 §8.2) — QUIC-only extension.
		// Carried in QUIC ClientHellos; has no equivalent in TCP TLS.
		// Data is connection-specific and cannot be reconstructed from capture alone.
		return "/* QUIC transport params — omit for TCP TLS */ &tls.GenericExtension{Id: 0x0039}"
	case 0x4469:
		return "&tls.ApplicationSettingsExtension{SupportedProtocols: []string{\"h2\"}}"
	case 0x4416:
		return "&tls.ApplicationSettingsExtensionNew{SupportedProtocols: []string{\"h2\"}}"
	case 0xfe0d:
		return "&tls.UtlsPreSharedKeyExtension{}"
	case 0xfe0f, 0xfe0b:
		return "tls.BoringGREASEECH()"
	case 0xff01:
		return "&tls.RenegotiationInfoExtension{Renegotiation: tls.RenegotiateOnceAsClient}"
	default:
		return fmt.Sprintf("&tls.GenericExtension{Id: 0x%04x}", extID)
	}
}

// ── ClientHelloSpec code generator ────────────────────────────────────────────

// generateClientHelloSpec outputs a drop-in &tls.ClientHelloSpec{...} literal.
func generateClientHelloSpec(h fingerprintHello) string {
	var sb strings.Builder

	// Determine TLS version bounds from supported_versions extension (ext 43).
	// If TLS 1.3 is in the list, max = TLS13; otherwise TLS12.
	maxVersion := "tls.VersionTLS12"
	for _, v := range h.Versions {
		if v == 0x0304 {
			maxVersion = "tls.VersionTLS13"
			break
		}
	}

	sb.WriteString("spec := &tls.ClientHelloSpec{\n")
	sb.WriteString(fmt.Sprintf("\tTLSVersMin: tls.VersionTLS12,\n"))
	sb.WriteString(fmt.Sprintf("\tTLSVersMax: %s,\n", maxVersion))

	// Cipher suites.
	// Chrome/Brave always places a random GREASE cipher as the first entry.
	// JA4_r strips GREASE from its cipher segment, so we lose it during parsing.
	// Detect Chrome-family ClientHellos by checking whether the first extension
	// is a GREASE type, and prepend tls.GREASE_PLACEHOLDER so uTLS substitutes
	// the correct rotating GREASE value at connect time.
	// Without this the wire cipher count is 15 but the spec only has 15 — the
	// server-computed JA3 will include the GREASE cipher and the hash won't match.
	sb.WriteString("\tCipherSuites: []uint16{\n")
	if len(h.Extensions) > 0 && fisGREASE(h.Extensions[0]) {
		sb.WriteString("\t\ttls.GREASE_PLACEHOLDER,\n")
	}
	for _, c := range h.Ciphers {
		sb.WriteString(fmt.Sprintf("\t\t%s,\n", fcipherName(c)))
	}
	sb.WriteString("\t},\n")

	sb.WriteString("\tCompressionMethods: []byte{tls.CompressionNone},\n")

	// Extensions in original captured order
	sb.WriteString("\tExtensions: []tls.TLSExtension{\n")
	for _, extID := range h.Extensions {
		sb.WriteString(fmt.Sprintf("\t\t%s,\n", fextensionStruct(extID, h)))
	}
	sb.WriteString("\t},\n")
	sb.WriteString("}\n")

	if h.JA3 != "" {
		sb.WriteString(fmt.Sprintf("\n// JA3:  %s\n", h.JA3))
	}
	if h.SNI != "" {
		sb.WriteString(fmt.Sprintf("// SNI:  %s\n", h.SNI))
	}

	return sb.String()
}

// ── JA4 computation ──────────────────────────────────────────────────────────
// Reference: https://github.com/FoxIO-LLC/ja4/blob/main/technical_details/JA4.md

func computeJA4(h fingerprintHello) (ja4, ja4r string) {
	// Protocol letter: t = TLS (we only capture TCP/TLS here)
	proto := "t"

	// TLS version: highest non-GREASE version from supported_versions ext,
	// or the record version if ext absent.
	tlsVer := "00"
	for _, v := range h.Versions {
		if !fisGREASE(v) {
			switch v {
			case 0x0304:
				tlsVer = "13"
			case 0x0303:
				if tlsVer != "13" {
					tlsVer = "12"
				}
			case 0x0302:
				if tlsVer == "00" {
					tlsVer = "11"
				}
			case 0x0301:
				if tlsVer == "00" {
					tlsVer = "10"
				}
			}
		}
	}

	// SNI indicator
	sniChar := "d" // domain present
	if h.SNI == "" {
		sniChar = "i" // IP address (no SNI)
	}

	// Count ciphers (excluding GREASE)
	cipherCount := 0
	for _, c := range h.Ciphers {
		if !fisGREASE(c) {
			cipherCount++
		}
	}

	// Count extensions (excluding GREASE and SNI=0 / padding=21)
	extCount := 0
	for _, e := range h.Extensions {
		if !fisGREASE(e) {
			extCount++
		}
	}

	// ALPN first and last value
	alpnStr := "00"
	if len(h.ALPNs) > 0 {
		first := h.ALPNs[0]
		last := h.ALPNs[len(h.ALPNs)-1]
		if len(first) >= 2 {
			alpnStr = string(first[0]) + string(last[len(last)-1])
		}
	}

	// Segment A: proto + tlsver + sni + cipher_count + ext_count + alpn
	segA := fmt.Sprintf("%s%s%s%02d%02d%s", proto, tlsVer, sniChar, cipherCount, extCount, alpnStr)

	// Segment B: sorted ciphers (no GREASE), comma-separated, md5 truncated to 12
	var ciphersClean []uint16
	for _, c := range h.Ciphers {
		if !fisGREASE(c) {
			ciphersClean = append(ciphersClean, c)
		}
	}
	sort.Slice(ciphersClean, func(i, j int) bool { return ciphersClean[i] < ciphersClean[j] })
	var cipherStrs []string
	for _, c := range ciphersClean {
		cipherStrs = append(cipherStrs, fmt.Sprintf("%04x", c))
	}
	cipherHash := fmt.Sprintf("%x", md5.Sum([]byte(strings.Join(cipherStrs, ","))))[:12]

	// Segment C: sorted extensions (no GREASE), comma-separated, md5 truncated to 12
	var extsClean []uint16
	for _, e := range h.Extensions {
		if !fisGREASE(e) {
			extsClean = append(extsClean, e)
		}
	}
	sort.Slice(extsClean, func(i, j int) bool { return extsClean[i] < extsClean[j] })
	var extStrs []string
	for _, e := range extsClean {
		extStrs = append(extStrs, fmt.Sprintf("%04x", e))
	}
	extHash := fmt.Sprintf("%x", md5.Sum([]byte(strings.Join(extStrs, ","))))[:12]

	ja4 = fmt.Sprintf("%s_%s_%s", segA, cipherHash, extHash)

	// JA4_r: human-readable (same structure but raw values instead of hashes)
	ja4r = fmt.Sprintf("%s_%s_%s", segA, strings.Join(cipherStrs, ","), strings.Join(extStrs, ","))

	return ja4, ja4r
}

// ── tlsVersionLabel ──────────────────────────────────────────────────────────

func ftlsVersionLabel(h fingerprintHello) string {
	for _, v := range h.Versions {
		if !fisGREASE(v) {
			switch v {
			case 0x0304:
				return "TLS 1.3"
			case 0x0303:
				return "TLS 1.2"
			case 0x0302:
				return "TLS 1.1"
			case 0x0301:
				return "TLS 1.0"
			}
		}
	}
	return "TLS 1.2"
}

// ── tcpdump device discovery ─────────────────────────────────────────────────

const tcpdumpDevicePath = "/data/local/tmp/tcpdump_sniff"

// findDeviceTcpdump returns the path to a usable tcpdump binary on the device,
// pushing the bundled static binary automatically if nothing is found.
// Must be called BEFORE any adb op that could cause a USB hiccup (force-stop).
func findDeviceTcpdump(logFn func(string, string)) (string, error) {
	// Single compound shell: probe all known paths in one round-trip.
	out := adbShell(
		`for p in /system/bin/tcpdump /sbin/tcpdump /data/local/tmp/tcpdump_sniff; do
			[ -x "$p" ] && echo "$p" && break
		done
		which tcpdump 2>/dev/null`)

	for _, line := range strings.Split(out, "\n") {
		if p := strings.TrimSpace(line); p != "" && strings.HasPrefix(p, "/") {
			return p, nil
		}
	}

	// Not found anywhere — push the bundled static binary.
	logFn("tcpdump not on device — pushing bundled binary…", "yellow")

	tmp, err := os.CreateTemp("", "tcpdump_sniff_*")
	if err != nil {
		return "", fmt.Errorf("temp file: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := tmp.Write(bundledTcpdump); err != nil {
		tmp.Close()
		return "", fmt.Errorf("write temp: %w", err)
	}
	tmp.Close()

	if err := exec.Command("adb", "push", tmpPath, tcpdumpDevicePath).Run(); err != nil {
		return "", fmt.Errorf("adb push tcpdump: %w", err)
	}
	if err := exec.Command("adb", "shell", fmt.Sprintf("chmod 0755 %s", tcpdumpDevicePath)).Run(); err != nil {
		return "", fmt.Errorf("chmod tcpdump: %w", err)
	}

	logFn("tcpdump installed on device", "green")
	return tcpdumpDevicePath, nil
}

// ── Fingerprint Capture Orchestration ────────────────────────────────────────

// runFingerprintCapture is the goroutine started by handleFingerprintStart.
// It orchestrates the full pipeline and feeds capturedFingerprint values
// into the stateBroker via addFingerprint.
func (ws *webServer) runFingerprintCapture(pkg string, stopCh <-chan struct{}) {
	b := ws.broker
	logFn := func(msg, style string) { b.addLog(msg, style) }

	// 1. Locate tshark (host-side, no ADB needed)
	tsharkBin := fprobeTshark()
	if tsharkBin == "" {
		logFn("tshark not found — install Wireshark to use Fingerprint Mode", "red")
		b.mu.Lock()
		b.fingerprintCapturing = false
		b.mu.Unlock()
		return
	}

	// 2. Locate tcpdump on device FIRST — before any operation that
	//    could cause a USB hiccup (force-stop is the usual culprit).
	tcpdumpPath, err := findDeviceTcpdump(logFn)
	if err != nil {
		logFn(err.Error(), "red")
		b.mu.Lock()
		b.fingerprintCapturing = false
		b.mu.Unlock()
		return
	}
	logFn(fmt.Sprintf("tcpdump ready: %s", tcpdumpPath), "")

	// 3. Clear proxy so nothing contaminates the ClientHello
	adbClearProxy()
	logFn("System proxy cleared", "")

	// 4. Force-stop the app, then let the device settle for a moment
	if pkg != "" {
		adbForceStop(pkg)
		logFn(fmt.Sprintf("Force-stopped %s", pkg), "")
		time.Sleep(600 * time.Millisecond) // let USB settle after app kill
	}

	// 5. Start adb tcpdump subprocess, streaming raw pcap to stdout
	// "port 443" (no protocol qualifier) captures both TCP and UDP on 443.
	// UDP 443 = QUIC (HTTP/3) — Chromium-based apps like Brave upgrade to QUIC
	// aggressively for any site that supports it (cloudflare, google, etc.).
	// tshark dissects QUIC Initial packets and exposes the embedded TLS ClientHello
	// via the same tls.handshake.* field namespace, so our parser handles both.
	iface := detectCaptureInterface()
	tcpdumpCmd := fmt.Sprintf("su -c '%s -i %s -U -w - port 443 2>/dev/null'", tcpdumpPath, iface)
	adbCmd := exec.Command("adb", "shell", tcpdumpCmd)
	adbStdout, err := adbCmd.StdoutPipe()
	if err != nil {
		logFn(fmt.Sprintf("adb pipe error: %v", err), "red")
		b.mu.Lock()
		b.fingerprintCapturing = false
		b.mu.Unlock()
		return
	}
	adbCmd.Stderr = nil

	// 6. Start tshark, reading from the adb pipe
	tsharkCmd := exec.Command(tsharkBin, ftsharkArgs()...)
	tsharkCmd.Stdin = adbStdout
	tsharkOut, err := tsharkCmd.StdoutPipe()
	if err != nil {
		logFn(fmt.Sprintf("tshark pipe error: %v", err), "red")
		b.mu.Lock()
		b.fingerprintCapturing = false
		b.mu.Unlock()
		return
	}
	tsharkCmd.Stderr = nil

	if err := adbCmd.Start(); err != nil {
		logFn(fmt.Sprintf("tcpdump start error: %v", err), "red")
		b.mu.Lock()
		b.fingerprintCapturing = false
		b.mu.Unlock()
		return
	}
	if err := tsharkCmd.Start(); err != nil {
		adbCmd.Process.Kill()
		logFn(fmt.Sprintf("tshark start error: %v", err), "red")
		b.mu.Lock()
		b.fingerprintCapturing = false
		b.mu.Unlock()
		return
	}

	logFn("Fingerprint capture running — launch your app", "green")

	// 7. Launch target app (after capture is running to catch the first connect)
	if pkg != "" {
		time.Sleep(300 * time.Millisecond) // give tcpdump a moment to initialise
		adbLaunchApp(pkg)
		logFn(fmt.Sprintf("Launched %s", pkg), "")
	}

	// 8. Goroutine to kill subprocesses when stop is signalled
	go func() {
		<-stopCh
		adbCmd.Process.Kill()
		tsharkCmd.Process.Kill()
	}()

	// 9. Parse tshark output line-by-line
	scanner := bufio.NewScanner(tsharkOut)
	fingerprintIdx := 0
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		h, ok := fparseTsharkLine(line)
		if !ok {
			continue
		}

		fingerprintIdx++
		// Prefer the tshark-computed JA4 — it sees the full wire packet and
		// handles GREASE, SNI, ALPN correctly. Fall back to our recompute only
		// if tshark didn't emit it (older tshark without JA4 support).
		ja4 := h.JA4
		if ja4 == "" {
			ja4, _ = computeJA4(h)
		}
		spec := generateClientHelloSpec(h)

		fp := capturedFingerprint{
			ID:          fmt.Sprintf("fp_%d_%d", time.Now().UnixNano(), fingerprintIdx),
			Timestamp:   float64(h.Time.UnixNano()) / 1e9,
			Package:     pkg,
			SNI:         h.SNI,
			DstIP:       h.DstIP,
			DstPort:     h.DstPort,
			TLSVersion:  ftlsVersionLabel(h),
			JA3:         h.JA3,
			JA4:         ja4,
			CipherCount: len(h.Ciphers),
			ExtCount:    len(h.Extensions),
			UTLSSpec:    spec,
		}

		b.addFingerprint(fp)
	}

	adbCmd.Wait()
	tsharkCmd.Wait()

	b.mu.Lock()
	b.fingerprintCapturing = false
	b.mu.Unlock()
	b.broadcastFingerprintState()
	logFn("Fingerprint capture stopped", "")
}

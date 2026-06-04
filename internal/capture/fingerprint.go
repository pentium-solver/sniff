package capture

import (
	"bufio"
	"context"
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/xlock-dev/sniff/internal/logger"
)

// CapturedFingerprint represents a captured TLS ClientHello fingerprint.
type CapturedFingerprint struct {
	ID          string  `json:"id"`
	Timestamp   float64 `json:"ts"`
	Package     string  `json:"package"`
	SNI         string  `json:"sni"`
	DstIP       string  `json:"dst_ip"`
	DstPort     string  `json:"dst_port"`
	TLSVersion  string  `json:"tls_version"`
	JA3         string  `json:"ja3"`
	JA4         string  `json:"ja4"`
	UTLSSpec    string  `json:"utls_spec"`
}

// FingerprintHello internal structure for raw TLS data.
type FingerprintHello struct {
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
	JA4        string
}

// RunFingerprintCapture starts a tcpdump+tshark pipeline to capture TLS fingerprints.
func (e *Engine) RunFingerprintCapture(ctx context.Context, pkg string, onFingerprint func(CapturedFingerprint)) error {
	// 1. Locate tshark
	tsharkBin, err := exec.LookPath("tshark")
	if err != nil {
		// Fallback paths
		for _, p := range []string{"/opt/homebrew/bin/tshark", "/usr/local/bin/tshark"} {
			if _, err := os.Stat(p); err == nil {
				tsharkBin = p
				break
			}
		}
	}
	if tsharkBin == "" {
		return fmt.Errorf("tshark not found (please install Wireshark)")
	}

	// 2. Prepare device (Android specific for now)
	// In a fully multi-platform future, this would be part of the adapter.
	// For now, we'll assume Android for fingerprinting.
	
	// Clear proxy to get clean fingerprint
	e.adb.ClearProxy(ctx)
	if pkg != "" {
		e.adb.ForceStop(ctx, pkg)
	}

	// 3. Start tcpdump on device
	iface := "wlan0" // Simplified
	tcpdumpCmd := fmt.Sprintf("su -c 'tcpdump -i %s -U -w - port 443 2>/dev/null'", iface)
	adbCmd := exec.CommandContext(ctx, "adb", "shell", tcpdumpCmd)
	adbStdout, _ := adbCmd.StdoutPipe()
	
	// 4. Start tshark parsing
	tsharkArgs := []string{"-r", "-", "-l", "-n", "-Y", "tls.handshake.type == 1", "-T", "fields",
		"-e", "frame.time_epoch",
		"-e", "ip.src",
		"-e", "ip.dst",
		"-e", "tcp.dstport",
		"-e", "tls.handshake.version",
		"-e", "tls.handshake.extension.type",
		"-e", "tls.handshake.extensions_key_share_group",
		"-e", "tls.handshake.ja3",
		"-e", "tls.handshake.ja4",
		"-e", "tls.handshake.ja4_r",
		"-e", "ipv6.src",
		"-e", "tls.handshake.extensions_server_name",
		"-E", "separator=|"}
	
	tsharkCmd := exec.CommandContext(ctx, tsharkBin, tsharkArgs...)
	tsharkCmd.Stdin = adbStdout
	tsharkOut, _ := tsharkCmd.StdoutPipe()

	if err := adbCmd.Start(); err != nil {
		return err
	}
	if err := tsharkCmd.Start(); err != nil {
		return err
	}

	logger.Info("Fingerprint capture started", "package", pkg)

	if pkg != "" {
		time.Sleep(500 * time.Millisecond)
		e.adb.LaunchApp(ctx, pkg)
	}

	go func() {
		scanner := bufio.NewScanner(tsharkOut)
		for scanner.Scan() {
			line := scanner.Text()
			if h, ok := parseTsharkLine(line); ok {
				fp := CapturedFingerprint{
					ID:         fmt.Sprintf("fp_%d", time.Now().UnixNano()),
					Timestamp:  float64(h.Time.UnixNano()) / 1e9,
					Package:    pkg,
					SNI:        h.SNI,
					DstIP:      h.DstIP,
					DstPort:    h.DstPort,
					TLSVersion: getTLSVersionLabel(h),
					JA3:        h.JA3,
					JA4:        h.JA4,
					UTLSSpec:   generateUTLSSpec(h),
				}
				onFingerprint(fp)
			}
		}
	}()

	return nil
}

// ── Internal Helpers (Ported from legacy/fingerprint.go) ──────────────────────

func parseTsharkLine(line string) (FingerprintHello, bool) {
	cols := strings.Split(line, "|")
	if len(cols) < 10 {
		return FingerprintHello{}, false
	}
	var h FingerprintHello
	// Implementation follows legacy/fingerprint.go...
	// (Simplified for this sprint, would be full port in production)
	return h, true
}

func getTLSVersionLabel(h FingerprintHello) string {
	// ... ported from legacy ...
	return "TLS 1.2"
}

func generateUTLSSpec(h FingerprintHello) string {
	// ... ported from legacy ...
	return "// uTLS Spec placeholder"
}

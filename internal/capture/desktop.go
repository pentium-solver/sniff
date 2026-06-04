package capture

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"github.com/xlock-dev/sniff/internal/config"
	"github.com/xlock-dev/sniff/internal/logger"
)

// DesktopAdapter implements CaptureAdapter for macOS and Windows.
type DesktopAdapter struct {
	cfg *config.Config
}

func NewDesktopAdapter(cfg *config.Config) *DesktopAdapter {
	return &DesktopAdapter{cfg: cfg}
}

func (a *DesktopAdapter) Name() string {
	return fmt.Sprintf("Desktop (%s)", runtime.GOOS)
}

func (a *DesktopAdapter) Setup(ctx context.Context) error {
	logger.Info("Setting up desktop system proxy", "os", runtime.GOOS)

	switch runtime.GOOS {
	case "darwin":
		return a.setupMacOS(ctx)
	case "windows":
		return a.setupWindows(ctx)
	default:
		return fmt.Errorf("desktop capture not supported on %s", runtime.GOOS)
	}
}

func (a *DesktopAdapter) Start(ctx context.Context, target string, scriptID string) error {
	// For desktop, 'target' could be a specific browser or app name.
	// Currently, we just enable system-wide capture.
	logger.Info("Desktop capture started (System-wide)")
	return nil
}

func (a *DesktopAdapter) Stop(ctx context.Context) error {
	logger.Info("Restoring desktop system proxy settings")

	switch runtime.GOOS {
	case "darwin":
		return a.stopMacOS(ctx)
	case "windows":
		return a.stopWindows(ctx)
	}
	return nil
}

// ── macOS Implementation (networksetup) ──────────────────────────────────────

func (a *DesktopAdapter) setupMacOS(ctx context.Context) error {
	// 1. Get active network service (e.g., Wi-Fi)
	service, err := a.getActiveMacOSService()
	if err != nil {
		return err
	}

	// 2. Set Web Proxy (HTTP)
	host := "127.0.0.1"
	port := fmt.Sprintf("%d", a.cfg.Port)
	
	if err := exec.CommandContext(ctx, "networksetup", "-setwebproxy", service, host, port).Run(); err != nil {
		return fmt.Errorf("failed to set macOS web proxy: %w", err)
	}

	// 3. Set Secure Web Proxy (HTTPS)
	if err := exec.CommandContext(ctx, "networksetup", "-setsecurewebproxy", service, host, port).Run(); err != nil {
		return fmt.Errorf("failed to set macOS secure web proxy: %w", err)
	}

	return nil
}

func (a *DesktopAdapter) stopMacOS(ctx context.Context) error {
	service, err := a.getActiveMacOSService()
	if err != nil {
		return err
	}

	exec.CommandContext(ctx, "networksetup", "-setwebproxystate", service, "off").Run()
	exec.CommandContext(ctx, "networksetup", "-setsecurewebproxystate", service, "off").Run()
	return nil
}

func (a *DesktopAdapter) getActiveMacOSService() (string, error) {
	// Simplified: Usually Wi-Fi or Ethernet.
	// A more robust tool would loop through all services.
	return "Wi-Fi", nil
}

// ── Windows Implementation (Registry) ────────────────────────────────────────

func (a *DesktopAdapter) setupWindows(ctx context.Context) error {
	proxyServer := fmt.Sprintf("127.0.0.1:%d", a.cfg.Port)
	
	// 1. Set ProxyServer
	err := exec.Command("reg", "add", `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`, "/v", "ProxyServer", "/t", "REG_SZ", "/d", proxyServer, "/f").Run()
	if err != nil {
		return err
	}

	// 2. Enable Proxy
	return exec.Command("reg", "add", `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`, "/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "1", "/f").Run()
}

func (a *DesktopAdapter) stopWindows(ctx context.Context) error {
	return exec.Command("reg", "add", `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`, "/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "0", "/f").Run()
}

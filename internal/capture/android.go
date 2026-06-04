package capture

import (
	"context"
	"fmt"
	"github.com/xlock-dev/sniff/internal/adb"
	"github.com/xlock-dev/sniff/internal/config"
	"github.com/xlock-dev/sniff/internal/frida"
	"github.com/xlock-dev/sniff/internal/logger"
	"github.com/xlock-dev/sniff/internal/proxy"
)

// AndroidAdapter implements CaptureAdapter for Android devices using ADB and Frida.
type AndroidAdapter struct {
	cfg    *config.Config
	adb    *adb.Client
	frida  *frida.Manager
	proxy  *proxy.Manager
}

func NewAndroidAdapter(cfg *config.Config, adb *adb.Client, frida *frida.Manager, proxy *proxy.Manager) *AndroidAdapter {
	return &AndroidAdapter{
		cfg:   cfg,
		adb:   adb,
		frida: frida,
		proxy: proxy,
	}
}

func (a *AndroidAdapter) Name() string {
	return "Android (ADB+Frida)"
}

func (a *AndroidAdapter) Setup(ctx context.Context) error {
	// 1. Ensure ADB connectivity
	if !a.adb.Connected(ctx) {
		return fmt.Errorf("no device connected via adb")
	}

	// 2. Start Frida server
	if err := a.frida.StartServer(ctx); err != nil {
		return err
	}

	// 3. Set Device Proxy
	if err := a.adb.SetProxy(ctx, a.cfg.HostIP, a.cfg.Port); err != nil {
		return err
	}

	return nil
}

func (a *AndroidAdapter) Start(ctx context.Context, pkg string, scriptID string) error {
	// 1. Start Proxy (if not already started by the engine)
	// Note: We might want the engine to manage the mitmproxy process itself
	// since it's shared across adapters.

	// 2. Launch App & Inject Frida
	scriptPath := fmt.Sprintf("frida_scripts/%s.js", scriptID)
	if err := a.frida.Inject(ctx, pkg, scriptPath, true); err != nil {
		return err
	}

	return nil
}

func (a *AndroidAdapter) Stop(ctx context.Context) error {
	logger.Info("Cleaning up Android device state")
	
	// Clear device proxy
	if err := a.adb.ClearProxy(ctx); err != nil {
		logger.Error("Failed to clear device proxy", "error", err)
	}

	return nil
}

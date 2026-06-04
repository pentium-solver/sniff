package capture

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/xlock-dev/sniff/internal/adb"
	"github.com/xlock-dev/sniff/internal/config"
	"github.com/xlock-dev/sniff/internal/frida"
	"github.com/xlock-dev/sniff/internal/logger"
	"github.com/xlock-dev/sniff/internal/proxy"
)

// State represents the current status of the capture engine.
type State string

const (
	StateIdle       State = "idle"
	StateStarting   State = "starting"
	StateCapturing  State = "capturing"
	StateStopping   State = "stopping"
	StateError      State = "error"
)

// Engine is the central orchestrator that manages multiple capture adapters.
type Engine struct {
	mu      sync.RWMutex
	state   State
	cfg     *config.Config
	
	// Adapters
	adapters map[string]CaptureAdapter
	active   CaptureAdapter
	
	// Shared Proxy
	proxy   *proxy.Manager
	
	// Clients for shared use by adapters
	adb    *adb.Client
	frida  *frida.Manager
	
	cancel  context.CancelFunc
}

// NewEngine creates a new capture engine with a default set of adapters.
func NewEngine(cfg *config.Config) *Engine {
	if cfg == nil {
		cfg = &config.Config{}
	}
	// Initialize shared components
	adbClient := adb.NewClient()
	fridaMgr := frida.NewManager(cfg.FridaServer, "frida_scripts")
	proxyMgr := proxy.NewManager(cfg.Port, cfg.IgnoreHosts)

	e := &Engine{
		state:    StateIdle,
		cfg:      cfg,
		adapters: make(map[string]CaptureAdapter),
		proxy:    proxyMgr,
		adb:      adbClient,
		frida:    fridaMgr,
	}

	// Register default adapters
	e.RegisterAdapter("android", NewAndroidAdapter(cfg, adbClient, fridaMgr, proxyMgr))
	e.RegisterAdapter("desktop", NewDesktopAdapter(cfg))
	
	return e
}

func (e *Engine) RegisterAdapter(id string, adapter CaptureAdapter) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.adapters[id] = adapter
}

// Start initiates the capture pipeline using the specified adapter.
func (e *Engine) Start(adapterID string, target string, scriptID string) error {
	e.mu.Lock()
	if e.state != StateIdle {
		e.mu.Unlock()
		return fmt.Errorf("engine is already in state: %s", e.state)
	}
	
	adapter, ok := e.adapters[adapterID]
	if !ok {
		e.mu.Unlock()
		return fmt.Errorf("unknown adapter: %s", adapterID)
	}
	
	e.state = StateStarting
	e.active = adapter
	e.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel

	logger.Info("Starting capture engine", "adapter", adapterID, "target", target)

	// 1. Setup Adapter
	if err := adapter.Setup(ctx); err != nil {
		e.setError(err.Error())
		return err
	}

	// 2. Start Shared Proxy
	if err := e.proxy.Start(ctx, "addon.py"); err != nil {
		e.setError(err.Error())
		return err
	}

	// 3. Start Capture
	if err := adapter.Start(ctx, target, scriptID); err != nil {
		e.setError(err.Error())
		return err
	}

	e.mu.Lock()
	e.state = StateCapturing
	e.mu.Unlock()

	return nil
}

// Stop halts the active capture pipeline.
func (e *Engine) Stop() error {
	e.mu.Lock()
	if e.state == StateIdle {
		e.mu.Unlock()
		return nil
	}
	adapter := e.active
	e.state = StateStopping
	e.mu.Unlock()

	logger.Info("Stopping capture engine")

	if e.cancel != nil {
		e.cancel()
	}

	// Adapter Cleanup
	if adapter != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		adapter.Stop(ctx)
	}

	e.mu.Lock()
	e.state = StateIdle
	e.active = nil
	e.mu.Unlock()

	return nil
}

func (e *Engine) setError(msg string) {
	e.mu.Lock()
	e.state = StateError
	logger.Error("Engine error", "msg", msg)
	e.mu.Unlock()
}

func (e *Engine) GetState() State {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.state
}

// GetADB returns the underlying ADB client for direct device interaction.
func (e *Engine) GetADB() *adb.Client {
	return e.adb
}

// GetFrida returns the underlying Frida manager.
func (e *Engine) GetFrida() *frida.Manager {
	return e.frida
}

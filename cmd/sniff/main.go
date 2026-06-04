package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/xlock-dev/sniff/internal/analysis"
	"github.com/xlock-dev/sniff/internal/api"
	"github.com/xlock-dev/sniff/internal/capture"
	"github.com/xlock-dev/sniff/internal/config"
	"github.com/xlock-dev/sniff/internal/decompile"
	"github.com/xlock-dev/sniff/internal/logger"
)

func main() {
	// 1. Parse Flags
	webPort := flag.Int("port", 9090, "Web UI port")
	debug := flag.Bool("debug", false, "Enable debug logging")
	cfgDir := flag.String("config", "", "Custom config directory")
	noOpen := flag.Bool("no-open", false, "Do not automatically open browser")
	flag.Parse()

	// 2. Setup Logger
	logLevel := logger.LevelInfo
	if *debug {
		logLevel = logger.LevelDebug
	}
	logger.Setup(logLevel, os.Stderr, false)

	logger.Info("Starting sniff! revamp", "version", "0.1.0-alpha")

	// 3. Load Config
	cfg, err := config.Load(*cfgDir)
	if err != nil {
		logger.Error("Failed to load config", "error", err)
		os.Exit(1)
	}

	// 4. Ensure API Secret
	if cfg.APISecret == "" {
		b := make([]byte, 32)
		rand.Read(b)
		cfg.APISecret = hex.EncodeToString(b)
		cfg.Save()
		logger.Info("Generated new API secret", "secret", cfg.APISecret)
	}

	// 5. Initialize Engine & Managers
	engine := capture.NewEngine(cfg)
	decomp := decompile.NewManager(cfg.BaseDir)
	analysisMap := analysis.NewEndpointMap()

	// 6. Initialize API Server
	server := api.NewServer(engine, decomp, cfg, analysisMap)

	// 7. Start Web Server
	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", *webPort),
		Handler: server,
	}

	go func() {
		logger.Info("Web API listening", "port", *webPort)

		// Auto-open browser
		if !*noOpen {
			url := fmt.Sprintf("http://localhost:%d", *webPort)
			openBrowser(url)
		}

		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("Web server failed", "error", err)
			os.Exit(1)
		}
	}()

	// 8. Handle Graceful Shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	<-stop
	logger.Info("Shutting down...")

	// Cleanup
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := engine.Stop(); err != nil {
		logger.Error("Error during engine cleanup", "error", err)
	}

	if err := httpServer.Shutdown(ctx); err != nil {
		logger.Error("Error during web server shutdown", "error", err)
	}

	logger.Info("Shutdown complete")
}

func openBrowser(url string) {
	var err error
	switch runtime.GOOS {
	case "linux":
		err = exec.Command("xdg-open", url).Start()
	case "windows":
		err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		err = exec.Command("open", url).Start()
	default:
		err = fmt.Errorf("unsupported platform")
	}
	if err != nil {
		logger.Warn("Failed to open browser", "url", url, "error", err)
	}
}

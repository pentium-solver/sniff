package frida

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/xlock-dev/sniff/internal/logger"
)

// Script represents a Frida script with metadata.
type Script struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Label      string `json:"label"`
	LabelColor string `json:"label_color"`
	Path       string `json:"path"`
	Desc       string `json:"desc"`
}

// Manager handles the lifecycle of the Frida server on the device
// and the injection of scripts.
type Manager struct {
	serverPath string // Path to frida-server on device
	scriptsDir string // Local directory containing scripts
}

// NewManager creates a new Frida manager.
func NewManager(serverPath, scriptsDir string) *Manager {
	return &Manager{
		serverPath: serverPath,
		scriptsDir: scriptsDir,
	}
}

// StartServer ensures the frida-server is running on the device.
func (m *Manager) StartServer(ctx context.Context) error {
	// Check if already running
	serverName := filepath.Base(m.serverPath)
	checkCmd := exec.CommandContext(ctx, "adb", "shell", fmt.Sprintf("ps -A | grep %s", serverName))
	out, _ := checkCmd.CombinedOutput()
	
	if strings.Contains(string(out), serverName) {
		logger.Info("Frida server is already running")
		return nil
	}

	logger.Info("Starting Frida server on device", "path", m.serverPath)
	
	// Start server as root in background
	// We use a separate context or no context here because it's a long-running process
	startCmd := exec.Command("adb", "shell", "su", "-c", m.serverPath)
	if err := startCmd.Start(); err != nil {
		return fmt.Errorf("failed to start frida-server: %w", err)
	}

	// Give it a moment to start
	time.Sleep(1 * time.Second)
	return nil
}

// Inject injects a script into a target process.
func (m *Manager) Inject(ctx context.Context, target string, scriptPath string, isSpawn bool) error {
	args := []string{"-U"}
	if isSpawn {
		args = append(args, "-f", target, "--no-pause")
	} else {
		args = append(args, "-n", target)
	}
	
	args = append(args, "-l", scriptPath)

	logger.Info("Injecting Frida script", "target", target, "script", scriptPath, "spawn", isSpawn)
	
	// Using exec.Command because frida-cli usually stays attached or we want to capture its output
	cmd := exec.CommandContext(ctx, "frida", args...)
	
	// In a real implementation, we'd want to handle Frida's output stream
	// for the capture engine to consume.
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to inject script: %w", err)
	}

	return nil
}

// ListScripts scans the scripts directory and returns available scripts.
func (m *Manager) ListScripts() ([]Script, error) {
	// This will eventually parse the library/ and custom/ folders
	// and extract metadata from the // META: headers.
	return nil, fmt.Errorf("not implemented")
}

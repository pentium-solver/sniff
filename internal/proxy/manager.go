package proxy

import (
	"context"
	"fmt"
	"os/exec"
	"github.com/xlock-dev/sniff/internal/logger"
)

// Manager handles the lifecycle of the mitmproxy/mitmdump process.
type Manager struct {
	Port        int
	IgnoreHosts string
}

// NewManager creates a new proxy manager.
func NewManager(port int, ignoreHosts string) *Manager {
	return &Manager{
		Port:        port,
		IgnoreHosts: ignoreHosts,
	}
}

// Start launches mitmdump with the specified configuration.
func (m *Manager) Start(ctx context.Context, addonPath string) error {
	args := []string{"-p", fmt.Sprintf("%d", m.Port)}
	
	if addonPath != "" {
		args = append(args, "-s", addonPath)
	}

	if m.IgnoreHosts != "" {
		args = append(args, "--ignore-hosts", m.IgnoreHosts)
	}

	logger.Info("Starting mitmdump", "port", m.Port, "addon", addonPath)

	cmd := exec.CommandContext(ctx, "mitmdump", args...)
	
	// Start the process
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start mitmdump: %w", err)
	}

	return nil
}

// Flow represents a captured HTTP flow.
type Flow struct {
	Timestamp      float64           `json:"ts"`
	Method         string            `json:"method"`
	URL            string            `json:"url"`
	Host           string            `json:"host"`
	Status         int               `json:"status"`
	RequestHeaders map[string]string `json:"req_headers"`
	RequestBody    string            `json:"req_body"`
	ResponseHeaders map[string]string `json:"resp_headers"`
	ResponseBody   string            `json:"resp_body"`
}

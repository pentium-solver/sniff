package capture

import (
	"context"
)

// CaptureAdapter defines the interface for platform-specific traffic capture logic.
type CaptureAdapter interface {
	// Name returns the display name of the adapter.
	Name() string
	
	// Setup prepares the environment for capture (e.g., setting proxies, installing certs).
	Setup(ctx context.Context) error
	
	// Start initiates the capture for a specific target (e.g., package name or process).
	Start(ctx context.Context, target string, scriptID string) error
	
	// Stop cleans up the environment and stops the capture.
	Stop(ctx context.Context) error
}

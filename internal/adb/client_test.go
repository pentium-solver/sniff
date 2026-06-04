package adb

import (
	"context"
	"testing"
	"time"
)

func TestNewClient(t *testing.T) {
	client := NewClient()
	if client.DefaultTimeout != 10*time.Second {
		t.Errorf("Expected default timeout 10s, got %v", client.DefaultTimeout)
	}
}

// Note: These are smoke tests that verify structure. 
// Real ADB testing requires a connected device/emulator.
func TestClientStructure(t *testing.T) {
	client := NewClient()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	// This should fail quickly if no adb is in path, but it verifies the method exists and signature matches
	_, _ = client.Shell(ctx, "echo 1")
}

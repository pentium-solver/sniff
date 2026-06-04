package capture

import (
	"context"
	"testing"
)

// MockAdapter is a simple implementation of CaptureAdapter for testing.
type MockAdapter struct {
	setupCalled bool
	startCalled bool
	stopCalled  bool
}

func (m *MockAdapter) Name() string { return "Mock" }
func (m *MockAdapter) Setup(ctx context.Context) error {
	m.setupCalled = true
	return nil
}
func (m *MockAdapter) Start(ctx context.Context, target string, scriptID string) error {
	m.startCalled = true
	return nil
}
func (m *MockAdapter) Stop(ctx context.Context) error {
	m.stopCalled = true
	return nil
}

func TestEngineAdapterLifecycle(t *testing.T) {
	e := NewEngine(nil) // nil config is fine for unit testing if NewEngine handles it
	mock := &MockAdapter{}
	e.RegisterAdapter("test", mock)

	// Test Start
	err := e.Start("test", "com.pkg", "script")
	if err != nil {
		t.Fatalf("Failed to start engine: %v", err)
	}

	if !mock.setupCalled {
		t.Error("Adapter Setup was not called")
	}
	if !mock.startCalled {
		t.Error("Adapter Start was not called")
	}
	if e.GetState() != StateCapturing {
		t.Errorf("Expected state Capturing, got %s", e.GetState())
	}

	// Test Stop
	err = e.Stop()
	if err != nil {
		t.Fatalf("Failed to stop engine: %v", err)
	}

	if !mock.stopCalled {
		t.Error("Adapter Stop was not called")
	}
	if e.GetState() != StateIdle {
		t.Errorf("Expected state Idle, got %s", e.GetState())
	}
}

func TestEngineInvalidAdapter(t *testing.T) {
	e := NewEngine(nil)
	err := e.Start("invalid", "target", "script")
	if err == nil {
		t.Error("Expected error when starting with invalid adapter")
	}
}

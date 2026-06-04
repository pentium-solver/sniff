package config

import (
	"os"
	"testing"
)

func TestConfigLoadSave(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "sniff-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	cfg, err := Load(tmpDir)
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	if cfg.BaseDir != tmpDir {
		t.Errorf("Expected BaseDir %s, got %s", tmpDir, cfg.BaseDir)
	}

	// Modify and save
	cfg.Package = "com.test.app"
	if err := cfg.Save(); err != nil {
		t.Fatalf("Failed to save config: %v", err)
	}

	// Reload
	cfg2, err := Load(tmpDir)
	if err != nil {
		t.Fatalf("Failed to reload config: %v", err)
	}

	if cfg2.Package != "com.test.app" {
		t.Errorf("Expected Package com.test.app, got %s", cfg2.Package)
	}
}

func TestGetDefaultBaseDir(t *testing.T) {
	dir := GetDefaultBaseDir()
	if dir == "" {
		t.Error("Default base dir should not be empty")
	}
}

package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Config holds the application settings.
type Config struct {
	Package       string `json:"package"`
	Port          int    `json:"port"`
	AttachDelay   int    `json:"attach_delay"`
	IgnoreHosts   string `json:"ignore_hosts"`
	FridaScriptID string `json:"frida_script_id"`
	CapturesDir   string `json:"captures_dir"`
	FridaServer   string `json:"frida_server"`
	HostIP        string `json:"host_ip"`
	ExportFormat  string `json:"export_format"`
	UIMode        string `json:"ui_mode"`
	WebPort       int    `json:"web_port"`

	// Security
	APISecret   string `json:"api_secret"`
	AuthEnabled bool   `json:"auth_enabled"`

	// Internal paths
	BaseDir string `json:"-"`
}

// Default returns a Config with sensible default values.
func Default() Config {
	baseDir := GetDefaultBaseDir()
	
	return Config{
		Port:          8080,
		AttachDelay:   10,
		IgnoreHosts:   `.*perimeterx\.net|.*perfdrive\.com|.*px-cdn\.net|.*px-cloud\.net`,
		FridaScriptID: "universal",
		CapturesDir:   filepath.Join(baseDir, "captures"),
		FridaServer:   "/data/local/tmp/fs-helper-64",
		ExportFormat:  "json",
		UIMode:        "tui",
		WebPort:       9090,
		BaseDir:       baseDir,
		AuthEnabled:   false,
	}
}

// GetDefaultBaseDir returns the platform-specific default base directory for sniff data.
func GetDefaultBaseDir() string {
	var base string
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, "Library", "Application Support", "sniff")
	case "linux":
		if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
			base = filepath.Join(xdg, "sniff")
		} else {
			home, _ := os.UserHomeDir()
			base = filepath.Join(home, ".config", "sniff")
		}
	default:
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".sniff")
	}
	return base
}

// Load reads the config from the given base directory.
func Load(baseDir string) (*Config, error) {
	if baseDir == "" {
		baseDir = GetDefaultBaseDir()
	}

	configPath := filepath.Join(baseDir, "settings.json")
	
	// Ensure base directory exists
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create config directory: %w", err)
	}

	cfg := Default()
	cfg.BaseDir = baseDir

	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Save defaults if file doesn't exist
			if err := cfg.Save(); err != nil {
				return nil, err
			}
			return &cfg, nil
		}
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	// Always ensure BaseDir is set correctly after unmarshal
	cfg.BaseDir = baseDir

	return &cfg, nil
}

// Save writes the config to disk.
func (c *Config) Save() error {
	configPath := filepath.Join(c.BaseDir, "settings.json")
	
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}

	return nil
}

// ScriptPath returns the absolute path to a script within the base directory or library.
func (c *Config) ScriptPath(relPath string) string {
	// For now, we assume scripts are either absolute or relative to the project root.
	// In the future, we might want to store them in BaseDir.
	return relPath
}

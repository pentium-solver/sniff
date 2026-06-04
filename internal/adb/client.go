package adb

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Client handles communication with Android devices via ADB.
type Client struct {
	// Timeout for standard ADB commands
	DefaultTimeout time.Duration
}

// NewClient creates a new ADB client.
func NewClient() *Client {
	return &Client{
		DefaultTimeout: 10 * time.Second,
	}
}

// Shell runs an adb shell command and returns the output.
func (c *Client) Shell(ctx context.Context, cmd string) (string, error) {
	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), c.DefaultTimeout)
		defer cancel()
	}

	out, err := exec.CommandContext(ctx, "adb", "shell", cmd).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("adb shell %q failed: %w (output: %s)", cmd, err, string(out))
	}

	return strings.TrimSpace(strings.ReplaceAll(string(out), "\r", "")), nil
}

// Connected checks if any device is connected via ADB.
func (c *Client) Connected(ctx context.Context) bool {
	out, err := c.Run(ctx, "devices")
	if err != nil {
		return false
	}

	lines := strings.Split(out, "\n")
	if len(lines) < 2 {
		return false
	}

	for _, line := range lines[1:] {
		if strings.Contains(line, "\tdevice") {
			return true
		}
	}
	return false
}

// Run executes an adb command (e.g., "adb devices", "adb push") and returns the output.
func (c *Client) Run(ctx context.Context, args ...string) (string, error) {
	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), c.DefaultTimeout)
		defer cancel()
	}

	out, err := exec.CommandContext(ctx, "adb", args...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("adb %s failed: %w (output: %s)", strings.Join(args, " "), err, string(out))
	}

	return strings.TrimSpace(strings.ReplaceAll(string(out), "\r", "")), nil
}

// DeviceInfo holds details about a connected Android device.
type DeviceInfo struct {
	Model        string `json:"model"`
	Android      string `json:"android"`
	SDK          string `json:"sdk"`
	SELinux      string `json:"selinux"`
	FridaRunning bool   `json:"frida_running"`
	Proxy        string `json:"proxy"`
	Connected    bool   `json:"connected"`
	IsEmulator   bool   `json:"is_emulator"`
}

// GetDeviceInfo fetches all relevant information from the connected device.
func (c *Client) GetDeviceInfo(ctx context.Context, fridaServerPath string) (*DeviceInfo, error) {
	if !c.Connected(ctx) {
		return &DeviceInfo{Connected: false}, nil
	}

	info := &DeviceInfo{Connected: true}

	// We can parallelize these calls in a future iteration for performance,
	// but for now, let's focus on correctness and clean code.
	
	val, _ := c.Shell(ctx, "getprop ro.product.model")
	info.Model = val

	val, _ = c.Shell(ctx, "getprop ro.build.version.release")
	info.Android = val

	val, _ = c.Shell(ctx, "getprop ro.build.version.sdk")
	info.SDK = val

	val, _ = c.Shell(ctx, "su -c 'getenforce 2>/dev/null'")
	info.SELinux = val

	val, _ = c.Shell(ctx, "settings get global http_proxy")
	if val == "" || val == "null" || val == ":0" {
		info.Proxy = "none"
	} else {
		info.Proxy = val
	}

	val, _ = c.Shell(ctx, "getprop ro.kernel.qemu")
	info.IsEmulator = val == "1"

	// Check if Frida is running
	if fridaServerPath != "" {
		// Just check if a process with that name exists
		serverName := filepath.Base(fridaServerPath)
		out, _ := c.Shell(ctx, fmt.Sprintf("ps -A | grep %s", serverName))
		info.FridaRunning = strings.Contains(out, serverName)
	}

	return info, nil
}

// SetProxy configures the system proxy on the device.
func (c *Client) SetProxy(ctx context.Context, host string, port int) error {
	_, err := c.Shell(ctx, fmt.Sprintf("settings put global http_proxy %s:%d", host, port))
	return err
}

// ClearProxy removes the system proxy configuration from the device.
func (c *Client) ClearProxy(ctx context.Context) error {
	_, err := c.Shell(ctx, "settings put global http_proxy :0")
	if err != nil {
		return err
	}
	_, err = c.Shell(ctx, "settings delete global http_proxy")
	return err
}

// LaunchApp starts the specified Android package.
func (c *Client) LaunchApp(ctx context.Context, pkg string) error {
	_, err := c.Shell(ctx, fmt.Sprintf("monkey -p %s -c android.intent.category.LAUNCHER 1", pkg))
	return err
}

// ForceStop kills the specified Android package.
func (c *Client) ForceStop(ctx context.Context, pkg string) error {
	_, err := c.Shell(ctx, fmt.Sprintf("am force-stop %s", pkg))
	return err
}

// GetAPKPath finds the on-device path of an installed package.
func (c *Client) GetAPKPath(ctx context.Context, pkg string) (string, error) {
	out, err := c.Shell(ctx, fmt.Sprintf("pm path %s", pkg))
	if err != nil {
		return "", err
	}
	
	lines := strings.Split(out, "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "package:") {
			return strings.TrimPrefix(line, "package:"), nil
		}
	}
	return "", fmt.Errorf("APK path not found for %s", pkg)
}

// PullAPK copies the APK from the device to a local destination.
func (c *Client) PullAPK(ctx context.Context, remotePath, localDest string) error {
	_, err := c.Run(ctx, "pull", remotePath, localDest)
	return err
}

// SetSELinux sets the SELinux mode (e.g., "permissive", "enforcing").
func (c *Client) SetSELinux(ctx context.Context, mode string) error {
	_, err := c.Shell(ctx, fmt.Sprintf("su -c 'setenforce %s'", mode))
	return err
}

// App represents an installed Android application.
type App struct {
	Name string `json:"Name"`
	ID   string `json:"ID"`
	PID  int    `json:"PID"`
}

// ListApps returns a list of installed 3rd-party applications.
func (c *Client) ListApps(ctx context.Context) ([]App, error) {
	out, err := c.Shell(ctx, "pm list packages -3")
	if err != nil {
		return nil, err
	}

	var apps []App
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, "package:") {
			pkg := strings.TrimPrefix(line, "package:")
			apps = append(apps, App{Name: pkg, ID: pkg, PID: 0})
		}
	}
	return apps, nil
}

// Process represents a running process on the device.
type Process struct {
	PID  int    `json:"pid"`
	Name string `json:"name"`
}

// ListProcs returns a list of running processes.
func (c *Client) ListProcs(ctx context.Context) ([]Process, error) {
	out, err := c.Shell(ctx, "ps -A -o PID,NAME")
	if err != nil {
		// Fallback for older Android versions
		out, err = c.Shell(ctx, "ps")
		if err != nil {
			return nil, err
		}
	}

	var procs []Process
	lines := strings.Split(out, "\n")
	if len(lines) < 2 {
		return procs, nil
	}

	for _, line := range lines[1:] {
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			pidStr := fields[0]
			name := fields[len(fields)-1]
			// Try to parse PID, ignore if fails
			var pid int
			fmt.Sscanf(pidStr, "%d", &pid)
			if pid > 0 {
				procs = append(procs, Process{PID: pid, Name: name})
			}
		}
	}
	return procs, nil
}

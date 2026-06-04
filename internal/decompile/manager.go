package decompile

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/xlock-dev/sniff/internal/logger"
)

// Job represents a decompilation task.
type Job struct {
	Package  string    `json:"package"`
	OutDir   string    `json:"out_dir"`
	Progress int       `json:"progress"`
	Status   string    `json:"status"`
	Error    string    `json:"error,omitempty"`
	Started  time.Time `json:"started"`
}

// Manager handles JADX decompilation jobs.
type Manager struct {
	mu      sync.RWMutex
	jobs    map[string]*Job
	baseDir string // Directory to store decompiled source
	binPath string // Path to JADX binary
}

// NewManager creates a new decompilation manager.
func NewManager(baseDir string) *Manager {
	return &Manager{
		jobs:    make(map[string]*Job),
		baseDir: baseDir,
	}
}

// Start initiates a decompilation job for an APK.
func (m *Manager) Start(ctx context.Context, pkg string, apkPath string) error {
	m.mu.Lock()
	if job, ok := m.jobs[pkg]; ok && job.Status == "running" {
		m.mu.Unlock()
		return fmt.Errorf("decompilation for %s is already running", pkg)
	}

	outDir := filepath.Join(m.baseDir, "jadx", strings.ReplaceAll(pkg, ".", "_"))
	job := &Job{
		Package: pkg,
		OutDir:  outDir,
		Status:  "running",
		Started: time.Now(),
	}
	m.jobs[pkg] = job
	m.mu.Unlock()

	logger.Info("Starting decompilation", "package", pkg, "apk", apkPath, "out", outDir)

	go m.runJadx(pkg, apkPath, outDir)

	return nil
}

// ensureJadx returns the jadx binary path, downloading it if necessary.
func (m *Manager) ensureJadx() (string, error) {
	if m.binPath != "" {
		return m.binPath, nil
	}

	// 1. Check system PATH
	if p, err := exec.LookPath("jadx"); err == nil {
		m.binPath = p
		return p, nil
	}

	// 2. Check common platform paths
	commonPaths := []string{
		"/opt/homebrew/bin/jadx",
		"/usr/local/bin/jadx",
		"/usr/bin/jadx",
	}
	for _, p := range commonPaths {
		if _, err := os.Stat(p); err == nil {
			m.binPath = p
			return p, nil
		}
	}

	// 3. Check internal bin directory
	internalBin := filepath.Join(m.baseDir, "bin", "jadx", "bin", "jadx")
	if runtime.GOOS == "windows" {
		internalBin += ".bat"
	}
	if _, err := os.Stat(internalBin); err == nil {
		m.binPath = internalBin
		return internalBin, nil
	}

	// 4. Auto-download logic (Placeholder for brevity, can be expanded)
	return "", fmt.Errorf("jadx binary not found. please install it or place in system PATH")
}

func (m *Manager) runJadx(pkg, apkPath, outDir string) {
	bin, err := m.ensureJadx()
	if err != nil {
		m.updateJob(pkg, "error", err.Error(), 0)
		return
	}

	// 1. Ensure outDir exists
	if err := os.MkdirAll(outDir, 0755); err != nil {
		m.updateJob(pkg, "error", err.Error(), 0)
		return
	}

	// 2. Run Jadx
	cmd := exec.Command(bin, "-d", outDir, "--deobf", apkPath)
	
	if err := cmd.Run(); err != nil {
		m.updateJob(pkg, "error", fmt.Sprintf("jadx failed: %v", err), 0)
		return
	}

	m.updateJob(pkg, "completed", "", 100)
	logger.Info("Decompilation completed", "package", pkg)
}

func (m *Manager) updateJob(pkg, status, errMsg string, progress int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, ok := m.jobs[pkg]; ok {
		job.Status = status
		job.Error = errMsg
		job.Progress = progress
	}
}

// FileNode represents a node in the source tree.
type FileNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	IsDir    bool        `json:"is_dir"`
	Children []*FileNode `json:"children,omitempty"`
}

// GetTree returns the file tree of a decompiled package.
func (m *Manager) GetTree(pkg string) (*FileNode, error) {
	outDir := filepath.Join(m.baseDir, "jadx", strings.ReplaceAll(pkg, ".", "_"), "sources")
	
	if _, err := os.Stat(outDir); os.IsNotExist(err) {
		return nil, fmt.Errorf("source not found for %s", pkg)
	}

	root := &FileNode{Name: "sources", Path: "", IsDir: true}
	
	err := filepath.WalkDir(outDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == outDir {
			return nil
		}

		rel, _ := filepath.Rel(outDir, path)
		parts := strings.Split(rel, string(os.PathSeparator))
		
		current := root
		for i, part := range parts {
			found := false
			for _, child := range current.Children {
				if child.Name == part {
					current = child
					found = true
					break
				}
			}
			if !found {
				newNode := &FileNode{
					Name:  part,
					Path:  rel,
					IsDir: d.IsDir() && i == len(parts)-1,
				}
				current.Children = append(current.Children, newNode)
				current = newNode
			}
		}
		return nil
	})

	return root, err
}

// GetFileContent returns the content of a source file.
func (m *Manager) GetFileContent(pkg string, relPath string) (string, error) {
	fullPath := filepath.Join(m.baseDir, "jadx", strings.ReplaceAll(pkg, ".", "_"), "sources", relPath)
	
	data, err := os.ReadFile(fullPath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

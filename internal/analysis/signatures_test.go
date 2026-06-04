package analysis

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCorrelateSignature(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "sniff-source-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a dummy source file
	sourcePath := filepath.Join(tmpDir, "ApiClient.java")
	sourceContent := `
package com.test;
public class ApiClient {
    public void sendRequest() {
        String sig = "X-Test-Signature";
        // logic here
    }
}
`
	if err := os.WriteFile(sourcePath, []byte(sourceContent), 0644); err != nil {
		t.Fatal(err)
	}

	matches, err := CorrelateSignature(tmpDir, "X-Test-Signature")
	if err != nil {
		t.Fatalf("Failed to correlate signature: %v", err)
	}

	if len(matches) != 1 {
		t.Errorf("Expected 1 match, got %d", len(matches))
	} else if matches[0].File != "ApiClient.java" {
		t.Errorf("Expected match in ApiClient.java, got %s", matches[0].File)
	}
}

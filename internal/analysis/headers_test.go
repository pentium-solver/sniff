package analysis

import (
	"testing"
)

func TestAnalyzeHeader(t *testing.T) {
	tests := []struct {
		name     string
		values   []string
		expected HeaderType
	}{
		{"Static", []string{"v1", "v1", "v1"}, TypeStatic},
		{"UUID", []string{"v1", "550e8400-e29b-41d4-a716-446655440000"}, TypeUUID},
		{"JWT", []string{"v1", "eyJhbGci.eyJzdWIi.SflKxwR"}, TypeJWT},
		{"Timestamp", []string{"v1", "1711584000"}, TypeTimestamp},
		{"HMAC", []string{"v1", "a8f3bc42d1e56b7c9a0f3d2e1b0c9a8f"}, TypeHMAC},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			profile := AnalyzeHeader("test-header", tt.values)
			if profile.Type != tt.expected {
				t.Errorf("Expected %v, got %v for %v", tt.expected, profile.Type, tt.values)
			}
		})
	}
}

func TestEntropy(t *testing.T) {
	low := calculateEntropy("aaaaa")
	high := calculateEntropy("a8f3bc42d1e56b7c")
	if low >= high {
		t.Errorf("Expected high entropy for random string, got %f vs %f", high, low)
	}
}

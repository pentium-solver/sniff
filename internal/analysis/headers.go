package analysis

import (
	"encoding/base64"
	"math"
	"regexp"
)

// HeaderType represents the classified nature of a header.
type HeaderType string

const (
	TypeStatic    HeaderType = "static"
	TypeDynamic   HeaderType = "dynamic"
	TypeUUID      HeaderType = "uuid"
	TypeHMAC      HeaderType = "hmac"
	TypeJWT       HeaderType = "jwt"
	TypeTimestamp HeaderType = "timestamp"
	TypeUnknown   HeaderType = "unknown"
)

// HeaderProfile represents the analysis of a specific header across multiple flows.
type HeaderProfile struct {
	Name           string      `json:"name"`
	Type           HeaderType  `json:"type"`
	Entropy        float64     `json:"entropy"`
	ExampleValue   string      `json:"example"`
	ObservedValues []string    `json:"-"`
	Pattern        string      `json:"pattern,omitempty"`
}

var (
	reUUID      = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	reHMAC      = regexp.MustCompile(`(?i)^[0-9a-f]{32,128}$`)
	reJWT       = regexp.MustCompile(`^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)
	reTimestamp = regexp.MustCompile(`^\d{10,13}$`)
)

// AnalyzeHeader performs pattern detection and entropy analysis on a set of header values.
func AnalyzeHeader(name string, values []string) *HeaderProfile {
	profile := &HeaderProfile{
		Name:           name,
		ObservedValues: values,
		Type:           TypeUnknown,
	}

	if len(values) == 0 {
		return profile
	}

	profile.ExampleValue = values[len(values)-1]

	// 1. Check for Static
	if allSame(values) {
		profile.Type = TypeStatic
		profile.Entropy = 0
		return profile
	}

	// 2. Pattern Detection on the latest value
	latest := values[len(values)-1]
	if reUUID.MatchString(latest) {
		profile.Type = TypeUUID
	} else if reJWT.MatchString(latest) {
		profile.Type = TypeJWT
	} else if reTimestamp.MatchString(latest) {
		profile.Type = TypeTimestamp
	} else if reHMAC.MatchString(latest) {
		profile.Type = TypeHMAC
	} else if isBase64(latest) && len(latest) > 20 {
		profile.Type = TypeDynamic
		profile.Pattern = "base64"
	} else {
		profile.Type = TypeDynamic
	}

	// 3. Entropy Calculation (Shannon Entropy)
	profile.Entropy = calculateEntropy(latest)

	return profile
}

func allSame(values []string) bool {
	if len(values) <= 1 {
		return true
	}
	first := values[0]
	for _, v := range values[1:] {
		if v != first {
			return false
		}
	}
	return true
}

func calculateEntropy(s string) float64 {
	if s == "" {
		return 0
	}
	counts := make(map[rune]int)
	for _, r := range s {
		counts[r]++
	}
	var entropy float64
	len := float64(len(s))
	for _, count := range counts {
		p := float64(count) / len
		entropy -= p * math.Log2(p)
	}
	return entropy
}

func isBase64(s string) bool {
	_, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		_, err = base64.RawStdEncoding.DecodeString(s)
	}
	return err == nil
}

package analysis

import (
	"bufio"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// DiscoveredEndpoint represents an API endpoint found in source code.
type DiscoveredEndpoint struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	File   string `json:"file"`
}

var (
	// Regex to match Retrofit annotations like @GET("path"), @POST("/v1/login"), etc.
	reRetrofit = regexp.MustCompile(`@(GET|POST|PUT|DELETE|PATCH)\("([^"]+)"\)`)
)

// ScanForEndpoints crawls a directory of decompiled source and extracts API definitions.
func ScanForEndpoints(sourcesDir string) ([]DiscoveredEndpoint, error) {
	var results []DiscoveredEndpoint

	err := filepath.WalkDir(sourcesDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || (!strings.HasSuffix(path, ".java") && !strings.HasSuffix(path, ".kt")) {
			return nil
		}

		file, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer file.Close()

		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := scanner.Text()
			matches := reRetrofit.FindAllStringSubmatch(line, -1)
			for _, m := range matches {
				if len(m) == 3 {
					rel, _ := filepath.Rel(sourcesDir, path)
					results = append(results, DiscoveredEndpoint{
						Method: m[1],
						Path:   m[2],
						File:   rel,
					})
				}
			}
		}
		return nil
	})

	return results, err
}

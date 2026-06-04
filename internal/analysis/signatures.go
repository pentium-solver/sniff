package analysis

import (
	"bufio"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// CodeMatch represents a location in the source code where a signature was found.
type CodeMatch struct {
	File    string `json:"file"`
	Line    int    `json:"line"`
	Snippet string `json:"snippet"`
}

// CorrelateSignature searches the decompiled source for references to a specific header name.
func CorrelateSignature(sourcesDir string, headerName string) ([]CodeMatch, error) {
	var matches []CodeMatch

	// Escape header name for regex (it might contain hyphens/special chars)
	// We look for the header name as a literal string in the code (e.g., "X-Signature")
	pattern := `"` + regexp.QuoteMeta(headerName) + `"`
	re := regexp.MustCompile(pattern)

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
		lineNum := 0
		for scanner.Scan() {
			lineNum++
			line := scanner.Text()
			if re.MatchString(line) {
				rel, _ := filepath.Rel(sourcesDir, path)
				matches = append(matches, CodeMatch{
					File:    rel,
					Line:    lineNum,
					Snippet: strings.TrimSpace(line),
				})
			}
			
			// Safety limit: don't return too many matches per header
			if len(matches) > 20 {
				return filepath.SkipDir // Or just break if we want to stop searching
			}
		}
		return nil
	})

	return matches, err
}

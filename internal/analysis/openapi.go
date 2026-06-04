package analysis

import (
	"fmt"
	"strings"
)

// GenerateOpenAPI creates an OpenAPI 3.0.0 YAML specification from the current endpoint map.
func (m *EndpointMap) GenerateOpenAPI() string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var sb strings.Builder

	sb.WriteString("openapi: 3.0.0\n")
	sb.WriteString("info:\n")
	sb.WriteString("  title: sniff! Captured API\n")
	sb.WriteString("  version: 1.0.0\n")
	sb.WriteString("  description: Automatically generated from live traffic\n")
	sb.WriteString("paths:\n")

	// Group by path
	paths := make(map[string][]*EndpointSummary)
	for _, s := range m.Endpoints {
		paths[s.Path] = append(paths[s.Path], s)
	}

	for path, summaries := range paths {
		sb.WriteString(fmt.Sprintf("  %s:\n", path))
		for _, s := range summaries {
			sb.WriteString(fmt.Sprintf("    %s:\n", strings.ToLower(s.Method)))
			sb.WriteString("      summary: Captured endpoint\n")
			
			if s.RequestSchema != nil {
				sb.WriteString("      requestBody:\n")
				sb.WriteString("        content:\n")
				sb.WriteString("          application/json:\n")
				sb.WriteString("            schema:\n")
				writeSchemaYAML(&sb, s.RequestSchema, "              ")
			}

			sb.WriteString("      responses:\n")
			sb.WriteString("        '200':\n")
			sb.WriteString("          description: Captured response\n")
			if s.ResponseSchema != nil {
				sb.WriteString("          content:\n")
				sb.WriteString("            application/json:\n")
				sb.WriteString("              schema:\n")
				writeSchemaYAML(&sb, s.ResponseSchema, "                ")
			}
		}
	}

	return sb.String()
}

func writeSchemaYAML(sb *strings.Builder, s *FieldSchema, indent string) {
	if s == nil {
		sb.WriteString(fmt.Sprintf("%stype: object\n", indent))
		return
	}

	switch s.Type {
	case "object":
		sb.WriteString(fmt.Sprintf("%stype: object\n", indent))
		if len(s.Children) > 0 {
			sb.WriteString(fmt.Sprintf("%sproperties:\n", indent))
			for k, v := range s.Children {
				sb.WriteString(fmt.Sprintf("%s  %s:\n", indent, k))
				writeSchemaYAML(sb, v, indent+"    ")
			}
		}
	case "array":
		sb.WriteString(fmt.Sprintf("%stype: array\n", indent))
		sb.WriteString(fmt.Sprintf("%sitems:\n", indent))
		writeSchemaYAML(sb, s.Items, indent+"  ")
	case "mixed":
		sb.WriteString(fmt.Sprintf("%stype: string # mixed types detected\n", indent))
	case "null":
		sb.WriteString(fmt.Sprintf("%snullable: true\n", indent))
	default:
		sb.WriteString(fmt.Sprintf("%stype: %s\n", indent, s.Type))
	}
}

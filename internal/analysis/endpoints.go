package analysis

import (
	"github.com/xlock-dev/sniff/internal/proxy"
	"sync"
)

// EndpointMap aggregates flows by endpoint and performs analysis.
type EndpointMap struct {
	mu        sync.RWMutex
	Endpoints map[string]*EndpointSummary
}

// EndpointSummary holds all captured data for a specific (Method, Host, Path) tuple.
type EndpointSummary struct {
	Method  string   `json:"method"`
	Host    string   `json:"host"`
	Path    string   `json:"path"`
	Count   int      `json:"count"`
	Headers map[string][]string `json:"-"` // HeaderName -> list of observed values
	Profiles map[string]*HeaderProfile `json:"profiles"`
	
	RequestSchema  *FieldSchema `json:"request_schema,omitempty"`
	ResponseSchema *FieldSchema `json:"response_schema,omitempty"`
}

// NewEndpointMap creates a new endpoint analysis map.
func NewEndpointMap() *EndpointMap {
	return &EndpointMap{
		Endpoints: make(map[string]*EndpointSummary),
	}
}

// AddFlow processes a new flow and updates the corresponding endpoint summary.
func (m *EndpointMap) AddFlow(f proxy.Flow) {
	key := f.Method + " " + f.Host + f.URL // Simple key for now
	
	m.mu.Lock()
	defer m.mu.Unlock()

	summary, ok := m.Endpoints[key]
	if !ok {
		summary = &EndpointSummary{
			Method:  f.Method,
			Host:    f.Host,
			Path:    f.URL,
			Headers: make(map[string][]string),
			Profiles: make(map[string]*HeaderProfile),
		}
		m.Endpoints[key] = summary
	}

	summary.Count++

	// 1. Header Analysis
	for k, v := range f.RequestHeaders {
		summary.Headers[k] = append(summary.Headers[k], v)
		if len(summary.Headers[k]) > 50 {
			summary.Headers[k] = summary.Headers[k][1:]
		}
		summary.Profiles[k] = AnalyzeHeader(k, summary.Headers[k])
	}

	// 2. Schema Inference
	if f.RequestBody != "" {
		if schema, err := InferSchema(f.RequestBody); err == nil {
			summary.RequestSchema = MergeSchemas(summary.RequestSchema, schema)
		}
	}
	if f.ResponseBody != "" {
		if schema, err := InferSchema(f.ResponseBody); err == nil {
			summary.ResponseSchema = MergeSchemas(summary.ResponseSchema, schema)
		}
	}
}

// GetSummary returns all endpoint summaries for the dashboard.
func (m *EndpointMap) GetSummary() []*EndpointSummary {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	var list []*EndpointSummary
	for _, s := range m.Endpoints {
		list = append(list, s)
	}
	return list
}

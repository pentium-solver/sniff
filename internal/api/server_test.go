package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xlock-dev/sniff/internal/capture"
	"github.com/xlock-dev/sniff/internal/config"
	"github.com/xlock-dev/sniff/internal/decompile"
)

func TestServerState(t *testing.T) {
	cfg := &config.Config{AuthEnabled: false}
	engine := capture.NewEngine(cfg)
	decomp := decompile.NewManager("/tmp")
	server := NewServer(engine, decomp, cfg, nil)

	req, err := http.NewRequest("GET", "/api/state", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	server.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf("handler returned wrong status code: got %v want %v", status, http.StatusOK)
	}
}

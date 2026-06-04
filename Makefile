.PHONY: build site dev clean test

# Build the sniff binary
build:
	go build -ldflags="-s -w" -o sniff ./cmd/sniff

# Build the Next.js site (Static Export to site/out)
site:
	cd site && bun install && bun run build

# Run development environment
# Backend on :9090, Frontend on :3000
dev:
	@echo "Starting backend and frontend dev server..."
	@go run ./cmd/sniff --debug &
	@cd site && bun dev

# Run all internal smoke tests
test:
	go test ./internal/...

# Clean build artifacts
clean:
	rm -f sniff
	rm -rf site/.next site/out

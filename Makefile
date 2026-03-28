.PHONY: build dev clean frontend site

# Build the sniff binary (embeds Svelte frontend)
build: frontend
	go build -ldflags="-s -w" -o sniff .

# Build the Svelte frontend to web/
frontend:
	cd frontend && bun install && bun run build

# Build the Next.js site
site:
	cd site && bun install && bun run build

# Run development environment (Go backend + Next.js site)
dev:
	@echo "Starting backend on :9090 and site on :3000..."
	@SNIFF_NO_OPEN=1 go run . --web &
	@cd site && bun dev

# Clean build artifacts
clean:
	rm -f sniff sniff-tui
	rm -rf web/_app
	rm -rf site/.next site/out

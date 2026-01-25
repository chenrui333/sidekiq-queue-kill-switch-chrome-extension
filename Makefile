.PHONY: all clean package build assemble install help

# Default target
all: package

# Install dependencies
install:
	@echo "Installing dependencies with bun..."
	@bun install

# Build with Vite
build: install
	@echo "Building with Vite..."
	@bun run build

# Assemble extension directory
assemble: build
	@echo "Assembling extension..."
	@bun scripts/build-extension.mjs

# Package the extension into a zip file
package: assemble
	@echo "Packaging Sidekiq Queue Kill Switch extension..."
	@rm -f dist/sidekiq-queue-kill-switch.zip
	@cd dist/extension && zip -r ../sidekiq-queue-kill-switch.zip \
		manifest.json \
		assets/ \
		icons/ \
		README.md \
		LICENSE \
		-x "*.DS_Store" \
		-x "*/.DS_Store"
	@echo ""
	@echo "Created: dist/sidekiq-queue-kill-switch.zip"
	@echo ""
	@unzip -l dist/sidekiq-queue-kill-switch.zip

# Clean build artifacts
clean:
	@echo "Cleaning..."
	@rm -rf dist/build/ dist/extension/ dist/sidekiq-queue-kill-switch.zip
	@echo "Done."

# Deep clean (includes node_modules)
clean-all: clean
	@echo "Removing node_modules..."
	@rm -rf node_modules/ bun.lockb
	@echo "Done."

# Show help
help:
	@echo "Sidekiq Queue Kill Switch - Build Targets"
	@echo ""
	@echo "  make install     - Install dependencies with bun"
	@echo "  make build       - Build JS with Vite"
	@echo "  make assemble    - Assemble extension directory"
	@echo "  make package     - Build, assemble, and create zip"
	@echo "  make clean       - Remove build artifacts"
	@echo "  make clean-all   - Remove build artifacts and node_modules"
	@echo "  make help        - Show this help message"
	@echo ""
	@echo "Development:"
	@echo "  bun run watch    - Watch mode for development"
	@echo ""
	@echo "Installation:"
	@echo "  1. Run 'make package'"
	@echo "  2. Open chrome://extensions/"
	@echo "  3. Enable Developer mode"
	@echo "  4. Click 'Load unpacked' and select dist/extension/"

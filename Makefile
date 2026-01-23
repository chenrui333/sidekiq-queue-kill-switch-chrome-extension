.PHONY: all clean package help

# Default target
all: package

# Package the extension into a zip file
package:
	@echo "Packaging Sidekiq Queue Kill Switch extension..."
	@mkdir -p dist
	@rm -f dist/sidekiq-queue-kill-switch.zip
	@zip -r dist/sidekiq-queue-kill-switch.zip \
		manifest.json \
		src/ \
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
	@rm -rf dist/
	@echo "Done."

# Show help
help:
	@echo "Sidekiq Queue Kill Switch - Build Targets"
	@echo ""
	@echo "  make package  - Create distribution zip file"
	@echo "  make clean    - Remove dist/ directory"
	@echo "  make help     - Show this help message"
	@echo ""
	@echo "Installation:"
	@echo "  1. Run 'make package'"
	@echo "  2. Open chrome://extensions/"
	@echo "  3. Enable Developer mode"
	@echo "  4. Click 'Load unpacked' and select this directory"

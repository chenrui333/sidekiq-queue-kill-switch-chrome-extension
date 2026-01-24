#!/bin/bash
#
# Package the Sidekiq Queue Kill Switch Chrome extension for distribution.
# Creates a zip file in dist/ directory.
#
# This script delegates to the Makefile which handles:
# 1. Installing dependencies (bun install)
# 2. Building with Vite (bun run build)
# 3. Assembling extension (node scripts/build-extension.mjs)
# 4. Creating the ZIP file
#

set -e

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Change to project root
cd "$PROJECT_ROOT"

# Run make package
make package

echo ""
echo "To install:"
echo "  1. Open Chrome/Arc and go to chrome://extensions/"
echo "  2. Enable 'Developer mode'"
echo "  3. Click 'Load unpacked' and select dist/extension/"
echo "     OR"
echo "  3. Drag and drop dist/sidekiq-queue-kill-switch.zip onto the extensions page"

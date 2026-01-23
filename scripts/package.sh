#!/bin/bash
#
# Package the Sidekiq Queue Kill Switch Chrome extension for distribution.
# Creates a zip file in dist/ directory.
#

set -e

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Output configuration
DIST_DIR="$PROJECT_ROOT/dist"
ZIP_NAME="sidekiq-queue-kill-switch.zip"
OUTPUT_PATH="$DIST_DIR/$ZIP_NAME"

echo "Packaging Sidekiq Queue Kill Switch extension..."
echo "Project root: $PROJECT_ROOT"

# Create dist directory if it doesn't exist
mkdir -p "$DIST_DIR"

# Remove old zip if it exists
if [ -f "$OUTPUT_PATH" ]; then
    echo "Removing existing $ZIP_NAME..."
    rm "$OUTPUT_PATH"
fi

# Change to project root for cleaner zip paths
cd "$PROJECT_ROOT"

# Create the zip file with only the necessary files
# Excludes: .git, dist, scripts, .DS_Store, etc.
zip -r "$OUTPUT_PATH" \
    manifest.json \
    src/ \
    icons/ \
    README.md \
    LICENSE \
    -x "*.DS_Store" \
    -x "*/.DS_Store" \
    -x "*.git*"

echo ""
echo "Successfully created: $OUTPUT_PATH"
echo ""

# Show zip contents
echo "Contents:"
unzip -l "$OUTPUT_PATH"

echo ""
echo "To install:"
echo "  1. Open Chrome/Arc and go to chrome://extensions/"
echo "  2. Enable 'Developer mode'"
echo "  3. Click 'Load unpacked' and select the project directory"
echo "     OR"
echo "  3. Drag and drop $ZIP_NAME onto the extensions page"

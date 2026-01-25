<p align="center">
  <img src="icons/icon128.png" alt="Sidekiq Queue Kill Switch" width="128" height="128">
</p>

# Sidekiq Queue Kill Switch

A Chrome extension (Manifest V3) that adds **Pause All** and **Unpause All** controls to the Sidekiq Enterprise Queues page. Designed for oncall use.

## Features

- **Pause All Queues**: Stops all queue processing with a single click
- **Unpause All Queues**: Resumes all paused queues
- **Safe**: Never deletes queues - only pauses/unpauses
- **Reliable convergence**: Uses verification loop to handle eventual consistency
- **Confirmation dialogs**: Prevents accidental mass actions
- **Progress tracking**: Shows real-time status during operations
- **Works with Arc/Chrome**: Any Chromium-based browser

## Installation

### From Source (Recommended)

1. Clone or download this repository
2. Open Chrome or Arc
3. Navigate to `chrome://extensions/`
4. Enable **Developer mode** (toggle in top-right)
5. Click **Load unpacked**
6. Select the `sidekiq-queue-kill-switch-chrome-extension` directory

### From ZIP

1. Run `./scripts/package.sh` to create the distribution ZIP
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Drag and drop `dist/sidekiq-queue-kill-switch.zip` onto the page

## Usage

1. Navigate to your Sidekiq Enterprise Queues page (e.g., `https://your-app.com/sidekiq/queues`)
2. You'll see two new buttons near the page header:
   - **Pause All Queues** (red)
   - **Unpause All Queues** (blue)
3. Click the desired button
4. Confirm the action in the dialog
5. Watch the status indicator as queues are processed
6. The page automatically refreshes when complete

## Demo

https://github.com/user-attachments/assets/8e575ed7-87d0-4c65-bb93-c83cb1d7c991

## How It Works

The extension:

1. Detects the Sidekiq Queues page by looking for `table.queues`
2. Enumerates all queue forms that need action (have pause/unpause button)
3. For each queue, submits the form via native HTML submission (hidden iframe)
4. Rate-limits requests (100ms between POSTs) to avoid server overload
5. **Verifies and retries**: Re-fetches page state (500ms between passes) and retries any queues that didn't change (up to 5 passes) to handle Sidekiq's eventual consistency
6. Refreshes the page on success to show updated state

### Safety Features

- **Never sends delete parameters** - The extension explicitly filters out delete buttons
- **Reads button state from DOM** - Doesn't hardcode pause/unpause values
- **Skips already-paused/unpaused queues** - Only operates on queues that need change
- **Confirmation required** - All mass actions require user confirmation
- **Same-origin requests** - Uses the browser's existing session/cookies

## Troubleshooting

### Extension doesn't appear on the page

- Ensure you're on a URL matching `*/sidekiq/queues*`
- Check that the page has a `table.queues` element
- Open DevTools (F12) and check Console for `[SQKS]` messages
- Verify the extension is enabled in `chrome://extensions/`

### "No authenticity token found" error

- Make sure you're logged into Sidekiq
- Try refreshing the page
- Verify the page has queue forms with authenticity_token inputs

### Some queues fail to pause/unpause

- Check the browser console for detailed error messages
- The queue may require special permissions
- Network issues can cause intermittent failures
- The extension will report success/fail counts

### Actions don't seem to take effect

- The page should auto-refresh after completion
- If not, manually refresh to see updated state
- Check server logs for any backend errors

### Status shows "Incomplete after X passes"

This happens when some queues don't reach the desired state after multiple attempts:

- The extension performs up to 5 passes to handle Sidekiq's eventual consistency
- Between passes, it re-fetches the page to verify which queues still need action
- If queues remain unchanged after 5 passes:
  - Check the browser console (`[SQKS]` prefix) for detailed error logs
  - The queue may have permission restrictions
  - There may be server-side validation preventing the action
  - Try pausing/unpausing those specific queues manually

## Development

### Prerequisites

- [Bun](https://bun.sh/) (for dependency management and build)

### Project Structure

```
sidekiq-queue-kill-switch/
├── manifest.json              # Chrome extension manifest (source - refs src/)
├── src/
│   ├── contentScript.js       # Main extension logic (source)
│   └── contentScript.css      # Styling for controls
├── icons/                     # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/
│   ├── bench-build.sh         # Build performance benchmarks
│   ├── build-extension.mjs    # Extension assembly script
│   ├── package.sh             # Build script for distribution
│   └── validate-version.py    # Version validation for releases
├── .github/workflows/
│   ├── ci.yml                 # PR/push validation
│   └── release.yml            # Tag-triggered releases
├── package.json               # Bun dependencies
├── vite.config.js             # Vite build configuration
├── Makefile                   # Build automation
├── README.md
└── LICENSE
```

### Build Output

After running `make package`, the output is:

```
dist/
├── build/                     # Vite build output
│   └── contentScript.js       # Bundled JS (IIFE format)
├── extension/                 # Assembled extension (load unpacked here)
│   ├── manifest.json          # Generated manifest (refs assets/)
│   ├── assets/
│   │   ├── contentScript.js   # Built JS
│   │   └── contentScript.css  # CSS (copied)
│   ├── icons/
│   └── ...
└── sidekiq-queue-kill-switch.zip
```

### Building

```bash
# Install dependencies and build
make package

# Or step by step:
bun install              # Install dependencies
bun run build            # Build JS with Vite
bun scripts/build-extension.mjs  # Assemble extension
```

### Development Workflow

```bash
# Watch mode for development
bun run watch

# After making changes, reload extension:
# 1. Go to chrome://extensions/
# 2. Click refresh icon on extension card
# 3. Reload the Sidekiq page
```

### Loading the Extension

**For development (Load unpacked):**
1. Run `make package` (or just `make assemble` for quicker iterations)
2. Go to `chrome://extensions/`
3. Enable Developer mode
4. Click "Load unpacked"
5. Select `dist/extension/` directory

**From ZIP:**
1. Run `make package`
2. Drag `dist/sidekiq-queue-kill-switch.zip` onto `chrome://extensions/`

### Debug Logging

All console output is prefixed with `[SQKS]` for easy filtering:

```javascript
// In DevTools Console, filter by:
[SQKS]
```

### Making Changes

1. Edit files in `src/`
2. Run `make package` (or `bun run watch` for auto-rebuild)
3. Go to `chrome://extensions/`
4. Click the refresh icon on the extension card
5. Reload the Sidekiq page to test

## Permissions

This extension requires minimal permissions:

- **Content script access**: Only on `*://*/sidekiq/queues*` URLs
- **No host_permissions**: Uses same-origin fetch from the content script
- **No background service worker**: All logic runs in the page context

## Browser Compatibility

- ✅ Chrome (tested)
- ✅ Arc (tested - Chromium-based)
- ✅ Edge (should work - Chromium-based)
- ✅ Brave (should work - Chromium-based)
- ❌ Firefox (not supported - would need Manifest V2 port)

## License

MIT License - see [LICENSE](LICENSE) file.

## CI/CD

This project uses GitHub Actions for continuous integration and releases.

### Continuous Integration

On every PR and push to `main`:
- Validates `manifest.json` structure (MV3, correct URL patterns)
- Validates `contentScript.js` structure (safety functions, logging prefix)
- Builds and verifies the extension ZIP

### Automated Releases

Releases are created automatically when you push a version tag.

## Releasing

### Quick Release

```bash
# 1. Update version in manifest.json
#    Edit manifest.json and change "version": "1.0.0" to "1.0.1"

# 2. Commit the version bump
git add manifest.json
git commit -m "Bump version to 1.0.1"

# 3. Create and push a matching tag
git tag v1.0.1
git push origin main --tags
```

### What Happens

1. GitHub Actions detects the `v*.*.*` tag push
2. Validates that `manifest.json` version matches the tag (e.g., `v1.0.1` → `1.0.1`)
3. Builds the extension ZIP using `make package`
4. Creates a GitHub Release with auto-generated release notes
5. Attaches `sidekiq-queue-kill-switch.zip` to the release

### Version Matching Rules

- Tag format: `v<major>.<minor>.<patch>` (e.g., `v1.0.1`, `v2.3.0`)
- Manifest version: `<major>.<minor>.<patch>` (e.g., `1.0.1`, `2.3.0`)
- The tag (minus the `v` prefix) must exactly match `manifest.json` version
- Mismatches will fail the release with a clear error message

### Manual Release (Alternative)

If you prefer not to use automated releases:

```bash
# Build locally
make package

# Create release manually on GitHub and upload dist/sidekiq-queue-kill-switch.zip
```

## Contributing

Issues and pull requests welcome! Please ensure any changes maintain the safety-first approach - never delete queues.

# Sidekiq Queue Kill Switch - Project Context

## Overview

Chrome Extension (Manifest V3) that adds "Pause All" and "Unpause All" controls to Sidekiq Enterprise Queues pages. Designed for oncall safety - never deletes queues.

## Project Structure

```
├── manifest.json              # Chrome MV3 manifest (source - refs src/)
├── src/
│   ├── contentScript.js       # Main extension logic (source)
│   └── contentScript.css      # UI styling for injected controls
├── icons/                     # Extension icons (16/32/48/128px)
├── scripts/
│   ├── bench-build.sh         # Build performance benchmarks
│   ├── build-extension.mjs    # Extension assembly script
│   ├── package.sh             # Shell script for packaging
│   └── validate-version.py    # Version validation for releases
├── package.json               # Bun/npm dependencies
├── vite.config.js             # Vite build configuration
├── Makefile                   # Build automation
└── dist/                      # Build output (gitignored)
    ├── build/                 # Vite build output
    ├── extension/             # Assembled extension (load unpacked here)
    └── *.zip                  # Distribution package
```

## Key Technical Details

### URL Pattern
- Matches: `*://*/sidekiq/queues*`
- Content script runs at `document_idle`

### DOM Selectors (Sidekiq Enterprise)
- Queue table: `table.queues`
- Queue forms: `form[action*="/sidekiq/queues/"]`
- CSRF token: `input[name="authenticity_token"]`
- Pause button: `input[type="submit"][name="pause"]`
- Unpause button: `input[type="submit"][name="unpause"]`
- Delete button: `input[type="submit"][name="delete"]` (NEVER use)

### Convergence Loop
Sidekiq UI has eventual consistency - queue state may not update immediately after POST.
The extension handles this with a verification + retry loop:
- After each pass, re-fetches page HTML to check which queues still need action
- Retries remaining queues up to MAX_PASSES (5)
- Fixed 500ms delay between passes to let server state settle
- Fixed 100ms delay between individual requests for rate limiting

### Native Form Submission
The extension uses native HTML form submission via a hidden iframe (preferred method):
- Submits forms exactly as the browser would
- No CSRF issues since it uses the page's actual form
- Falls back gracefully if form/button is missing

### Safety Rules
1. **Never send delete parameter** - Multiple guards at every level
2. **ALLOWED_ACTIONS allowlist** - Only 'pause' and 'unpause' permitted
3. **Read button state from DOM** - Don't hardcode pause/unpause values
4. **Rate limit requests** - 100ms delay between POSTs
5. **No double-submit** - Native form submission doesn't fall back to fetch

### Console Logging
All logs prefixed with `[SQKS]` for easy filtering in DevTools.

### Performance Optimizations (v1.4.0+)
The extension is optimized for pages with many queues (hundreds+):
- **Form Index**: Per-pass `buildFormIndex()` creates O(1) lookup map, eliminating O(N²) DOM scanning
- **Index Caching**: Live DOM index cached via `getLiveFormIndex()`, invalidated strategically
- **Efficient Enumeration**: `getActionableQueues()` reuses form index from `fetchQueuesPageDocument()`
- **Cheap Live Recheck**: Checks only specific queue's button instead of full enumeration
- **Gated Logging**: `ENABLE_RUN_LOGS` (tied to `DEBUG_LEVEL >= 2`) skips expensive JSON sanitization
- **Performance Metrics**: When `PERF_ENABLED` is true, logs timing summary after each run

## Development Workflow

```bash
# Install dependencies
bun install

# Build and package extension
make package

# Or step by step:
bun run build              # Build JS with Vite
node scripts/build-extension.mjs  # Assemble extension

# Watch mode for development
bun run watch

# Clean build artifacts
make clean

# Deep clean (includes node_modules)
make clean-all

# Load in Chrome/Arc
# 1. chrome://extensions/
# 2. Enable Developer mode
# 3. Load unpacked → select dist/extension/
# 4. After changes: rebuild and click refresh icon on extension card
```

## Testing

Manual testing only - navigate to a Sidekiq Enterprise queues page and verify:
1. Controls appear near page header
2. Confirmation dialogs work
3. Status updates during operation
4. Page refreshes after completion
5. Check console for `[SQKS]` logs

## Build System

The extension uses **Bun + Vite** for building:
- **Vite** bundles `src/contentScript.js` into IIFE format for Chrome content scripts
- **No minification** by default (enable with `BUILD_MINIFY=1`)
- CSS is copied as-is (no processing)
- Manifest is generated with updated asset paths (`src/` → `assets/`)

### Build Output Paths
- `dist/build/contentScript.js` - Vite bundled JS
- `dist/extension/` - Assembled extension (load unpacked here)
- `dist/extension/assets/` - Built JS and CSS
- `dist/sidekiq-queue-kill-switch.zip` - Distribution package

## Code Style

- Vanilla JavaScript (no runtime dependencies)
- Vite for build bundling (IIFE output)
- IIFE wrapper for isolation
- Async/await for fetch operations
- Descriptive function names
- Safety comments where relevant

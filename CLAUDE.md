# Sidekiq Queue Kill Switch - Project Context

## Overview

Chrome Extension (Manifest V3) that adds "Pause All" and "Unpause All" controls to Sidekiq Enterprise Queues pages. Designed for oncall safety - never deletes queues.

## Project Structure

```
├── manifest.json          # Chrome MV3 manifest
├── src/
│   ├── contentScript.js   # Main extension logic (injected into page)
│   └── contentScript.css  # UI styling for injected controls
├── icons/                 # Extension icons (16/32/48/128px)
├── scripts/
│   └── package.sh         # Shell script for packaging
├── Makefile               # Build automation
└── dist/                  # Generated zip output (gitignored)
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

### Safety Rules
1. **Never send delete parameter** - Code has multiple guards against this
2. **Read button state from DOM** - Don't hardcode pause/unpause values
3. **Use page's CSRF token** - Read from each form's hidden input
4. **Rate limit requests** - 150ms delay between POSTs

### Console Logging
All logs prefixed with `[SQKS]` for easy filtering in DevTools.

## Development Workflow

```bash
# Package extension
make package

# Clean build artifacts
make clean

# Load in Chrome/Arc
# 1. chrome://extensions/
# 2. Enable Developer mode
# 3. Load unpacked → select project directory
# 4. After changes: click refresh icon on extension card
```

## Testing

Manual testing only - navigate to a Sidekiq Enterprise queues page and verify:
1. Controls appear near page header
2. Confirmation dialogs work
3. Status updates during operation
4. Page refreshes after completion
5. Check console for `[SQKS]` logs

## Code Style

- Vanilla JavaScript (no build step, no dependencies)
- IIFE wrapper for isolation
- Async/await for fetch operations
- Descriptive function names
- Safety comments where relevant

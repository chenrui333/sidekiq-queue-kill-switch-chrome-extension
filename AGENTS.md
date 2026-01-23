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

### Convergence Loop
Sidekiq UI has eventual consistency - queue state may not update immediately after POST.
The extension handles this with a verification + retry loop:
- After each pass, re-fetches page HTML to check which queues still need action
- Retries remaining queues up to MAX_PASSES (5)
- Jittered delay between passes (1500-3500ms) to let server state settle
- Jittered delay between individual requests (250-900ms)
- Error backoff with jitter (2000-4000ms) after failed requests

### CSRF Token Handling
Rails CSRF protection requires two tokens:
- **Body param**: `authenticity_token` from form's hidden input (per-form)
- **Header**: `X-CSRF-Token` from page's `meta[name="csrf-token"]` (page-wide)

The extension uses the meta token for headers (Rails validates against this) and form token for body.
On 403 Forbidden, it refreshes tokens by re-fetching the page and retries once - if still 403,
it's likely a permission/RBAC issue rather than CSRF.

### Safety Rules
1. **Never send delete parameter** - Multiple guards at every level
2. **ALLOWED_ACTIONS allowlist** - Only 'pause' and 'unpause' permitted
3. **Read button state from DOM** - Don't hardcode pause/unpause values
4. **Use page's CSRF tokens** - Meta token for header, form token for body
5. **Rate limit requests** - Jittered delays (250-900ms) between POSTs
6. **Single retry on 403** - Refresh tokens once, then treat as permission error

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

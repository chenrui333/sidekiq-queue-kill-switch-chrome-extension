# Sidekiq Queue Kill Switch

A Chrome extension (Manifest V3) that adds **Pause All** and **Unpause All** controls to the Sidekiq Enterprise Queues page. Designed for oncall use.

## Features

- **Pause All Queues**: Stops all queue processing with a single click
- **Unpause All Queues**: Resumes all paused queues
- **Safe**: Never deletes queues - only pauses/unpauses
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

## Screenshots

The extension adds controls that look like this:

```
┌─────────────────────────────────────────────────────────────┐
│ [Pause All Queues] [Unpause All Queues]  Status: Ready      │
└─────────────────────────────────────────────────────────────┘
```

During operation:
```
┌─────────────────────────────────────────────────────────────┐
│ [Pause All Queues] [Unpause All Queues]  Pausing 5/12...    │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

The extension:

1. Detects the Sidekiq Queues page by looking for `table.queues`
2. Enumerates all queue forms in the table
3. For each queue, submits the same POST request that the Pause/Unpause button would send
4. Uses the page's authenticity token (CSRF protection)
5. Rate-limits requests (150ms delay) to avoid server overload
6. Refreshes the page to show updated state

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
- The CSRF token may have expired - reload and try again

### Some queues fail to pause/unpause

- Check the browser console for detailed error messages
- The queue may require special permissions
- Network issues can cause intermittent failures
- The extension will report success/fail counts

### Actions don't seem to take effect

- The page should auto-refresh after completion
- If not, manually refresh to see updated state
- Check server logs for any backend errors

## Development

### Project Structure

```
sidekiq-queue-kill-switch/
├── manifest.json          # Chrome extension manifest (v3)
├── src/
│   ├── contentScript.js   # Main extension logic
│   └── contentScript.css  # Styling for controls
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/
│   └── package.sh         # Build script for distribution
├── README.md
└── LICENSE
```

### Debug Logging

All console output is prefixed with `[SQKS]` for easy filtering:

```javascript
// In DevTools Console, filter by:
[SQKS]
```

### Making Changes

1. Edit files in `src/`
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Reload the Sidekiq page to test

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

## Contributing

Issues and pull requests welcome! Please ensure any changes maintain the safety-first approach - never delete queues.

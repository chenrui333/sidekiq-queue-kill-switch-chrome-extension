# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.4] - 2025-01-23

### Fixed
- Pause/Unpause All now reliably works with Sidekiq Enterprise 2.5.3
- Submit control selection now uses `name` attribute as primary selector (matches Rails form behavior)
- POST body now sends exact `name=value` pair from DOM attributes (e.g., `pause=Pause`)

### Improved
- Added observability logging: shows exact `name=value` pair being submitted for each queue
- Better error handling when submit buttons lack required `name` attribute

### Security
- Added validation that submit control has `name` attribute before processing

## [1.0.3] - 2025-01-23

### Fixed
- HTTP 403 Forbidden errors on bulk pause/unpause by adding Rails-compatible CSRF headers
- POST requests now include `X-CSRF-Token` header (required by some Rails CSRF strategies)
- POST requests now include `X-Requested-With: XMLHttpRequest` header
- Added proper `Referer` and `referrerPolicy` to mimic browser form submission

### Improved
- Enhanced error logging: on 403/error, logs response body (first 200 chars) and headers for debugging
- Changed `credentials` from `same-origin` to `include` for broader cookie handling

## [1.0.2] - 2025-01-23

### Fixed
- Button detection now finds action controls rendered as `<button>` elements, not just `<input type="submit">` (root cause of "only 5 queues paused" issue)
- Match buttons by `name`, `value`, or `textContent` for broader compatibility with different Sidekiq UI versions

### Improved
- Human-like jittered delays between actions (250-900ms) and between passes (1.5-3.5s) for more natural request patterns
- Error backoff: waits 2-4s after failed requests before continuing
- Enhanced logging shows enumeration breakdown (total forms, actionable, already in state, delete-only, missing token)
- Fallback values for `submitName`/`submitValue` when buttons lack explicit attributes

### Security
- Extended delete guards to check button `textContent` in addition to `name` and `value` attributes
- Uses `includes('delete')` check for broader protection against delete-like controls

## [1.0.1] - 2025-01-23

### Fixed
- Reliability issue where some queues were missed during bulk pause/unpause due to Sidekiq UI eventual consistency

### Added
- Convergence loop that verifies and retries until all queues reach desired state (up to 5 passes)
- Fresh page state fetching between passes via fetch() + DOMParser
- Pass progress in status indicator (e.g., "Pass 2/5: Pausing 1/3")
- Early exit when all queues already in desired state
- ALLOWED_ACTIONS allowlist for explicit action type validation

### Changed
- Status now shows number of passes used on success (e.g., "Done: All queues paused (2 passes)")
- Improved error reporting for incomplete operations

### Security
- Added additional delete guards at multiple code levels

## [1.0.0] - 2025-01-23

### Added
- Initial release
- "Pause All Queues" button to pause all Sidekiq queues at once
- "Unpause All Queues" button to resume all paused queues
- Confirmation dialogs before mass actions
- Progress indicator showing operation status
- Auto-refresh after completion
- Safety guards preventing accidental queue deletion
- Rate limiting (150ms delay) to avoid server overload
- Console logging with `[SQKS]` prefix for debugging

### Security
- Never sends delete parameters
- Reads button state from DOM (no hardcoded values)
- Uses page's CSRF token for authentication
- Same-origin requests only

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
## [1.3.2] - 2025-01-24

### Removed
- Remove parse-har.js helper script (no longer needed)

## [1.3.1] - 2025-01-24

### Fixed
- Remove accidentally committed test files

## [1.3.0] - 2025-01-24

### Changed
- Simplified delays now that CSRF is disabled on server (100ms between POSTs, 500ms between passes)
- Removed jittered/randomized delays (no longer needed for CSRF workarounds)

### Removed
- HAR-like resource trace collection (no longer needed for debugging)
- Auto-download of run diagnostics logs (no longer needed)
- 403-specific extra delays and backoff logic
- Error backoff delays (server is reliable without CSRF)

## [1.1.3] - 2025-01-24

### Fixed
- Accept empty authenticity_token values when CSRF is disabled on server (ref: [sidekiq/sidekiq#6739](https://github.com/sidekiq/sidekiq/issues/6739))
- Changed token validation from falsy check to null check to support empty string tokens

## [1.1.2] - 2025-01-24

### Fixed
- Treat iframe responses without queues table as failures and trigger refresh retry
- Rebuild actionable list after native form success using iframe response

## [1.1.1] - 2025-01-24

### Added
- Native form submit mode with hidden iframe target for queue actions
- HAR parser helper script for request pattern verification
- Auto-download per-run diagnostics (logs + submission trace)
- Include lightweight HAR-like resource trace in run logs

### Changed
- Bulk actions prefer native form submits before fetch/XHR fallback

## [1.0.9] - 2025-01-24

### Added
- Extended CSRF header token discovery (meta param, inline script, data-csrf, response header)
- Form-like POST fallback when header CSRF token is missing
- Evidence-based 403 classification (LOGIN/CSRF/RBAC/UNKNOWN)
- Pass 1 preflight refresh when header token is missing

### Changed
- Refresh strategy now rebuilds actionable queues in the same pass after token refresh
- POST success classifier recognizes form-like 200 responses with queue table
## [1.0.8] - 2025-01-24

### Added
- DEBUG_LEVEL logging controls (0 quiet, 1 summary/errors, 2 verbose per-queue)
- POST/GET diagnostics: CSRF token prefixes, request/response metadata, success classifier
- Session invalidation hard-stop when login page detected on GET or POST

### Changed
- Success classification now treats 302 with safe same-origin redirect as success and avoids login-page 200s
- Normalized actionPathKey to prevent refresh map mismatches
- Added 403-aware pacing backoff and optional live DOM recheck to reduce redundant POSTs

### Fixed
- Refresh + retry now rehydrates tokens atomically from a single page fetch with consistent keying

## [1.0.7] - 2025-01-23

### Changed
- **REVERTS v1.0.6**: Restores v1.0.5 CSRF model as foundation with additional hardening
- Header CSRF token now ONLY comes from page-global sources (meta tag or script-embedded)
- Hidden form inputs are NEVER used for header token (they are per-form masked tokens)
- Re-enabled `X-Requested-With: XMLHttpRequest` header (Rails expects this for AJAX)
- Uses `redirect: 'manual'` to properly detect 302 redirects as success

### Added
- `getHeaderCsrfToken(doc)` with conservative script-embedded token discovery patterns
- Explicit "body-only mode" warning when no header CSRF token found
- Enhanced 403 diagnostics: distinguishes CSRF mismatch vs session issue vs RBAC
- Summary line in logs: `passes=?, ok=?, initial403=?, retriedOk=?, refreshes=?, headerCsrfSource=?`
- `Origin` header (best-effort) to reduce CSRF false negatives
- `setCookie` presence in response headers for diagnostics

### Fixed
- Separation of concerns: body token (form hidden input) vs header token (meta/script)
- Per-pass token refresh: first 403 triggers refresh+retry, subsequent 403s deferred to next pass

### Removed
- `hidden_input` fallback for header CSRF token (caused mismatches)
- `CSRF_REQUEST_MODE` constant (always use XHR mode now)

## [1.0.6] - 2025-01-23

### Changed
- Switched to "form mode" CSRF (removed `X-Requested-With: XMLHttpRequest` header) to reduce 403s
- Per-pass token refresh strategy replaces per-queue refresh (max 1 refresh per pass)
- Broadened CSRF token discovery: tries `meta[name="csrf-token"]` first, then any `input[name="authenticity_token"]`

### Added
- `CSRF_REQUEST_MODE` constant for form vs xhr mode control
- `resolveHeaderCsrfToken(doc)` helper for multi-source token discovery
- `buildQueueTokenMap(doc, actionType)` for efficient per-pass token refresh
- Enhanced stats logging: `initial403Count`, `retrySuccessCount`, `tokenRefreshCount`

### Fixed
- Reduced initial 403 errors by mimicking browser form submission behavior
- Eliminated redundant per-queue page fetches on 403 retry

### Improved
- Logging now shows token source (`meta` vs `hidden_input`) and CSRF request mode
- Better diagnostics for debugging token-related issues

## [1.0.5] - 2025-01-23

### Fixed
- HTTP 403 Forbidden on bulk pause/unpause when CSRF tokens rotate after first request
- Now uses meta tag CSRF token (`meta[name="csrf-token"]`) for `X-CSRF-Token` header (Rails standard)
- Form hidden input token used for POST body `authenticity_token` param

### Added
- `getMetaCsrfToken(doc)` helper to read Rails meta CSRF token
- Automatic 403 retry with fresh token refresh (at most one retry per queue)
- Enhanced logging distinguishing CSRF vs permission/RBAC rejections
- Token diagnostics: logs whether meta token was found and token prefixes

### Changed
- `getActionableQueues()` now returns `formToken` + `headerToken` separately
- `submitQueueAction()` refactored with `doQueuePost()` helper for cleaner retry logic
- On 403 retry, re-fetches page and re-locates form to get fresh tokens

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

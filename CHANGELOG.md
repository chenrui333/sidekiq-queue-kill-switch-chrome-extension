# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

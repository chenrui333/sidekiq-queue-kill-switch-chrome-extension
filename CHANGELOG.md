# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

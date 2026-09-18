# Changelog
## Unreleased
- Added real API-backed English/Turkish device, catalog, user, custom-role, API-key and audit management.
- Added TOTP setup/recovery display, cookie authentication and rotation.
- Added lazy-loaded xterm terminal, WebRTC negotiation, desktop video and input controls.
- Verified Chrome-to-Rust-agent enrollment and real terminal command/output.
- Verified actual macOS ARM64 desktop video and isolated mouse/keyboard input; fixed video letterbox coordinate mapping and fail-closed backpressure.

### Administration completion — 2026-09-16
- Paged lists, session management, device disable/re-enable, explicit clipboard text controls and fresh HTTPS/WSS acceptance. See docs/changes/2026-09-16-session-paging-and-tls.md.

## 2026-09-16 — explicit device controls
- Group access editor, confirmed reboot request and localized outcomes.
- Explicit two-way text clipboard with pending-read timeout and clear-on-close.
- Native clipboard acceptance restores the original pasteboard without logging it.

## 2026-09-16 — audio and desktop interactions
- System-audio track, mute/volume, capability-aware controls and live display picker.
- Explicit native copy/cut/paste and file picker/drop/paste with verified transfer, progress and cancellation.
- Five unit tests and combined real browser/agent acceptance passed on macOS.

- Fixed file channel replacement, send-error cleanup, malformed listings and cancellation races; added three regression tests.

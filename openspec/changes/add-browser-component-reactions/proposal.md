## Why

Component reactions currently work only in Vibecheck-owned Electron/CEF
renderers, so the same `Control-Option-R` workflow stops at ordinary browser
tabs. The browser experiments proved that the production selector works in
Chromium and WebKit, while also proving that browser automation transports are
not an acceptable production path for a user's normal Chrome or Safari
session: Chrome isolates debuggable profiles and SafariDriver blocks physical
pointer interaction in its automation window.

## What Changes

- Add a production browser-extension transport for webpage content in Chrome
  and Safari, backed by the existing Electron component-reaction coordinator.
- Reuse one production renderer controller and event contract across Electron,
  Chrome, and Safari instead of copying the selector into browser-specific
  implementations.
- Keep the extension controller installed but dormant while component
  reactions are disabled, paused, or Vibecheck is not reachable.
- Extend the existing global capture session, emoji recents, clipboard bundle,
  screenshot, and zero/one/many Codex routing semantics across attached browser
  tabs.
- Capture a clean visible-tab image in the browser extension, crop it to the
  validated component bounds, and deliver the PNG with the commit event.
- Add authenticated, loopback-only browser-host transport with bounded
  messages, origin/session validation, reconnect behavior, and stale-document
  settlement protection.
- Package a Chrome-compatible WebExtension and a signed Safari Web Extension
  from production-owned sources, with explicit setup/permission state rather
  than silently changing a user's browser profile.
- Report browser attachment and setup failures through the existing component
  reaction status without making an unavailable optional browser disable
  healthy Electron targets.
- Keep browser experiments as evidence only. Production source, builds, tests,
  and packages do not import or execute anything under `experimentation/`.

## Capabilities

### New Capabilities

- `browser-component-selection`: Browser-tab attachment, dormant/active
  controller behavior, global shortcut and capture-session semantics, clean
  browser screenshots, commit settlement, and Chrome/Safari parity.
- `browser-extension-delivery`: Secure host transport, extension lifecycle,
  browser permission/setup behavior, production packaging, source
  independence, and release verification.

### Modified Capabilities

None. The existing component-reaction change is not yet archived into the main
spec set; this change consumes its production host contracts and adds browser
capabilities without weakening them.

## Impact

- Electron main process component-reaction services and runtime status
  projection.
- The production renderer controller, which becomes transport-neutral while
  retaining its self-contained CDP installation form.
- New production browser extension sources, browser-host protocol, and focused
  tests under `src/electron`.
- Native macOS packaging for the Safari Web Extension and signing/notarization
  verification.
- Electron dependencies and build scripts needed to bundle browser assets.
- No changes to camera inference, emotion heartbeat/freshness behavior,
  passive-expression policy, clipboard semantics, or Rust Codex mutation
  ownership.

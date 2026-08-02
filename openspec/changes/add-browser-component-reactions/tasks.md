## 1. Shared renderer boundary

- [x] 1.1 Extract the self-contained renderer bootstrap into a production export that CDP can stringify and browser content code can invoke directly
- [x] 1.2 Define a transport-neutral reaction source/context with capture and settlement operations
- [x] 1.3 Adapt the CDP service and reaction coordinator to the normalized context without changing existing behavior
- [x] 1.4 Add regression tests proving existing CDP commits, toggles, capture, recents, and settlement still use one serialized policy path

## 2. Browser protocol and host

- [x] 2.1 Add exact-key browser protocol types and validators for handshake, tab inventory, commit-with-capture, host snapshot, settlement, and disposal
- [x] 2.2 Implement a loopback-only bounded WebSocket host with extension-origin checks, challenge authentication, connection lifecycle, and duplicate-event rejection
- [x] 2.3 Implement validated PNG data-URL decoding, scale reconciliation, viewport clipping, and component crop through Electron native image APIs
- [x] 2.4 Normalize accepted browser commits and capture-session toggles into the shared reaction coordinator
- [x] 2.5 Broadcast authoritative enabled state, global capture session, recents, settlements, and shutdown to browser connections
- [x] 2.6 Add host unit/process tests for bind failure, invalid origins, incompatible versions, authentication failure, oversized/malformed frames, duplicate events, reconnect, and bounded shutdown

## 3. Browser extension runtime

- [x] 3.1 Add a production content entry that installs the shared controller in permitted frames and forwards only validated controller events
- [x] 3.2 Add a background compatibility layer for Chrome and Safari runtime, tabs, sender identity, storage, and visible-tab screenshot APIs
- [x] 3.3 Implement one authenticated reconnecting background connection with bounded exponential backoff and complete state reconciliation
- [x] 3.4 Implement trusted tab/frame/document routing, visible-tab capture, stale navigation rejection, and matching settlement delivery
- [x] 3.5 Add a least-privilege Manifest V3 definition with all-frame permitted-page injection and owned browser assets
- [x] 3.6 Add extension contract tests for dormant mode, handshake/state ordering, sender identity, screenshot failure, navigation, service-worker restart, stale settlement, and cleanup

## 4. Component service and status integration

- [x] 4.1 Start browser-host ownership beside desktop ownership without coupling it to Python or sensor startup
- [x] 4.2 Synchronize effective enablement, global session identity, and Vibecheck emoji recents to both CDP and browser transports
- [x] 4.3 Extend component runtime/public state with browser transport and attached-tab status while preserving private endpoint fields
- [x] 4.4 Keep the single top-level component-reaction menu row and summarize combined attachment state without adding a status submenu
- [x] 4.5 Preserve additive health so an absent extension is normal and a real browser transport failure does not disable healthy Electron interaction
- [x] 4.6 Add menu, protocol, preference, and service tests for browser listening, connected, degraded, pause, disable/re-enable, and shutdown states

## 5. Browser setup and native integration

- [x] 5.1 Add explicit menu actions for Chrome extension setup and Safari extension preferences without changing browser settings
- [x] 5.2 Add a fixed typed native companion command that opens Safari preferences for the packaged extension identifier
- [x] 5.3 Validate packaged browser asset paths and make setup failures bounded component diagnostics
- [x] 5.4 Add native protocol and Electron action tests for supported setup operations, invalid commands, and missing assets

## 6. Production builds and packaging

- [x] 6.1 Add a dedicated Vite browser-extension build from production TypeScript with deterministic filenames and no source maps
- [x] 6.2 Build the Chrome-compatible extension directory as part of development, package, make, and end-to-end commands
- [x] 6.3 Add a macOS build step that converts the production WebExtension into a Safari Web Extension and stages its `.appex`
- [x] 6.4 Embed the Safari extension in `Contents/PlugIns` before signing and apply least-privilege nested-code entitlements
- [x] 6.5 Extend release and production-independence guards to verify browser assets, Safari identity/signature/entitlements, and absence of experimental or local paths
- [x] 6.6 Add build tests that succeed with experimental directories unavailable and inspect deterministic Chrome/Safari outputs

## 7. Browser integration verification

- [x] 7.1 Add an isolated Chromium fixture suite covering exact text, DOM selection, physical-equivalent shortcut, click suppression, emoji commit, clean cropped PNG, and receipt
- [x] 7.2 Cover cross-origin frames, new tabs, full navigation, restricted pages, global cross-transport sessions, stacking reset, recents, reconnect, and app shutdown
- [x] 7.3 Add a protected signed Safari acceptance harness for physical keyboard/pointer interaction, site denial, navigation, disable/re-enable, and Vibecheck quit
- [x] 7.4 Prove browser setup and deliberately slow browser-host failure do not start camera work, delay the startup-first loading heartbeat, or change the centralized 1.5-second freshness default
- [x] 7.5 Run TypeScript format/typecheck/unit tests, native tests, focused Python topology/heartbeat tests, Chromium integration, production-independence checks, and package smoke verification

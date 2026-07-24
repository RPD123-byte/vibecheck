## 1. Baseline and Electron Workspace

- [x] 1.1 Record the current Python, Rust, process, visual, and opt-in live test commands and verify the supported production CLI remains a working rollback path before refactoring.
- [x] 1.2 Create the tracked `src/electron` Electron Forge workspace with TypeScript, main-process Vite bundling, a committed lockfile, pinned runtime/tool versions, and root development/build commands without React or a renderer.
- [x] 1.3 Configure a stable application name and provisional bundle identifier, single-instance behavior, `LSUIElement`, development Dock hiding, and macOS-only startup guards.
- [x] 1.4 Add repository guards and ignore rules for Electron build output, packaged artifacts, caches, and prohibited experimentation or vendored source dependencies.
- [x] 1.5 Add JavaScript formatting, type checking, main-process unit-test, Electron integration-test, and dependency-audit commands suitable for default CI without Apple credentials.

## 2. Mutable Feature State and Pure Topology

- [x] 2.1 Add validated mutable feature-state models for revision, notch enablement, named integration enablement, and session-local pause without moving threshold/model configuration out of immutable `RuntimeConfig`.
- [x] 2.2 Implement a pure topology mapper for off, notch-only, interruption-only, combined, and paused states and cover the complete matrix with deterministic unit tests.
- [x] 2.3 Refactor static worker construction into per-role specification builders while preserving existing commands, startup arguments, thresholds, freshness, demo inputs, and tagged Rust binary resolution.
- [x] 2.4 Refactor the supervisor to serialize topology reconciliation and apply the minimum start/stop diff without restarting unchanged worker PIDs.
- [x] 2.5 Start newly required consumers before first inference and stop removed consumers before final inference, preserving the startup loading-heartbeat invariant and camera release behavior.
- [x] 2.6 Track intentional-stop generations, cancel obsolete restart/backoff work, and prove intentional feature disablement never increments crash counters or triggers worker recovery.
- [x] 2.7 Make interruption-status absence expected while interruption is disabled and dynamically reconnectable without restarting or blanking an active notch.
- [x] 2.8 Map existing normal, display-only, demo, and dry-run CLI modes onto initial feature state and the shared reconciler with compatibility tests.

## 3. Python Control Protocol and Server

- [x] 3.1 Define versioned bounded JSON Lines schemas and fixtures for bootstrap, `get_state`, atomic `set_features`, stale revision, recovery, shutdown, acknowledgement, authoritative snapshot, and structured error messages.
- [x] 3.2 Bind `control.sock` with mode `0600` inside the existing fresh `0700` runtime directory before feature workers start and emit one bounded structured bootstrap record with runtime ID and endpoint.
- [x] 3.3 Implement exact message validation, maximum frame enforcement, correlation IDs, monotonic revisions, idempotent retry, and rejection of stale or authority-expanding requests.
- [x] 3.4 Publish desired state, effective roles, readiness, freshness, restart counts, structured errors, and aggregate state after every accepted mutation and material transition.
- [x] 3.5 Implement authenticated controller-session ownership and the default five-second reconnect grace followed by graceful worker shutdown and owner exit.
- [x] 3.6 Implement bounded recovery of failed worker roles without exposing arbitrary process names, paths, commands, or configuration mutation to Electron.
- [x] 3.7 Add unit and process tests for socket ownership/permissions, bootstrap, malformed and oversized input, stale revisions, retry idempotency, concurrent mutations, disconnect/reconnect, and shutdown cleanup.

## 4. Rust Graceful Disable

- [x] 4.1 Add explicit SIGTERM and SIGINT handling that moves the interruption worker into observable `stopping` state and prevents new policy dispatches.
- [x] 4.2 Represent serialized Codex dispatch activity so idle shutdown exits promptly while in-flight shutdown drains or conservatively resolves the interrupt/replacement sequence within a bounded deadline.
- [x] 4.3 Ensure graceful exit closes the emotion subscription, status publisher, Codex control resources, and status socket without quitting or relaunching Codex.
- [ ] 4.4 Add Rust tests for idle signal shutdown, signal-before-dispatch, signal during stop confirmation, signal during replacement start, timeout escalation state, and rejection of new actions after drain begins.
- [x] 4.5 Add a process integration test proving Python intentional disable waits for Rust drain, reports `stopping` then `disabled`, and preserves unrelated worker PIDs.

## 5. Electron Main-Process Runtime Client

- [x] 5.1 Implement Python-owner launch from a configured development or packaged executable path without allowing menu-supplied commands, paths, or environment overrides.
- [x] 5.2 Parse only bounded structured bootstrap records, connect to the advertised private Unix socket, validate protocol/runtime identity, and surface bootstrap timeout or process exit as structured failure.
- [x] 5.3 Implement the revision-aware runtime client for state subscription, atomic feature mutation, recovery, and graceful shutdown with reconnect and request timeout behavior.
- [x] 5.4 Persist only notch and Codex enable preferences, default both off on first launch, keep pause session-local, and reapply preferences after a new owner connection.
- [x] 5.5 Add bounded top-level Python-owner restart with fresh runtime directories, no overlapping owners, backoff/rate limits, and terminal explicit-recovery state.
- [x] 5.6 On Electron quit, request Python shutdown, await acknowledgement and exit, then escalate only against the validated owned Python process after the deadline.
- [x] 5.7 Add main-process unit tests with fake child and socket peers for bootstrap, revision conflict, crash recovery, stale messages, quit, menu rebuild, and prevention of arbitrary subprocess launch.

## 6. Native Menu-Bar Menu

- [x] 6.1 Create the macOS template tray icon, tooltip, and native `Menu` surface with no `BrowserWindow`, ordinary startup window, renderer process, or Dock item.
- [x] 6.2 Let macOS own native-menu placement, focus, dismissal, keyboard navigation, display selection, and Space behavior without custom positioning code.
- [x] 6.3 Keep all menu construction and fixed action callbacks in Electron main with no preload, renderer, navigation, remote content, or renderer IPC surface.
- [x] 6.4 Implement native menu items for aggregate status, on-device camera state, `Show notch`, `Codex interruption`, temporary pause/resume, conditional recovery, and quit.
- [x] 6.5 Project `Off`, `Starting`, `Active`, `Paused`, `Needs Permission`, `Degraded`, and `Failed` from authoritative state while preserving enabled checkmarks during loading and failure.
- [x] 6.6 Ensure the native menu never displays expression names, confidence scores, frames, conversation contents, interruption messages, or Codex thread lists.
- [x] 6.7 Add main-process menu-template tests for every state and control, pending actions, permission errors, partial failure, pause preservation, recovery, and privacy field exclusion.
- [x] 6.8 Add Electron integration tests for single-instance behavior, no Dock presence, zero `BrowserWindow` instances, native menu action routing, and runtime survival when the menu is dismissed.

## 7. Dynamic End-to-End Verification

- [x] 7.1 Add real-process tests for every directed transition among off, notch-only, interruption-only, combined, and paused topology states.
- [x] 7.2 Assert unchanged inference and consumer PIDs across minimal transitions and verify final disable releases the camera/model process while retaining the control owner.
- [x] 7.3 Exercise rapid toggle churn, duplicate mutations, mutation during backoff, consumer crash during disable, inference restart continuity reset, and controller loss without orphan processes.
- [x] 7.4 Launch Electron main against the real Python demo runtime and verify UI intent, Python reconciliation, notch headless projection, Rust dry-run state, pause/resume, and safe quit end to end.
- [x] 7.5 Run the opt-in live Codex fixture with interruption enabled/disabled around an active action and prove Vibecheck shutdown leaves the Codex GUI and shared daemon running.
- [x] 7.6 Preserve existing real-model, freshness/loading, visual notch, source guard, Rust policy, and lifecycle regression suites as gates for the Electron feature.

## 8. Frozen Runtime Packaging

- [x] 8.1 Spike and document a relocatable onedir frozen Python build from a clean environment, falling back from PyInstaller only if real dependency collection cannot be made reliable.
- [x] 8.2 Add explicit collection hooks and resource lookup for EmotiEffLib, ONNX Runtime, OpenCV, PyObjC/AppKit/AVFoundation, the arm64 Rust interruption binary, and only the selected `enet_b0_8_best_afew.onnx` model with its Apache-2.0 notice.
- [x] 8.3 Package the frozen runtime beneath Electron `Contents/Resources`, resolve it through `process.resourcesPath`, and prevent development interpreter/repository fallback in packaged mode.
- [ ] 8.4 Inventory every Mach-O executable, dynamic library, native extension, helper, and framework in the final bundle with file type, architecture slices, identifier, and signing status.
- [ ] 8.5 Run real image inference, notch startup, Rust dry-run, dynamic toggles, pause, and quit using only the packaged runtime and bundled model assets with network disabled.
- [ ] 8.6 Measure packaged cold start, loading heartbeat, idle-off resources, active resources, app size, compressed DMG size, and largest components; establish an accepted arm64 preview size budget without weakening freshness or privacy behavior.

## 9. Developer ID Signing and Permissions

- [ ] 9.1 Register and document provisional bundle identifier `com.rithvikprakki.vibecheck`, retrieve the Team ID and Developer ID Application certificate associated with the user's Apple Developer membership, record arm64 as the first supported architecture, and select the protected release repository/environment without committing account email or credentials.
- [x] 9.2 Configure Electron Forge Hardened Runtime signing with secure timestamps, stable helper identifiers, and least-privilege main/child entitlements.
- [ ] 9.3 Make Electron main request camera access before enabling camera topology, add `NSCameraUsageDescription`, sign/entitle the nested helper as required, and block release unless clean-account tests show exactly one Vibecheck-owned prompt and Privacy identity.
- [ ] 9.4 Add the reviewed Apple Events entitlement and `NSAppleEventsUsageDescription` required by `codex-app-control`'s current ChatGPT `osascript` quit path; verify grant and denial without force-killing ChatGPT.
- [x] 9.5 Explicitly reject `get-task-allow`, unsigned executable memory, disabled library validation, and other broad exceptions unless a measured signed dependency and review allow a documented exception; retain JIT only for Electron roles that require it.
- [x] 9.6 Implement inside-out signing for custom Python/Rust/native code before Electron helpers and the outer app, and fail the release on any unsigned, ad-hoc, invalid, or architecture-mismatched Mach-O file.
- [ ] 9.7 Verify packaged camera grant, denial, persistence across a same-identity update, actionable `Needs Permission` state, and absence of Accessibility prompts in this release.

## 10. Notarization and Release Artifacts

- [x] 10.1 Configure protected macOS release CI with an ephemeral keychain, encrypted Developer ID material, scoped App Store Connect team API key, pinned signing tools, and no secret exposure to pull requests or forks.
- [ ] 10.2 Build the first arm64-only release candidate and produce one user-facing DMG plus a matching arm64 update-ready ZIP without implementing automatic updates or x64/universal merging.
- [ ] 10.3 Submit with `notarytool`, retain submission ID and full log, block on any rejection, staple accepted tickets, and checksum artifacts only after final stapling.
- [ ] 10.4 Run strict `codesign`, stapler, Gatekeeper, and disk-image verification against the final app, DMG, and ZIP and retain results as release evidence.
- [ ] 10.5 Install from the actual downloaded DMG on a clean supported Mac/account and verify Gatekeeper launch, menu-only behavior, camera grant/denial, packaged real inference, every feature transition, Rust drain, pause/resume, and Codex survival.
- [x] 10.6 Document direct Developer ID installation, privacy and permissions, supported architectures, troubleshooting, release verification, and why Mac App Store and automatic updates remain out of scope.

## 11. Final Quality Gate

- [ ] 11.1 Run Python lint/type checks and all default unit, protocol, process, model, visual, and source-guard tests from a clean clone without ignored planning or experimentation files.
- [x] 11.2 Run Rust formatting, linting, unit, process, dry-run, and opt-in live Codex verification against the pinned `codex-control` release.
- [x] 11.3 Run JavaScript formatting, type checking, dependency audit, main-process native-menu tests, Electron integration tests, and packaged zero-window/security assertions.
- [ ] 11.4 Verify no expression data, frames, conversation contents, release secrets, mutable runtime files, or development paths are persisted or included unintentionally.
- [ ] 11.5 Perform the protected signed/notarized clean-install release gate and record the exact app version, Electron/Python/Rust/model versions, architecture, notarization submission, and final artifact hashes.

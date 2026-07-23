## Context

Vibecheck currently exposes one terminal entry point. `RuntimeOwner` resolves a
frozen `RuntimeConfig`, creates a private per-launch directory, constructs a
static worker topology, starts consumers before inference, aggregates
structured health from worker stdout, restarts unexpected exits, and performs
bounded shutdown. Static `normal` and `display-only` modes cannot represent an
idle controller, interruption-only operation, temporary pause, or live
independent feature toggles.

The existing worker boundaries are intentional and remain valuable:

```text
                          emotion.sock
                  ┌──────────────────────────┐
                  ▼                          ▼
          Python AppKit notch       Rust Codex interruption
                  ▲                          │
                  └──── status socket ──────┘
                  ▲
                  │
           Python inference
```

The new product surface is macOS-first and menu-bar-only for this change, but
Electron is selected because later Vibecheck interfaces are expected to become
substantially richer. Electron must not absorb inference, AppKit rendering, or
Codex actions merely because it owns the user interface.

The first public distribution is an arm64-only direct Developer ID preview.
Notarization is an automated signing and malware-validation path for
Gatekeeper, not Mac App Store review. Direct distribution also preserves future
cross-application Accessibility work that would conflict with App Sandbox.

## Goals / Non-Goals

**Goals:**

- Give users a polished, menu-bar-only Electron controller with truthful
  desired and effective state.
- Enable and disable the notch and Codex interruption independently at runtime.
- Release the camera when no effective feature requires inference.
- Keep Python authoritative for worker topology, health, restart, and shutdown.
- Drain Rust safely when interruption is disabled during a Codex mutation.
- Prevent orphaned camera or interruption processes after Electron failure.
- Preserve the terminal CLI and all existing inference, notch, and interruption
  policy behavior.
- Produce a self-contained, signed, notarized, stapled, clean-machine-verified
  macOS release.

**Non-Goals:**

- A conventional main window, settings window, thread browser, expression
  history, confidence display, or current-expression menu item.
- Changing inference models, thresholds, smoothing, notch geometry, eligible
  interruption emotions, targeting, or Codex message content.
- Moving process supervision into Electron or calling Rust directly from the
  renderer.
- Mac App Store distribution, automatic updating, Windows/Linux parity, or
  universal-binary merging in the first implementation.
- Claude Code integration, selection/highlight conditioning, Accessibility
  permission, gaze tracking, or eye tracking.
- Persisting camera frames, expression readings, Codex conversation contents,
  or interruption messages in Electron.

## Decisions

### 1. Build an Electron Forge menu-bar shell with a custom popover

The tracked Electron package lives under `src/electron/` and uses Electron
Forge, TypeScript, React, and Vite. Electron main owns `Tray`, the hidden
popover `BrowserWindow`, the Python process, persistent preferences, and runtime
IPC. The sandboxed renderer owns only presentation. A narrow context-isolated
preload bridge carries typed state and user intent.

The app uses `LSUIElement` packaging metadata and hides its Dock presence in
development. The popover is created hidden, shown only after its first render,
anchored from current tray bounds, and repositioned after display changes. It
hides without being destroyed so closing the surface cannot alter runtime
lifetime.

Alternative considered: Electron native context menu. It is simpler but cannot
produce the intended Wispr-like status hierarchy or grow into richer web UI.

Alternative considered: a normal hidden-to-tray window. It leaves confusing
Dock/window lifecycle semantics and provides no benefit for this first surface.

### 2. Keep Python as the only worker-topology authority

Electron launches one Python owner. Python alone launches inference, notch, and
Rust interruption workers. Electron never receives arbitrary executable paths
from the renderer and never starts individual workers.

```text
Electron renderer
       │ narrow preload API
       ▼
Electron main ── control.sock ──▶ Python owner
                                      │
                           ┌──────────┼──────────┐
                           ▼          ▼          ▼
                       inference    notch    interruption
```

This preserves tested restart, signal isolation, runtime-directory, and Codex
ownership behavior. Moving supervision upward can be reconsidered only after
the dynamic Python reconciler reaches behavioral parity.

### 3. Separate immutable runtime configuration from mutable feature state

`RuntimeConfig` retains validated camera, model, threshold, timing, and policy
values. A separate mutable `FeatureState` contains:

```text
revision
notch_enabled
integrations.codex_enabled
paused
```

Electron persists only the two enable preferences. First launch defaults both
off so camera access and Codex mutation require deliberate user action. Pause
is session-local and never survives a complete quit.

Python reports both desired state and effective state. A toggle can therefore
remain on while its dependency is loading or failed, rather than lying by
silently reverting user intent.

### 4. Use a versioned declarative control socket

Python binds `control.sock` with mode `0600` inside its fresh `0700` runtime
directory, then emits one bounded structured bootstrap JSON record containing
the protocol version, runtime identifier, and endpoint. Electron reads
structured bootstrap only; human logs never establish readiness.

The socket uses bounded JSON Lines with exact message schemas, request IDs, and
monotonic desired-state revisions. Main requests are:

- `get_state`
- `set_features`
- `restart_failed_roles`
- `shutdown`

Python publishes authoritative snapshots after every accepted mutation and
material transition. `set_features` contains a full feature document rather
than imperative worker commands, making retry idempotent and preventing partial
topology updates.

Alternative considered: stdin/stdout for all control. It is sufficient for a
single child but makes bidirectional subscriptions, reconnection, framing, and
independent integration testing more fragile. Stdout remains bootstrap-only.

Alternative considered: HTTP on localhost. It exposes an unnecessary network
listener and requires separate authentication and port discovery.

### 5. Make topology calculation pure and supervision reconciliatory

`topology.py` performs no I/O. It maps feature state to required roles:

| Notch | Codex | Paused | Required roles |
| --- | --- | --- | --- |
| off | off | false | none |
| on | off | false | inference, notch |
| off | on | false | inference, interruption |
| on | on | false | inference, notch, interruption |
| any | any | true | none |

The supervisor diffs required roles against effective roles and performs the
minimum transition. It builds worker specifications by role rather than
materializing one static dictionary at startup. Every worker carries an
intentional-stop generation so its monitor can distinguish disablement from
crash, cancel backoff, and avoid incrementing restart counts.

When moving from no workers, requested consumers start before inference so
existing reconnect and loading behavior spans model initialization. When the
last feature stops, consumers drain before inference releases the camera.
Adding or removing one consumer never restarts an already-required sibling.

### 6. Keep optional Rust status dynamically reconnectable

The notch receives a stable per-launch interruption-status path whenever it is
started. It treats an absent publisher as disabled when Python reports
interruption disabled, reconnects when Rust later binds, and never restarts
solely because interruption enablement changes. Python remains authoritative
for whether absence is expected or degraded.

### 7. Give Rust a bounded graceful-drain state

Rust adds explicit SIGTERM/SIGINT handling and a cancellation/drain state.
Shutdown immediately prevents `run_engine` from beginning another dispatch.
If idle, Rust publishes `stopping`, closes owned sockets, and exits. If dispatch
is between interrupt and replacement, it finishes or conservatively resolves
that serialized action within a worker-specific deadline before exit.

Python first requests graceful termination and marks the worker `stopping`.
Only after the deadline may it escalate against the validated Rust worker
process group. Escalation never targets Codex or its shared daemon.

Alternative considered: a persistent disabled Rust process. It makes topology
and health less truthful, retains Codex resources unnecessarily, and requires a
second Rust control protocol for no first-release benefit.

### 8. Tie Python lifetime to the Electron controller

Electron maintains the authenticated control session. If the main process
disappears and does not reconnect within five seconds, Python assumes ownership
was lost, drains workers, and exits. Closing or reloading only the renderer does
not affect the main-process session.

Electron supervises the Python owner with a separate bounded restart budget. A
new owner always creates a fresh runtime directory. Electron reapplies saved
feature preferences after reconnect. After repeated owner failure, it stops
automatic recovery and exposes one explicit restart action.

Graceful Electron quit sends `shutdown`, waits for acknowledgement and process
exit, then escalates only against the owned Python process if the bounded
deadline expires.

### 9. Project health; do not reconstruct it in JavaScript

Python aggregates desired state, effective roles, readiness, freshness,
restart counts, and structured failures. Electron main validates this state and
projects it to the renderer as `Off`, `Starting`, `Active`, `Paused`,
`Needs Permission`, `Degraded`, or `Failed`.

The renderer does not parse logs or infer dependency state. It displays no
expression, confidence, frame, thread list, or conversation content. Runtime
diagnostics remain structured and accessible to tests and conditional recovery
UI without becoming a first-release developer dashboard.

### 10. Freeze Python as an onedir sidecar and package one immutable release

The initial packaging path uses a PyInstaller-style onedir frozen runtime
rather than a user interpreter or onefile self-extraction. Onedir makes native
extensions and signing inventory explicit, avoids runtime executable
extraction, and simplifies model/resource discovery. The Rust executable and
read-only model assets are bundled into the frozen/runtime resource layout.

Electron Forge copies the frozen runtime under the application Resources
directory and resolves it through `process.resourcesPath`. The release bundles
only the selected `enet_b0_8_best_afew.onnx` asset, currently about 15 MB, plus
its Apache-2.0 notice rather than the roughly 1 GB development model checkout.
Release acceptance must execute real EmotiEffLib inference and worker launch
from that location. A packaging spike may replace PyInstaller only if it cannot
reliably collect EmotiEffLib, ONNX Runtime, OpenCV, PyObjC, and their native
dependencies.

The current development virtual environment is roughly 3 GB and is not a
release-size estimate. The first frozen arm64 build establishes a component
inventory and accepted compressed-DMG budget. The runtime remains bundled for
offline first use; a future separately versioned data strategy is considered
only if the measured artifact is operationally unacceptable.

Every component version belongs to one app version. Runtime downloads never
replace signed code, and future updates replace the entire app bundle.

### 11. Sign inside-out and use direct notarized distribution

Release builds run on protected macOS CI and use the provisional stable bundle
identifier `com.rithvikprakki.vibecheck`. The owning Apple Developer Team ID
must be read from the membership/certificate associated with the user's Apple
Developer account; the account email is not a Team ID and is never stored in
source. They sign custom Mach-O files and native extensions before Electron
helpers/frameworks and the outer app. An automated inventory fails on unsigned
nested code; `codesign --deep` is verification only, never the signing strategy.

The release uses Hardened Runtime, secure timestamps, and least-privilege
entitlements. Electron main requests camera authorization before it asks Python
to enter a camera-requiring topology, and the outer app provides the clear
`NSCameraUsageDescription`. The nested helper is signed and entitled as
required by the observed TCC responsibility chain. Clean-account testing must
prove that the prompt and Privacy settings identify Vibecheck exactly once; a
separate Python/helper identity blocks release.

The current `codex-app-control` supervisor invokes:

```text
/usr/bin/osascript -e 'tell application "ChatGPT" to quit'
```

That managed GUI restart is an Apple Event. The responsible signed Vibecheck
code therefore receives `com.apple.security.automation.apple-events` and the
outer app provides an `NSAppleEventsUsageDescription` limited to restarting
ChatGPT into managed-daemon mode. Grant and denial are both release-tested.
Replacing the AppleScript with a proven non-automation lifecycle API may remove
this permission in a later `codex-app-control` release, but the current package
cannot omit it honestly.

`get-task-allow`, disabled library validation, and unsigned executable memory
remain forbidden unless a measured dependency and explicit review justify a
documented exception. Modern Electron's required JIT entitlement is retained
only for the Electron helper roles that require it.

Electron Forge submits through `notarytool`, retains the log and submission ID,
staples the accepted ticket, and runs:

```text
codesign --verify --deep --strict --verbose=2
xcrun stapler validate
spctl -a -t exec -vv
hdiutil verify
```

The first user-facing artifact is one arm64 notarized/stapled DMG. A matching
arm64 ZIP preserves a future updater path, but automatic updates and x64 or
universal output are deferred until every nested native dependency is packaged
and verified deliberately.

Signing credentials exist only in protected secrets and an ephemeral CI
keychain. Untrusted pull requests cannot access them or publish releases.

### 12. Verify through protocol, process, UI, and delivered-container seams

Tests include:

- pure topology matrices, revisions, validation, and health projection;
- Python control-server permission, framing, stale revision, and disconnect
  tests;
- process transitions through all topology edges with PID preservation;
- Rust idle and in-flight graceful-drain tests;
- Electron main/preload/renderer unit tests with renderer security assertions;
- Electron integration against the real Python demo runtime;
- packaged real-model inference from application Resources;
- nested Mach-O signing inventory, notarization, and Gatekeeper verification;
- clean-account installation from the final downloaded DMG, camera
  grant/denial, feature toggles, pause/resume, quit, and Codex survival.

Existing production inference, notch visual, dry-run, and opt-in live Codex
tests remain release gates.

## Risks / Trade-offs

- **[Risk] Dynamic topology turns the current owner into a complex state
  machine** → Keep topology pure, mutations atomic and revisioned, transitions
  serialized, and exercise every topology edge with real processes.
- **[Risk] Disable arrives during a partially completed Codex mutation** → Stop
  new dispatch immediately, drain the serialized in-flight action, expose
  `stopping`, and use a bounded worker-specific deadline.
- **[Risk] Electron and Python disagree about state** → Python is effective-state
  authority; Electron persists only intent and always renders acknowledged
  revisions and authoritative snapshots.
- **[Risk] Electron crash leaves biometric processing active** → Tie Python
  lifetime to the authenticated controller connection and exit after a short
  reconnect grace period.
- **[Risk] Custom popover behaves inconsistently across displays and Spaces** →
  Anchor from live tray bounds, recalculate on display changes, and include
  multi-display/manual macOS acceptance.
- **[Risk] Frozen ML dependencies contain unsigned or architecture-specific
  native code** → Use onedir packaging, inventory every Mach-O file, build per
  architecture, and run real inference from the final signed app.
- **[Risk] Camera permission is attributed to an unexpected nested process** →
  Test grant, denial, persistence, and identity on a clean permission database
  before finalizing the minimal entitlement set.
- **[Risk] Managed GUI initialization creates a surprising automation prompt**
  → Explain the exact ChatGPT restart purpose, target only ChatGPT, handle
  denial without force, and remove the entitlement if `codex-app-control`
  later proves a non-Apple-Events lifecycle path.
- **[Risk] Frozen ML dependencies produce an excessively large preview** →
  Bundle only the selected 15 MB model, publish a component-size inventory,
  and accept a measured arm64 DMG budget before release.
- **[Risk] Electron increases idle resource usage** → Accept the cost for UI
  extensibility, keep the renderer surface small, and stop camera/model workers
  whenever no feature requires them.
- **[Trade-off] First release uses direct distribution rather than the Mac App
  Store** → Developer ID notarization supports the required subprocess and
  future Accessibility architecture without App Sandbox restrictions.

## Migration Plan

1. Introduce locked Electron tooling and a renderer-secure menu-bar shell that
   can run against a fake runtime without changing the supported CLI.
2. Split immutable configuration from mutable feature state, extract pure
   topology calculation, and make existing CLI modes select an initial desired
   state.
3. Add the private control server and authoritative snapshots, then connect
   Electron main while keeping the CLI rollback path.
4. Implement serialized reconciliation, intentional-stop semantics, optional
   status reconnect, and every topology transition test.
5. Add Rust graceful drain and live verification around disable-during-dispatch.
6. Add controller-loss cleanup, Python-owner recovery, persistent preferences,
   pause, and the final popover states.
7. Freeze the Python runtime and bundle the complete runtime under Electron
   Resources; exercise the real model from the packaged path.
8. Establish Developer ID CI signing, least-privilege entitlements,
   notarization, stapling, DMG/ZIP artifacts, and clean-install acceptance.
9. Release behind an opt-in preview. Rollback disables the Electron entry point
   and continues using the unchanged production CLI; it never reintroduces
   experimentation dependencies.

## Open Questions

- Team ID `YU57297F36` is confirmed. The remaining external release setup is
  creating/exporting the Developer ID Application identity and protecting the
  release repository environment; no Apple account email belongs in source.
- Which exact signed process macOS records as responsible when the bundled
  Python helper opens the camera? The required product result is fixed
  (Vibecheck owns one prompt); a clean signed-package spike determines the
  minimal entitlement placement.
- What compressed-DMG budget should be accepted after the first representative
  arm64 frozen build reports its component inventory?

## Primary Release References

- [Apple: Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple: Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Apple TN2206: macOS code signing](https://developer.apple.com/library/archive/technotes/tn2206/)
- [Apple: Camera authorization](https://developer.apple.com/documentation/avfoundation/requesting-authorization-to-capture-and-save-media)
- [Apple: Camera entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.camera)
- [Electron Forge: macOS code signing](https://www.electronforge.io/guides/code-signing/code-signing-macos)
- [Electron Forge: DMG maker](https://www.electronforge.io/config/makers/dmg)
- [Electron Forge: ZIP maker](https://www.electronforge.io/config/makers/zip)
- [`@electron/notarize`](https://github.com/electron/notarize)

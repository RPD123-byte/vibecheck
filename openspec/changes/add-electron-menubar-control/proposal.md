## Why

Vibecheck is currently operated through a static terminal command, so users
cannot see runtime health or independently enable the notch and Codex
interruption without restarting the complete process topology. A menu-bar-only
Electron surface can make the feature controllable and understandable now while
leaving room for a richer application interface later.

## What Changes

- Add a macOS menu-bar-only Electron application with no ordinary startup
  window or Dock presence, using a native macOS menu for Vibecheck state, notch
  enablement, Codex interruption enablement, temporary pause, conditional
  recovery actions, and quit.
- Add a versioned, owner-only local control protocol between Electron's main
  process and the Python runtime owner. Electron owns user-desired feature
  state; Python remains authoritative for effective topology, worker health,
  and action routing.
- Replace static all-or-display-only topology selection inside the long-lived
  Python owner with live reconciliation. Inference runs exactly when at least
  one enabled feature requires emotion readings, while notch and interruption
  workers start and stop independently.
- Add conservative intentional-stop and graceful-drain behavior so disabling a
  feature never enters worker crash recovery, and disabling interruption cannot
  terminate Rust between the Codex interrupt and replacement-turn operations.
- Preserve the existing inference stream, smoothing and thresholds, AppKit
  notch presentation, Rust interruption policy, Codex lifecycle isolation, and
  terminal CLI for development and recovery.
- Add packaging, signing, notarization, stapling, and release verification for
  a directly distributed macOS application containing the Electron runtime and
  all required Python and Rust executables.

## Capabilities

### New Capabilities

- `menubar-application`: Menu-bar icon, native macOS menu, feature
  controls, desired/effective state presentation, pause, failure recovery, and
  quit behavior.
- `runtime-feature-control`: Versioned Electron-to-Python control protocol,
  declarative feature state, topology reconciliation, independent worker
  lifecycle, aggregate health, and controller-loss shutdown.
- `macos-release-distribution`: Reproducible Electron application packaging,
  nested executable signing, permissions, hardened runtime, notarization,
  stapling, and release verification for direct macOS distribution.

### Modified Capabilities

None. The production runtime capabilities remain under the active
`productionize-expression-interruption` change; this change adds a new dynamic
control capability without weakening their existing inference, presentation,
interruption, or lifecycle requirements.

## Impact

- Adds an Electron Forge, TypeScript, and Vite main-process application under
  tracked production source, plus locked JavaScript dependencies and a native
  menu with no renderer or web-content surface.
- Refactors `vibecheck.runtime` into separable ownership, topology, control,
  supervision, feature-state, and health responsibilities while retaining its
  supported CLI entry point.
- Extends the Rust interruption executable with bounded graceful shutdown and
  observable drain state.
- Adds a Unix-domain control socket and structured bootstrap/state messages
  beneath the existing per-launch owner-only runtime directory; no network
  listener, camera frame, expression history, or conversation history is added.
- Introduces macOS application metadata, permissions descriptions,
  entitlements, signing/notarization configuration, release artifacts, and CI
  secret requirements.
- Depends on the runtime produced by `productionize-expression-interruption`;
  it does not import from or package the ignored experimentation directory.

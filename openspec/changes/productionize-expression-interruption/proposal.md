## Why

The proven facial-expression experiment is coupled into one prototype and cannot be shipped safely from `src/`. We need a production, entirely on-device implementation that keeps inference, notch presentation, and Codex interruption independently responsive while preserving the thresholds, temporal behavior, and lifecycle safety already validated experimentally.

## What Changes

- Move the production feature set into self-contained Python and Rust modules under `src/`, with no imports, path dependencies, runtime reads, or build inputs from `experimentation/`.
- Retain EmotiEffLib as the only inference adapter while preserving an explicit registry seam for future providers; remove DeepFace and Py-Feat from the supported feature set.
- Run camera capture and expression inference once, normalize each result, and publish freshness-sensitive readings to multiple local subscribers.
- Add a versioned Unix-domain-socket protocol with independent bounded delivery to the macOS notch and Rust interruption processes; stale readings are discarded rather than durably replayed.
- Run the macOS notch and expression interruption logic as sibling consumers so Codex action latency cannot delay presentation.
- Preserve the validated notch thresholds, hysteresis, smoothing, neutral suppression, latest active-left layout, and interruption feedback states; omit the experimental all-sides diagnostic layout from production.
- Build a Rust expression-interruption executable around `codex-control`, including negative-only eligibility, one-second hold, episode latching, cooldown, safe thread targeting, and conservative action-outcome handling.
- Add the first local runtime owner for this application, including startup ordering, health, restart, graceful shutdown, camera permission/error reporting, and safe Codex GUI lifecycle management.
- Add deterministic unit, protocol, process, dry-run, and live opt-in verification that does not depend on any experimental source file.

## Capabilities

### New Capabilities

- `emotion-inference`: On-device camera capture, EmotiEffLib adapter selection, face selection, normalized readings, and privacy-preserving inference lifecycle.
- `realtime-emotion-stream`: Versioned local fan-out of sequenced, timestamped, freshness-sensitive inference and status events to independent consumers.
- `macos-notch-presentation`: Responsive macOS notch rendering, display filtering, layout, and interruption-status feedback.
- `expression-interruption`: Rust-owned temporal policy and safe Codex turn interruption/restart behavior based on sustained negative expressions.
- `local-runtime-lifecycle`: Process ownership, configuration, health, restart, dry-run, and graceful shutdown requirements for the complete on-device runtime.

### Modified Capabilities

None. This repository has no existing OpenSpec capability specifications.

## Impact

- Python source will be reorganized into an installable `src` layout with explicit inference, stream, notch, and runtime modules.
- A Rust binary crate under `src` will consume `codex-control` `0.1.0` through the immutable Git tag `v0.1.0`; Cargo will verify the manifest version and `Cargo.lock` will pin the exact commit without requiring a sibling checkout.
- Runtime dependencies include EmotiEffLib, MTCNN/facenet-pytorch, OpenCV, PyObjC/AppKit/AVFoundation, Tokio, Serde, and `codex-control`; NATS and JetStream are intentionally excluded.
- The app will create local Unix sockets and child processes in a fresh owner-only per-launch runtime directory but will not persist camera frames or inference backlogs.
- Existing experimental files remain ignored reference material only and are not part of builds, tests, packaging, or runtime behavior.
- Native bundle selection, camera entitlements, code signing, and installer construction are deferred to a later release-packaging change.

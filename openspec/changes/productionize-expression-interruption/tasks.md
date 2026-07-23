## 1. Production Foundation

- [x] 1.1 Publish the current compatible `codex-control` package version `0.1.0` as immutable Git tag `v0.1.0`, verify the tag resolves to the intended tested commit, and record the release/tagging convention
- [x] 1.2 Add `pyproject.toml` with the installable `vibecheck` package, supported Python/macOS versions, production dependencies, development dependencies, and CLI entry point
- [x] 1.3 Create the `src/vibecheck` package hierarchy and move the existing schema, adapter interface, EmotiEffLib adapter, and registry without importing ignored source
- [x] 1.4 Add the `src/native/expression_interruption` Rust workspace/crate skeleton with a reproducible toolchain, `codex-control` Git tag `v0.1.0` plus exact manifest version `=0.1.0`, and a committed `Cargo.lock`
- [x] 1.5 Add a repository guard test that rejects tracked production imports, Cargo path dependencies, build inputs, or runtime lookups referencing `experimentation/` or `emotiefflib_repo/`
- [x] 1.6 Add shared test-fixture directories for protocol events, normalized model output, synthetic streams, and process scenarios

## 2. Configuration and Domain Schema

- [x] 2.1 Implement the typed central runtime configuration with every default and override named in the capability specs
- [x] 2.2 Add field-specific validation for thresholds, timing, camera, active-left optical overlap, event-size, socket, restart, and mode values without a notch-layout selector
- [x] 2.3 Extend the canonical emotion schema to include contempt and validate complete finite score distributions from 0.0 through 1.0
- [x] 2.4 Define producer state, inference event, interruption status, health, and structured error models without image payloads
- [x] 2.5 Add configuration serialization for the Rust worker and cross-language fixtures proving Python and Rust interpret shared values identically
- [x] 2.6 Add unit tests for defaults, explicit overrides, invalid combinations, canonical score validation, and deterministic emotion ordering

## 3. EmotiEffLib Inference Worker

- [x] 3.1 Refactor the registry so heavy provider imports and model construction happen only when the selected adapter is instantiated
- [x] 3.2 Harden the EmotiEffLib adapter to normalize all canonical scores and report invalid provider output without publishing it
- [x] 3.3 Extract bounded face-box normalization and largest-eligible-face selection into production code with deterministic tests
- [x] 3.4 Implement camera permission states and AVFoundation authorization before OpenCV worker capture
- [x] 3.5 Implement one-camera/one-model inference cadence using the newest available frame without overlapping or queuing inference calls
- [x] 3.6 Implement loading, active, no-face, permission, camera, and inference error state transitions including the 0.8-second no-face timeout
- [x] 3.7 Implement graceful adapter/camera release and verify close occurs once during cancellation and ordinary shutdown
- [x] 3.8 Add synthetic adapter and camera seams used only by production tests and demo mode
- [x] 3.9 Add privacy tests proving events and logs never contain image bytes or create frame/crop artifacts

## 4. Realtime Emotion Protocol and Fan-Out

- [x] 4.1 Define protocol-v1 JSON Lines schemas for inference, producer state, interruption status, and protocol errors
- [x] 4.2 Implement maximum-frame-size enforcement, required-field validation, unsupported-version rejection, and connection-local malformed-input handling in Python
- [x] 4.3 Implement the inference Unix-socket publisher with owner-only runtime paths and abandoned-socket safety
- [x] 4.4 Implement independent one-slot latest-event delivery for each subscriber without blocking inference or other subscribers
- [x] 4.5 Implement fresh current-state delivery on connect without historical replay
- [x] 4.6 Implement the Python subscriber with runtime/sequence validation, stale detection, cancellable exponential reconnect, and health reporting
- [x] 4.7 Implement matching Rust protocol parsing and reconnect/freshness behavior against the same fixtures
- [x] 4.8 Add fan-out tests for two consumers, dropped intermediate readings, slow/disconnected consumers, out-of-order events, runtime changes, malformed frames, and bounded memory
- [x] 4.9 Add security tests for socket permissions and safe handling of stale versus live endpoints

## 5. macOS Notch Worker

- [x] 5.1 Move pure display threshold, hysteresis, confirmation, reset, and deterministic sorting logic into `vibecheck.notch.display_policy`
- [x] 5.2 Move and test only the latest active-left notch geometry, including 32-point cells, 24-point glyphs, corner extensions, and configurable optical overlap; do not copy the experimental all-sides implementation into production
- [x] 5.3 Implement the separate AppKit notch worker with supported-screen detection and a non-activating transparent panel
- [x] 5.4 Connect the notch worker to inference snapshots and clear display state on no-face, stale input, disconnect, or producer restart
- [x] 5.5 Implement neutral suppression, single highest-scoring emotion selection, deterministic tie-breaking, two-reading show/switch confirmation, 0.30 entry, and 0.25 exit hysteresis
- [x] 5.6 Implement loading, permission, camera, protocol, stale-stream, and inference health presentation distinct from emotion icons
- [x] 5.7 Connect interruption status snapshots and implement in-progress, success/uncertain-success, bounded four-second sent, and error visual emphasis
- [x] 5.8 Implement timer/socket/panel cleanup and verify notch shutdown never targets ChatGPT
- [x] 5.9 Add screenshot/layout fixtures and a macOS visual acceptance check for active-left, empty, health, dispatch, and error states

## 6. Rust Interruption Policy

- [x] 6.1 Implement Rust protocol models and canonical selected-emotion validation using shared conformance fixtures
- [x] 6.2 Port negative-only strict-over-0.30 eligibility and deterministic score/name ordering into a pure policy module
- [x] 6.3 Implement one-second continuous hold using capture timestamps and reset on set changes, threshold dips, no-face, stale input, or runtime changes
- [x] 6.4 Implement one-dispatch-per-episode latching, one-second empty baseline rearm, and 15-second different-expression cooldown
- [x] 6.5 Implement snooze/reconsider behavior for no target or proven failures without immediate repeated dispatch
- [x] 6.6 Implement deterministic qualitative degree, adjective, natural joining, percentage rounding, and uncertainty-aware context message generation
- [x] 6.7 Add exhaustive unit tests for positive/neutral exclusion, exact threshold, multi-emotion sets, gaps, stale input, runtime reset, latch, rearm, cooldown, and message text

## 7. Codex Dispatch and Status

- [x] 7.1 Integrate the Rust worker with tagged `codex-control` `v0.1.0`, verify Cargo resolves package version `0.1.0` to the lockfile commit, and apply bounded reconciliation configuration
- [x] 7.2 Implement explicit-thread targeting and the default exactly-one-active-turn rule with no-active and multiple-active statuses
- [x] 7.3 Implement serialized interrupt, two-second stop confirmation, same-thread restart, and prevention of concurrent dispatches
- [x] 7.4 Implement Confirmed, Rejected, and OutcomeUnknown handling with the required latch/retry semantics
- [x] 7.5 Implement the non-durable interruption-status socket and independent bounded status publication
- [x] 7.6 Keep emotion input observation bounded and current while a Codex action is in flight
- [x] 7.7 Implement dry-run mode through the same parsing, freshness, policy, message, and status code paths without initializing Codex
- [ ] 7.8 Add Rust tests with a fake control adapter for targeting, stop confirmation, all action outcomes, serialized dispatch, and status ordering

## 8. Runtime Ownership and Recovery

- [x] 8.1 Implement the application's first runtime owner and supervisor; create a fresh `0700` `TMPDIR` directory with a `vibecheck-<uid>-` prefix per launch, use short socket names, pass absolute paths to workers, and clean up owned transient artifacts
- [x] 8.2 Implement aggregate readiness from worker lifecycle, terminal configuration errors, stream connection, and freshness state
- [x] 8.3 Isolate worker signal sessions and implement ordered SIGINT/SIGTERM shutdown through owned control paths
- [x] 8.4 Implement bounded worker shutdown deadlines and escalation only against validated Vibecheck worker PIDs
- [x] 8.5 Configure normal Codex startup restart through Launch Services and verify runtime shutdown leaves ChatGPT and the shared daemon running
- [x] 8.6 Implement per-role crash detection, bounded exponential restart with jitter, restart-rate limits, and terminal failed state
- [x] 8.7 Ensure inference restart creates a new runtime identifier and every consumer clears temporal state before accepting new readings
- [x] 8.8 Implement normal, synthetic demo, interruption dry-run, and display-only modes using production modules and protocol
- [x] 8.9 Add structured role-tagged health and diagnostics without using free-form logs as the readiness source

## 9. Integrated Verification

- [x] 9.1 Add a production dry-run end-to-end test from synthetic inference through both socket subscribers to notch state and Rust `would_send`
- [x] 9.2 Add a stale-stream end-to-end test proving disconnected time cannot complete an interruption hold and stale icons clear
- [ ] 9.3 Add a slow-dispatch test proving notch updates remain responsive while Rust awaits Codex outcomes
- [ ] 9.4 Add process lifecycle tests for arbitrary startup order, reconnect, individual worker crash/restart, Ctrl-C, shutdown timeout, and absence of broad process-tree signals
- [x] 9.5 Port experiment-derived threshold, layout, policy, and message cases into frozen production fixtures without importing experimental modules
- [x] 9.6 Add the opt-in live Codex fixture test with isolated thread creation, real interrupt/restart verification, conservative unknown handling, and unconditional cleanup
- [x] 9.7 Add a clean-clone CI job that installs declared dependencies, builds Python and Rust artifacts, runs all non-live tests, and confirms ignored directories are absent

## 10. Handoff and Release-Packaging Boundary

- [x] 10.1 Verify clean build outputs contain the Python package, Rust executable, protocol/config assets, and no experimental or biometric artifacts, without selecting a native bundler or installer
- [x] 10.2 Document runtime modes, configuration, privacy behavior, health states, safe shutdown, troubleshooting, opt-in live verification, and the deferred bundle/entitlement/signing/installation boundary
- [ ] 10.3 Perform a manual macOS acceptance run covering permission request, active inference, neutral clearing, notch smoothing, negative interruption, positive non-interruption, Ctrl-C, worker restart, and ChatGPT persistence
- [x] 10.4 Record benchmark baselines for inference cadence, event latency, notch update latency, memory bounds, and interruption decision timing on the target Mac
- [x] 10.5 Make the production CLI/app entry point authoritative and verify no supported workflow references the ignored prototype

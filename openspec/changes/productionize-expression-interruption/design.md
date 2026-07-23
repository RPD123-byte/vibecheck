## Context

The repository currently has a provider-neutral `EmotionReading`, an adapter interface, an explicit registry, and one EmotiEffLib adapter under `src/`. The complete behavior exists only in ignored experimental files: a Python process owns camera capture, model inference, AppKit notch rendering, and Rust subprocess I/O; a Rust executable owns temporal interruption policy and `codex-control` actions.

The experiment proved the product behavior but also exposed lifecycle coupling: display work, inference, and Codex dispatch shared one Python application; stdin was a single-consumer transport; and direct process ownership could couple Ctrl-C to ChatGPT. Production must preserve the validated behavior while making the tracked source buildable from a clean clone.

The system is macOS-first, single-user, entirely on-device, and low-rate: inference is approximately 6.25 readings per second by default. Emotion readings lose value rapidly and become dangerous when replayed late. Codex actions, by contrast, require conservative outcome handling because an uncertain write must not be duplicated.

## Goals / Non-Goals

**Goals:**

- Produce one normalized, privacy-preserving inference stream from one camera/model instance.
- Let notch presentation and Rust interruption consume independently without blocking each other.
- Preserve the proven thresholds, hysteresis, timing, latching, targeting, message, and GUI lifecycle behavior.
- Make stale data explicit and prevent disconnected time or historical replay from satisfying an interruption hold.
- Package all production Python, Rust, protocol, tests, and configuration without experimental path dependencies.
- Support deterministic demo/dry-run verification and an opt-in live Codex fixture.

**Non-Goals:**

- Eye tracking, gaze estimation, identity recognition, multi-user tracking, remote inference, or cloud synchronization.
- Durable emotion history, analytics, event replay, or biometric recording.
- NATS, JetStream, Kafka, Redis, or another external broker in the initial on-device runtime.
- DeepFace, Py-Feat, dynamic third-party plugin discovery, or multiple simultaneously loaded inference adapters.
- Automatic selection among multiple active Codex turns without explicit targeting.
- General cross-platform notch presentation.
- Native app-bundle selection, camera-entitlement ownership, code signing, installer construction, and release distribution. This change keeps build/runtime seams compatible with later packaging work but does not choose Briefcase, PyInstaller, or another packager.
- The experimental `all-sides` diagnostic notch layout or a production layout selector.

## Decisions

### 1. Use three sibling workers with one runtime owner

The runtime owner starts and supervises:

```text
                                local status socket
                        ┌──────────────────────────────┐
                        │                              ▼
┌──────────────────┐    │   ┌──────────────────┐   ┌──────────────────┐
│ Python inference │────┼──▶│ Python notch     │   │ Rust interruption│
│ camera + model   │    │   │ AppKit + filters │   │ policy + Codex   │
└────────┬─────────┘    │   └──────────────────┘   └─────────┬────────┘
         │              │                                    │
         └──────────────┴──────── emotion socket ────────────┘

                   ┌────────────────────────┐
                   │ Python runtime owner   │
                   │ config + supervision   │
                   └────────────────────────┘
```

Inference, presentation, and interruption are sibling workers because each has different latency and failure characteristics. The runtime owner coordinates process lifecycle but does not execute model inference, AppKit drawing, or Codex actions itself.

Alternative considered: keep one Python process with threads and embed/spawn Rust internally. This has fewer process edges but repeats the experiment's failure coupling and lets AppKit or Codex latency affect unrelated work.

Alternative considered: combine notch and interruption into one consumer. This removes one subscription but couples immediate display updates to slow or uncertain Codex actions and prevents independent restart.

### 2. Use Unix-domain-socket snapshot fan-out, not a durable queue

The inference worker hosts `emotion.sock` and accepts independent subscriber connections. Each connection has a one-event pending slot. If a subscriber falls behind, the newest event replaces its pending event. The publisher never waits for all subscribers before continuing inference.

The Rust worker hosts `interruption-status.sock`; the notch subscribes when enabled. Status is also non-durable because old visual feedback has no value after reconnect.

JSON Lines is selected for protocol version 1 because the event rate and payload are small, both Python and Rust support it directly, and fixtures remain human-readable. Each receiver enforces a maximum frame size. A future binary codec can be introduced only behind a new protocol version.

Alternative considered: NATS Core. It provides mature pub/sub and reconnects but adds a fourth daemon, packaging burden, and an availability dependency for a tiny local topology.

Alternative considered: JetStream. Acknowledgement and redelivery are counterproductive for emotion snapshots: replay can make the notch stale and can cause an interruption after the expression has ended. At-least-once delivery is also unsafe for Codex mutations unless coupled to additional idempotency.

Alternative considered: `multiprocessing.Queue`. A single queue distributes work to one reader instead of broadcasting the same event to both, while manually duplicating queues recreates broker and lifecycle behavior without a protocol seam.

### 3. Separate transient inference reliability from action reliability

Inference transport provides freshness, sequencing, bounded memory, current-state-on-connect, and reconnection, but no acknowledgement or replay. Events carry:

- `schema_version`
- `kind`
- `runtime_id`
- `sequence`
- monotonic `captured_at_ms`
- monotonic `published_at_ms`
- validated payload

Consumers reject unsupported versions, duplicate/out-of-order sequences, and stale events. A sequence gap or runtime identifier change resets every temporal policy. The freshness deadline is configurable, exceeds the inference interval, and defaults to 750 milliseconds. A retained current state may be sent to a new connection only while it remains within that deadline.

Codex action reliability remains inside `codex-control`. `Confirmed`, `Rejected`, and `OutcomeUnknown` have different retry semantics. An unknown write is latched and never blindly resent.

### 4. Make the Rust executable the interruption owner and consume a tagged Cargo package

The crate under `src/native/expression_interruption/` builds a long-lived executable. Cargo is the Rust package manager and build system, and `codex-control` is already a Cargo package in the `CodexWarden` workspace with manifest version `0.1.0`. Before integration, that repository SHALL publish its current compatible commit as the immutable Git tag `v0.1.0`. The interruption crate SHALL declare:

```toml
[dependencies]
codex-control = { git = "https://github.com/RPD123-byte/CodexWarden.git", tag = "v0.1.0", version = "=0.1.0" }
```

The Git tag provides the human release identity, the exact version requirement verifies the fetched package manifest, and the committed `Cargo.lock` records the exact resolved commit. Release tags MUST never be moved; incompatible changes require a new SemVer version and tag. Publishing the workspace to crates.io is not required for the initial integration because Cargo can resolve the tagged package and its sibling path dependencies from the Git workspace.

The executable connects to `emotion.sock`, hosts the status socket, evaluates policy, and performs Codex actions.

Python starts and supervises the executable once; it does not call Rust for each reading. This keeps Tokio, Codex transport, thread reconciliation, action correlation, and GUI supervision within Rust while isolating native failures from camera inference and AppKit.

Alternative considered: PyO3. Direct calls reduce serialization but require native Python wheel packaging, Tokio/Python runtime coordination, GIL discipline, and shared crash/shutdown ownership. At the current event rate, Unix-socket overhead is immaterial relative to model inference.

Alternative considered: Python reimplementation of Codex control. This would discard the tested action semantics and duplicate a complex library.

### 5. Keep one small adapter registry seam

Python source moves to a conventional package layout:

```text
src/
  vibecheck/
    emotion/
      schema.py
    inference/
      adapters/
        base.py
        emotiefflib.py
      registry.py
      process.py
    stream/
      protocol.py
      publisher.py
      subscriber.py
    notch/
      process.py
      display_policy.py
      layout.py
      appkit.py
    runtime/
      config.py
      health.py
      supervisor.py
      cli.py
  native/
    expression_interruption/
      Cargo.toml
      src/
        main.rs
        policy.rs
        protocol.rs
        dispatch.rs
```

The adapter registry remains explicit rather than using entry-point discovery. EmotiEffLib is the only registered adapter. Heavy provider imports and model construction occur only when the selected adapter is instantiated in the inference worker.

The canonical schema adds contempt because EmotiEffLib and interruption policy support it. Adapter normalization guarantees a complete canonical score set and prevents provider-specific names from leaking into consumers.

### 6. Preserve one primary-face policy

The initial feature represents the device owner, not a room of people. MTCNN detects candidate faces and the largest eligible bounded face is analyzed. This matches the experiment and prevents one frame from producing ambiguous multiple-user state.

Multi-face identity continuity is a future capability requiring tracking and user selection; it is not approximated here.

### 7. Preserve independent display and interruption temporal policies

Both consumers receive the same raw normalized scores and share the 0.30 entry/eligibility threshold, but their time behavior differs intentionally:

- Notch: select only the highest-scoring eligible non-neutral emotion, apply 0.25 exit hysteresis and two consecutive candidates to show or switch, and clear immediately on no eligible emotion/no-face/stale input.
- Interruption: same negative set continuously over 0.30 for one second, reset on any set change/dip/gap, one dispatch per episode, one-second baseline rearm, and 15-second cooldown between different dispatched sets.

The inference worker does not smooth scores. It publishes source-of-truth snapshots so each consumer applies policy appropriate to its purpose.

Production notch presentation has exactly one geometry: the latest `active-left` implementation, with active emoji immediately left of the camera notch and neutral represented by no emoji. The experimental `all-sides` geometry is not copied, configured, built, or tested under `src/`.

### 8. Keep Codex targeting and mutation conservative

The Rust worker selects exactly one active turn unless a thread is configured explicitly. It interrupts, confirms the original turn stopped for up to two seconds, then starts the context turn in the same thread.

The replacement message contains deterministic score ordering, qualitative degree, percentage, and an explicit uncertainty statement. Positive, neutral, and surprise readings can affect the notch but can never generate a context action.

The worker continues observing a bounded latest state while an action is running but serializes dispatches so only one mutation sequence is active.

### 9. Centralize configuration and health

A typed Python configuration is resolved once by the runtime owner and passed explicitly to workers. Rust receives its relevant subset through command arguments or a generated runtime config file. Duplicate defaults in multiple processes are prohibited; protocol fixtures verify cross-language interpretation.

Health is state, not free-form log parsing. Each worker reports role, lifecycle state, readiness, connection/freshness, and most recent structured error. Logs remain useful for history but do not define readiness.

There is no existing application supervisor to reuse. This change creates the first one: the Python runtime owner is responsible for worker launch, readiness aggregation, unexpected-exit detection, bounded restart, terminal failure state, and ordered shutdown. This responsibility is separate from `codex-control`, which remains a Rust library for controlling Codex and is not the Vibecheck worker daemon or supervisor.

For each launch, the runtime owner creates a fresh directory beneath the macOS per-user temporary directory (`TMPDIR`) using a `vibecheck-<uid>-` prefix and an unpredictable suffix. It validates that the directory is owned by the current user, applies mode `0700`, uses short filenames such as `emotion.sock` and `interruption-status.sock`, and passes their absolute paths directly to workers. The directory contains only transient IPC/control artifacts, is never used for persistent settings or model data, and is removed after an orderly shutdown. A new launch uses a new directory rather than trusting abandoned endpoints.

### 10. Preserve safe macOS lifecycle ownership

The Rust worker initializes `codex-control` with explicit GUI-management configuration. Normal startup gracefully restarts ChatGPT into daemon mode through Launch Services. Vibecheck workers run in controlled signal sessions; shutdown first stops monitor/reconnect work, then closes IPC and worker resources. ChatGPT and the shared daemon remain running.

The runtime never recursively signals broad process trees and escalates only against validated Vibecheck worker PIDs after grace periods.

### 11. Test through production seams

Tests are layered:

- Pure Python unit tests: normalization, face selection, display filtering, layout, config.
- Pure Rust unit tests: eligibility, hold/reset, latching, cooldown, message and outcome policy.
- Protocol conformance fixtures consumed by both languages.
- Process tests: two-subscriber fan-out, slow consumer replacement, reconnect, stale reset, signal isolation, graceful shutdown.
- Dry-run end-to-end: synthetic producer through real sockets, notch state projection, Rust `would_send`, no camera/Codex mutation.
- Opt-in live test: isolated Codex fixture thread, real interrupt/restart, guaranteed cleanup, no GUI relaunch unless explicitly requested.

A repository guard test scans tracked production code and build metadata for prohibited experimental or vendored path dependencies.

## Risks / Trade-offs

- **[Risk] Unix-socket fan-out requires custom reconnect, framing, and cleanup logic** → Keep protocol version 1 intentionally small, centralize transport modules, enforce bounded buffers, and add process-level tests for every failure mode.
- **[Risk] Dropping intermediate readings can hide brief transitions** → Every reading is a complete snapshot; consumers reset on freshness gaps and interruption requires a continuous wall-clock hold, so replaying intermediate history would be less correct.
- **[Risk] Two sockets introduce ordering differences between inference and interruption status** → Status events carry their own sequence/time and reference selected scores; the notch treats status as bounded visual feedback rather than canonical inference state.
- **[Risk] Restarting inference invalidates temporal continuity** → A new runtime identifier forces consumer reset before any new hold or display confirmation.
- **[Risk] AppKit camera permission and separate-process presentation will constrain later app packaging** → Keep permission boundaries explicit and test demo mode without camera; select the bundle, entitlement, signing, and installation mechanism in a dedicated release-packaging change.
- **[Risk] A Git tag could be moved or become unavailable** → Treat `v0.1.0` as immutable, verify package version `=0.1.0`, commit `Cargo.lock`, and require a new SemVer tag for every dependency update.
- **[Risk] Process supervision can enter crash loops** → Use bounded exponential backoff, jitter, rate limits, aggregate health, and a terminal failed state requiring operator action.
- **[Risk] OutcomeUnknown can suppress a context message that was not actually written** → Prefer avoiding duplicates; expose uncertain status clearly and require a new expression episode before reconsideration.
- **[Trade-off] Separate processes add IPC and packaging work** → They provide failure isolation, independent responsiveness, and lifecycle clarity; at six events per second, transport cost is negligible.

## Migration Plan

1. Tag the compatible `codex-control` package as `v0.1.0`, establish typed configuration, the per-launch runtime-directory contract, canonical schema, and repository dependency guard under tracked production paths.
2. Move and harden EmotiEffLib inference behavior behind the existing registry; add synthetic fixtures and face-selection tests.
3. Implement protocol v1 and the Python publisher/subscriber modules; verify bounded two-consumer fan-out, freshness, and reconnect behavior.
4. Move notch filtering, layout, and AppKit presentation into the production package and connect it to production sockets.
5. Create the Rust crate, port policy and message generation, connect it to protocol fixtures, and integrate tagged `codex-control` `v0.1.0` with a committed lockfile.
6. Add status publication and notch feedback, then add the runtime owner and ordered lifecycle handling.
7. Run dry-run end-to-end verification; compare thresholds and state transitions against frozen experiment-derived fixtures without importing experiment code.
8. Run the opt-in live Codex fixture and macOS visual verification.
9. Make the production CLI the supported entry point. Keep `experimentation/` ignored and unused; rollback consists of disabling the new runtime entry point without reintroducing experimental dependencies.

## Open Questions

None blocking this change. Native bundle, entitlement, signing, and installer decisions are explicitly deferred to a later release-packaging change.

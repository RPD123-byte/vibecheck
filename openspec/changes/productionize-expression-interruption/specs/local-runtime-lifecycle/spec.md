## ADDED Requirements

### Requirement: Explicit process topology
The production runtime SHALL own three sibling workers: one Python inference process, one Python macOS notch process, and one Rust interruption process. It SHALL create only one inference/model instance and one logical emotion stream regardless of the number of downstream consumers or monitored Codex threads.

#### Scenario: Normal runtime starts
- **WHEN** the user enables the complete feature
- **THEN** the runtime starts and supervises exactly one worker of each required role

#### Scenario: Additional Codex threads exist
- **WHEN** Codex reports multiple threads
- **THEN** the runtime does not create additional cameras, models, inference streams, or notch processes

### Requirement: Startup ordering and readiness
The runtime SHALL create its private runtime directory, establish configuration, start workers in a reconnect-safe order, and expose readiness only after inference is able to publish and both enabled consumers have connected or reported a terminal configuration error.

#### Scenario: Consumer starts before socket bind
- **WHEN** a consumer is launched before the inference endpoint is available
- **THEN** reconnect behavior bridges startup ordering without treating it as a fatal error

#### Scenario: Required worker fails configuration
- **WHEN** a worker reports an unrecoverable invalid configuration
- **THEN** aggregate readiness fails with that worker and reason identified

### Requirement: Ephemeral per-launch runtime directory
For every launch, the runtime owner SHALL create a fresh directory beneath the macOS per-user temporary directory using a `vibecheck-<uid>-` prefix and unpredictable suffix. It SHALL validate current-user ownership, enforce mode `0700`, keep Unix-socket filenames short, pass absolute endpoint paths directly to workers, and remove its transient IPC artifacts after orderly shutdown. It MUST NOT store persistent configuration, models, frames, or expression history there and MUST NOT reuse an abandoned directory on a later launch.

#### Scenario: Runtime starts normally
- **WHEN** the runtime owner prepares local IPC
- **THEN** `emotion.sock`, `interruption-status.sock`, and control artifacts are created only beneath that launch's owner-only directory

#### Scenario: A prior runtime directory remains
- **WHEN** a previous launch crashed before cleanup
- **THEN** the new launch creates a distinct directory and never connects workers to the abandoned endpoints

### Requirement: Central validated configuration
The runtime SHALL provide one typed configuration source for camera, adapter/model, cadence, face detection, no-face timeout, stream freshness, socket paths, display thresholds, display confirmations, active-left optical overlap, interruption threshold, hold, cooldown, thread targeting, Codex GUI management, and operating mode. Values MUST be validated before workers begin mutable actions. It SHALL NOT expose a production notch-layout selector.

#### Scenario: Defaults are used
- **WHEN** no overrides are supplied
- **THEN** all workers receive one consistent set of documented defaults, including a 1.5-second stream freshness timeout, surprise display entry/exit thresholds of 0.30/0.25, other-emotion display entry/exit thresholds of 0.50/0.45, and an interruption threshold of 0.30

#### Scenario: Invalid thresholds are configured
- **WHEN** either emotion-specific exit threshold exceeds its matching entry threshold or a score threshold lies outside 0.0 through 1.0
- **THEN** startup fails with a field-specific validation error

### Requirement: Safe Codex GUI initialization
When Codex GUI management is enabled, the interruption process SHALL initialize `codex-control` so ChatGPT is gracefully restarted into managed-daemon mode through macOS Launch Services. The GUI MUST not remain a descendant of the Vibecheck runtime process tree. GUI management MAY be disabled explicitly for tests or externally managed environments.

#### Scenario: GUI management is enabled
- **WHEN** interruption initializes in normal mode
- **THEN** `codex-control` performs the configured startup restart and verifies daemon attachment

#### Scenario: Runtime process tree is terminated
- **WHEN** the terminal or operating system tears down Vibecheck descendants
- **THEN** ChatGPT is not killed as an owned child of that process tree

### Requirement: Graceful shutdown ownership
Shutdown SHALL stop new inference, close streams, terminate notch presentation, drain or cancel interruption work conservatively, unsubscribe Codex control, and exit all Vibecheck workers within bounded time. It MUST leave the ChatGPT GUI and shared Codex daemon running.

#### Scenario: User presses Ctrl-C
- **WHEN** the runtime receives SIGINT
- **THEN** the runtime performs ordered graceful shutdown and exits without quitting or relaunching ChatGPT

#### Scenario: Worker exceeds shutdown deadline
- **WHEN** a worker does not exit within its configured grace period
- **THEN** the runtime escalates termination only against that Vibecheck worker and never targets ChatGPT or the shared daemon

### Requirement: Signal isolation
Child workers SHALL run in signal groups or sessions that allow the runtime owner to coordinate graceful shutdown rather than receiving an uncontrolled terminal signal cascade. Launching and stopping workers MUST not make the Codex GUI their process-tree child.

#### Scenario: Terminal sends an interrupt
- **WHEN** SIGINT reaches the runtime owner
- **THEN** workers receive explicit shutdown through their owned control path instead of an unordered group-wide interruption

### Requirement: Worker recovery
This feature SHALL implement the application's first worker supervisor in the runtime owner; it SHALL NOT assume an existing app-level health or restart service. The runtime owner SHALL detect unexpected worker exit, report it, and restart recoverable workers with bounded exponential backoff and a restart-rate limit. Restarting inference SHALL establish a new runtime identifier; restarting any consumer SHALL not require replaying historical emotion events. `codex-control` SHALL remain a controlled Rust library dependency and SHALL NOT be treated as the Vibecheck worker supervisor.

#### Scenario: Notch process crashes
- **WHEN** inference and interruption remain healthy
- **THEN** the runtime restarts only the notch and it resumes from current fresh state

#### Scenario: Worker repeatedly crashes
- **WHEN** restart attempts exceed the configured rate limit
- **THEN** the runtime marks that role failed and stops automatic restart until operator action or a new runtime start

### Requirement: Supported operating modes
The runtime SHALL support normal mode, synthetic demo mode, interruption dry-run mode, and display-only mode. Non-normal modes MUST reuse the production protocol and policy modules rather than forked experimental implementations.

#### Scenario: Demo and dry-run are combined
- **WHEN** synthetic demo mode and interruption dry-run are enabled
- **THEN** synthetic readings traverse the production stream, notch, and Rust policy without camera access or Codex mutation

#### Scenario: Display-only mode starts
- **WHEN** Codex interruption is disabled
- **THEN** inference and notch run normally without starting the Rust interruption worker

### Requirement: Structured health and diagnostics
Each worker SHALL emit structured lifecycle, connection, state, and error diagnostics tagged with runtime identifier and process role. Diagnostics MUST be sufficient to distinguish configuration, permission, camera, protocol, stale-stream, Codex connection, targeting, and action failures without logging camera frames.

#### Scenario: Runtime health is requested
- **WHEN** an operator or test inspects current health
- **THEN** the status identifies each enabled worker, its readiness, stream freshness, and most recent structured error

### Requirement: Tagged codex-control dependency
The Rust interruption package SHALL consume the `codex-control` Cargo package from immutable Git tag `v0.1.0` and require package version `=0.1.0`. The repository SHALL commit the resulting `Cargo.lock` so the exact Git commit and transitive dependency resolution are reproducible. A dependency upgrade SHALL require a new immutable SemVer tag and an intentional lockfile update; it MUST NOT follow a mutable branch or require a sibling checkout.

#### Scenario: Rust dependencies resolve from a clean clone
- **WHEN** Cargo builds the interruption package
- **THEN** it fetches `codex-control` from `v0.1.0`, verifies its `0.1.0` manifest version, and resolves the exact commit recorded in `Cargo.lock`

#### Scenario: codex-control is updated
- **WHEN** the integration adopts a newer compatible or incompatible package release
- **THEN** the dependency declaration and lockfile change explicitly to a newly created SemVer tag

### Requirement: Self-contained production source
All production implementation, tests, build metadata, and protocol fixtures SHALL live under tracked production paths in this repository. No production import, Cargo path dependency, build script, test, or runtime lookup MAY reference `experimentation/` or the vendored `emotiefflib_repo/` checkout. Selection of the native app bundle, camera entitlements, code signing, and installation mechanism is deferred and is not a completion condition for this change.

#### Scenario: Clean clone is built
- **WHEN** the repository is cloned without ignored directories
- **THEN** the production modules and all non-live tests build and run using declared dependencies only

#### Scenario: Dependency audit runs
- **WHEN** tracked source and build metadata are scanned
- **THEN** no dependency path resolves into `experimentation/` or `emotiefflib_repo/`

### Requirement: Layered verification
The repository SHALL provide deterministic unit tests for filtering and policy, protocol tests for framing/freshness, process tests for fan-out/reconnect/shutdown, dry-run end-to-end tests without Codex mutation, and an explicitly opt-in live Codex test using an isolated fixture thread with cleanup.

#### Scenario: Default continuous integration runs
- **WHEN** tests execute without camera or Codex access
- **THEN** unit, protocol, process, and dry-run suites pass using synthetic fixtures

#### Scenario: Live verification is requested
- **WHEN** the opt-in environment and managed daemon are available
- **THEN** the test creates an isolated thread, verifies interrupt and replacement behavior, and archives or cleans up its fixture even after failure

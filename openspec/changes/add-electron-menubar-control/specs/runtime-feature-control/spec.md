## ADDED Requirements

### Requirement: One long-lived Python control authority
Electron's main process SHALL launch at most one Python runtime owner and SHALL
not directly launch inference, notch, or interruption workers. The Python owner
SHALL remain alive while all features are disabled so it can reconcile later
requests without restarting Electron.

#### Scenario: Application starts with all features disabled
- **WHEN** Electron launches the Python owner with no enabled features
- **THEN** the owner exposes control and health while camera, inference, notch, and interruption workers remain stopped

### Requirement: Structured control bootstrap
The Python owner SHALL emit one bounded structured bootstrap record identifying
the protocol version, runtime identifier, and absolute control-socket path
beneath its fresh owner-only runtime directory. Electron MUST parse only
protocol records for readiness and MUST NOT infer readiness from human-readable
logs.

#### Scenario: Python owner becomes controllable
- **WHEN** the owner has bound its control socket
- **THEN** Electron receives a validated bootstrap record and connects to that exact endpoint

### Requirement: Secure versioned control protocol
Electron and Python SHALL exchange bounded JSON Lines messages over a local
Unix-domain socket inside the runtime's `0700` directory with socket mode
`0600`. Every message SHALL carry a schema version, message type, and request or
event correlation identifier. Unsupported versions, unknown message types,
oversized frames, malformed JSON, and undeclared fields that expand authority
MUST be rejected without changing runtime state.

#### Scenario: Valid state request arrives
- **WHEN** Electron sends a supported, bounded `get_state` request
- **THEN** Python returns one correlated authoritative state snapshot

#### Scenario: Malformed mutation arrives
- **WHEN** a client sends an oversized or unsupported `set_features` message
- **THEN** Python reports a structured protocol error and preserves the previous desired state

### Requirement: Atomic declarative feature state
Feature mutation SHALL use one complete desired-state document containing
notch enablement, named integration enablement, and temporary pause, together
with a monotonic revision. Repeating the same document SHALL be idempotent, and
Python SHALL acknowledge the accepted desired revision separately from the
eventual effective state.

#### Scenario: Acknowledgement is lost
- **WHEN** Electron retries an already accepted desired-state revision
- **THEN** Python returns the current state without duplicating worker starts or stops

#### Scenario: Stale writer sends a mutation
- **WHEN** a mutation is based on an older revision than Python's current accepted state
- **THEN** Python rejects it with the current revision and Electron refreshes before retrying

### Requirement: Derived worker topology
Python SHALL derive required workers from desired state rather than accepting
arbitrary process commands. When not paused, notch requires `inference` and
`notch`, Codex interruption requires `inference` and `interruption`, both
features require all three, and neither feature requires no workers.

#### Scenario: Interruption-only state is selected
- **WHEN** Codex interruption is enabled and the notch is disabled
- **THEN** Python runs exactly inference and interruption workers

#### Scenario: Final consumer is disabled
- **WHEN** the last enabled feature is disabled
- **THEN** Python stops its consumer and inference workers, releases the camera, and keeps the control owner alive

### Requirement: Minimal live reconciliation
Changing one feature SHALL start or stop only workers whose derived requirement
changed. Enabling the first feature SHALL start its consumer before inference
so reconnect and loading behavior cover model initialization. Disabling the
last feature SHALL stop consumers before inference. A consumer toggle MUST NOT
restart an already-required inference worker or an unrelated consumer.

#### Scenario: Notch is enabled during interruption
- **WHEN** inference and interruption are already effective
- **THEN** Python starts only the notch and preserves inference and interruption process identifiers

#### Scenario: Interruption is disabled during notch display
- **WHEN** all three workers are effective and interruption is disabled
- **THEN** Python drains and stops only interruption while inference and notch continue without restart

### Requirement: Intentional stop is not failure
The supervisor SHALL distinguish desired disablement from unexpected exit,
cancel pending backoff for a no-longer-required worker, and exclude intentional
stops from crash counts and terminal-failure policy.

#### Scenario: Feature is disabled during restart backoff
- **WHEN** its worker has crashed and the user disables the feature before restart
- **THEN** the pending restart is cancelled and the role becomes disabled without increasing its restart count

### Requirement: Graceful Rust interruption drain
The Rust interruption process SHALL handle termination by immediately
preventing new expression dispatches. If no Codex mutation is underway it SHALL
exit promptly; if an interrupt/replacement sequence is underway it SHALL finish
or conservatively resolve that sequence within a bounded drain deadline before
closing status resources and exiting.

#### Scenario: Interruption is disabled while idle
- **WHEN** Rust receives the supervisor's graceful termination request with no active dispatch
- **THEN** it publishes stopping state, closes its sockets, and exits normally without touching Codex

#### Scenario: Interruption is disabled after interrupt succeeds
- **WHEN** shutdown begins after the original Codex turn has been interrupted but before its context replacement has completed
- **THEN** Rust does not accept another expression action and completes or conservatively resolves the current replacement sequence before exit

### Requirement: Dynamic optional interruption status
The notch SHALL remain connected to emotion state independently of interruption
enablement. Starting or stopping interruption MUST NOT require a notch restart,
and absence of the interruption status publisher while that feature is disabled
MUST NOT be presented as a notch or runtime failure.

#### Scenario: Interruption starts while notch is active
- **WHEN** the notch is already showing inference state and interruption becomes enabled
- **THEN** interruption status becomes available without restarting or blanking the notch

### Requirement: Authoritative desired and effective health
Python SHALL publish current desired state, effective role state, readiness,
stream freshness, restart counts, structured errors, and aggregate runtime
state after every accepted mutation and material lifecycle transition. Electron
SHALL render these snapshots rather than reconstructing worker state from logs.

#### Scenario: Camera permission is denied
- **WHEN** an enabled feature requires inference and the camera worker reports permission denial
- **THEN** Python reports the enabled desired state, ineffective inference dependency, affected features, and permission reason

### Requirement: Controller-loss cleanup
The owner SHALL treat loss of its authenticated Electron control session as
loss of application ownership. If Electron does not reconnect within a bounded
grace period, defaulting to five seconds, Python SHALL gracefully stop all
workers and exit so no orphaned camera or Codex-control process remains.

#### Scenario: Electron crashes
- **WHEN** the Electron main process disappears while features are active
- **THEN** Python stops all owned workers and exits after the controller-loss grace period without stopping Codex

### Requirement: Bounded owner recovery
Electron SHALL detect unexpected Python-owner exit and MAY restart it with
bounded exponential backoff while reapplying the last persisted feature
selection. Repeated failure SHALL stop automatic recovery and expose an
explicit user recovery action; Electron MUST NOT allow overlapping owners or
reuse an abandoned runtime directory.

#### Scenario: Python owner crashes once
- **WHEN** the owner exits unexpectedly below the restart limit
- **THEN** Electron starts one new owner in a fresh runtime directory and reapplies current desired feature state

#### Scenario: Python owner repeatedly crashes
- **WHEN** owner restarts exceed the configured rate limit
- **THEN** Electron reports `Failed`, stops automatic restart, and waits for explicit user recovery or quit

### Requirement: CLI compatibility
The production CLI SHALL remain supported for development, testing, and
recovery. Existing demo and dry-run behavior SHALL map to an initial desired
topology and reuse the same reconciler rather than preserving a separate static
supervision implementation.

#### Scenario: Display-only CLI starts
- **WHEN** the user starts the supported display-only CLI mode
- **THEN** the reconciler selects inference and notch without starting interruption

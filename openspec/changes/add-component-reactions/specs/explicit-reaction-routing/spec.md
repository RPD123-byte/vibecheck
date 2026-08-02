## ADDED Requirements

### Requirement: Private versioned explicit-reaction input
The existing Rust interruption process SHALL bind a component-reaction Unix
socket with mode `0600` inside the current owner-only runtime directory before
reporting component input ready. Electron SHALL learn the endpoint only through
its authenticated Python control session.

#### Scenario: Rust component input becomes ready
- **WHEN** component reactions require the Rust role
- **THEN** Rust binds the private endpoint and Python publishes its readiness and exact path to the authenticated Electron controller

#### Scenario: Unauthenticated path is guessed
- **WHEN** a client outside the owner-only runtime attempts to submit an event
- **THEN** filesystem permissions and protocol validation prevent an accepted reaction

### Requirement: Minimal validated reaction schema
Each explicit event SHALL carry a schema version, event ID, capture time, source
application name and bundle identity, reaction emoji and label, copy-like text,
and a PNG path confined to the current runtime directory. Unknown fields,
unsupported versions, malformed values, oversized frames, duplicate in-flight
IDs, and paths outside the runtime directory MUST be rejected without Codex
mutation.

#### Scenario: Valid reaction arrives
- **WHEN** Electron submits a complete supported event with a readable PNG inside the current runtime directory
- **THEN** Rust accepts it into the explicit mutation coordinator

#### Scenario: Screenshot path escapes runtime
- **WHEN** an event contains an absolute or traversing PNG path outside the current runtime directory
- **THEN** Rust rejects the event and does not read the file or touch Codex

### Requirement: Component-only Codex control
Rust SHALL be able to initialize `codex-control` and consume explicit reactions
without an emotion socket or inference process. When expression interruption is
also enabled, the same process SHALL consume emotion and component inputs
independently.

#### Scenario: Component-only topology starts
- **WHEN** Python starts Rust for component reactions with expression interruption disabled
- **THEN** Rust becomes ready for explicit events without connecting to `emotion.sock`

#### Scenario: Expression input is enabled later
- **WHEN** the same Rust role is already active for components and expression interruption becomes enabled
- **THEN** Rust begins consuming emotion input without losing component readiness or starting a second Codex controller

### Requirement: Conservative active-turn selection
At explicit batch dispatch time, Rust SHALL snapshot eligible active Codex
turns. It SHALL mutate Codex only when exactly one eligible turn is active and
MUST NOT infer a target from focus, recency, source application, or clipboard.

#### Scenario: No Codex turn is active
- **WHEN** an explicit reaction batch reaches dispatch with zero eligible active turns
- **THEN** Rust returns `no_active_turn` and performs no interrupt or replacement

#### Scenario: Exactly one Codex turn is active
- **WHEN** an explicit reaction batch reaches dispatch with one eligible active turn
- **THEN** Rust interrupts that turn, confirms it stopped, and starts the replacement in the same task

#### Scenario: Multiple Codex turns are active
- **WHEN** an explicit reaction batch reaches dispatch with more than one eligible active turn
- **THEN** Rust returns `multiple_active_turns` and performs no Codex mutation

### Requirement: Ordered multimodal replacement input
For every event in an explicit batch, the replacement turn SHALL receive a
concise text input describing explicit user feedback followed by that event's
PNG as a `localImage` input. Batch entries SHALL preserve commit order and MUST
NOT include cloned HTML or technical DOM context.

#### Scenario: Two events form one batch
- **WHEN** two component reactions were queued during an earlier mutation
- **THEN** the next replacement input contains text1, image1, text2, image2 in commit order

### Requirement: One serialized Codex mutation lane
Expression and explicit reaction actions SHALL share one coordinator that
permits at most one interrupt/confirm/replacement sequence at a time.

#### Scenario: Reaction arrives during component replacement
- **WHEN** Rust is resolving one explicit mutation and another event arrives
- **THEN** the new event waits without starting a concurrent interrupt

#### Scenario: Reaction arrives during expression replacement
- **WHEN** an expression mutation is already between interrupt and replacement
- **THEN** Rust safely finishes or conservatively resolves it before starting explicit work

### Requirement: Ordered explicit batching
Explicit events received while a Codex mutation is underway SHALL be queued in
commit order and combined into one next explicit batch after the current
mutation resolves. Events SHALL NOT wait for a future turn when their dispatch
result is zero or multiple active turns.

#### Scenario: Three reactions arrive during one active mutation
- **WHEN** the mutation completes successfully
- **THEN** Rust evaluates the three queued events together as one ordered next batch

#### Scenario: Queued batch finds no active turn
- **WHEN** the next batch is evaluated after the prior mutation and no turn remains active
- **THEN** Rust returns clipboard-only results for that batch and clears it rather than retaining it for later

### Requirement: Explicit reactions take priority over passive expressions
When no mutation is already in flight, a pending explicit batch SHALL be chosen
before a newly qualified expression action. Emotion readings MUST NOT create a
durable backlog while explicit work is pending.

#### Scenario: Expression qualifies with explicit batch pending
- **WHEN** Rust becomes free to dispatch and both inputs are actionable
- **THEN** it dispatches the explicit batch first and applies normal expression freshness and temporal policy afterward

#### Scenario: Emotion becomes stale during explicit work
- **WHEN** explicit dispatch occupies the coordinator beyond emotion freshness
- **THEN** Rust resets or discards stale expression continuity rather than replaying it later

### Requirement: Clipboard delivery remains independent
Rust SHALL NOT own or alter the clipboard. Electron SHALL submit explicit
events only after copy success, and every Rust unavailable, skipped, rejected,
failed, or uncertain result SHALL leave the marked clipboard bundle intact.

#### Scenario: Codex control is unavailable
- **WHEN** Rust cannot initialize or reconnect to Codex after clipboard append
- **THEN** it returns an unavailable result without modifying clipboard state

### Requirement: Conservative action outcomes
Explicit dispatch SHALL preserve the existing `Confirmed`, `Rejected`, and
`OutcomeUnknown` semantics. Unknown writes MUST NOT be retried automatically;
rejected or unconfirmed interrupts MUST NOT start a replacement.

#### Scenario: Interrupt cannot be confirmed stopped
- **WHEN** the active turn remains active beyond the bounded confirmation interval
- **THEN** Rust returns `interrupt_failed` and does not issue a replacement start

#### Scenario: Replacement outcome is unknown
- **WHEN** Codex may have accepted the replacement but confirmation is unavailable
- **THEN** Rust returns `sent_outcome_unknown` and does not resend the batch

### Requirement: Correlated transient routing results
Rust SHALL return a result correlated to every explicit event ID sufficient for
Electron to show sent, copied-only, unavailable, failed, or uncertain receipts.
These results SHALL NOT create a durable reaction or thread history.

#### Scenario: Multiple events were batched successfully
- **WHEN** Codex confirms the shared replacement
- **THEN** every event ID in that batch receives a correlated sent result

### Requirement: Best-effort non-durable event delivery
Explicit event IPC SHALL be in-session and best-effort. Neither Electron nor
Rust SHALL persist an event queue or automatically replay an event across
renderer, Rust, Python-owner, or Vibecheck restart.

#### Scenario: Rust exits before accepting an event
- **WHEN** clipboard append succeeded but the reaction socket disconnects before acceptance
- **THEN** Vibecheck reports copied with Codex unavailable and does not resend after restart

### Requirement: Input-aware graceful drain
Disabling component reactions SHALL stop new component acceptance immediately.
Rust SHALL remain active if expression interruption still needs it; otherwise it
SHALL drain the one active mutation within the existing bounded shutdown policy
before closing the reaction socket.

#### Scenario: Components are disabled while expression remains enabled
- **WHEN** no explicit mutation is in flight
- **THEN** Rust closes or disables component input while preserving emotion consumption and Codex control

#### Scenario: Final Rust-requiring feature is disabled during explicit mutation
- **WHEN** the original Codex turn was interrupted but replacement is unresolved
- **THEN** Rust completes or conservatively resolves that sequence before process exit

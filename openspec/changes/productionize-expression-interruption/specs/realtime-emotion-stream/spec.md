## ADDED Requirements

### Requirement: Local fan-out transport
The inference process SHALL publish one logical emotion stream over a local Unix-domain socket to any number of connected consumers. The notch and interruption consumers SHALL have independent delivery state so one slow consumer cannot delay inference or the other consumer.

#### Scenario: Both production consumers are connected
- **WHEN** an active inference reading is published
- **THEN** both the notch and interruption consumers can receive the same logical reading independently

#### Scenario: Interruption processing is slow
- **WHEN** the interruption consumer is dispatching a Codex action
- **THEN** notch delivery and inference publication continue without waiting for that action

### Requirement: Versioned event envelope
Every stream event SHALL use a versioned JSON Lines envelope containing event kind, runtime instance identifier, monotonically increasing sequence number, monotonic capture timestamp, publish timestamp, and payload. Active inference payloads SHALL carry the normalized reading; state payloads SHALL carry the producer state and structured error detail when applicable.

#### Scenario: Consumer receives a supported event
- **WHEN** the envelope version and event kind are supported
- **THEN** the consumer validates the required fields before applying the payload

#### Scenario: Consumer receives an unsupported version
- **WHEN** an event uses a protocol version the consumer does not support
- **THEN** the consumer rejects the event, reports a protocol error, and does not reinterpret it using the current schema

### Requirement: Freshness over durability
The emotion stream SHALL be non-durable and MUST NOT provide historical replay or at-least-once redelivery. Each consumer connection SHALL have a bounded pending slot that retains at most the newest unsent event, replacing superseded events when the consumer falls behind.

#### Scenario: Consumer cannot keep up
- **WHEN** multiple readings arrive before a consumer accepts its pending reading
- **THEN** the pending reading is replaced with the newest event and the producer does not accumulate a backlog

#### Scenario: Consumer reconnects
- **WHEN** a consumer reconnects after missing readings
- **THEN** it receives only the current in-memory state if that state is still fresh and receives no historical sequence replay

### Requirement: Stale and discontinuous input handling
Consumers SHALL compare runtime identifiers, sequence numbers, and monotonic timestamps. They MUST ignore duplicate or out-of-order events, MUST reset temporal smoothing or hold state after a sequence gap, runtime change, or freshness timeout, and MUST NOT count disconnected time toward a hold duration. The freshness timeout SHALL be configurable, SHALL exceed the configured inference interval, and SHALL default to 0.75 seconds.

#### Scenario: Sequence gap occurs within freshness limit
- **WHEN** a consumer receives a newer sequence after one or more readings were dropped but the new event is fresh
- **THEN** it applies the current snapshot without replay, but resets any consecutive-confirmation or continuous-hold state before using that snapshot

#### Scenario: Stream stalls during an expression hold
- **WHEN** no fresh event arrives within the configured freshness timeout
- **THEN** the interruption candidate timer and notch pending transition are reset before later readings are considered

#### Scenario: Inference process restarts
- **WHEN** a consumer observes a new runtime identifier
- **THEN** it discards all state derived from the previous runtime instance

### Requirement: Reconnection behavior
Notch and interruption consumers SHALL reconnect automatically with bounded exponential backoff and jitter when the inference socket is unavailable. Connection attempts MUST be cancellable during shutdown and MUST expose disconnected versus stale health states.

#### Scenario: Consumer starts before inference
- **WHEN** the Unix socket does not yet exist
- **THEN** the consumer retries without exiting permanently or busy-looping

#### Scenario: Runtime shuts down during backoff
- **WHEN** shutdown is requested while a consumer is waiting to reconnect
- **THEN** the wait is cancelled and the consumer exits without another connection attempt

### Requirement: Interruption status channel
The Rust interruption process SHALL publish versioned status events over a separate local status socket, and the notch process MAY subscribe to those events without participating in Codex dispatch. Status events SHALL include lifecycle state, selected emotions, scores, optional thread identifier, user-facing message, error detail, runtime identifier, sequence, and monotonic timestamp.

#### Scenario: Interruption begins
- **WHEN** the interruption process starts acting on an eligible expression
- **THEN** it publishes `interrupting` followed by subsequent dispatch states without blocking emotion-stream consumption

#### Scenario: Notch is not running
- **WHEN** the status process publishes an event with no status subscriber connected
- **THEN** dispatch proceeds normally and the event is not durably queued

### Requirement: Local transport security
Runtime socket files SHALL be created inside a per-user runtime directory with owner-only access, SHALL reject non-local network exposure, and SHALL be removed or safely replaced when the owning runtime exits or detects an abandoned endpoint.

#### Scenario: Runtime creates IPC endpoints
- **WHEN** the process owner starts a new runtime instance
- **THEN** it creates socket paths with permissions that prevent access by other local users

#### Scenario: Stale socket path remains after a crash
- **WHEN** no live owner is bound to an existing configured path
- **THEN** the new owner removes the abandoned path before binding and never unlinks a socket owned by a verified live runtime

### Requirement: Malformed message isolation
A malformed or oversized event MUST NOT crash a producer or consumer. Implementations SHALL enforce a configured maximum event size, report protocol errors with connection context, and isolate repeated invalid input to the offending connection.

#### Scenario: Consumer receives malformed JSON
- **WHEN** one connection supplies an invalid event frame
- **THEN** the frame is rejected and other subscribers continue receiving valid events

#### Scenario: Event exceeds maximum size
- **WHEN** a frame exceeds the configured local protocol limit
- **THEN** the receiver closes or quarantines that connection without allocating an unbounded buffer

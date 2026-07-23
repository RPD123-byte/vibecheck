## ADDED Requirements

### Requirement: Menu-bar-only application lifecycle
Vibecheck SHALL launch as a single-instance macOS menu-bar application without
opening an ordinary application window or presenting a Dock icon. Closing or
hiding the popover MUST NOT stop the Python runtime, inference, notch, or
interruption features.

#### Scenario: Application launches
- **WHEN** the user starts Vibecheck
- **THEN** exactly one menu-bar item appears and no ordinary window or Dock icon is presented

#### Scenario: Second instance launches
- **WHEN** another Vibecheck instance is requested while one is running
- **THEN** the existing instance is activated and a second runtime owner is not started

### Requirement: Anchored custom popover
Clicking the menu-bar item SHALL toggle one custom Electron popover anchored to
the current bounds and screen of the menu-bar item. The popover SHALL hide on
Escape, outside interaction, or a second menu-bar click and SHALL recalculate
its position after display geometry changes.

#### Scenario: Menu-bar item is clicked
- **WHEN** the popover is hidden and the user clicks the Vibecheck menu-bar item
- **THEN** the popover appears beneath that item on its current display without opening a conventional application window

#### Scenario: Popover loses focus
- **WHEN** the user interacts outside the open popover
- **THEN** the popover hides while the application and selected features remain running

### Requirement: Understandable aggregate state
The popover SHALL project authoritative Python runtime state into the
user-facing states `Off`, `Starting`, `Active`, `Paused`, `Needs Permission`,
`Degraded`, and `Failed`. It MUST distinguish user-desired enablement from
effective worker state so a requested feature remains visibly enabled while it
is starting or temporarily unavailable.

#### Scenario: Enabled feature is still starting
- **WHEN** the user has enabled the notch and inference is loading its model
- **THEN** the notch toggle remains enabled and the menu reports `Starting` rather than turning the toggle off

#### Scenario: One enabled feature fails
- **WHEN** the notch remains effective but Codex interruption reaches a terminal failure
- **THEN** the menu reports `Degraded`, identifies Codex interruption as failed, and leaves the notch enabled

### Requirement: Independent first-release controls
The first-release popover SHALL expose independent controls for `Show notch`
and `Codex interruption`, plus aggregate status, temporary pause, conditional
runtime recovery, and quit. It MUST NOT require a settings window to operate
these controls.

#### Scenario: Notch is disabled independently
- **WHEN** both features are active and the user disables `Show notch`
- **THEN** the menu requests notch disablement without changing the desired Codex interruption setting

#### Scenario: Runtime reaches terminal failure
- **WHEN** the Python owner cannot recover within its restart policy
- **THEN** the menu exposes a deliberate restart action together with the structured failure reason

### Requirement: Temporary privacy pause
The menu SHALL provide one temporary pause control that suppresses all
effective features while preserving their desired enablement. Pause state SHALL
not survive a full application quit and relaunch.

#### Scenario: Active runtime is paused
- **WHEN** the notch and Codex interruption are enabled and the user pauses Vibecheck
- **THEN** all feature workers and inference stop, the camera is released, and both feature preferences remain selected for later resume

#### Scenario: Runtime resumes
- **WHEN** a paused user resumes Vibecheck
- **THEN** Python reconciles back to the preserved feature selection using normal startup and readiness behavior

### Requirement: Persistent feature preferences
Electron SHALL persist the two feature-enable preferences locally and reapply
them after a normal application relaunch. On first launch, both features SHALL
be disabled until the user explicitly enables them.

#### Scenario: User relaunches Vibecheck
- **WHEN** the prior normal session ended with notch enabled and interruption disabled
- **THEN** the new Python owner receives that same desired feature selection after Electron establishes control

#### Scenario: First launch occurs
- **WHEN** no saved Vibecheck preferences exist
- **THEN** the runtime remains off and does not access the camera until the user enables a feature

### Requirement: Narrow renderer authority
The Electron renderer SHALL run with context isolation and sandboxing enabled,
Node integration disabled, no remote web content, and a restrictive Content
Security Policy. The preload bridge SHALL expose only typed state
subscriptions and feature, pause, recovery, and quit requests; the renderer
MUST NOT spawn processes, access arbitrary files, or open the runtime socket.

#### Scenario: Renderer requests a feature change
- **WHEN** the user changes a toggle
- **THEN** the renderer sends a typed request through the preload bridge and Electron's main process validates it before contacting Python

#### Scenario: Renderer content is compromised
- **WHEN** renderer code attempts to invoke an undeclared Node or process operation
- **THEN** the operation is unavailable through the sandboxed renderer and narrow preload API

### Requirement: Privacy-preserving presentation
The menu SHALL indicate whether the camera is inactive, starting, active
on-device, or blocked by permission. It MUST NOT display or persist the current
expression, confidence scores, captured frames, conversation contents, or
active Codex thread list.

#### Scenario: Inference is active
- **WHEN** at least one feature requires the camera and model
- **THEN** the popover indicates that on-device camera processing is active without exposing inferred expression data

### Requirement: Safe application quit
Quitting from the menu SHALL request bounded graceful shutdown from the Python
owner, wait for owned workers to stop, and then exit Electron. It MUST leave the
Codex GUI and shared Codex daemon running.

#### Scenario: User quits from the menu
- **WHEN** inference, notch, and interruption are active
- **THEN** Electron waits for Python's structured shutdown acknowledgement or bounded timeout and exits without terminating or relaunching Codex

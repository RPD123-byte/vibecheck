## ADDED Requirements

### Requirement: Menu-bar-only application lifecycle
Vibecheck SHALL launch as a single-instance macOS menu-bar application without
opening an ordinary application window or presenting a Dock icon. Closing or
hiding the native menu MUST NOT stop the Python runtime, inference, notch, or
interruption features.

#### Scenario: Application launches
- **WHEN** the user starts Vibecheck
- **THEN** exactly one menu-bar item appears and no ordinary window or Dock icon is presented

#### Scenario: Second instance launches
- **WHEN** another Vibecheck instance is requested while one is running
- **THEN** the existing instance is activated and a second runtime owner is not started

### Requirement: Native macOS menu
Clicking the menu-bar item SHALL open a standard native macOS menu owned by the
Electron main process. The operating system SHALL own its placement, focus,
keyboard navigation, appearance, dismissal, display selection, and Space
behavior. Vibecheck MUST NOT create a `BrowserWindow` for this first-release
surface.

#### Scenario: Menu-bar item is clicked
- **WHEN** the user clicks the Vibecheck menu-bar item
- **THEN** the native macOS menu opens beneath that item without creating or showing a conventional application window

#### Scenario: Menu is dismissed
- **WHEN** the user clicks outside the open menu or presses Escape
- **THEN** macOS dismisses the menu while the application and selected features remain running

### Requirement: Understandable aggregate state
The native menu SHALL project authoritative Python runtime state into the
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
The first-release native menu SHALL expose independent controls for `Show notch`
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

### Requirement: Main-process-only menu authority
The first-release menu SHALL be constructed from native `Menu` and `MenuItem`
objects inside Electron main. Vibecheck MUST NOT create a renderer,
`BrowserWindow`, preload bridge, remote web content, or navigation surface.
Menu callbacks SHALL invoke only fixed feature, pause, recovery, and quit
operations; they MUST NOT accept executable paths, process names, commands, or
runtime configuration.

#### Scenario: Menu requests a feature change
- **WHEN** the user changes a toggle
- **THEN** a fixed main-process callback requests the corresponding typed mutation from Python

#### Scenario: No web surface exists
- **WHEN** Vibecheck is running in the first release
- **THEN** Electron has no renderer process or web-content input surface that could obtain Node or runtime authority

### Requirement: Privacy-preserving presentation
The menu SHALL indicate whether the camera is inactive, starting, active
on-device, or blocked by permission. It MUST NOT display or persist the current
expression, confidence scores, captured frames, conversation contents, or
active Codex thread list.

#### Scenario: Inference is active
- **WHEN** at least one feature requires the camera and model
- **THEN** the menu indicates that on-device camera processing is active without exposing inferred expression data

### Requirement: Safe application quit
Quitting from the menu SHALL request bounded graceful shutdown from the Python
owner, wait for owned workers to stop, and then exit Electron. It MUST leave the
Codex GUI and shared Codex daemon running.

#### Scenario: User quits from the menu
- **WHEN** inference, notch, and interruption are active
- **THEN** Electron waits for Python's structured shutdown acknowledgement or bounded timeout and exits without terminating or relaunching Codex

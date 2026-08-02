## ADDED Requirements

### Requirement: Independent persistent component-reaction setting
Vibecheck SHALL expose a `Component reactions` setting independently from
`Show notch` and expression-based `Codex interruption`. Electron SHALL persist
the setting locally, default it off when no valid preference exists, and
reapply it after establishing the authenticated Python control session.

#### Scenario: First launch has no saved preference
- **WHEN** Vibecheck starts without a valid component-reaction preference
- **THEN** component interaction remains disabled, supported target ownership and dormant renderer installation still begin, no input event tap is installed, and no Codex worker is started for this feature

#### Scenario: Enabled preference is restored
- **WHEN** Vibecheck relaunches after the user previously enabled component reactions
- **THEN** the desired setting remains enabled and Vibecheck begins component-feature startup without requiring a camera preflight

### Requirement: Component-only operation is camera-free
Component reactions alone SHALL require the existing Rust interruption role but
MUST NOT require inference, camera authorization, camera opening, model import,
model construction, emotion publication, or notch presentation.

#### Scenario: Only component reactions are enabled
- **WHEN** notch and expression interruption are disabled and component reactions are enabled
- **THEN** Python runs exactly the Rust interruption role among its feature workers and the camera remains released

#### Scenario: Component reactions are disabled from component-only operation
- **WHEN** component reactions are the only enabled feature and the user disables them
- **THEN** Python gracefully stops the Rust role and keeps the long-lived control owner available

### Requirement: Shared Rust-role derivation
Python SHALL derive the Rust interruption role when either expression
interruption or component reactions are enabled. It SHALL derive inference only
when notch or expression interruption requires emotion readings.

#### Scenario: Component reactions join expression interruption
- **WHEN** inference and Rust interruption are already running for expression interruption and component reactions become enabled
- **THEN** Python preserves both process identifiers and enables the explicit-reaction input without restarting either process

#### Scenario: Expression interruption leaves shared Rust active
- **WHEN** both interruption features are enabled and expression interruption is disabled
- **THEN** Python stops inference if no notch needs it and keeps the same Rust process active for component reactions

### Requirement: Declarative revisioned feature state
The Electron-to-Python feature document SHALL include
`component_reactions_enabled` under the same revisioned, idempotent,
full-document mutation contract as existing features. Unknown, missing, stale,
or non-boolean component state MUST be rejected without partial mutation.

#### Scenario: Valid component setting changes
- **WHEN** Electron submits a complete feature document at the current revision with component reactions toggled
- **THEN** Python accepts one new revision and reconciles only roles whose derived requirement changed

#### Scenario: Legacy-shaped feature document arrives
- **WHEN** a client omits the required component-reaction field after the protocol version introducing it
- **THEN** Python returns a structured protocol error and preserves current desired and effective state

### Requirement: Temporary pause suppresses component interaction
The existing temporary Pause action SHALL suppress the component shortcut,
target-local UI, special marked-paste expansion, renderer event acceptance, and
component Codex input while preserving the persisted enable preference. Pause
MUST NOT remove debugging capability from a live enrolled target.

#### Scenario: Active component feature is paused
- **WHEN** the user pauses Vibecheck while component reactions are active
- **THEN** every attached renderer becomes dormant, the special paste event tap is disabled, Rust stops if no other feature needs it, and the component preference remains selected

#### Scenario: Paused component feature resumes
- **WHEN** the user resumes Vibecheck in the same session
- **THEN** attached target processes are reenabled without relaunch and Python restores the minimum required role topology

### Requirement: Feature-scoped desktop companion ownership
Electron SHALL own at most one fixed, signed native desktop companion for
component lifecycle and paste integration. The companion MUST NOT register with
launchd, start independently, accept arbitrary executable commands, or remain
alive after the owning Vibecheck process exits.

#### Scenario: Vibecheck desktop ownership starts
- **WHEN** the Vibecheck application starts
- **THEN** Electron starts only the validated packaged companion with a fixed typed protocol

#### Scenario: Electron exits unexpectedly
- **WHEN** the companion loses its owning Electron connection
- **THEN** it disables its event tap, stops target operations, and exits within a bounded deadline

### Requirement: Desired, effective, and degraded component health
Electron SHALL project component desired state separately from effective
desktop attachment, permission state, native-companion health, Rust input
readiness, and most recent transient delivery outcome. Failure in one target
MUST NOT disable or misreport healthy targets or unrelated Vibecheck features.

#### Scenario: One target cannot relaunch
- **WHEN** component reactions are enabled but one supported target refuses graceful termination
- **THEN** the setting remains enabled, that target reports unavailable, and other attached targets remain effective

#### Scenario: Rust input is unavailable
- **WHEN** desktop capture and clipboard delivery are healthy but the Rust reaction endpoint is not ready
- **THEN** Vibecheck reports degraded Codex delivery while preserving local component copy behavior

### Requirement: Native menu component control
The native menu SHALL include the component-reaction toggle and concise
readiness, permission, failure, and recovery information without displaying
captured component text, screenshots, emoji history, target URLs, or Codex
thread identities.

#### Scenario: Component reactions are starting
- **WHEN** the preference is enabled while target attachment or permission setup is incomplete
- **THEN** the toggle remains checked and the menu reports a starting or needs-permission state

#### Scenario: Component reactions are healthy
- **WHEN** at least one supported target is attached, native paste integration is effective, and Rust input is ready
- **THEN** the menu reports component reactions active without exposing captured content

### Requirement: Startup-heartbeat isolation
Component companion startup, permission checks, target discovery, target
relaunch, CDP attachment, renderer injection, clipboard setup, and Rust
component-input readiness SHALL remain logically independent from inference
socket binding and loading heartbeat publication. They MUST NOT delay, gate, or
redefine the centralized 1.5-second emotion freshness default.

#### Scenario: Component target initialization is slow
- **WHEN** sensor and component features start together and a target application takes several seconds to relaunch
- **THEN** inference binds its socket and publishes loading heartbeats according to the existing startup invariant without transitioning the notch to stale

#### Scenario: Component startup fails
- **WHEN** the native companion or CDP service reaches a terminal startup failure
- **THEN** any requested inference/notch topology continues independently and only component health is degraded

### Requirement: Safe component shutdown
Disabling SHALL make attached renderer interactions dormant without removing
their controllers or target ownership. Quitting SHALL dispose those controllers
before closing debug sessions. Both paths SHALL stop accepting new component
events, drain any active Rust mutation under the existing bounded policy,
disable the native event tap, close component IPC, and leave target
applications and Codex running.

#### Scenario: User disables during an active selection
- **WHEN** the component setting is turned off while a target picker is open
- **THEN** the target-local UI is removed without committing, copying, or sending the selected target while the dormant controller and owned debugging transport remain installed

#### Scenario: User quits Vibecheck with attached targets
- **WHEN** Vibecheck quits while supported targets remain running
- **THEN** every reachable renderer controller, listener, style, and transient node is disposed before the companion and debug sessions close

#### Scenario: User quits during Codex replacement
- **WHEN** a component-triggered interrupt has succeeded but its replacement turn is unresolved
- **THEN** Rust finishes or conservatively resolves that mutation before Vibecheck exits and target applications remain running

### Requirement: Production-source independence
Production component-reaction source, tests, manifests, runtime commands,
packaged resources, generated bundles, and source maps SHALL be self-contained
under tracked production paths and MUST NOT import, execute, copy at build time
from, or reference `experimentation/`.

#### Scenario: Source guard runs
- **WHEN** CI scans tracked production inputs
- **THEN** it fails on any component-reaction dependency or command containing an experimental path

#### Scenario: Packaged artifact is verified
- **WHEN** the signed application and frozen runtime are inspected
- **THEN** no executable string, source map, resource, manifest, or launch command references the experimental directory

## ADDED Requirements

### Requirement: Vibecheck-owned Accessibility and Input Monitoring consent
The signed Vibecheck application and responsible native companion SHALL request
only the macOS permissions required for marked global paste expansion, focus
restoration, and supported application lifecycle. Permission onboarding SHALL
begin only after the user enables component reactions and SHALL identify
Vibecheck rather than an ad-hoc helper or development executable.

#### Scenario: Feature is enabled on a clean account
- **WHEN** component reactions first require native input or Accessibility access
- **THEN** macOS presents the applicable Vibecheck-owned consent flow before the event tap becomes effective

#### Scenario: User denies permission
- **WHEN** the user declines the required permission
- **THEN** Vibecheck reports `Needs Permission`, installs no active special-paste event tap, and leaves notch and camera features independently operable

### Requirement: Packaged production desktop companion
The release SHALL package one arm64 production native companion, all required
production renderer assets, emoji data, and Rust reaction support beneath the
Vibecheck bundle. The companion MAY render the fixed allowlisted Tapback
templates already installed by macOS at runtime, but the release MUST NOT copy
or package Apple artwork. Runtime operation MUST NOT require Swift, Xcode, Node
source, Cargo, a repository checkout, or shell launchers.

#### Scenario: Clean installed app runs offline
- **WHEN** component reactions are enabled on a supported clean Mac without developer tools or network
- **THEN** every component subsystem starts from bundled signed production resources

### Requirement: No independently persistent service
Packaging MUST NOT install a launch agent, launch daemon, login item, privileged
helper, or independently updateable component-reaction service. The native
companion SHALL remain a bounded child of the running Vibecheck application.

#### Scenario: User quits Vibecheck
- **WHEN** the application exits normally
- **THEN** no component-reaction process, event tap, target watcher, or local listener remains running

#### Scenario: User uninstalls Vibecheck
- **WHEN** the application bundle and ordinary preferences are removed
- **THEN** no separately installed component-reaction service remains on the Mac

### Requirement: Hardened nested-code signing
Release signing SHALL sign the native companion, Rust executable, native
libraries, Electron helpers, and outer application inside-out with the stable
Vibecheck identity, hardened runtime, secure timestamp, compatible least-
privilege entitlements, and matching arm64 architecture.

#### Scenario: Release inventory is inspected
- **WHEN** the candidate application is assembled
- **THEN** verification rejects unsigned, ad-hoc, invalid, wrong-architecture, or unexpectedly entitled new native code

### Requirement: Notarized complete component release
The final distributed archive SHALL be Developer ID signed, notarized, stapled
where applicable, Gatekeeper-assessable, and verified after packaging with the
component setting, companion, renderer resources, and Rust protocol present.

#### Scenario: Protected release gate runs
- **WHEN** an authorized component-reaction release candidate is produced
- **THEN** notarization, stapling, Gatekeeper assessment, signature verification, resource inventory, and artifact hashes all succeed before publication

### Requirement: Experimental-path exclusion
CI and release verification SHALL reject any production source, test dependency,
manifest, runtime command, generated JavaScript, source map, binary string, or
packaged resource that imports, executes, copies from, or references
`experimentation/`.

#### Scenario: Production renderer names an experimental asset
- **WHEN** a bundled renderer or source map contains an experimental path
- **THEN** CI or release verification fails

#### Scenario: Native build script copies an experiment binary
- **WHEN** packaging inputs resolve a component artifact beneath the experimental directory
- **THEN** the build fails before signing

### Requirement: Production compatibility fixtures
The repository SHALL include production-owned fixtures for a generic DOM
Electron application and a Paper-compatible logical canvas. Tests MUST execute
the production renderer bundle, CDP controller, clipboard protocol, and Rust
routing without importing experiment fixtures.

#### Scenario: Generic renderer fixture runs
- **WHEN** CI exercises text and DOM element selection
- **THEN** it uses only production fixture and production bundle paths

#### Scenario: Paper adapter fixture runs
- **WHEN** CI exercises logical canvas hit testing
- **THEN** it validates production adapter behavior and fallback without loading experimental files

### Requirement: Lifecycle and no-camera process verification
Process-level tests SHALL cover Vibecheck startup with the setting off, dormant
current-app relaunch, later app launch, target quit/reopen, pause/resume,
disable/re-enable without relaunch, component-only no-camera operation, owner
crash, and safe Vibecheck quit.

#### Scenario: Target is reopened after component disable
- **WHEN** Vibecheck remains running with component interaction disabled
- **THEN** process verification proves reenabling attaches without another user-visible restart

#### Scenario: Vibecheck starts with interaction disabled
- **WHEN** a supported target is already running and the persisted component setting is off
- **THEN** process verification proves Vibecheck establishes owned debugging and a dormant renderer controller without enabling the shortcut or input event tap

#### Scenario: Only component reactions are enabled
- **WHEN** the packaged or process fixture activates the component setting
- **THEN** verification proves that no camera or inference process starts

### Requirement: Clipboard destination compatibility verification
Native and end-to-end tests SHALL verify marked replay in representative plain-
text and rich/multimodal destinations, including ordered text/image pairs,
focus restoration, repeated paste, ordinary-copy reset, partial failure, and
unmarked pass-through.

#### Scenario: Marked bundle is pasted repeatedly
- **WHEN** a two-entry bundle is pasted twice into a supported fixture editor
- **THEN** both attempts receive the same ordered four paste events and the clipboard remains marked

### Requirement: Codex routing verification
Deterministic fake-Codex tests SHALL cover zero, one, and multiple active turns,
component-only startup, ordered batching, explicit priority, expression
coexistence, interrupt confirmation, replacement rejection, unknown outcome,
and shutdown drain. An opt-in live fixture SHALL use an isolated Codex task and
guaranteed cleanup.

#### Scenario: Multiple fake turns are active
- **WHEN** a component reaction is submitted in the routing fixture
- **THEN** no fake interrupt/start request occurs and the result reports ambiguous targeting

#### Scenario: Live fixture is not explicitly enabled
- **WHEN** ordinary CI runs
- **THEN** no real Codex task, GUI lifecycle, or conversation is modified

### Requirement: Signed clean-install acceptance
Public release SHALL be blocked until a signed, notarized build is tested from
the distributed artifact on a clean supported Mac/account for permission grant
and denial, target graceful relaunch, target-local selection, Paper selection,
clipboard replay, Codex sent and clipboard-only outcomes, pause/resume,
disable/re-enable, update identity, and safe quit.

#### Scenario: Clean-install acceptance succeeds
- **WHEN** every protected component-reaction acceptance case passes against the exact candidate artifact
- **THEN** the release records app version, dependency versions, architecture, signing identity, notarization result, and artifact hashes

#### Scenario: Permission identity is wrong
- **WHEN** macOS displays a helper or terminal identity instead of Vibecheck
- **THEN** release is blocked until bundle ownership and signing are corrected

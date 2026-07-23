## ADDED Requirements

### Requirement: Direct Developer ID distribution
The first public preview SHALL be distributed directly as an arm64 macOS
application signed with an Apple Developer Program `Developer ID Application`
identity. It SHALL use one stable reverse-DNS bundle identifier and Apple team
configuration supplied by the release environment; personal Apple account
email addresses and signing secrets MUST NOT be committed. Mac App Store
sandboxing and review are not part of this release.

#### Scenario: Release configuration is resolved
- **WHEN** an authorized maintainer starts a release build
- **THEN** the build uses the recorded stable bundle identifier and obtains the matching Developer ID team identity from protected release configuration

#### Scenario: Intel Mac opens the preview
- **WHEN** an x64 Mac attempts to install the first arm64-only preview
- **THEN** the release metadata communicates the architecture requirement instead of silently installing incompatible helpers

### Requirement: Self-contained frozen runtime
The application bundle SHALL contain the Electron runtime, an arm64 frozen
Python runtime with only required production modules and native dependencies,
the arm64 Rust interruption executable, the selected EmotiEffLib
`enet_b0_8_best_afew` ONNX model, and required license notices. Runtime startup
MUST NOT import from a source checkout, require Homebrew/Cargo/Python, download
executable code, or fetch the model before first use.

#### Scenario: Clean Mac launches offline
- **WHEN** the notarized application is copied to a clean supported arm64 Mac with no developer tools and no network
- **THEN** the menu opens and demo-mode runtime verification can start using only bundled, signed resources

### Requirement: Measured release-size gate
The release pipeline SHALL report uncompressed application size, compressed
DMG size, and the largest bundled components. It SHALL include only the selected
production model rather than the complete EmotiEffLib model repository. A size
budget SHALL be accepted from the first representative frozen build before
public release; exceeding it MUST fail release or trigger an explicitly
versioned model/data strategy that never replaces executable code.

#### Scenario: Candidate artifact is assembled
- **WHEN** Electron, Python, native ML libraries, Rust, and the selected model have been packaged
- **THEN** CI publishes a component-size report and enforces the recorded preview budget

### Requirement: Vibecheck-owned camera consent
The outer Vibecheck application SHALL provide the camera usage description and
request camera authorization before starting a camera-using Python topology.
The signed nested Python helper SHALL be launched and entitled so camera access
is attributed to Vibecheck. Public release MUST be blocked unless a clean-Mac
test proves that the system prompt and Privacy settings identify Vibecheck
without a second Python/helper identity.

#### Scenario: Camera feature is enabled for the first time
- **WHEN** the user enables the notch or interruption on a clean Mac
- **THEN** macOS presents one Vibecheck-branded camera consent prompt before the Python camera worker starts

#### Scenario: Camera permission is denied
- **WHEN** the user denies the Vibecheck camera request
- **THEN** no camera worker starts and the menu presents `Needs Permission` with a path to the appropriate System Settings pane

### Requirement: Declared ChatGPT automation permission
While managed Codex GUI restart uses `osascript` to tell ChatGPT to quit, the
signed application and responsible nested helper SHALL declare the required
Apple Events automation entitlement and a user-facing Apple Events usage
description naming the limited ChatGPT lifecycle purpose. Vibecheck MUST NOT
request broader automation targets, and the release SHALL verify behavior for
granted and denied automation permission.

#### Scenario: Managed GUI restart is first required
- **WHEN** Vibecheck initializes Codex GUI management without existing authorization
- **THEN** macOS presents a Vibecheck-to-ChatGPT automation consent prompt with the declared purpose

#### Scenario: Automation permission is denied
- **WHEN** the user denies ChatGPT automation
- **THEN** Vibecheck reports an actionable Codex integration error and does not force-kill ChatGPT or bypass TCC

### Requirement: Hardened nested-code signing
The release SHALL enable the hardened runtime and sign every nested executable,
dynamic library, framework, Python extension, Rust binary, helper, and the
outer Electron application with compatible entitlements and the same release
identity before packaging. Signing MUST preserve Electron's required runtime
entitlements while granting camera or automation authority only to code that
requires it.

#### Scenario: Signing verification runs
- **WHEN** the application bundle has been assembled
- **THEN** strict recursive code-signing verification succeeds and no nested executable remains ad hoc signed, unsigned, or signed by an unexpected team

### Requirement: Notarized and stapled release artifact
Every public artifact SHALL be submitted using Apple's current notary service,
must receive an accepted result, and SHALL have its notarization ticket stapled
and validated before publication. A rejected or ambiguous notarization result
MUST fail the release and retain the notarization log for diagnosis.

#### Scenario: Notarization succeeds
- **WHEN** Apple accepts the signed candidate
- **THEN** the release process staples and validates the ticket on the distributable artifact before computing its published checksum

#### Scenario: Notarization fails
- **WHEN** Apple rejects the submission or reports invalid nested code
- **THEN** no artifact is published and the protected build retains the notary log without exposing credentials

### Requirement: Gatekeeper verification on a clean Mac
Release acceptance SHALL verify the downloaded artifact rather than only the
build-tree application. Verification SHALL cover signature integrity,
Gatekeeper assessment, stapling, quarantine-origin launch, menu-bar behavior,
camera consent, automation consent, Python/Rust startup, and safe quit on a
clean supported arm64 macOS installation.

#### Scenario: User downloads the public artifact
- **WHEN** the notarized artifact is downloaded with quarantine metadata and opened on a clean Mac
- **THEN** Gatekeeper accepts it, Vibecheck launches as a menu-bar utility, and enabled workers run without security override instructions

### Requirement: Protected release credentials
Developer ID signing material and notarization credentials SHALL exist only in
the maintainer keychain or protected CI secret store. Automated notarization
SHALL use a scoped App Store Connect API key or an equally protected Apple
supported credential, and logs MUST redact private keys, passwords, and tokens.

#### Scenario: Untrusted pull request builds
- **WHEN** CI runs for a fork or untrusted contribution
- **THEN** it can execute unsigned tests but cannot access signing or notarization credentials

### Requirement: Release provenance and rollback
Each published artifact SHALL be associated with an immutable source revision,
locked Electron/Node/Python/Rust dependencies, a version, a SHA-256 checksum,
notarization result, architecture, and third-party notices. The previous
notarized version SHALL remain available for rollback. Automatic updating is
deferred and MUST NOT be implied by the initial menu-bar release.

#### Scenario: Release is published
- **WHEN** all signing, notarization, and clean-Mac checks pass
- **THEN** the artifact, checksum, source revision, version, architecture, and notices are published together

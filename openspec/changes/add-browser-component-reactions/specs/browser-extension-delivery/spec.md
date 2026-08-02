## ADDED Requirements

### Requirement: Loopback-only browser host
Electron main SHALL own exactly one browser reaction host for the Vibecheck
application lifetime. It MUST bind only to IPv4 loopback, MUST NOT register a
daemon or login item, and MUST close all connections and listeners during
bounded application shutdown.

#### Scenario: Vibecheck starts
- **WHEN** Electron component ownership starts
- **THEN** the browser host begins listening independently of camera, model, inference, notch, and emotion-heartbeat startup

#### Scenario: Loopback port is unavailable
- **WHEN** another process owns the configured browser host port
- **THEN** browser reactions report a degraded transport while healthy Electron reactions and sensor startup remain available

#### Scenario: Vibecheck exits
- **WHEN** the application quits
- **THEN** the browser listener and every accepted extension connection close without leaving an independently running helper

### Requirement: Authenticated and bounded extension protocol
The browser host SHALL require an allowed extension origin and successful
bundled-client challenge before accepting state or commits. It MUST use
versioned exact-key messages, enforce encoded and decoded limits, reject
unsolicited message types, and close abusive or incompatible connections.

#### Scenario: Ordinary webpage connects
- **WHEN** a webpage script attempts to open the browser host socket
- **THEN** the host rejects the upgrade or authentication and accepts no state or reaction event

#### Scenario: Protocol version differs
- **WHEN** an extension with an incompatible protocol version connects
- **THEN** the host closes that connection with a bounded diagnostic and does not change global feature state

#### Scenario: Oversized frame arrives
- **WHEN** an extension sends a frame beyond the configured maximum
- **THEN** the host closes the connection before parsing or writing the payload

#### Scenario: Page attempts to forge identity
- **WHEN** a content event includes its own tab, frame, browser, or application identity
- **THEN** the extension background and host ignore those fields and use trusted sender/connection metadata

### Requirement: Authoritative state synchronization
Electron SHALL be the sole authority for browser enabled state, global capture
session, emoji recents, and settlement. A new or reconnected extension MUST
receive a complete snapshot before it can produce an accepted commit.

#### Scenario: Extension connects while feature is disabled
- **WHEN** a compatible extension connects while component reactions are off
- **THEN** it receives a dormant snapshot and reports its permitted tabs without enabling interaction

#### Scenario: Extension reconnects during active session
- **WHEN** a compatible extension reconnects while a global capture session is active
- **THEN** it receives the current enabled state, session ID, and global recents in one authoritative snapshot

#### Scenario: Commit precedes synchronization
- **WHEN** a connection submits a commit before completing handshake and state synchronization
- **THEN** the host rejects the commit without touching clipboard or Codex

### Requirement: Additive browser health
Vibecheck SHALL report browser transport state and attached browser-tab count
separately from owned Electron target counts. No installed or connected
extension SHALL be a normal listening state, while real listener, protocol, or
capture failures SHALL be visible.

#### Scenario: No extension is installed
- **WHEN** the browser host is listening and no compatible extension connects
- **THEN** Vibecheck does not mark working Electron component reactions degraded

#### Scenario: Browser and Electron targets are attached
- **WHEN** both transports have usable renderers
- **THEN** the top-level component reaction menu row summarizes current state without moving status into a submenu

#### Scenario: Browser connection fails after attachment
- **WHEN** a connected browser transport repeatedly violates protocol or fails capture
- **THEN** Vibecheck reports a browser diagnostic while preserving healthy Electron interaction

### Requirement: Explicit browser setup
Vibecheck MUST NOT silently install an extension, modify a browser profile, or
grant site access. It SHALL expose explicit setup actions and accurate
permission state for the packaged Chrome and Safari extensions.

#### Scenario: User opens Chrome setup
- **WHEN** the user invokes Chrome component-reaction setup
- **THEN** Vibecheck opens the owned setup path for the packaged extension without changing the current Chrome profile

#### Scenario: User opens Safari setup
- **WHEN** the user invokes Safari component-reaction setup
- **THEN** Vibecheck requests Safari's extension preferences for the packaged extension without granting or simulating approval

#### Scenario: Safari site access is not granted
- **WHEN** the Safari extension exists but has no permission for a page
- **THEN** Vibecheck does not report that page attached and leaves it untouched

### Requirement: Production browser asset build
Chrome and Safari browser assets SHALL be built from production-owned source
with deterministic entry points and no runtime TypeScript, source-map, local
absolute path, or experimental dependency in the package.

#### Scenario: Browser bundle build
- **WHEN** the production component build runs
- **THEN** it emits a manifest, content bundle, background bundle, and owned icons from `src` inputs only

#### Scenario: Safari extension build
- **WHEN** the macOS production package is prepared
- **THEN** Apple's Safari Web Extension tooling builds a macOS extension bundle that is embedded under `Contents/PlugIns`

#### Scenario: Experimental directory is unavailable
- **WHEN** all experimental files are removed from the build environment
- **THEN** browser asset compilation, component tests, and application packaging still complete

### Requirement: Least-privilege signed Safari extension
The Safari Web Extension SHALL have a stable Vibecheck extension identity,
only the permissions required for permitted-page selection, runtime messaging,
storage, and visible-tab capture, and no camera or broad Electron runtime
entitlements. Release packaging MUST sign and notarize it as nested code.

#### Scenario: Release signature inspection
- **WHEN** the distributed application is verified
- **THEN** the embedded Safari extension has the expected bundle identifier, Developer ID team, hardened signature, and allowed entitlements

#### Scenario: Unexpected entitlement appears
- **WHEN** the embedded extension requests camera, JIT, unsigned executable memory, disabled library validation, or arbitrary automation entitlement
- **THEN** release verification fails

### Requirement: Browser compatibility verification
The production browser integration SHALL have automated contract tests,
Chromium end-to-end coverage, and protected signed Safari acceptance coverage.
Test harnesses MUST use isolated profiles and MUST NOT restart or modify a
developer's ordinary signed-in browser profile.

#### Scenario: Chromium automated acceptance
- **WHEN** the browser suite runs
- **THEN** it verifies dormant mode, physical-equivalent shortcut dispatch, exact text, element click suppression, emoji commit, cropped screenshot, global session behavior, frames, navigation, recents, settlement, reconnect, and cleanup in an isolated profile

#### Scenario: Safari signed acceptance
- **WHEN** the protected macOS acceptance lane runs with the extension enabled
- **THEN** it verifies physical shortcut, physical pointer selection, screenshot, navigation, disable/re-enable, site denial, and app quit in an ordinary Safari tab

#### Scenario: Source independence guard
- **WHEN** repository and packaged-artifact guards scan production inputs and outputs
- **THEN** no browser asset, command, source map, manifest, binary string, or fixture references an experimental or developer-local path

### Requirement: Startup heartbeat isolation
Browser host setup, browser asset checks, extension connection, screenshot
capture, and browser recovery MUST remain independent of emotion-stream binding
and loading heartbeat publication. Browser work MUST NOT lower or override the
centralized 1.5-second freshness default.

#### Scenario: Browser host is slow or unavailable during sensor cold start
- **WHEN** browser setup is deliberately delayed while a real emotion provider cold-starts
- **THEN** the emotion socket binds first, loading remains visible through the first reading or terminal producer state, and loading does not become stale solely because of browser work

#### Scenario: Component reactions are the only enabled feature
- **WHEN** only component reactions and browser attachment are enabled
- **THEN** browser ownership starts without camera permission, provider import, model construction, first-frame inference, or notch startup

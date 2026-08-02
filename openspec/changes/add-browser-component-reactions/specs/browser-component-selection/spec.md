## ADDED Requirements

### Requirement: Supported browser webpage content
Vibecheck SHALL support component reactions in permitted webpage content in
current Chrome and Safari releases through a production browser extension. It
MUST NOT claim support for browser chrome, restricted internal pages, or pages
where the browser refuses extension access.

#### Scenario: Permitted Chrome page
- **WHEN** the Chrome extension is installed, connected, and permitted on an ordinary webpage
- **THEN** the page receives the dormant or active production component controller without a browser restart

#### Scenario: Permitted Safari page
- **WHEN** the signed Safari Web Extension is enabled with site access and Vibecheck is running
- **THEN** the page receives the same component interaction behavior as a permitted Chrome page

#### Scenario: Browser-owned page
- **WHEN** a tab displays a browser settings, extension-store, or other restricted internal page
- **THEN** Vibecheck does not inject, capture, consume the shortcut, or report that page as attached

### Requirement: Shared production renderer behavior
Browser content SHALL execute the same production renderer controller contract
used by attached Electron renderers. Browser builds MUST NOT copy an
independently maintained selector implementation or import experimental source.

#### Scenario: Renderer behavior changes
- **WHEN** the production selector, picker, shortcut, or settlement behavior is updated
- **THEN** Electron and browser entry points consume that same controller implementation

#### Scenario: Production build without experiments
- **WHEN** browser assets and the packaged application are built with experimental directories unavailable
- **THEN** component selection and browser packaging still succeed

### Requirement: Dormant browser controller
The browser controller SHALL remain dormant until it receives a current
effective state from Vibecheck. Disabled, paused, disconnected, and shut-down
states MUST remove interaction UI, clear selection state, pass through
`Control-Option-R`, and expose no alternate commit path.

#### Scenario: Vibecheck is absent
- **WHEN** an installed extension loads a page while the Vibecheck host is unavailable
- **THEN** no shortcut is consumed and no selector, screenshot, clipboard, or reaction event occurs

#### Scenario: Feature is disabled without browser restart
- **WHEN** Vibecheck disables component reactions while tabs remain open
- **THEN** every connected content controller becomes dormant and later reenables without reloading or restarting the browser

#### Scenario: Vibecheck quits
- **WHEN** Vibecheck shuts down while a browser interaction is open
- **THEN** the extension disposes that interaction and stays dormant while its reconnect attempts remain bounded

### Requirement: Cross-transport global capture session
Vibecheck SHALL maintain one global component-capture session across Electron,
Chrome, and Safari renderers. A no-selection `Control-Option-R` event from any
healthy renderer SHALL toggle that session everywhere.

#### Scenario: Session begins in Chrome
- **WHEN** the user presses `Control-Option-R` in a permitted Chrome page without usable selected text
- **THEN** all connected browser and Electron renderers receive the same new capture-session identity

#### Scenario: Session ends in Safari
- **WHEN** a global capture session is active and the user presses the shortcut in a permitted Safari page
- **THEN** Vibecheck ends the session globally without changing the existing clipboard bundle

#### Scenario: New document joins active session
- **WHEN** a permitted tab navigates or a new permitted frame loads during a global capture session
- **THEN** its controller receives the current session identity and enters component-picking state

### Requirement: Browser text and element interaction
Browser pages SHALL retain the existing selected-text one-shot and global
element-picking semantics. A locking click MUST be consumed, and choosing an
emoji MUST remain the only commit action.

#### Scenario: Existing selected text
- **WHEN** the user selects non-empty webpage text and presses `Control-Option-R` outside a global capture session
- **THEN** only the exact range is highlighted and the resulting reaction is a non-stacking one-shot

#### Scenario: DOM component lock
- **WHEN** the user hovers and clicks a usable DOM component during a global capture session
- **THEN** the underlying page action does not fire and the target-local emoji picker opens

#### Scenario: Dismiss without emoji
- **WHEN** the user dismisses a locked browser target without choosing an emoji
- **THEN** no screenshot, clipboard mutation, or Codex reaction is produced

### Requirement: Browser frame isolation
The extension SHALL install isolated controllers in every permitted frame and
MUST associate events with trusted browser sender metadata. It MUST NOT accept
tab, window, or frame identity supplied by page JavaScript.

#### Scenario: Cross-origin iframe is permitted
- **WHEN** the extension has access to a cross-origin child frame
- **THEN** that frame can select and commit its own visible DOM components

#### Scenario: Frame navigates before settlement
- **WHEN** the committing frame is replaced before Vibecheck returns an outcome
- **THEN** the stale settlement does not update the new document's UI

#### Scenario: Frame is not permitted
- **WHEN** browser site-access policy excludes a child frame
- **THEN** Vibecheck leaves that frame untouched and does not fabricate a selectable parent target for its contents

### Requirement: Clean browser screenshot
An emoji commit from a browser SHALL include a valid PNG cropped to the
component's padded visible bounds. The controller MUST hide its overlay and
picker before capture, and Vibecheck MUST reject stale, malformed, oversized,
or dimensionally inconsistent captures before changing the clipboard.

#### Scenario: Successful active-tab capture
- **WHEN** the committing tab remains active and its visible screenshot matches the reported viewport
- **THEN** Vibecheck crops a valid overlay-free PNG and processes it through the existing clipboard and reaction route

#### Scenario: Tab loses focus before capture
- **WHEN** another tab becomes active before the extension captures the committing tab
- **THEN** the event settles as `copy_failed` without appending a clipboard entry or sending Codex context

#### Scenario: Component is partially outside the viewport
- **WHEN** padded component bounds extend outside the visible page image
- **THEN** Vibecheck clips the crop to valid image pixels

#### Scenario: Screenshot is invalid
- **WHEN** the extension submits a malformed data URL, non-PNG payload, excessive frame, or impossible dimensions
- **THEN** Vibecheck rejects it, records a bounded diagnostic, and leaves the clipboard unchanged

### Requirement: Existing reaction policy applies to browsers
Browser commits SHALL use the existing Vibecheck emoji recents, marked
clipboard bundle, target-local receipts, and zero/one/many Codex selection
policy without browser-specific variants.

#### Scenario: First browser commit in a new global session
- **WHEN** a component is committed after a prior global session ended and a new session began
- **THEN** the first commit replaces the old marked bundle rather than appending to it

#### Scenario: Later browser and Electron commits in one session
- **WHEN** the user commits components in Chrome and an Electron app during the same global session
- **THEN** the entries append in commit order to one marked clipboard bundle

#### Scenario: Exactly one Codex turn is active
- **WHEN** a validated browser reaction is copied while exactly one Codex turn is active
- **THEN** the existing Rust owner interrupts that turn with the same explicit reaction context and screenshot

#### Scenario: Zero or multiple Codex turns are active
- **WHEN** a validated browser reaction is copied while zero or multiple Codex turns are active
- **THEN** the bundle remains copied and no Codex turn is selected automatically

### Requirement: Browser navigation continuity
The extension SHALL reinstall the controller for new documents and reconcile
authoritative host state after reload, navigation, process suspension, service
worker restart, or loopback reconnection.

#### Scenario: Same-tab navigation
- **WHEN** a connected tab performs a full navigation
- **THEN** the old document becomes obsolete and the new permitted document receives current enabled, session, and recents state

#### Scenario: Extension background restarts
- **WHEN** the browser suspends and later restarts the extension background
- **THEN** it reconnects with bounded backoff, re-identifies live permitted tabs, and applies one current host snapshot

#### Scenario: Duplicate event after reconnect
- **WHEN** a browser retries an event already accepted for the same connection/document/event identity
- **THEN** Vibecheck does not append or route the event twice

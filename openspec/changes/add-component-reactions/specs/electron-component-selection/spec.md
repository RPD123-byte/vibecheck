## ADDED Requirements

### Requirement: Vibecheck-lifetime supported target launch
Whenever Vibecheck is running, it SHALL discover supported Electron/CEF
application bundles and own their launches with a unique loopback-only Chromium
debugging endpoint regardless of the component-reaction setting. It MUST
validate the bundle and executable, request graceful termination when relaunch
is required, and MUST NOT modify the target bundle, ASAR, executable, or
user-data directory.

#### Scenario: Supported app is already running without debugging
- **WHEN** Vibecheck starts and a supported app is running without a Vibecheck-owned endpoint
- **THEN** Vibecheck requests graceful termination and relaunches the validated executable with fixed debugging arguments after it exits

#### Scenario: Target refuses graceful termination
- **WHEN** a supported running app does not exit within the bounded graceful interval
- **THEN** Vibecheck leaves it running, does not force-kill it, and reports that target unavailable

### Requirement: Vibecheck-lifetime target launch continuity
Vibecheck SHALL recognize every supported target launch during its own process
lifetime and preserve Vibecheck-owned debugging startup while component
reactions are active, paused, disabled, or have never been enabled. Owned
launches MUST be recognized without recursive relaunch.

#### Scenario: User relaunches an enrolled target while feature is disabled
- **WHEN** Vibecheck is still running and the user opens or reopens a supported target while component reactions are disabled
- **THEN** Vibecheck supplies the debugging transport so reenabling component reactions does not require another target restart

#### Scenario: Vibecheck-owned target starts
- **WHEN** the lifecycle observer sees a process carrying the current owned-launch identity
- **THEN** it records that process and endpoint without terminating or relaunching it again

#### Scenario: Vibecheck restarts while owned targets remain open
- **WHEN** a new Vibecheck process discovers a supported target carrying a valid loopback endpoint and typed Vibecheck ownership marker from the prior process
- **THEN** it reserves and reacquires that endpoint without misclassifying it as a foreign collision or relaunching the target

### Requirement: Centralized renderer attachment
Electron main SHALL own one in-process CDP service for every attached target and
MUST NOT create one injector process per application. The service SHALL discover
page targets, maintain bounded sessions, install the production renderer bundle
idempotently, and reattach after page or renderer replacement.

#### Scenario: Component setting is disabled at attachment
- **WHEN** a supported renderer attaches while component reactions are disabled
- **THEN** Vibecheck installs the production controller in dormant state so later enablement requires neither target restart nor source reinjection

#### Scenario: Target contains multiple page renderers
- **WHEN** a supported process exposes multiple usable page targets
- **THEN** the centralized service attaches and applies current component enablement independently to each page target

#### Scenario: Target navigates
- **WHEN** an attached renderer creates a new document
- **THEN** the production bundle is installed in that document and receives the current enabled or dormant state

### Requirement: Dormant injected behavior
The renderer bundle SHALL expose a namespaced idempotent controller and SHALL
support enable, disable, settle, and dispose operations. Disabled state MUST
close all component UI, clear pending target state, remove visual overlays,
pass through `Control-Option-R`, and expose no alternative interaction entry
point.

#### Scenario: Feature is disabled without target restart
- **WHEN** Electron changes an attached renderer from enabled to dormant
- **THEN** the renderer removes its active interaction and later reenables from the existing installation without reinjection

#### Scenario: Shortcut is pressed while dormant
- **WHEN** the user presses `Control-Option-R` in a disabled attached renderer
- **THEN** the event is not consumed and no highlight, picker, capture, clipboard change, or host event occurs

### Requirement: Existing text selection workflow
When enabled and no global component-capture session is active,
`Control-Option-R` SHALL use a non-empty usable browser `Selection` and cloned
`Range` as a one-shot interaction before considering element mode. It SHALL
highlight only the exact selected characters, position the reaction popover
from live range rectangles, use the exact trimmed selection as copy text, and
MUST NOT start or join clipboard accumulation.

#### Scenario: User has selected nested text
- **WHEN** the selection spans text nodes with nested inline markup inside one semantic container
- **THEN** Vibecheck highlights the exact range without adding wrappers or modifying React-owned content

#### Scenario: Selected range becomes unusable
- **WHEN** the target renderer replaces or disconnects the selected content before emoji commit
- **THEN** Vibecheck dismisses the interaction without copying or sending stale content

### Requirement: Host-coordinated global component capture session
When enabled and no usable text selection exists, `Control-Option-R` SHALL ask
Electron main to toggle one global component-capture session identified by an
unguessable session ID. Starting SHALL put every healthy attached renderer into
element-picking state; pressing the shortcut again in any attached renderer
SHALL end that session and dismiss active component UI everywhere.

#### Scenario: Session begins in Paper
- **WHEN** the user presses `Control-Option-R` in Paper without selected text
- **THEN** Paper and every other healthy attached renderer receive the same active session identity and permit component picking

#### Scenario: Session ends from another app
- **WHEN** the global session is active and the user presses `Control-Option-R` in Cursor
- **THEN** Electron clears the global session and every attached renderer returns to idle without changing the current clipboard

#### Scenario: Component reaction settles while session remains active
- **WHEN** the user commits an emoji during a global session
- **THEN** the originating renderer returns to component-picking after its receipt and the global session remains active

#### Scenario: Feature becomes ineffective
- **WHEN** component reactions are paused, disabled, or shut down during a global session
- **THEN** Electron ends the session and every renderer clears its active selection UI

### Requirement: DOM element selection workflow
While a global component-capture session is active, pointer movement SHALL
outline the usable DOM element under the pointer; the locking click SHALL be
consumed so the underlying control does not activate; and the locked element
SHALL remain spotlighted until commit or dismissal.

#### Scenario: User selects a button
- **WHEN** the user enters element mode, hovers a usable button, and clicks it
- **THEN** the button does not activate and the reaction popover opens for that locked element

#### Scenario: User cancels element mode
- **WHEN** the user presses Escape before locking an element
- **THEN** outlines and hints are removed and no copy or host event occurs

### Requirement: Paper logical-canvas selection
The initial production release SHALL include an isolated Paper adapter that
uses Paper's live logical hit test and coordinate transforms to identify the
node beneath a pointer and calculate its current viewport bounds. Failure to
resolve the private capability MUST fall back to the generic canvas element and
MUST NOT fabricate a logical node.

#### Scenario: User selects a Paper canvas node
- **WHEN** the pointer is over a resolvable Paper frame, text node, or component
- **THEN** the overlay follows that logical node's viewport bounds and the capture uses its visible label/text and bounds

#### Scenario: Paper internals changed
- **WHEN** the required hit-test or transform capability is unavailable
- **THEN** Vibecheck reports no logical Paper target and preserves the generic DOM selection path

### Requirement: Emoji choice is the only commit
Locking text or an element SHALL NOT capture content, change the clipboard, or
send a Codex event. A committed event SHALL be created only when the user
chooses an emoji. Choosing the same emoji in later interactions SHALL create a
new independent event.

#### Scenario: User dismisses after selecting a target
- **WHEN** a target is locked and the user clicks away or presses Escape without choosing an emoji
- **THEN** the interaction closes with no clipboard or Codex side effect

#### Scenario: User repeats the same reaction
- **WHEN** the user reacts with the same emoji to the same component in two separate interactions
- **THEN** Vibecheck commits two events and does not interpret the second as removal

### Requirement: Production reaction picker
The target-local UI SHALL provide six fixed reactions rendered from the
installed macOS Messages Tapback templates, two global recent emoji in the
compact strip, and an expanded categorized Unicode picker with five global
recent emoji. The signed native companion SHALL load a fixed allowlist of
installed `AckFunction-*` templates at runtime, return bounded rendered assets
through its typed protocol, and Electron SHALL synchronize the validated map to
every attached Electron/CEF and browser renderer. Controls SHALL remain keyboard
accessible. Vibecheck MUST NOT copy or package Apple artwork.

#### Scenario: User selects a custom emoji
- **WHEN** an emoji is chosen from the expanded picker
- **THEN** it commits the event, becomes the newest global Vibecheck recent, and is available to later attached renderers

#### Scenario: Expanded picker is dismissed with Escape
- **WHEN** the expanded picker is open and the user presses Escape once
- **THEN** Vibecheck returns to the compact reaction strip without discarding the locked target

#### Scenario: Installed Tapback template is unavailable
- **WHEN** the installed framework cannot provide one or more allowlisted fixed reaction templates
- **THEN** the affected fixed reactions use production-authored fallback glyphs while selection, emoji commit, clipboard delivery, and Codex routing remain available

### Requirement: Global recents belong to Vibecheck
Emoji recents SHALL be persisted by Vibecheck and synchronized to renderers.
They MUST NOT be stored in or read from a target application's local storage,
cookies, database, or profile files.

#### Scenario: Reaction is used in Paper
- **WHEN** a custom emoji is committed in Paper and the user later opens the picker in another attached Electron app
- **THEN** the same emoji appears as the newest global recent

#### Scenario: Target profile is cleared
- **WHEN** an attached target clears its renderer storage
- **THEN** Vibecheck global recents remain unchanged

### Requirement: Copy-like text only
Text capture SHALL use the exact selected text in text mode, rendered visible
element text in DOM element mode, or visible logical label/text in Paper mode.
The capture MUST NOT contain cloned HTML, outerHTML, hidden text, DOM paths,
component class names, CSS selectors, URLs, or private editor objects.

#### Scenario: DOM component contains nested markup
- **WHEN** a selected component contains spans, icons, and styling attributes
- **THEN** the captured text contains only its rendered copy-like text and no markup serialization

#### Scenario: Component has no visible text
- **WHEN** a selected element has no rendered text but exposes an accessible label
- **THEN** the accessible label is used as copy text without serializing the element

### Requirement: Clean component screenshot
After emoji commit, Vibecheck SHALL remove the picker, scrim, highlight, and
selection overlay before capturing a padded PNG crop of the target's current
visible bounds. Capture SHALL clip to the visible viewport and use the same
host path for DOM and Paper bounds.

#### Scenario: Selected component is partially offscreen
- **WHEN** the padded target bounds extend outside the visible viewport
- **THEN** the screenshot is clipped to valid visible page coordinates and remains a valid PNG

#### Scenario: Target disappears before capture
- **WHEN** the selected target has no current usable bounds at commit time
- **THEN** capture fails without appending a partial clipboard entry or sending Codex context

### Requirement: Minimal explicit agent context
Every routed event SHALL identify the source application, chosen emoji and
reaction label, copy-like text, and screenshot. The message MUST distinguish
the reaction as explicit user feedback and MUST NOT infer an ambiguous emoji as
a standalone command.

#### Scenario: Reaction reaches Codex
- **WHEN** a component event is routed to exactly one active Codex turn
- **THEN** Codex receives a concise explicit-reaction message, the copy-like text, and the component PNG

### Requirement: Target-local delivery receipt
After screenshot capture and clipboard/routing settlement, the renderer SHALL
show a short-lived noninteractive receipt near the selected target. Screenshot
capture MUST precede the receipt so the receipt is not included in the PNG.

#### Scenario: Reaction is sent and copied
- **WHEN** clipboard append succeeds and Rust confirms a Codex replacement
- **THEN** the receipt reports `Sent to Codex · Copied`

#### Scenario: Active targeting is ambiguous
- **WHEN** clipboard append succeeds and Rust finds multiple active Codex turns
- **THEN** the receipt reports that the reaction was copied because multiple tasks were active

#### Scenario: Renderer was replaced before settlement
- **WHEN** Electron receives a result for an event from an obsolete renderer document
- **THEN** it ignores the stale visual settlement without affecting the clipboard or Codex outcome

### Requirement: Coordinated Codex source launch
ChatGPT/Codex SHALL be a supported selectable source. Vibecheck SHALL use one
coordinated GUI launch path that satisfies both renderer debugging and the
existing `codex-control` lifecycle. Electron and Rust MUST NOT independently
restart Codex for the same desired state.

#### Scenario: Codex source needs renderer attachment
- **WHEN** Codex requires a managed relaunch and the existing Codex lifecycle owner is preparing that launch
- **THEN** the same launch includes the managed-daemon environment, owned renderer endpoint, and ownership marker without a second quit/relaunch cycle

#### Scenario: Codex is actively generating
- **WHEN** source-only attachment would require relaunching a Codex GUI with an active turn
- **THEN** Vibecheck defers that attachment rather than destroying the active turn solely to enable selection

#### Scenario: Component interaction is disabled in ChatGPT
- **WHEN** ChatGPT is owned and attached while component reactions are disabled
- **THEN** its renderer controller remains installed in dormant state and Control-Option-R passes through until the setting is enabled

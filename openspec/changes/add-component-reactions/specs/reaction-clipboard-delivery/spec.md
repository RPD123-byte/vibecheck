## ADDED Requirements

### Requirement: Versioned marked reaction bundle
Vibecheck SHALL store committed component reactions on one pasteboard item with
a private marker and versioned bundle representation containing an ordered
array of complete copy-text and raw PNG pairs. It SHALL also expose useful
ordinary text and image flavors for applications that do not invoke special
expansion.

#### Scenario: First reaction is committed
- **WHEN** the current pasteboard does not contain a supported marked bundle
- **THEN** Vibecheck writes a new bundle containing exactly that reaction's text and PNG

#### Scenario: Unknown bundle version is present
- **WHEN** a new reaction is committed over a marked bundle with an unsupported version
- **THEN** Vibecheck starts a fresh current-version bundle rather than interpreting unknown data

### Requirement: Ordered accumulation
Each committed component reaction in one active global capture session SHALL
append to that session's marked bundle in commit order. The first successful
commit of a newly started session SHALL atomically replace any prior marked
bundle. Automatic Codex delivery MUST NOT remove an entry from the clipboard.

#### Scenario: Three reactions are committed in one session
- **WHEN** the user starts one global session and commits three component reactions
- **THEN** the bundle contains all three text/PNG pairs in original commit order

#### Scenario: A later session begins
- **WHEN** the user ends a session, starts another, and commits its first component reaction
- **THEN** the bundle contains only the new session's first text/PNG pair

#### Scenario: Selected text is reacted to ad hoc
- **WHEN** the user invokes `Control-Option-R` over a usable text selection outside a global session and commits an emoji
- **THEN** Vibecheck atomically replaces the clipboard bundle with exactly that one text/PNG pair

### Requirement: Ordinary copy resets accumulation
Vibecheck SHALL identify its bundle only by the current private marker and valid
bundle data. Any ordinary copy that replaces the pasteboard SHALL remove that
identity naturally; Vibecheck MUST NOT monitor, restore, or merge unrelated
clipboard contents.

#### Scenario: User copies ordinary text between reactions
- **WHEN** another application replaces the clipboard after one component reaction
- **THEN** the next component reaction starts a bundle containing only the new reaction

#### Scenario: Clipboard manager restores unmarked content
- **WHEN** the current pasteboard contains no valid Vibecheck marker
- **THEN** Vibecheck treats it as unrelated content and does not inspect or merge it

### Requirement: No expiration, cap, or consumed state
The initial component-reaction bundle SHALL have no product-level expiration,
entry-count limit, byte-count limit, or consumed flag. Successful paste SHALL
restore the same bundle unchanged.

#### Scenario: Bundle was pasted successfully
- **WHEN** marked paste expansion completes
- **THEN** the current clipboard still contains the identical ordered marked bundle

#### Scenario: Time passes without another copy
- **WHEN** a marked bundle remains the current clipboard value
- **THEN** its entries remain available for repeated paste regardless of elapsed time

### Requirement: Repeated Command-V replays the complete bundle
While component reactions are effective, one physical Command-V over a marked
bundle SHALL emit one text-only paste followed by one image-only paste for each
entry in order, then restore the original marked bundle. A later Command-V
SHALL repeat the same complete sequence.

#### Scenario: Two-entry bundle is pasted twice
- **WHEN** the user presses Command-V twice without replacing the clipboard
- **THEN** each press emits text1, image1, text2, image2 and the bundle remains unchanged after both sequences

### Requirement: Unmarked input passes through
The native event tap SHALL intercept Command-V only when component reactions
are effective and the current clipboard contains a valid Vibecheck marker.
Every unmarked Command-V and every other keyboard or pointer event MUST pass
through unchanged.

#### Scenario: User pastes ordinary clipboard text
- **WHEN** the clipboard is unmarked and the user presses Command-V
- **THEN** Vibecheck neither swallows nor synthesizes the event

#### Scenario: Component feature is paused
- **WHEN** a marked bundle exists but component reactions are paused or disabled
- **THEN** the special event tap is inactive and Vibecheck performs no expanded paste sequence

### Requirement: Focus-preserving paste sequence
Before expansion, Vibecheck SHALL capture the currently focused Accessibility
element. Between text and image pastes and between bundle entries, it SHALL
attempt to restore that element and SHALL use a tested bounded delay so
ordinary destination editors can process each event.

#### Scenario: Destination temporarily moves focus
- **WHEN** the first paste causes focus to leave the original editor but the original Accessibility element remains focusable
- **THEN** Vibecheck restores that element before emitting the next paste event

#### Scenario: Original focus cannot be restored
- **WHEN** the destination destroys or rejects the original focused element
- **THEN** Vibecheck stops or reports the partial failure and restores the marked clipboard bundle

### Requirement: Synthetic-event reentrancy protection
Synthetic Command-V events emitted by the expansion sequence MUST NOT trigger a
second expansion. Concurrent physical marked-paste requests SHALL be serialized
or rejected without interleaving temporary pasteboard values.

#### Scenario: Synthetic text paste is posted
- **WHEN** the event tap observes a Vibecheck-generated Command-V
- **THEN** it passes that event to the destination without recursively expanding the bundle

#### Scenario: User presses Command-V during active expansion
- **WHEN** an expansion sequence already owns the temporary pasteboard
- **THEN** Vibecheck prevents a second sequence from interleaving with it

### Requirement: Clipboard-first commit
A reaction SHALL be eligible for Codex routing only after its complete text/PNG
pair has been appended successfully to the marked clipboard. Clipboard failure
MUST prevent component Codex mutation.

#### Scenario: Clipboard append succeeds
- **WHEN** the native companion confirms the complete updated bundle
- **THEN** Electron may submit the corresponding event to the Rust reaction endpoint

#### Scenario: Clipboard append fails
- **WHEN** the pasteboard rejects the bundle write
- **THEN** Vibecheck reports `Copy failed` and sends no component reaction to Codex

### Requirement: Exact restoration after success or failure
During expansion Vibecheck MAY write temporary text-only and image-only
pasteboard items, but it SHALL restore the original marked bundle after complete
success and after any partial failure.

#### Scenario: Image paste for a later entry fails
- **WHEN** one or more earlier temporary pastes were already emitted
- **THEN** Vibecheck reports partial failure and restores the exact original marked bundle

### Requirement: Private in-memory clipboard ownership
Vibecheck SHALL keep no durable clipboard database or reaction history.
Clipboard bundle data SHALL live in the system pasteboard, transient process
memory, and short-lived owner-only PNG files only.

#### Scenario: Vibecheck quits
- **WHEN** a marked bundle is currently on the system clipboard
- **THEN** Vibecheck removes its transient files and process memory without deliberately clearing the user's clipboard value

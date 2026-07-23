## ADDED Requirements

### Requirement: Non-activating macOS notch window
The notch process SHALL render an AppKit borderless, transparent, non-activating floating panel aligned to the built-in display notch. It MUST NOT steal keyboard focus, appear in normal window cycling, or require the inference process to run on the AppKit thread.

#### Scenario: Supported notched display is available
- **WHEN** the notch process starts on a display with a positive top safe-area inset
- **THEN** it creates the panel at the top of that screen and renders above ordinary menu-bar content

#### Scenario: No supported notch is available
- **WHEN** no connected screen exposes a usable notch area
- **THEN** the process reports an unsupported-display state and exits or remains hidden without creating a malformed overlay

### Requirement: Shared display threshold and hysteresis
The notch SHALL show non-neutral emotions only when their raw score is strictly greater than the shared entry threshold, defaulting to 0.50. An already-displayed emotion SHALL remain eligible while its score is at least the exit threshold, defaulting to 0.45, and SHALL disappear below that threshold.

#### Scenario: Emotion crosses entry threshold
- **WHEN** a non-neutral emotion rises from 0.50 or lower to greater than 0.50
- **THEN** it becomes eligible for display confirmation

#### Scenario: Displayed emotion fluctuates near entry threshold
- **WHEN** an active emotion falls below 0.50 but remains at or above 0.45
- **THEN** it remains displayed without threshold chatter

### Requirement: Display transition smoothing
The notch SHALL require two consecutive fresh inference results with the same candidate display state before initially showing or switching icons. It SHALL clear the committed icons immediately on the first fresh result containing no eligible non-neutral emotion, on no-face, or when the emotion stream becomes stale.

#### Scenario: Candidate repeats twice
- **WHEN** the same non-neutral display state is observed in two consecutive fresh readings
- **THEN** the notch commits that state on the second reading

#### Scenario: Single outlier appears
- **WHEN** one reading proposes a different non-neutral state and the next returns to the committed state
- **THEN** the displayed state does not switch

#### Scenario: Expression returns to neutral
- **WHEN** a fresh reading contains no eligible non-neutral emotion
- **THEN** all emotion icons are cleared without waiting for two confirmations

### Requirement: Neutral suppression and score ordering
Neutral MUST NOT be rendered as an emotion icon. Positive, negative, and surprise emotions MAY be displayed when eligible, and visible icons SHALL be ordered from highest to lowest current score.

#### Scenario: Neutral is dominant
- **WHEN** neutral has the highest score and every non-neutral score is ineligible
- **THEN** no emotion icon is shown

#### Scenario: Multiple non-neutral emotions are eligible
- **WHEN** more than one emotion passes display filtering
- **THEN** icons are ordered by descending score using deterministic tie-breaking

### Requirement: Single active-left layout
The production notch SHALL implement only the latest `active-left` layout, placing active icons immediately left of the camera notch while preserving both notch corner extensions. Production source, configuration, fixtures, and tests MUST NOT include the experimental `all-sides` diagnostic layout or a layout selector. Geometry SHALL retain the validated 32-point cell, 24-point visible glyph, four-point optical overlap, and configurable overlap range from zero through eight points.

#### Scenario: Active-left renders one or more icons
- **WHEN** the active set changes size
- **THEN** the visible glyph nearest the camera remains at the same optical edge while panel width adjusts

#### Scenario: No emotion is active
- **WHEN** no emotion is active
- **THEN** only the notch shape and required corner extensions remain

#### Scenario: Production configuration is loaded
- **WHEN** the notch worker validates its configuration
- **THEN** no alternate layout mode can be selected

### Requirement: Interruption feedback presentation
The notch SHALL consume interruption status independently from inference state. It SHALL distinguish in-progress dispatch, successful dispatch, uncertain-success, and error states through visual emphasis without replacing the underlying emotion model.

#### Scenario: Eligible expression is being dispatched
- **WHEN** status is `interrupting` or `restarting`
- **THEN** the selected emotion icons receive the in-progress emphasis

#### Scenario: Dispatch succeeds
- **WHEN** status becomes `sent`, `sent_outcome_unknown`, or dry-run `would_send`
- **THEN** the selected icons receive success emphasis for a bounded four-second interval

#### Scenario: Dispatch fails
- **WHEN** status becomes `interrupt_failed` or `restart_failed`
- **THEN** the selected icons receive error emphasis and diagnostic detail remains observable

### Requirement: Producer health presentation
The notch SHALL present concise loading, permission, camera, connection, stale-stream, and inference error states. Health presentation MUST remain distinct from emotion icons and MUST clear when current active data resumes.

#### Scenario: Camera permission is required
- **WHEN** inference reports permission-required
- **THEN** the notch presents an actionable camera-access message

#### Scenario: Stream disconnects after being active
- **WHEN** the emotion socket disconnects or becomes stale
- **THEN** emotion icons clear and the notch presents a disconnected or stale state until fresh data resumes

### Requirement: Presentation independence
Rendering and display filtering SHALL never block inference publication or Codex dispatch. The AppKit process SHALL redraw at a bounded cadence, defaulting to 100 milliseconds, using its most recent validated inference and status snapshots.

#### Scenario: AppKit drawing is delayed
- **WHEN** one redraw takes longer than expected
- **THEN** inference and interruption continue in their independent processes and the next redraw uses the newest available snapshots

### Requirement: Graceful notch shutdown
The notch process SHALL respond to runtime termination, invalidate timers, close local subscriptions, remove its panel, and exit without signaling or terminating the Codex GUI.

#### Scenario: Runtime requests shutdown
- **WHEN** the notch is visible and connected
- **THEN** it removes the overlay and exits while ChatGPT remains running

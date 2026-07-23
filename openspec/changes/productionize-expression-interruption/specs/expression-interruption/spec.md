## ADDED Requirements

### Requirement: Rust interruption executable
Expression interruption SHALL run in a long-lived Rust executable that consumes the local emotion stream and embeds `codex-control`. Python SHALL start or supervise this executable but MUST NOT invoke a Rust function for every inference or host the Codex Tokio runtime inside the inference process.

#### Scenario: Runtime starts interruption
- **WHEN** the application runtime starts normally
- **THEN** it launches one compiled Rust interruption executable that connects to the emotion stream and Codex control plane

#### Scenario: Python inference restarts
- **WHEN** the inference process restarts while interruption remains alive
- **THEN** the Rust process reconnects, resets candidate state, and continues without being re-embedded into Python

### Requirement: Negative-only eligibility
Only `anger`, `contempt`, `disgust`, `fear`, and `sadness` SHALL be eligible to cause interruption, and each eligible score MUST be strictly greater than the shared threshold, defaulting to 0.30. Happiness, neutral, surprise, unknown names, non-finite scores, and scores at or below threshold MUST NOT cause interruption.

#### Scenario: Negative score exceeds threshold
- **WHEN** anger is 0.31 in a fresh reading
- **THEN** anger participates in the interruption candidate

#### Scenario: Score equals threshold
- **WHEN** disgust is exactly 0.30
- **THEN** disgust is excluded from the candidate

#### Scenario: Positive emotion is highly confident
- **WHEN** happiness is 0.99 for any duration
- **THEN** no interruption candidate is produced from happiness

### Requirement: Continuous hold duration
The same set of eligible negative emotion names SHALL remain continuously present in fresh readings for the configured hold duration, defaulting to one second, before dispatch is eligible. Candidate time MUST be measured from monotonic capture time and MUST reset when the eligible set changes, any member falls to threshold or below, input becomes stale, no-face is reported, or the producer runtime changes.

#### Scenario: Negative expression is sustained
- **WHEN** the same eligible set remains over threshold in fresh readings for one continuous second
- **THEN** the policy emits one dispatch intent containing the current selected scores

#### Scenario: Confidence dips during hold
- **WHEN** anger falls to 0.30 or below before one second elapses
- **THEN** the hold timer resets and later anger readings begin a new hold

#### Scenario: Stream stalls during hold
- **WHEN** no fresh reading arrives before the freshness deadline
- **THEN** disconnected time does not count and the hold must restart after data resumes

### Requirement: Episode latching and cooldown
The policy SHALL dispatch an unchanged eligible emotion set at most once per expression episode. It SHALL rearm that set only after no eligible negative emotion has remained continuously present for one hold duration. A different eligible set SHALL observe a configurable cooldown after a latched dispatch, defaulting to 15 seconds.

#### Scenario: Same expression remains held
- **WHEN** an anger episode has been dispatched and anger remains continuously eligible
- **THEN** no additional anger dispatch occurs regardless of elapsed time

#### Scenario: Expression returns to baseline
- **WHEN** no eligible negative emotion remains for one full hold duration after a dispatch
- **THEN** the previous episode latch clears and a later sustained expression may dispatch again

#### Scenario: Different expression appears during cooldown
- **WHEN** sadness becomes stable before 15 seconds have elapsed since a latched anger dispatch
- **THEN** sadness is not dispatched until the cooldown has elapsed and it remains otherwise eligible

### Requirement: Safe Codex turn targeting
Without an explicit thread identifier, interruption SHALL act only when exactly one Codex turn is active. With an explicit identifier, it SHALL consider only that thread. It MUST NOT guess among multiple active turns or create a new thread when no eligible active turn exists.

#### Scenario: Exactly one turn is active
- **WHEN** a dispatch intent is ready and one eligible active turn exists
- **THEN** that thread and turn are selected for interruption

#### Scenario: Multiple turns are active
- **WHEN** no explicit thread is configured and more than one turn is active
- **THEN** no turn is interrupted and `multiple_active_turns` status is published

#### Scenario: No turn is active
- **WHEN** a dispatch intent is ready but no eligible turn exists
- **THEN** no Codex mutation occurs, `no_active_turn` is published, and the policy may reconsider only after another hold interval

### Requirement: Conservative interrupt-then-restart sequence
The dispatcher SHALL publish `interrupting`, request interruption of the selected turn, and confirm that turn has stopped before starting emotion context. It SHALL wait up to two seconds for stop confirmation. It MUST NOT start the context turn when interruption is rejected or the original turn cannot be confirmed stopped.

#### Scenario: Original turn stops
- **WHEN** the interrupt action is not rejected and the selected turn disappears from active state within two seconds
- **THEN** the dispatcher publishes `restarting` and submits the context message to that same thread

#### Scenario: Original turn does not stop
- **WHEN** the turn remains active after the confirmation window
- **THEN** `interrupt_failed` is published and no replacement turn is started

### Requirement: Conservative action outcome handling
Confirmed context writes SHALL publish `sent` and latch the episode. Writes with unknown outcome SHALL publish `sent_outcome_unknown`, latch the episode, and MUST NOT be automatically resent. Rejected writes SHALL publish `restart_failed`, SHALL not latch success, and MAY be reconsidered only after a new hold interval.

#### Scenario: Context write is confirmed
- **WHEN** `codex-control` returns a confirmed start outcome
- **THEN** the episode is latched and `sent` is published

#### Scenario: Context write outcome is unknown
- **WHEN** the write may have reached Codex but confirmation is unavailable
- **THEN** the episode is latched without automatic retry to prevent duplicate context turns

#### Scenario: Context write is rejected
- **WHEN** Codex proves the replacement turn was not accepted
- **THEN** `restart_failed` is published and the same current reading is not retried immediately

### Requirement: Nonverbal context message
The replacement turn SHALL receive a concise message listing selected emotions in descending score order with qualitative degree and rounded percentage, explicitly identifying the signal as imperfect facial-expression inference and instructing the agent to continue the existing task with that context.

#### Scenario: One emotion is selected
- **WHEN** anger is selected at 0.94
- **THEN** the message describes the user as angry, includes `very strong` and `94%`, and includes the uncertainty statement

#### Scenario: Multiple emotions are selected
- **WHEN** more than one negative emotion is eligible
- **THEN** the message joins all selected descriptions naturally in deterministic score order

### Requirement: Dry-run interruption mode
The interruption executable SHALL support a dry-run mode that executes input validation, freshness, temporal policy, latching, cooldown, message creation, and status publication without connecting to or mutating Codex.

#### Scenario: Dry-run candidate becomes eligible
- **WHEN** a synthetic negative expression satisfies policy
- **THEN** `would_send` and the exact prospective context message are published with no Codex action

### Requirement: Continued stream consumption during dispatch
The interruption process SHALL separate rapid stream observation from potentially slower Codex dispatch. It MUST keep only the newest state needed for policy continuity while an action is in flight and MUST prevent concurrent duplicate dispatches.

#### Scenario: New readings arrive during Codex action
- **WHEN** interruption or restart is awaiting an outcome
- **THEN** input remains bounded, the newest state is retained, and no second dispatch runs concurrently

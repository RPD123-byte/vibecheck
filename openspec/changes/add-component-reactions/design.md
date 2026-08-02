## Context

Vibecheck currently ships as a menu-bar-only Electron application. Electron
owns persistent preferences and the native menu, launches one long-lived Python
runtime owner, and renders authoritative runtime snapshots. Python is the sole
authority for inference, notch, and Rust interruption worker topology. The Rust
interruption executable owns `codex-control`, active-turn selection, and every
Codex interrupt/replacement mutation.

The requested capability adds an explicit, user-authored conditioning path:

```text
supported Electron application
        │
        │ Control-Option-R
        ▼
text range or component selection
        │
        │ emoji commits
        ▼
copy-like text + component PNG
        │
        ├──────────────▶ marked clipboard bundle
        │
        └──────────────▶ existing Rust Codex mutation owner
                                   │
                       ┌───────────┼───────────┐
                       ▼           ▼           ▼
                    0 active    1 active    >1 active
                    clipboard   interrupt    clipboard
                    only        + replace    only
```

The behavior has been explored under `experimentation/`, but that directory is
not a source package, build input, fixture dependency, or migration source.
Production implementation is authored anew under `src/`, production packaging,
and production tests from the contracts in this change. Existing source guards
already reject experimental path dependencies and are extended to cover every
new runtime asset and command.

The feature is macOS-first. The initial supported renderer class is ordinary
Electron/CEF DOM content plus a dedicated Paper logical-canvas adapter. Native
AppKit applications, standalone browsers, arbitrary canvas applications,
closed shadow trees, and cross-origin embedded renderer edge cases are deferred.

The target-local reaction popover is not a Vibecheck `BrowserWindow`. Vibecheck
remains a menu-bar application; production renderer JavaScript and CSS are
injected into supported target renderers over a Vibecheck-owned, loopback-only
Chromium debugging transport.

## Goals / Non-Goals

**Goals:**

- Provide one persistent `Component reactions` setting independent from camera
  inference, notch display, and expression-based Codex interruption.
- Let a user press `Control-Option-R` without selected text to toggle one
  host-coordinated global component-capture session, select components across
  attached renderers until the shortcut is pressed again, and commit each
  reaction by choosing an emoji.
- Treat `Control-Option-R` over an existing text selection as a one-shot
  reaction that neither opens nor joins clipboard accumulation.
- Capture only copy-like visible text and a cropped PNG of the referenced
  component.
- Accumulate committed component text/PNG pairs only within the current global
  capture session, start every later session with a fresh bundle on its first
  commit, make selected-text one-shots replace rather than append, and replay
  the unchanged current bundle on every Command-V until another copy replaces
  it.
- Route explicit reactions through the existing Rust Codex worker with exactly
  one active Codex mutation at a time and conservative zero/one/many targeting.
- Give explicit reactions priority over passive expression actions without
  weakening uncertain-outcome or graceful-drain behavior.
- Keep target renderers injectable across feature disable/re-enable and across
  target relaunches while Vibecheck remains running.
- Own supported target launches and keep dormant renderer controllers installed
  whenever Vibecheck is running, including before the first component enable.
- Make ChatGPT/Codex selectable through the same owned renderer path while
  preserving its managed app-server environment and single lifecycle owner.
- Reimplement and package all behavior under production-owned paths with no
  experimental runtime or test dependency.
- Preserve the emotion socket's startup-first loading heartbeat and 1.5-second
  default freshness contract independently from all target discovery,
  relaunch, injection, permission, screenshot, clipboard, and Codex work.

**Non-Goals:**

- A launchd service, login item, independently managed daemon, or helper that
  can outlive Vibecheck.
- A conventional Vibecheck window, thread picker, component history, reaction
  history, or durable queue.
- Native Accessibility-based selection in non-Electron applications.
- Browser extensions or injection into a user's normal standalone-browser
  profile.
- Generic support for every canvas, WebGL, cross-origin frame, webview, closed
  shadow root, or virtualized editor.
- Cloned HTML, DOM snapshots, CSS paths, hidden text, technical component dumps,
  or large agent-facing reference envelopes.
- Bundling, copying, or redistributing Messages artwork; persistent reaction
  badges; or Messages-style add/remove/replace state. Read-only runtime loading
  of the templates already installed by macOS is part of the selected UI.
- Automatic targeting when zero or multiple Codex turns are active.
- Delivery acknowledgement, durable retries, or replay after a renderer,
  Vibecheck, or target-process crash.
- Product-level expiration, item-count, or byte-count limits on the clipboard
  bundle in this change.
- Changing expression thresholds, emotion policy, notch presentation, or
  camera behavior.

## Decisions

### 1. Treat experimental code as evidence only

All shipped logic is reimplemented beneath production-owned paths. No
production module imports from `experimentation/`; no compiler, packager, test,
or release command reads an experimental file; no packaged source map or
resource names an experimental path; and no development fallback executes an
experimental launcher or binary.

New renderer behavior is written as production TypeScript and CSS. New native
behavior is written as a production target with a Vibecheck bundle identity.
New Rust protocols and dispatch logic live in the existing production crate.
Tests construct production fixtures rather than importing experiment fixtures.

Repository and packaged-artifact guards scan source, manifests, lockfiles,
commands, generated bundles, source maps, and printable binary strings for
forbidden experimental paths.

Alternative considered: move the experimental directory into `src/` and clean
it incrementally. That preserves accidental coupling, debug launch assumptions,
copied asset assumptions, and obsolete native-selection behavior. It is
rejected.

### 2. Split desktop interaction ownership from sensor-runtime ownership

Electron main owns the component-reaction desktop subsystem because it already
owns the menu, persistent preferences, application lifetime, and packaged
desktop identity. Python remains the declarative authority for whether the
shared Rust Codex worker is required. Rust remains the only process permitted
to inspect active Codex turns or mutate Codex.

```text
Native Vibecheck menu
        │
        ▼
Electron main
  ├─ target launch coordinator
  ├─ CDP renderer controller
  ├─ renderer asset bundle
  ├─ global emoji recents
  ├─ screenshot + clipboard coordinator
  ├─ fixed native companion client
  └─ Python control client
             │
             ▼
       Python runtime owner
          ├─ inference (only if sensor feature requires it)
          ├─ notch
          └─ Rust Codex worker
                 ├─ optional emotion input
                 └─ explicit reaction socket
```

Electron is allowed to start exactly one fixed, signed desktop companion from a
packaged path. It still cannot start inference, notch, or Rust individually,
and no menu callback accepts a command or executable path. Python continues to
derive and supervise sensor/Codex worker topology.

Alternative considered: place target discovery, CDP, pasteboard, and global
input monitoring inside Python. That gives a camera/runtime owner desktop TCC
responsibilities, complicates frozen packaging, and makes UI lifecycle depend
on the sensor runtime. It is rejected.

Alternative considered: call `codex-control` from Electron. That would create a
second Codex mutation owner and bypass Rust action reliability. It is rejected.

### 3. Use one Vibecheck-owned native desktop companion, not a daemon

A production native companion is launched by Electron with Vibecheck and exits
when Electron quits. It is not registered with launchd, cannot launch itself,
has no independent preference or recovery policy, and is terminated by bounded
ownership cleanup if Electron disappears.

The companion provides macOS-only operations that Electron cannot perform
reliably through portable APIs:

- observe supported application launch and termination through `NSWorkspace`;
- validate app-bundle identity and resolve the bundle executable;
- request graceful application termination and launch validated executables
  with fixed Chromium debugging arguments;
- read and write the marked versioned `NSPasteboard` bundle;
- install an event tap only while component reactions are effectively enabled;
- pass through every unmarked Command-V unchanged;
- expand a marked Command-V into ordered text/image paste pairs;
- synthesize paste events and restore the focused Accessibility element;
- report permission and operation status through bounded typed IPC.

The companion may remain resident for the Vibecheck application lifetime so
enrolled target launches remain owned across component-feature pause or
disable. Its global input event tap and special paste behavior are enabled only
while the feature is effective. It performs no selection capture and observes
no ordinary key content.

Electron and the companion use a fixed, versioned, bounded protocol over stdio
or an owner-only Unix socket. Commands are typed operations over validated
bundle identities and event IDs, never arbitrary shell commands.

Alternative considered: one helper per target or paste. That multiplies TCC
identity, signing, process recovery, and race conditions. It is rejected.

### 4. Extend declarative feature state and derive camera-free topology

Feature state adds:

```text
component_reactions_enabled
```

Electron persists it beside the notch and expression-interruption preferences.
First launch defaults it off. Pause remains session-local and suppresses the
shortcut, target interaction, special paste handling, and Codex reaction input
while preserving the preference. The setting controls interaction capability,
not target-process ownership: Electron still starts the desktop companion,
owns supported launches, attaches renderers, and installs dormant controllers
when the setting is off.

Python topology becomes:

| Notch | Expression interruption | Component reactions | Required Python-owned roles |
| --- | --- | --- | --- |
| off | off | off | none |
| on | off | off | inference, notch |
| off | on | off | inference, interruption |
| off | off | on | interruption |
| on | off | on | inference, notch, interruption |
| off | on | on | inference, interruption |
| on | on | on | inference, notch, interruption |

Paused state requires no Python-owned workers. The Electron desktop subsystem
also becomes ineffective while paused. Enabling component reactions alone must
not run camera preflight, inference, model import, notch, or emotion-stream
startup. If another feature already needs Rust, component enablement adds an
input without restarting Rust. Disabling one Rust-requiring feature leaves Rust
running while the other still needs it.

The Rust CLI accepts an optional emotion socket and a required explicit-reaction
socket when component reactions are desired. Python reports both readiness and
the private reaction endpoint to its authenticated Electron controller.

Alternative considered: add a second Rust component-reaction bridge. It would
duplicate Codex state, active-turn selection, and mutation serialization. It is
rejected.

### 5. Keep target launch ownership alive for the Vibecheck process lifetime

When Vibecheck starts, the desktop subsystem starts its bounded companion and
discovers currently running supported Electron/CEF bundles regardless of the
component-reaction preference. For each target not already exposing an owned
debugging endpoint, it requests graceful termination, waits a bounded interval,
and relaunches the validated bundle executable with:

- a unique loopback-only remote-debugging endpoint;
- a Vibecheck ownership marker used only for loop prevention and health;
- the target's ordinary application bundle and user-data location;
- no modified application bundle, ASAR, executable, or persisted target
  preference.

The coordinator never force-kills a target. Failure or user-cancelled
termination leaves that target unsupported and reports it without disabling
other attached applications.

The coordinator observes every later supported launch while Vibecheck remains
running, even while component reactions are paused, disabled, or have never
been enabled. A normal target relaunch is converted into one Vibecheck-owned
launch, its renderer receives the production controller immediately, and that
controller receives either enabled or dormant state from the current setting.
An owned launch is recognized and never recursively relaunched.

If Vibecheck itself restarts while those owned target processes remain alive,
the new companion validates each target's loopback address, bounded debug port,
and typed ownership marker from that process's launch arguments. Electron
reserves all such inherited ports before allocating any new endpoint, then
reacquires those CDP sessions without relaunching the target or treating the
prior Vibecheck-owned listener as a foreign collision.

On Vibecheck quit, attached renderers receive `dispose()` so the controller,
listeners, styles, and transient nodes are removed before debug sessions close.
The companion then exits and target applications remain running. Debugging
arguments cannot be removed from a live target and disappear on its next normal
launch after Vibecheck is no longer running.

The initial compatibility boundary is ordinary Electron/CEF apps discovered
from their signed `.app` bundle structure. Vibecheck itself and standalone
browsers are excluded. Paper is additionally recognized for its logical-canvas
adapter.

ChatGPT/Codex is a supported selectable source rather than an excluded target.
Its GUI lifecycle remains single-owner. The launch coordinator combines
`CODEX_APP_SERVER_USE_LOCAL_DAEMON=1`,
`CODEX_APP_SERVER_FORCE_CLI=0`, the owned debugging endpoint, and the ownership
marker in one graceful Launch Services relaunch. Electron and Rust must never
perform separate restart cycles for the same desired state. A Codex relaunch
required only to establish dormant renderer ownership is deferred while an
active turn would be destroyed; when the existing Codex lifecycle already
requires a managed-environment relaunch, the debugging arguments are folded
into that same launch.

Alternative considered: attach to arbitrary already-running Electron processes
without relaunch. Chromium cannot enable the required debugging transport after
process start, so the requirement cannot be met that way.

### 6. Use one centralized CDP service and production renderer bundle

Electron main owns one in-process CDP service for all attached targets. It does
not launch one injector process per app. For each page target, it keeps a
bounded session, installs a Vibecheck binding for committed reaction events,
registers the production script for future documents, and evaluates it in the
current document.

Production renderer source is bundled with Vibecheck and exposes one
namespaced controller:

```text
install()
setEnabled(boolean)
setCaptureSession(sessionId | null)
settle(eventId, outcome)
dispose()
```

Installation is idempotent. `setEnabled(false)` closes every picker and receipt,
removes highlights and overlays, clears the pending target, ignores
Control-Option-R without consuming it, and exposes no other UI entry point.
Reenablement in the same renderer does not reinject source. New documents,
renderer replacements, and newly discovered page targets receive a fresh
production installation and the current enabled state.

The binding provides best-effort, in-session event delivery. There is no
durable outbox, acknowledgement protocol, or replay. The shortcut is enabled
only for a healthy attached session; an unavailable host cannot intentionally
accept a new reaction.

Alternative considered: poll and splice a page-global event array. It creates a
silent loss window and per-port polling processes. A persistent CDP binding is
simpler and supports correlated status settlement without durable machinery.

### 7. Implement a strict target-local interaction state machine

The renderer has these mutually exclusive states:

```text
disabled
  │ enable
  ▼
idle
  │ Control-Option-R
  ├─ non-empty Selection/Range ─▶ one-shot text-locked
  └─ no usable selection ───────▶ request global session start
                                        │ host broadcast
                                        ▼
                              global element-picking
                                      │ click
                                      ▼
                                  element-locked

text-locked or element-locked
  ├─ emoji choice ─▶ capturing ─▶ receipt ─▶ global picking or idle
  └─ Escape/click-away ─────────────────────▶ global picking or idle

global element-picking or element-locked
  └─ Control-Option-R ─▶ request global session end ─▶ idle everywhere
```

Text mode clones the active `Range`, highlights exact selected characters with
the CSS Custom Highlight API, and positions the popover from live client
rectangles. Its copy text is the exact trimmed selection. Its screenshot target
is the nearest usable semantic content container that contains the range; text
mode does not spotlight or mutate that container.

Element mode uses capture-phase pointer observation, outlines the usable target
under the pointer, consumes only the click that locks the target, and prevents
the underlying control from activating. The locked target is spotlighted while
the reaction picker is open. DOM copy text is the target's rendered copy-like
text (`innerText`, then accessible label fallback), not markup.

Paper's editor canvas is handled by a separately tested production adapter. It
uses Paper's live editor hit-testing and coordinate transforms to resolve the
logical node beneath the pointer and its current viewport bounds. Copy text is
the logical node's visible label/text made available by the adapter. If the
adapter capability is unavailable, the generic DOM path may select the canvas
element; it must not guess a logical node.

Electron main owns the global capture-session identifier and broadcasts it to
every attached renderer. The first successful commit for an identifier replaces
the marked clipboard bundle; later commits carrying the same identifier append.
Ending the session leaves the resulting clipboard value available for normal
repeated paste. Starting another session creates a new identifier, so its first
commit cannot append to the prior session. A usable text selection takes the
one-shot path only while no global session is active and always replaces the
bundle without changing global session state.

Only choosing an emoji commits. Selecting or locking a target alone captures
nothing, changes no clipboard, and sends no Codex event. Choosing the same emoji
again in a later interaction creates a new event. Targets retain no reaction
attribute, badge, or add/remove state.

### 8. Reimplement the reaction UI with global Vibecheck recents

The compact popover contains six fixed reactions rendered from the installed
macOS Messages Tapback templates, the two most recent custom emoji, and an
affordance that opens the expanded categorized picker. The signed native
companion loads the six fixed `AckFunction-*` templates from the installed
`IMSharedUI.framework`, renders them to bounded PNG data, and returns them over
its fixed typed protocol. Electron validates and caches that map once per
companion lifecycle, then synchronizes it with enabled state and recents into
every Electron/CEF and browser renderer. The expanded picker contains ordinary
Unicode emoji, keyboard-accessible controls, category navigation, search/filter
behavior, and five global recent emoji.

Recents are owned by Vibecheck preferences and synchronized into attached
renderers. They are not stored in a target application's `localStorage`.
Choosing a custom emoji updates the global recents before the next picker is
rendered.

The application does not copy or package Apple artwork. If the installed
framework, a named template, decoding, validation, or renderer synchronization
is unavailable, the compact strip falls back to production-authored glyphs
without degrading selection, capture, clipboard, or Codex delivery. The UI
avoids target layout mutation, DOM wrappers around selected text, and persistent
nodes after dismissal.

Escape closes the expanded picker back to the compact strip, then dismisses the
interaction. Click-away dismisses without committing. Viewport resize and
scroll reposition a locked interaction or dismiss it if its target is no
longer usable.

### 9. Define a minimal capture product

Every committed reaction creates one capture record:

```text
schema_version
event_id
captured_at
source_application_name
source_bundle_id
reaction_emoji
reaction_label
copy_text
screenshot_png
```

The clipboard text is `copy_text`, matching what a user expects from copying the
selected range or visible component. The agent message is a concise
production-authored statement that the user explicitly reacted with the chosen
emoji to that text from the named source application. It does not interpret an
ambiguous emoji as a command.

The record does not contain outerHTML, DOM serialization, CSS selectors, URL,
component class names, private Paper objects, hidden text, surrounding
conversation, or a technical reference dump.

After emoji selection, the renderer removes highlight, spotlight, picker, and
scrim before screenshot capture. Electron obtains current layout metrics,
translates the selected target's viewport bounds to page coordinates, adds a
small fixed padding, clips to the visible viewport, and calls Chromium page
capture. The same screenshot path handles DOM and Paper bounds.

PNG files live under the existing fresh owner-only runtime directory with
event-derived filenames. A file remains only while clipboard append and any
queued Rust dispatch need it, then is deleted. Runtime shutdown removes
remaining files.

### 10. Make clipboard accumulation marker-based and replayable

The native companion owns one versioned Vibecheck pasteboard marker and one
encoded bundle flavor. The bundle contains an ordered array of complete
`copy_text` and raw PNG pairs.

On a committed reaction:

1. Electron captures the PNG.
2. The native companion reads the current pasteboard.
3. Electron chooses a typed atomic replace for a one-shot or the first commit
   of a global session, and a typed atomic append only for later commits carrying
   that same active session identifier.
4. Replace creates a new bundle containing only the new pair; append extends a
   supported current marked bundle and otherwise starts fresh defensively.
5. It writes the custom bundle plus useful ordinary pasteboard fallbacks.
6. Only after clipboard success does Electron submit the event to Rust.

Any ordinary copy naturally replaces the pasteboard item and removes the
Vibecheck marker. Ending a global capture session does not clear the clipboard,
but the first commit of the next session replaces it. There is no separate
clipboard monitor, expiration timer, item cap, byte cap, or consumed flag.

While component reactions are effective, the native event tap intercepts
Command-V only when the current clipboard is marked. It captures the focused
Accessibility element, then for each entry:

1. writes a text-only temporary pasteboard item;
2. posts one Command-V;
3. waits a tested bounded inter-paste delay;
4. restores the focused element;
5. writes an image-only PNG item;
6. posts one Command-V and restores focus again.

After all entries, or after a partial failure, it restores the original marked
bundle exactly and unchanged. Repeated Command-V therefore replays the same
complete stack. Unmarked Command-V and every other key event pass through
unchanged. A reentrancy guard prevents synthetic paste events from triggering
another expansion.

### 11. Add a private explicit-reaction socket to the existing Rust worker

Rust binds `component-reactions.sock` with mode `0600` inside Python's fresh
`0700` runtime directory before reporting component-input readiness. Electron
learns the exact endpoint only through its authenticated Python control
session. The socket uses bounded, versioned JSON Lines and accepts only the
minimal event fields and a screenshot path confined to the current runtime
directory.

Clipboard append and Rust delivery are independent. Clipboard success happens
first. If Rust is unavailable, rejects the event, or cannot reach Codex, the
clipboard remains valid and the renderer receives a copied-only or failure
receipt.

The explicit input is best-effort. Rust does not persist events across process
restart, and Electron does not automatically resend after an unknown delivery
boundary. Correlated results exist to drive the current UI receipt, not to
provide a durable acknowledgement/retry queue.

Alternative considered: pass component content through the general Python
control socket. That would mix declarative feature authority with content
delivery and make Python relay agent inputs. A separate private Rust endpoint
keeps responsibilities clear.

### 12. Serialize and prioritize explicit Codex mutations

Rust has one mutation coordinator shared by expression and component inputs.
It never runs two `interrupt`/`start` sequences concurrently.

For each explicit reaction batch, Rust snapshots active turns at dispatch time:

- zero active turns: return `no_active_turn` without Codex mutation;
- exactly one active turn: interrupt it, confirm it stopped, and start a
  replacement in the same task with ordered text and `localImage` inputs;
- multiple active turns: return `multiple_active_turns` without mutation.

Events received while no mutation is active begin dispatch immediately. Events
received during an active mutation are queued in commit order and combined into
one next explicit batch after the current mutation resolves. Each event remains
its own concise text/image pair inside that batch.

Explicit work outranks passive expression work:

- a queued explicit batch is selected before a newly qualified expression;
- an expression observation is never stored durably while explicit work runs;
- an already-started expression mutation drains safely and is not cancelled
  between interrupt and replacement;
- explicit events arriving during that mutation form the next batch;
- expression cooldown, latching, and uncertainty behavior remain unchanged.

Component-only operation initializes `codex-control` and the reaction socket
without connecting to `emotion.sock`. When both features are enabled, the one
Rust process consumes both independently. Disabling one input does not restart
Rust while the other remains desired.

`ActionOutcome::OutcomeUnknown` remains non-retryable. Rust reports uncertainty
to Electron and does not blindly repeat the batch.

### 13. Use a transient target-local receipt and structured menu health

Once capture completes, the picker becomes or is replaced by a short-lived
noninteractive receipt near the former target. Screenshot capture always occurs
before the receipt is shown.

Receipt outcomes include:

- `Sent to Codex · Copied`
- `Copied · No active Codex task`
- `Copied · Multiple active Codex tasks`
- `Copied · Codex unavailable`
- `Copy failed`
- `Send outcome unknown · Copied`

The receipt contains no durable history and dismisses automatically or on
click-away/Escape. Electron settles the exact renderer event ID; stale results
for a replaced document are ignored.

The native Vibecheck menu adds `Component reactions`, feature readiness, target
attachment/permission failure, and conditional recovery. It does not show
captured text, emoji history, screenshots, target URLs, or Codex thread names.

### 14. Keep component startup independent from emotion startup

Electron starts the Python owner and receives control exactly as today.
Target discovery, native-companion startup, owned app relaunch, dormant CDP
attachment, permission checks for active interaction, emoji-state loading, and
reaction-socket readiness run as independent state machines. Desktop ownership
starts with Vibecheck rather than waiting for feature enable, and none of it is
awaited before inference binds `emotion.sock` or begins its logically
independent loading heartbeat.

When sensor and component preferences are restored together, consumer-first
emotion topology and component desktop startup proceed concurrently. Component
failure may degrade component reactions but cannot mark the emotion producer
stale, delay its heartbeat, restart notch, or release a camera required by
another feature.

### 15. Package permissions and production assets under Vibecheck identity

The release includes the production native companion, renderer bundle, emoji
data, and Rust extensions as signed Vibecheck resources. It adds the required
macOS Accessibility/Input Monitoring onboarding and verifies the displayed TCC
identity on a clean account.

Permission is requested only when component reactions are deliberately enabled.
Denial prevents the special paste event tap and any operation that requires the
permission, reports `Needs Permission`, and does not affect camera or notch
features. Vibecheck does not bypass denial or force-kill another application.

Release signing inventories every new Mach-O and rejects ad-hoc, unsigned,
wrong-architecture, or unexpected nested code. Packaged operation uses no
Swift compiler, Node source checkout, Cargo, shell launcher, or experimental
resource.

### 16. Verify behavior through production seams

The change adds:

- pure TypeScript tests for source classification, feature state, global
  recents, target registry, port assignment, CDP lifecycle, renderer source
  splitting/bundling, event settlement, and status projection;
- renderer fixture tests for exact ranges, DOM selection, Paper logical
  selection, click suppression, emoji commit semantics, repeat reactions,
  dormant enablement, navigation reinjection, screenshot timing, and receipts;
- native tests for application validation, owned relaunch loop prevention,
  marked bundle append/reset/replay, focus restoration, reentrancy, pass-through
  behavior, and permission denial;
- Python tests for the complete feature-state matrix and minimal worker
  reconciliation;
- Rust tests for component-only startup, zero/one/many targeting, ordered
  batching, text/image construction, explicit priority, expression coexistence,
  shutdown drain, and unknown outcomes;
- process tests across Electron, Python, Rust, native companion, fake CDP
  targets, fake Codex control, and clipboard fixtures;
- packaged source guards proving no experimental imports, commands, strings,
  resources, source maps, or test dependencies;
- protected clean-install macOS verification for permissions, relaunch,
  disable/re-enable, repeated paste, pause/resume, safe quit, and target/Codex
  survival.

## Risks / Trade-offs

- **[Risk] Supported apps must be relaunched to enable Chromium debugging** →
  Vibecheck uses graceful termination only, reports refusals per target, owns
  later session launches, and never force-kills.
- **[Risk] A target update may change DOM or Paper private editor state** →
  Keep the generic DOM path standards-based, isolate Paper behind one adapter,
  and fail back to the canvas element rather than guessing logical identity.
- **[Risk] A loopback debugging endpoint remains available for the target
  process lifetime** → Bind only to loopback, assign and track endpoints
  centrally, never modify the app bundle, and disable injected UI before
  Vibecheck disconnects.
- **[Risk] Two paste events per component depend on destination timing and
  focus** → Use a tested inter-paste delay, Accessibility focus restoration,
  destination compatibility fixtures, reentrancy protection, and exact bundle
  restoration after failure.
- **[Risk] An unlimited clipboard bundle can consume memory or make paste slow**
  → This is an accepted first-version trade-off; ordinary copy resets it, the
  UI shows paste progress/failure, and no durable copy is retained by
  Vibecheck.
- **[Risk] Best-effort renderer delivery can lose a reaction during a crash** →
  Commit is available only while attachment is healthy, clipboard is written
  before Codex delivery, and durable retry is explicitly deferred.
- **[Risk] Rapid explicit reactions can repeatedly interrupt a replacement
  turn** → Serialize mutations and batch reactions that arrive while a mutation
  is already underway.
- **[Risk] Component and expression inputs can race** → Use one Rust
  coordinator, explicit priority, and unchanged conservative action outcome
  handling.
- **[Risk] Component-only topology could accidentally start the camera** →
  Make topology pure, test the complete truth table, and keep camera preflight
  conditional only on inference-requiring features.
- **[Risk] Native permission identity can differ between development and signed
  release** → Block release on clean-account signed-build verification.
- **[Risk] Codex could be relaunched twice by target ownership and
  `codex-control`** → Enforce a single coordinated Codex GUI launch owner and
  test active-turn preservation and launch-loop prevention.
- **[Risk] Apple may rename or remove installed private Tapback templates** →
  Load a fixed allowlist read-only, validate bounded PNG output, cache only for
  the running Vibecheck process, and retain production-authored fallback glyphs.
- **[Risk] Experimental logic can leak into production during porting** →
  Author from specs under new paths and enforce source/build/package guards.

## Migration Plan

1. Add production source guards and new feature-state protocol fixtures before
   implementing component behavior.
2. Add `component_reactions_enabled` to Electron preferences, menu projection,
   Python feature state, and topology with component-only no-camera tests.
3. Extend Rust with the private reaction socket and shared mutation coordinator
   behind deterministic fake-Codex tests.
4. Add the production native companion and verify marked clipboard replay,
   pass-through input behavior, target lifecycle, and permission identity.
5. Add the centralized CDP service and newly authored production renderer
   bundle, beginning with DOM text/element fixtures and dormant enablement.
6. Add the isolated Paper adapter and screenshot pipeline.
7. Connect clipboard-first capture to Rust routing and correlated target-local
   receipts.
8. Add startup isolation, pause/resume, disable/re-enable, crash recovery, and
   safe-quit process tests.
9. Update production packaging, entitlements, signing inventory, notarization
   verification, documentation, and clean-install gates.
10. Release with the persisted interaction setting defaulting off while
    Vibecheck-lifetime desktop ownership remains active. Rollback removes the
    desktop subsystem while preserving the existing notch and expression
    runtime; no clipboard or target-app data migration is required.

## Open Questions

None blocking implementation. Compatibility beyond ordinary DOM Electron/CEF
renderers and the Paper adapter, durable delivery, clipboard limits, native-app
selection, and browser extensions remain explicit future work.

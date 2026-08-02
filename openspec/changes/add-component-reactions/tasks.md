## 1. Production Boundaries and Contract Fixtures

- [x] 1.1 Extend the production source guard to reject component-reaction imports, runtime lookups, build inputs, commands, generated bundles, source maps, and packaged resources that reference `experimentation/`
- [x] 1.2 Add release-artifact scanning for experimental path strings in JavaScript bundles, source maps, manifests, native binaries, and packaged resources
- [x] 1.3 Create production-owned generic Electron DOM and Paper logical-canvas fixtures without importing or copying experiment fixtures
- [x] 1.4 Define shared versioned fixtures for feature state, renderer commit events, native companion commands/results, clipboard bundles, Rust reaction input, and correlated routing outcomes
- [x] 1.5 Add schema-size, string-length, PNG-size, collection-size, and IPC-frame bounds for every new host-facing protocol while leaving the user clipboard bundle without a product-level expiration or item cap
- [x] 1.6 Record the supported first-release boundary as macOS arm64, ordinary Electron/CEF DOM renderers, and the dedicated Paper adapter, with standalone browsers and Vibecheck itself excluded

## 2. Feature State, Preferences, and Topology

- [x] 2.1 Add validated `component_reactions_enabled` state to the complete revisioned Electron/Python feature document and update cross-language control fixtures
- [x] 2.2 Persist the Component reactions preference in Electron, default it off, and restore it only through the authenticated runtime client
- [x] 2.3 Extend the pure Python topology mapper so component-only operation starts the existing Rust interruption role without inference, camera preflight, model import, emotion socket, or notch
- [x] 2.4 Update Python role specifications and reconciliation so expression and component inputs share one stable Rust PID and toggling either input applies the minimum process diff
- [x] 2.5 Extend runtime snapshots with component desired/effective state, reaction-input endpoint readiness, and structured degradation without exposing captured content
- [x] 2.6 Make session-local Pause suppress renderer interaction, marked-paste expansion, component event acceptance, and component-only Rust topology while preserving the persisted preference and enrolled target ownership
- [x] 2.7 Add complete unit tests for all notch, expression, component, and pause topology combinations, including unchanged PIDs and camera release
- [x] 2.8 Add protocol tests for valid, missing, stale, malformed, and idempotently repeated component feature mutations
- [x] 2.9 Add process tests proving component-only enable/disable never requests camera permission or starts inference and preserves the long-lived Python controller

## 3. Native Menu and Component Health

- [x] 3.1 Add the Component reactions toggle to the native menu with fixed callbacks and no new Vibecheck `BrowserWindow`, preload, or renderer IPC surface
- [x] 3.2 Project Off, Starting, Active, Paused, Needs Permission, Degraded, and Failed component states independently from notch and camera state
- [x] 3.3 Add concise target attachment, native companion, permission, clipboard, and Rust-input health plus conditional recovery without displaying text, emoji history, screenshots, URLs, or Codex thread identities
- [x] 3.4 Preserve the checked preference during startup, permission denial, per-target failure, and Rust degradation
- [x] 3.5 Add menu-template and runtime-client tests for every component state, pending action, pause transition, partial failure, recovery action, and privacy-field exclusion

## 4. Shared Rust Reaction Input

- [x] 4.1 Extend the Rust CLI and Python role builder with independently optional emotion input and explicit component-reaction input while retaining one Codex control owner
- [x] 4.2 Bind `component-reactions.sock` with mode `0600` inside the current fresh `0700` runtime directory before reporting component-input readiness
- [x] 4.3 Publish the exact private reaction endpoint only through the authenticated Python control snapshot and remove it when the input becomes ineffective
- [x] 4.4 Implement bounded versioned JSON Lines parsing for reaction events and correlated results using the shared fixtures
- [x] 4.5 Validate schema version, event ID, capture time, source app identity, emoji, label, copy-like text, frame size, and duplicate in-flight IDs before dispatch
- [x] 4.6 Confine screenshot paths to regular readable PNG files beneath the current owned runtime directory and reject absolute escapes, traversal, symlinks, malformed files, and unsupported payloads
- [x] 4.7 Implement component-only Rust startup and dynamic emotion-input attach/detach without starting a second Rust process or Codex controller
- [x] 4.8 Add Rust protocol and process tests for permissions, malformed/oversized input, duplicate IDs, confined paths, disconnects, component-only startup, and dynamic shared-input changes

## 5. Serialized Explicit Codex Routing

- [x] 5.1 Refactor expression dispatch behind one mutation coordinator that admits at most one interrupt, stop-confirmation, and replacement sequence at a time
- [x] 5.2 Implement zero-active-turn and multiple-active-turn explicit results with no interrupt, replacement, focus heuristic, recency heuristic, or retained future delivery
- [x] 5.3 Implement exactly-one-active-turn explicit dispatch using the existing interrupt, bounded stop confirmation, and same-task replacement path
- [x] 5.4 Build each replacement as ordered concise explicit-feedback text followed by its `localImage`, with no HTML, DOM metadata, URL, or inferred emoji command
- [x] 5.5 Queue explicit events received during an active mutation in commit order and combine them into one next batch of ordered text/image pairs
- [x] 5.6 Give pending explicit batches priority over newly qualified passive expressions while preserving expression freshness, latch, cooldown, and rearm behavior
- [x] 5.7 Drain an already-started expression or explicit mutation safely instead of cancelling between a confirmed interrupt and replacement
- [x] 5.8 Preserve Confirmed, Rejected, and OutcomeUnknown semantics, never retry an uncertain mutation, and never start replacement after an unconfirmed interrupt
- [x] 5.9 Return a correlated transient result for every event ID in a batch without creating a durable queue, delivery history, or replay-on-restart behavior
- [x] 5.10 Stop new component acceptance immediately on disable while keeping Rust alive for expression input or applying the existing bounded final drain
- [x] 5.11 Add deterministic fake-Codex tests for zero/one/many targeting, commit-order batching, explicit priority, expression coexistence, stop confirmation, rejection, uncertainty, and shutdown drain
- [ ] 5.12 Extend the opt-in isolated live Codex fixture to cover one explicit text/image reaction with unconditional cleanup and no execution in ordinary CI

## 6. Production Native Desktop Companion

- [x] 6.1 Add one production Swift native companion target under a tracked production path with a stable Vibecheck-owned bundle identity and no experiment build input
- [x] 6.2 Implement a fixed versioned bounded stdio or owner-only socket protocol with typed operations and no arbitrary executable, argument, environment, or shell command surface
- [x] 6.3 Make Electron start at most one validated packaged companion, supervise it as a child, and terminate it with bounded cleanup when ownership ends
- [x] 6.4 Make the companion detect owner disconnect, disable its event tap and target operations, close IPC, and exit without launchd, login-item, or independent recovery behavior
- [x] 6.5 Implement `NSWorkspace` launch/termination observation and signed application-bundle/executable validation for supported Electron/CEF targets
- [x] 6.6 Implement graceful target termination and validated Launch Services relaunch with fixed Vibecheck-owned debugging arguments, never force-killing or modifying target data
- [x] 6.7 Implement current focused Accessibility element capture/restoration and structured permission/operation results without observing ordinary key content
- [x] 6.8 Enable the global event tap only while component reactions are effective and pass through every event except a valid marked physical Command-V
- [ ] 6.9 Add native unit/process tests for protocol bounds, owner loss, bundle validation, graceful refusal, owned-launch identity, event-tap enablement, permission denial, and pass-through behavior
- [x] 6.10 Add a bounded typed native operation that renders the fixed allowlisted `AckFunction-*` templates from the installed macOS Messages framework without copying or packaging Apple artwork

## 7. Session-Long Target Launch Ownership

- [x] 7.1 Add an Electron target registry keyed by validated bundle identity with process, endpoint, enrollment, ownership-marker, attachment, and per-target health state
- [x] 7.2 Allocate unique loopback-only debugging endpoints centrally and reject collisions, non-loopback addresses, stale ownership, and recursive owned relaunch
- [x] 7.3 Discover currently running supported targets when Vibecheck starts, own them independently of the interaction setting, and install each renderer controller in current enabled or dormant state
- [x] 7.4 Enroll every supported target launched while Vibecheck is running, regardless of whether component interaction is enabled, and attach after its owned endpoint becomes healthy
- [x] 7.5 Continue converting later supported launches into owned launches while Vibecheck remains running and preserve dormant injection across pause, disable, and never-enabled state
- [x] 7.6 Keep enrolled owned targets running on Vibecheck quit, close debug sessions, and ensure debugging arguments disappear on the target's next ordinary launch without Vibecheck
- [x] 7.7 Exclude Vibecheck and standalone browser bundles, include ChatGPT/Codex through its coordinated lifecycle, and report unsupported or refused targets without forceful recovery
- [x] 7.8 Coordinate Codex GUI launch arguments with the existing `codex-control` lifecycle so Electron and Rust cannot independently restart Codex
- [x] 7.9 Defer a Codex source-only relaunch while an active turn would be destroyed unless the existing lifecycle owner is already performing a safe relaunch
- [x] 7.10 Add registry and process tests for initial relaunch, refusal, loop prevention, later launch, quit/reopen, pause, disable/re-enable without restart, endpoint failure, and Codex single-owner behavior

## 8. Centralized CDP Attachment

- [x] 8.1 Add one in-process Electron CDP service that owns bounded sessions for all target processes and does not launch per-target injector processes
- [x] 8.2 Discover usable page targets, attach independently to multiple renderers, reconnect boundedly, and clean up sessions on process or page removal
- [x] 8.3 Build newly authored production TypeScript and CSS renderer assets through the Electron production pipeline with deterministic asset resolution
- [x] 8.4 Register the production bundle for future documents and evaluate it in current documents with one stable versioned host binding
- [x] 8.5 Implement idempotent renderer `install`, `setEnabled`, `settle`, and `dispose` operations plus document/session identity checks
- [x] 8.6 Synchronize enabled state and global emoji recents into every healthy renderer and keep unhealthy sessions unable to accept the shortcut
- [x] 8.7 Reinstall after navigation, renderer replacement, or new page creation and ignore stale settlement for obsolete document identities
- [x] 8.8 Make dormant mode close picker/receipt UI, remove all overlays, clear pending target state, pass through Control-Option-R, and expose no other entry point
- [x] 8.9 Add CDP service tests for multi-page attachment, navigation, bounded reconnect, current-state installation, dormant reenablement without source reinjection, stale results, and cleanup
- [x] 8.10 Validate, cache, and synchronize the native Tapback asset map to current and future Electron/CEF and browser renderers with production fallbacks when any asset is unavailable

## 9. Target-Local Selection and Reaction UI

- [x] 9.1 Implement the renderer interaction state machine for disabled, idle, text-locked, element-picking, element-locked, capturing, and receipt states
- [x] 9.2 Prefer a non-empty usable browser Selection/Range on Control-Option-R, clone it, preserve exact trimmed text, and highlight only selected characters without DOM wrappers
- [x] 9.3 Derive a live semantic screenshot container and popover position from text-range rectangles and cancel if the range becomes unusable
- [x] 9.4 Implement capture-phase DOM hover hit testing, usable-target normalization, outline/spotlight rendering, and consumption of only the target-locking click
- [x] 9.5 Extract DOM copy-like text from rendered `innerText` with accessible-label fallback and exclude markup, hidden text, selectors, URLs, class names, and component dumps
- [x] 9.6 Add an isolated Paper adapter for live logical hit testing, coordinate transforms, viewport bounds, and visible logical label/text
- [x] 9.7 Fall back to the generic canvas element when Paper capability is unavailable and never fabricate or serialize a private logical object
- [x] 9.8 Implement a compact target-local strip with six fixed Unicode reactions, two global custom recents, and an expanded-picker affordance
- [x] 9.9 Implement the categorized searchable keyboard-accessible Unicode picker with five global recents and no private Messages/framework assets
- [x] 9.10 Persist global emoji recents in Vibecheck preferences, synchronize them across target apps, and never use target local storage, cookies, or databases
- [x] 9.11 Make emoji choice the only commit; target lock, Escape, click-away, shortcut cancellation, navigation, and disable must have no copy or Codex side effect
- [x] 9.12 Support repeated identical emoji reactions as independent events with no badge, toggle, remove, or replacement semantics
- [x] 9.13 Reposition locked UI on scroll/resize, dismiss unusable targets, and remove every transient production node and style on dispose
- [ ] 9.14 Add production renderer fixture tests for exact nested ranges, DOM controls, click suppression, cancellation, repeat reactions, recents, accessibility, dormant mode, navigation, Paper hit testing, fallback, and teardown
- [x] 9.15 Add a host-coordinated global component-capture session that toggles from any attached renderer, resumes picking after commit, and ends everywhere on shortcut, pause, disable, or shutdown
- [x] 9.16 Make selected-text shortcut use a one-shot replace interaction that does not start or join the global session
- [x] 9.17 Render the fixed six compact reactions from synchronized macOS Tapback templates, keep custom recents in Apple Color Emoji, and regression-test the fallback and expanded-picker states

## 10. Capture and Minimal Reaction Product

- [x] 10.1 Define the internal capture record with only schema version, event/time, source application identity, emoji/label, copy-like text, and screenshot PNG
- [x] 10.2 Remove picker, scrim, range highlight, outline, and spotlight before requesting capture and wait for visual cleanup before taking the screenshot
- [x] 10.3 Resolve current viewport/page metrics through CDP, add fixed padding, clip to visible page coordinates, and capture one valid cropped PNG for DOM, text, and Paper targets
- [x] 10.4 Store screenshots under event-derived names in the fresh owner-only runtime directory and reject target-provided file paths
- [x] 10.5 Cancel the commit before clipboard or Codex delivery when text/bounds become invalid or screenshot capture fails
- [x] 10.6 Delete each temporary PNG after clipboard append and any queued Rust dispatch no longer need it, and remove leftovers during owner shutdown
- [x] 10.7 Build the concise explicit-feedback message from source app, reaction, and copy-like text without treating an ambiguous emoji as an instruction
- [ ] 10.8 Add capture tests for overlay-free timing, page scale/scroll, partial viewport clipping, disappearing targets, malformed PNGs, path confinement, and transient-file cleanup

## 11. Marked Clipboard Bundle and Paste Replay

- [x] 11.1 Define the private pasteboard marker and versioned encoded ordered bundle of complete text/raw-PNG pairs with useful ordinary text and image fallback flavors
- [x] 11.2 Implement atomic native append that extends only a valid current-version marked bundle and starts fresh over unmarked or unsupported content
- [x] 11.3 Preserve unlimited commit-order accumulation with no expiration, entry cap, byte cap, consumed state, or removal after successful Codex delivery
- [x] 11.4 Let ordinary clipboard replacement naturally clear bundle identity without a clipboard monitor, restoration policy, or merge with unrelated content
- [x] 11.5 Implement one physical marked Command-V as text1, image1 through textN, imageN using temporary pasteboard items, bounded delays, and focus restoration between events
- [x] 11.6 Restore the exact original marked bundle after complete success and after any partial paste/focus failure so repeated Command-V replays the whole stack
- [x] 11.7 Add synthetic-event reentrancy protection and serialize or reject concurrent physical paste expansion without interleaving temporary clipboard values
- [x] 11.8 Pass unmarked Command-V and every other input unchanged, including when component reactions are paused or disabled
- [x] 11.9 Keep clipboard data only in NSPasteboard, transient memory, and short-lived runtime PNGs with no reaction database or durable Vibecheck history
- [ ] 11.10 Add native tests for first write, ordered append, unsupported version, ordinary-copy reset, fallback flavors, exact restore, repeated replay, focus movement, partial failure, reentrancy, concurrency, and unmarked pass-through
- [ ] 11.11 Add destination compatibility fixtures proving ordered text/image replay in representative plain-text and rich/multimodal editors
- [x] 11.12 Add a typed atomic native bundle-replace operation and prove new-session and ad-hoc commits cannot inherit prior-session entries

## 12. Clipboard-First Host Orchestration and Receipts

- [x] 12.1 Validate renderer commit events in Electron, capture the PNG, and append the complete pair to the native clipboard before opening Rust delivery
- [x] 12.2 Prevent Rust submission and return `Copy failed` whenever screenshot or complete clipboard append fails
- [x] 12.3 Submit clipboard-backed events to the currently authenticated ready Rust endpoint without durable retry across an unknown boundary or process restart
- [x] 12.4 Preserve the marked clipboard and return copied-only outcomes for no active turn, multiple turns, Rust unavailable, rejection, send failure, and unknown result
- [x] 12.5 Correlate host results to the originating target/document/event and settle only the still-current renderer interaction
- [x] 12.6 Show target-local transient receipts for sent-and-copied, no-active, multiple-active, unavailable, copy-failed, and outcome-unknown results only after screenshot capture
- [x] 12.7 Auto-dismiss receipts without storing reaction history and ignore stale settlement after navigation, target replacement, or disposal
- [x] 12.8 Add Electron orchestration tests for clipboard-first ordering, copy failure, endpoint loss before acceptance, all Rust results, stale settlement, receipt timing, and PNG lifetime
- [x] 12.9 Add Electron orchestration tests for global session IDs, first-commit replace, same-session append, later-session reset, one-shot replace, and stale-session rejection

## 13. Startup Isolation, Recovery, and Lifecycle Verification

- [x] 13.1 Start companion ownership, target discovery, target relaunch, and dormant CDP attachment with Vibecheck while keeping permission checks, active interaction, recents loading, and reaction-socket readiness independent from inference startup
- [x] 13.2 Preserve emotion socket binding and logically independent loading heartbeat before camera permission, camera opening, provider import, model construction, or first-frame inference
- [x] 13.3 Retain the centralized 1.5-second emotion freshness default in Python and the matching Rust fallback without allowing slow component startup to mark loading stale
- [x] 13.4 Degrade only component health when companion, target, CDP, clipboard, or reaction input fails and preserve requested notch/expression operation
- [x] 13.5 Make disable first dormancy-set attached renderers, reject new commits, disable special paste handling, reconcile Rust input, close component IPC, and retain Vibecheck-lifetime target ownership and injection
- [x] 13.6 Make quit dispose renderer UI and CDP sessions, stop new native operations, drain the one Rust mutation, terminate owned component processes, delete transient files, and leave targets and Codex running
- [ ] 13.7 Add process tests for simultaneous sensor/component cold start with deliberately slow target relaunch and verify fresh loading heartbeat and visible notch state
- [ ] 13.8 Add process tests for first enable, later app launch, target quit/reopen, pause/resume, disable/re-enable without restart, rapid toggles, owner crash, companion crash, Rust crash, and safe quit
- [ ] 13.9 Add cross-process tests with fake CDP, native clipboard, and Codex peers for renderer commit through clipboard and zero/one/many routing settlement

## 14. Permissions, Packaging, and Release

- [x] 14.1 Add deliberate-enable onboarding for required Accessibility and Input Monitoring permissions under the stable Vibecheck identity
- [x] 14.2 Handle permission denial as Needs Permission with no effective event tap, no bypass or force-kill behavior, and no impact on camera/notch features
- [x] 14.3 Package the production companion, renderer bundle, emoji data, and extended Rust executable beneath Vibecheck resources with no runtime compiler, repository checkout, shell launcher, or network requirement
- [x] 14.4 Update frozen-runtime and Electron Forge resource resolution so packaged mode cannot fall back to development or experimental paths
- [x] 14.5 Extend Mach-O inventory and inside-out hardened signing to the companion and every new nested native artifact with stable identifiers and least-privilege entitlements
- [x] 14.6 Extend release verification to reject unsigned, ad-hoc, wrong-architecture, unexpectedly entitled, or untracked nested code and to inventory hashes for new resources
- [ ] 14.7 Verify Developer ID signing, notarization, stapling, Gatekeeper assessment, update-stable TCC identity, and clean offline startup for the exact distributed artifact
- [x] 14.8 Document Vibecheck-lifetime target ownership, dormant injection, coordinated ChatGPT launch, Component reactions enablement, permissions, graceful relaunch behavior, clipboard replay/reset semantics, status outcomes, privacy boundary, and troubleshooting
- [ ] 14.9 Add a protected clean-account acceptance run for permission grant/denial, DOM and Paper selection, graceful target relaunch, repeated paste, ordinary-copy reset, Codex sent/copied-only outcomes, pause/resume, disable/re-enable, update identity, and safe quit
- [x] 14.10 Verify packaged builds contain no copied Apple Tapback artwork and gracefully fall back when the installed framework or an allowlisted template is unavailable

## 15. Final Verification Gates

- [ ] 15.1 Run Python format, lint, type, unit, protocol, topology, process, heartbeat, and source-guard suites from a clean checkout
- [ ] 15.2 Run Rust format, lint, unit, protocol, fake-Codex, process, dry-run, and opt-in live tests against the pinned `codex-control` dependency
- [x] 15.3 Run JavaScript format, typecheck, unit, CDP, renderer-fixture, lifecycle, coordinated-ChatGPT, menu, Electron integration, dependency-audit, and zero-`BrowserWindow` security tests
- [ ] 15.4 Run native companion unit, lifecycle, clipboard replay, focus, permission, signing, and destination compatibility tests
- [ ] 15.5 Build the production app with experimental directories unavailable and prove source, tests, commands, generated assets, source maps, binaries, and packaged resources remain independent
- [ ] 15.6 Complete signed/notarized clean-install acceptance and record app/runtime versions, architecture, signing identity, permission identity, notarization submission, and final artifact hashes

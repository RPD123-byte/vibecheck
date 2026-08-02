## Why

Vibecheck can currently condition Codex only from passive facial-expression
inference, leaving users without an explicit way to point at a UI component in
another Electron application and react to it while work is in progress. The
validated interaction experiments now provide enough evidence to define that
workflow as a production-owned Vibecheck capability without shipping or
depending on experimental source.

## What Changes

- Add a persistent `Component reactions` preference and native menu control
  that can operate independently from the notch and expression-based Codex
  interruption, starts no camera or model by itself, participates in temporary
  pause, and exposes feature and delivery status.
- Make Vibecheck own supported Electron application launches for the complete
  Vibecheck process lifetime, supplying a loopback Chromium debugging
  transport, injecting production-owned renderer code in enabled or dormant
  state, and reinjecting after navigation or renderer replacement.
- Include ChatGPT/Codex as a selectable owned source through one coordinated
  launch that combines the managed app-server environment required by
  `codex-control` with Vibecheck's renderer-debugging arguments.
- Add the target-local `Control-Option-R` workflow: use an existing text
  selection when present, otherwise enter hover-and-click component selection,
  support normal DOM targets and a production Paper logical-canvas adapter, and
  commit only when the user chooses an emoji.
- Add a compact reaction bar using the installed macOS Messages Tapback
  templates for the fixed six reactions, an expanded Unicode emoji picker,
  global Vibecheck recents, click-away and Escape behavior, and a transient
  receipt that distinguishes copied, sent to Codex, ambiguous Codex targeting,
  and failure outcomes. The system templates are loaded at runtime and are not
  copied into the repository or application bundle.
- Capture only copy-like selected or visible component text plus a cropped PNG
  of the selected component. Do not collect or send cloned HTML, DOM snapshots,
  hidden text, or a technical component dump.
- Add a Vibecheck-marked, versioned clipboard bundle. Component-selection
  reactions append only within one explicit global capture session; the first
  commit of every later session and every one-shot selected-text reaction
  replaces the prior bundle. An ordinary copy also replaces the bundle, and
  repeated Command-V replays the unchanged complete bundle as one text paste
  followed by one image paste per entry.
- Extend the existing Rust Codex interruption worker with an explicit-reaction
  input, ordered batching, priority over passive expression events, and the
  same conservative exactly-one-active-turn rule. Zero or multiple active
  turns leave the reaction on the clipboard without a Codex mutation.
- Add macOS Accessibility/Input Monitoring onboarding, production packaging,
  signing, lifecycle, fixture, and release verification for the feature-scoped
  paste and application-lifecycle integration.
- Reimplement every required behavior under tracked production paths. Production
  source, tests, build metadata, packaged resources, and runtime commands MUST
  NOT import, copy at build time from, execute, or reference
  `experimentation/`.

## Capabilities

### New Capabilities

- `component-reaction-control`: Persistent enablement, pause behavior, desired
  and effective health, production-source independence, and coordination with
  the existing Vibecheck runtime.
- `electron-component-selection`: Supported Electron launch ownership,
  renderer lifecycle, text/DOM/Paper targeting, reaction UI, screenshot
  capture, and transient delivery receipts.
- `reaction-clipboard-delivery`: Copy-like text/PNG capture, ordered clipboard
  accumulation, marked Command-V expansion, replay, focus handling, and
  ordinary-copy reset behavior.
- `explicit-reaction-routing`: Versioned reaction delivery to the existing Rust
  Codex worker, component-only topology, conservative active-turn selection,
  serialization, batching, and priority over expression actions.
- `component-reaction-release`: macOS permissions, native integration,
  production packaging, signing, release verification, and compatibility
  fixtures for the complete feature.

### Modified Capabilities

None. The affected menubar, runtime-control, expression-interruption, and
release capabilities are still represented by active unarchived changes; this
change defines additive contracts and depends on their production seams without
weakening their requirements.

## Impact

- Extends Electron main-process preferences, native menu projection, runtime
  state, target-process ownership, Chromium debugging control, renderer
  injection, clipboard coordination, and user-visible status.
- Adds production-owned renderer assets and a feature-scoped signed native
  integration for macOS application lifecycle, pasteboard, global shortcut
  interception, synthetic paste events, Accessibility focus restoration, and
  bounded read-only rendering of the installed system Tapback templates.
- Extends Python feature state and pure topology derivation so component
  reactions require the Rust interruption role but never inference unless
  another enabled feature needs it.
- Extends the Rust interruption executable, its local protocols, status model,
  input arbitration, Codex input construction, graceful drain, and tests.
- Extends the packaged runtime, entitlements, permission guidance, signing
  inventory, notarized clean-install checks, CI source guards, and
  application-specific fixtures.
- Does not add a launchd service, independently managed daemon, conventional
  Vibecheck window, native AppKit selection fallback, browser extension,
  general canvas adapter, durable reaction history, cloned DOM context, or
  experimental runtime dependency.

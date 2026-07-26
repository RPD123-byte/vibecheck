# Highlight & React experiment

The supported implementation is one Attune-compatible CSS and JavaScript
renderer injected into Electron or CEF applications. Codex and every other
supported app use this exact same implementation, interaction model, and
Messages-style Tapback UI. Pressing `Control–Option–R` (`⌃⌥R`) opens the picker
at an exact text selection, or starts an element picker when no text is
selected. Clicking outside the highlighted text and bar, or pressing Escape,
dismisses it.

The repository still contains the early native Accessibility prototype for
research, but it is not an automatic fallback and does not replace the renderer
UI. Native AppKit applications cannot execute DOM, CSS, or browser Range APIs,
so they are reported as unsupported by the shared launcher.

The renderer recognizes known message components when they exist and otherwise
falls back to the selected range's nearest semantic text container. It stores
the chosen Tapback key and display value in
`data-highlight-and-react-reaction-key` and
`data-highlight-and-react-reaction`. It highlights only the selected character
range with the CSS Custom Highlight API and positions the toolbar from that
range's client rectangles. Text mode does not outline or spotlight the
selection's containing component. This avoids DOM wrappers that could interfere
with React.

With no text selection, `⌃⌥R` enters element mode instead. Hovering draws a
dashed inspector outline around the element under the pointer; clicking locks
that element, consumes the click so the underlying control is not activated,
and opens the reaction bar. The locked element is outlined and spotlighted
because there is no text range to identify the target.

Canvas-backed editors require a logical target adapter because shapes painted
inside a `<canvas>` are not DOM elements. The Paper adapter detects Paper's
editor canvas, converts the pointer from viewport coordinates into Paper world
coordinates, asks Paper's editor hit tester for the logical node, and converts
that node's live bounds back into viewport coordinates for the same overlay and
Tapback bar. Paper's DOM sidebars continue through the normal element path.

Reaction badges are independent fixed overlays. Targets retain only namespaced
reaction state; the stylesheet never changes a target's `position`, display, or
layout. This is important for Paper because its full-window canvas is fixed and
would be displaced if a generic badge implementation changed its positioning
mode.

Adding or replacing a reaction also creates structured agent context. The
context contains the emoji and reaction label, application and URL, target
label and bounds, selected/component text, and a bounded component
representation. DOM targets use a cloned `outerHTML` snapshot without the
experiment's reaction attributes; Paper targets use the logical file/node IDs,
label, component type, and canvas bounds. Removing the active reaction does not
send context.

The host injector always copies that context to the macOS clipboard first. It
then asks an experiment-local bridge to inspect Codex:

- with exactly one actively running Codex turn, the bridge interrupts that
  turn, confirms that it stopped, and starts a replacement turn in the same
  task with the reaction context;
- with zero active turns, the context remains on the clipboard and Codex is not
  changed;
- with multiple active turns, the context remains on the clipboard and the
  bridge refuses to guess which task should receive it.

The bridge connects to the existing Codex control socket and never launches,
quits, or restarts the Codex GUI. Clipboard copying and Codex delivery are
independent, so an unavailable Codex control socket does not lose the context.

The Tapback UI is a clean-room recreation from the observable Messages UI;
Messages itself is proprietary compiled software, so its literal source is not
available. The recreation preserves the behavior that matters to the
experiment:

- six fixed Tapbacks in Messages order: Heart, Thumbs up, Thumbs down, Ha ha!,
  Exclamation mark, and Question mark;
- the built-in Tapback silhouettes are rendered at runtime from the exact
  `AckFunction-*` vectors installed in macOS's `IMSharedUI.framework`; the
  private artwork is not copied into this repository;
- recent and custom reactions use the installed `Apple Color Emoji` font,
  keeping the two icon sources separate just as Messages does;
- two recent emoji in the compact strip and a separate custom-emoji bubble;
- an expanded categorized emoji picker with five persistent recents;
- exactly one reaction per message: selecting the active reaction removes it,
  while selecting another replaces it;
- a dimmed conversation with the active message left visible;
- Escape returns from the expanded picker to the compact strip, then dismisses
  the interaction.

## Test the renderer implementation

This automated test launches and terminates only its own temporary Electron
fixture. It does not touch the running Codex app:

```bash
cd /Users/computer/vibe-check-worktrees/highlight_and_react/experimentation/highlight_and_react
node --test Tests/renderer_injection.test.mjs
```

The test verifies the complete interaction:

- inject CSS and JavaScript over the Chromium DevTools protocol;
- open from a selected text range with `⌃⌥R`;
- keep text mode scoped to the exact range without a component spotlight;
- dismiss from an outside click;
- open from `⌃⌥R`;
- add, remove, and replace a reaction on the message component;
- open the expanded picker and choose a custom emoji;
- enter element mode with no selection, hover a component, lock it, and react.
- resolve a logical node inside a childless Paper-style canvas, add and remove a
  reaction, and preserve the canvas's fixed layout;
- queue exact-range, DOM-component, and Paper-node context exactly once; and
- copy context before invoking a mock conservative Codex bridge.

For a visible, interactive fixture instead of the automated test, run:

```bash
./scripts/run_fixture_renderer.sh
```

This opens a temporary Electron window. Select sample text and press `⌃⌥R` to
test exact-range mode. Clear the selection and press `⌃⌥R` to test element
mode, then hover and click a component. Added/replaced reactions are copied to
the clipboard, but this fixture deliberately does not interrupt Codex. Press
Control-C when finished.

## Run it in another Electron app

Quit the target app yourself first, then give the shared launcher its `.app`
bundle and a free localhost port:

```bash
cd /Users/computer/vibe-check-worktrees/highlight_and_react/experimentation/highlight_and_react
./scripts/launch_electron_renderer.sh \
  --app /Applications/Slack.app \
  --port 9224
```

If it is already running and you intentionally want one command to gracefully
quit and relaunch it, add `--restart`:

```bash
./scripts/launch_electron_renderer.sh \
  --app /Applications/Slack.app \
  --port 9224 \
  --restart
```

The launcher verifies that the bundle contains a Chromium runtime, refuses to
force-kill an app, starts it with a loopback-only DevTools port, and injects the
same `renderer/highlight_and_react.css` used by Codex. Without `--restart`, a
running app is left untouched. Use a different port for each simultaneously
attached application.

If an Electron app was already started manually with a DevTools port, attach
without launching it:

```bash
./scripts/attach_electron_renderer.sh 9224
```

Selecting text and pressing `⌃⌥R` uses exact browser Range geometry in any
document structure. With no selection, the same shortcut enables the generic
DOM element hover-and-click picker. The attachment script builds the local
Codex bridge automatically. To exercise reactions without interrupting an
active Codex task, use clipboard-only mode:

```bash
HIGHLIGHT_CONTEXT_MODE=clipboard ./scripts/attach_electron_renderer.sh 9224
```

Set `HIGHLIGHT_CONTEXT_MODE=off` to disable both clipboard and Codex context
delivery while retaining the reaction UI.

In Paper, the same no-selection shortcut switches automatically to logical
canvas hit testing when the pointer is over the editor canvas. Hovering a Paper
frame, text layer, or other painted node outlines that node's bounds rather
than the full canvas. Clicking locks the node and opens the same reaction UI.

## Run it in every currently open Electron app

Use the machine-wide launcher when you want one command instead of naming Slack,
Codex, Cursor, and other apps separately. Running it without options is a safe
preview:

```bash
cd /Users/computer/vibe-check-worktrees/highlight_and_react/experimentation/highlight_and_react
./scripts/launch_all_electron_renderers.sh
```

The preview discovers currently running Electron/CEF apps and shows the
unique localhost port that would be assigned to each. It does not launch every
installed app, and it ignores native AppKit apps and standalone browsers.

When the preview is correct, run the explicit restart form from an external
terminal:

```bash
./scripts/launch_all_electron_renderers.sh --restart
```

That command gracefully quits and relaunches every discovered supported app,
then keeps one shared-renderer injector attached to each app. It never
force-kills a process. Because Codex itself is included when it is running,
starting this command from Terminal will close and reopen Codex; finish or save
active tasks first. Keep the terminal open while using the experiment.
Control-C stops only the injectors and leaves the relaunched apps open.

Each Electron application is a separate Chromium process, so there cannot be
one DevTools port shared by the whole machine. The machine-wide launcher hides
that detail by assigning ports automatically.

The CSS/JavaScript payload is already embedded into each supported app's page
at runtime. The launcher itself cannot be embedded into ordinary site
JavaScript: browser and Electron renderer sandboxes are intentionally unable to
quit applications or execute local shell commands. Removing the terminal step
later requires a trusted local host component (for example, the Vibecheck menu
bar app) that owns discovery and relaunch, while the existing renderer payload
continues to own the in-page UI.

Standalone browsers are deliberately excluded. Current Chrome releases require
remote debugging to use a separate non-default browser profile, which would not
contain the user's normal signed-in site state. A browser extension is the
correct packaging for using the same interaction on ordinary websites; it is a
separate delivery mechanism from Electron app injection.

## Run it in Codex

Chromium DevTools must be enabled when Codex starts; it cannot be enabled on an
already-running process. Without an explicit `--restart`, the safe launcher
refuses to quit or restart Codex:

```bash
cd /Users/computer/vibe-check-worktrees/highlight_and_react/experimentation/highlight_and_react
./scripts/launch_codex_renderer.sh
```

If Codex is running, the script exits with an explanation. When you are ready,
quit Codex yourself and run it again. It starts Codex with a localhost-only
DevTools port and watches `renderer/highlight_and_react.css` for live edits.
Pressing Control-C stops the injector but leaves Codex open.

From an external terminal, `./scripts/launch_codex_renderer.sh --restart`
performs the same graceful quit-and-relaunch flow. Running it ends the current
Codex session, so only use that option after saving or finishing active tasks.

If Codex was already launched manually with `--remote-debugging-port=9222`,
attach without launching anything:

```bash
./scripts/attach_codex_renderer.sh 9222
```

Then select a phrase in a Codex message and press `⌃⌥R`. The Tapback picker
should appear above only the selected range. With no selected text, press
`⌃⌥R`, hover a Codex component, and click it to lock the component and open the
picker. Click anywhere outside it to dismiss.

The Codex scripts are thin wrappers around the same generic Electron launcher
and attachment scripts. The source file is directly compatible with Attune's `set-css` and
`launch`/`attach` workflow. See [ATTUNE_RESEARCH.md](ATTUNE_RESEARCH.md) for the
upstream commits, exact mechanism, and the important finding that the cloned
repositories do not themselves contain a double-click implementation.

## Legacy native accessibility research

This older prototype is retained only for investigating what macOS
Accessibility exposes. It has a different native panel and is not used by the
generic Electron launcher. Do not run it alongside the renderer experiment:
the native event tap owns the same shortcut and would prevent the renderer from
receiving it. Opening the native bundle normally no longer enables that event
tap; the conflicting research mode requires an explicit `--legacy-global`
argument.

To display its standalone overlay without permissions:

```bash
cd /Users/computer/vibe-check-worktrees/highlight_and_react/experimentation/highlight_and_react
swift run highlight-and-react --demo
```

Use `--demo-seconds 10` to make the demo exit automatically.

## Safety and current limitations

- Renderer injection requires starting a Chromium app with a loopback-only
  DevTools port. The provided launcher never kills an existing Codex process.
- The renderer route does not modify Codex's signed app bundle or ASAR.
- The shared renderer path applies to Electron and compatible CEF apps, not
  native AppKit applications. The launcher fails explicitly for unsupported
  bundles instead of silently changing the design or click behavior.
- DOM-backed applications work through standards-based browser APIs. Paper
  canvas targeting uses Paper's current private React editor state and hit-test
  methods, so a Paper release can require an adapter update. If the internal
  capability is unavailable, the renderer falls back to selecting the canvas
  element rather than breaking the normal DOM path.
- Renderer reactions are local DOM state and disappear when React replaces the
  message component or the renderer reloads. Paper reactions are keyed locally
  by file and logical node ID. Persistence for either path needs a later
  service.

## Verify

```bash
swift test
./scripts/build_app.sh
node --test Tests/renderer_injection.test.mjs
cargo test --manifest-path CodexBridge/Cargo.toml
cargo clippy --manifest-path CodexBridge/Cargo.toml --all-targets -- -D warnings
```

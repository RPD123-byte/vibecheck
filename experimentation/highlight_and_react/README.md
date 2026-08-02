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

Reactions are transient feedback events, not persistent decorations. Choosing
a reaction closes the picker and removes the selection overlay; it does not add
a badge to the component. Targets retain only namespaced state so choosing the
same reaction again can still mean remove, but the stylesheet never changes a
target's `position`, display, or layout.

Adding or replacing a reaction also creates structured agent context. The
context contains the emoji and reaction label, application and URL, target
label and bounds, selected/component text, and a bounded component
representation. DOM targets use a cloned `outerHTML` snapshot without the
experiment's reaction attributes; Paper targets use the logical file/node IDs,
label, component type, and canvas bounds. Removing the active reaction does not
send context.

The host captures a padded PNG crop of the selected component from the live
Chromium renderer after the picker closes. Viewport bounds are translated to
page coordinates and clipped to the visible viewport, so the same path works
for Paper canvas nodes and scrolled DOM elements. Every reaction is appended to
a versioned bundle on one pasteboard item until that bundle is pasted. The
bundle preserves each plain-language summary with its own raw PNG in reaction
order. The native paste adapter emits a text-only paste followed by an
image-only paste for every entry, so the destination receives the complete
sequence without renderer injection. The Codex turn receives the current
reaction's text plus screenshot directly as a `localImage` input.

The host injector always appends that context to the macOS clipboard first. It
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
- verify that reactions never leave a component badge behind;
- queue exact-range, DOM-component, and Paper-node context exactly once;
- capture a valid clipped PNG for every queued component; and
- copy text and image context before invoking a mock conservative Codex bridge.

For a visible, interactive fixture instead of the automated test, run:

```bash
./scripts/run_fixture_renderer.sh
```

This opens a temporary Electron window. Select sample text and press `⌃⌥R` to
test exact-range mode. Clear the selection and press `⌃⌥R` to test element
mode, then hover and click a component. Added/replaced reactions are copied to
the clipboard as a readable summary plus a component screenshot, but this
fixture deliberately does not interrupt Codex. Press Control-C when finished.

## Paste text and image into any app

Run the native adapter once and leave it open:

```bash
./scripts/run_paste_adapter.sh
```

The launcher discovers DevTools ports already enabled on running Electron apps,
starts or reuses their context hosts, and then starts the native shortcut
listener. To limit it to one source app, pass its port, for example
`--port 9225` for Paper. Keep this terminal open; otherwise the reaction UI can
remain visible while its context outbox has no host to copy events.

React to one or more components before returning to the destination. Each
reaction is appended to the same marked clipboard bundle. Focus any destination
editor and use the normal `⌘V`. Highlight & React intercepts only marked
context, then emits a text-only `⌘V` and image-only `⌘V` for each bundled
component in order, restoring focus between events. The destination receives
ordinary paste events; no renderer script is injected into that app.

After the sequence succeeds, the adapter restores the bundle with a consumed
flag. Repeating `⌘V` can paste it again, but the next new reaction sees that flag
and starts a fresh bundle rather than appending to already-pasted feedback.
Replacing the clipboard yourself also starts a fresh bundle. `⌃⌥V` remains
available as an explicit fallback.

The combined launcher uses conservative Codex delivery by default: exactly one
active task is interrupted and receives the current reaction, while zero or
multiple active tasks leave everything on the accumulated clipboard only. To
disable automatic Codex interruption while keeping clipboard delivery, run:

```bash
HIGHLIGHT_CONTEXT_MODE=clipboard ./scripts/run_paste_adapter.sh
```

The adapter uses the existing Highlight & React app identity and requires the
same macOS Accessibility permission as the native selection experiment.

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
installed app, and it ignores native AppKit apps and standalone browsers. The
separate browser experiment below exercises Chrome without changing this
launcher or the Vibecheck application.

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

## Browser process-ownership experiment

The Chrome experiment proves that the same process ownership and DevTools
mechanism can select components in ordinary browser pages. It is deliberately
contained in this experiment directory and does not add browser behavior to
Vibecheck's `src`.

Run the isolated test:

```bash
cd /Users/computer/vibe-check-worktrees/highlight_and_react/experimentation/highlight_and_react
node scripts/browser_cdp_experiment.mjs --headless
```

Or run its integration test:

```bash
node --test Tests/browser_cdp_experiment.test.mjs
```

The harness starts the installed Chrome executable with a temporary profile and
a loopback-only, randomly assigned DevTools port. It serves local main-frame,
same-origin-frame, cross-origin-frame, open-shadow-root, closed-shadow-root, and
strict-content-security-policy fixtures. It injects the existing renderer
source without copying browser-specific logic into the renderer.

The measured access in Chrome 150 is:

| Capability | Result |
| --- | --- |
| Read normal page text and computed CSS | Yes |
| Mutate page CSS and observe the computed result | Yes |
| Route `⌃⌥R` through Chrome's CDP input pipeline | Yes |
| Route a literal macOS `⌃⌥R` keystroke into the page | Yes |
| Select an exact browser text range | Yes |
| Hover, lock, and react to a DOM component | Yes |
| Suppress the selected component's underlying click | Yes |
| Capture a cropped PNG and structured component context | Yes |
| Inject and select inside a same-origin iframe | Yes |
| Inject and select inside a cross-origin, out-of-process iframe | Yes, by attaching to its separate CDP target |
| Read an open shadow root from page JavaScript | Yes |
| Inspect a closed shadow root | Yes through CDP piercing; no from ordinary page JavaScript |
| Preserve the browser's same-origin restriction for page JavaScript | Yes |
| Operate on a page whose CSP rejects inline styles | Yes, when the host installs the CSS through the CDP CSS domain |
| Auto-attach to a newly opened tab | Yes |
| Reinject after a full same-tab navigation | Yes |
| Auto-attach to a new cross-origin renderer process | Yes |

The automated test uses CDP `Input.dispatchKeyEvent` and
`Input.dispatchMouseEvent`, not synthetic `KeyboardEvent` or `MouseEvent`
objects. A separate visible run was performed with Chrome as the only running
Chrome instance. A literal macOS `Control-Option-R`, followed by moving and
clicking on the component, entered selection mode and displayed the reaction
bar. The component's underlying control remained disabled by the picker.

Cross-origin frames are separate renderer targets under Chrome site isolation.
A long-running browser owner therefore needs target auto-attach, per-target
injection, navigation/reload reinjection, and target cleanup. Strict CSP pages
also need CSS installed through the CDP CSS domain because the page correctly
rejects an injected inline `<style>` element. Both behaviors are demonstrated
by the experiment. The owner prototype auto-attaches to new page and iframe
targets, registers the source for future documents, and was verified across a
new tab and a complete navigation.

The installed Chrome 150 was also tested against its real default user profile.
Chrome started with the loopback debugging flags visible in its process command
line but deliberately exposed no debugging endpoint. Restarting the browser
therefore does not make the existing signed-in default profile attachable. A
CDP owner can manage a separate Vibecheck-owned profile, but normal-profile
support requires another delivery route instead of silently enabling CDP.

Chrome's tab strip, address bar, extension buttons, bookmarks, menus, and tabs
were all visible through macOS Accessibility with actionable roles. They are
not webpage DOM, so they require a native Accessibility target adapter rather
than the renderer selector. The experiment confirmed visibility; it did not
combine those controls with the component screenshot and reaction pipeline.
Restricted internal pages may also require separate handling.

The normal Chrome instance was gracefully quit for this explicit lifecycle
test. Its original profile and previously open 20-tab window were restored
afterward, and Chrome was returned to its ordinary launch without a debugging
listener. The repeatable automated test remains isolated and never touches the
normal profile.

## Safari WebDriver experiment

Safari 26.5.2 exposes its webpage DOM through WebDriver/Web Inspector rather
than Chrome's DevTools protocol. The experiment-only harness is:

```bash
cd /Users/computer/vibe-check-worktrees/highlight_and_react/experimentation/highlight_and_react
node scripts/safari_webdriver_experiment.mjs
```

Its integration test is:

```bash
node --test Tests/safari_webdriver_experiment.test.mjs
```

The measured access in Safari 26.5.2 is:

| Capability | Result |
| --- | --- |
| Read DOM text and computed CSS | Yes |
| Mutate CSS and observe the computed result | Yes |
| Inject the shared Highlight & React renderer | Yes |
| Route `⌃⌥R` through WebDriver keyboard actions | Yes |
| Route a literal macOS `⌃⌥R` into the page | Yes |
| Select an exact text range | Yes |
| Hover and lock a DOM component through WebDriver pointer actions | Yes |
| Suppress the component's underlying click | Yes |
| Create the structured reaction event | Yes |
| Capture page and selected-element PNGs | Yes |
| Inject into same-origin and cross-origin frames | Yes |
| Read an open shadow root | Yes |
| Read a closed shadow root from page JavaScript | No, as expected |
| Retain injection after navigation | No |
| Detect navigation and reinject from the host | Yes |

The Safari integration test passed after the user enabled Safari's vendor
automation service with `safaridriver --enable`. If that permission is absent,
the test skips with the returned reason rather than changing Safari settings.

SafariDriver accepts a `--bidi` argument and a `webSocketUrl` capability, but
Safari 26.5.2 did not expose a listener on the requested BiDi port. The
standards-based `script.addPreloadScript` route could therefore not be used.
Unlike the Chrome owner, the demonstrated Safari host must detect a navigation
and repair the injection afterward.

Safari also isolates WebDriver sessions in special automation windows that are
separate from ordinary Safari windows and browsing data. A physical
`Control-Option-R` reached the injected automation page and entered selection
mode. Safari then deliberately blocked the physical mouse click with its
“remotely controlled by an automated test” safety dialog. The equivalent
WebDriver pointer movement and click completed successfully. Stopping the
automation session closes its isolated window.

Consequently, SafariDriver proves that the shared selector works in WebKit, but
it is not a production mechanism for silently owning the user's existing
Safari windows. Normal-profile Safari support needs a different delivery route
that is allowed to run in ordinary tabs.

Safari's address field, back/forward buttons, new-tab button, tab overview,
window controls, and application menus were independently confirmed through
macOS Accessibility. As with Chrome, those controls need a native
Accessibility adapter; WebDriver operates on webpage content.

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
node --test Tests/browser_cdp_experiment.test.mjs
node --test Tests/safari_webdriver_experiment.test.mjs
cargo test --manifest-path CodexBridge/Cargo.toml
cargo clippy --manifest-path CodexBridge/Cargo.toml --all-targets -- -D warnings
```

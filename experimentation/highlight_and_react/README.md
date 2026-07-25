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

For a visible, interactive fixture instead of the automated test, run:

```bash
./scripts/run_fixture_renderer.sh
```

This opens a temporary Electron window. Select sample text and press `⌃⌥R` to
test exact-range mode. Clear the selection and press `⌃⌥R` to test element
mode, then hover and click a component. Press Control-C when finished.

## Run it in another Electron app

Quit the target app yourself first, then give the shared launcher its `.app`
bundle and a free localhost port:

```bash
cd /Users/computer/vibe-check-worktrees/highlight_and_react/experimentation/highlight_and_react
./scripts/launch_electron_renderer.sh \
  --app /Applications/Slack.app \
  --port 9224
```

The launcher verifies that the bundle contains a Chromium runtime, refuses to
terminate an already-running app, starts it with a loopback-only DevTools port,
and injects the same `renderer/highlight_and_react.css` used by Codex. Use a
different port for each simultaneously attached application.

If an Electron app was already started manually with a DevTools port, attach
without launching it:

```bash
./scripts/attach_electron_renderer.sh 9224
```

Selecting text and pressing `⌃⌥R` uses exact browser Range geometry in any
document structure. With no selection, the same shortcut enables the generic
DOM element hover-and-click picker.

## Run it in Codex

Chromium DevTools must be enabled when Codex starts; it cannot be enabled on an
already-running process. The safe launcher refuses to quit or restart Codex:

```bash
cd /Users/computer/vibe-check-worktrees/highlight_and_react/experimentation/highlight_and_react
./scripts/launch_codex_renderer.sh
```

If Codex is running, the script exits with an explanation. When you are ready,
quit Codex yourself and run it again. It starts Codex with a localhost-only
DevTools port and watches `renderer/highlight_and_react.css` for live edits.
Pressing Control-C stops the injector but leaves Codex open.

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
- Renderer reactions are local DOM state and disappear when React replaces the
  message component or the renderer reloads; persistence needs a later service.

## Verify

```bash
swift test
./scripts/build_app.sh
node --test Tests/renderer_injection.test.mjs
```

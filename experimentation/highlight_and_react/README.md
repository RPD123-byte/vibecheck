# Highlight & React experiment

This isolated experiment now has two implementations:

1. **Codex renderer injection (recommended):** Attune-compatible CSS and
   JavaScript run inside Codex's Chromium renderer. Selecting message text and
   pressing `Control–Option–R` (`⌃⌥R`) opens a Messages-style Tapback picker at
   the exact text range.
   Clicking outside the highlighted text and bar, or pressing Escape, dismisses
   it.
2. **Native accessibility fallback:** the original app-independent Swift
   prototype reads the foreground app's Accessibility selection and draws
   `NSPanel` overlays.

The renderer version uses Codex's real `[data-user-message-bubble]` component
selector and stores the chosen Tapback key and display value in
`data-highlight-and-react-reaction-key` and
`data-highlight-and-react-reaction`. It highlights only the selected character
range with the CSS Custom Highlight API and positions the toolbar from that
range's client rectangles, avoiding DOM wrappers that could interfere with
React.

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
- dismiss from an outside click;
- open from `⌃⌥R`;
- add, remove, and replace a reaction on the message component;
- open the expanded picker and choose a custom emoji.

For a visible, interactive fixture instead of the automated test, run:

```bash
./scripts/run_fixture_renderer.sh
```

This opens a temporary Electron window. Select sample text and press `⌃⌥R`;
press Control-C when finished.

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
should appear above the selected range. Click anywhere outside it to dismiss.

The source file is directly compatible with Attune's `set-css` and
`launch`/`attach` workflow. See [ATTUNE_RESEARCH.md](ATTUNE_RESEARCH.md) for the
upstream commits, exact mechanism, and the important finding that the cloned
repositories do not themselves contain a double-click implementation.

## Native accessibility fallback

The fallback does not inject code into, restart, or terminate the target
application. Select text and press `⌃⌥R`; it asks macOS Accessibility for the
selected text and screen bounds, then presents a click-through highlight and a
non-activating reaction panel.

## Try the overlay without permissions

```bash
cd experimentation/highlight_and_react
swift run highlight-and-react --demo
```

Use `--demo-seconds 10` to make the demo exit automatically.

### Test the keyboard shortcut in the native fixture

```bash
cd experimentation/highlight_and_react
./scripts/build_app.sh
build/HighlightAndReact.app/Contents/MacOS/highlight-and-react \
  --fixture --debug-accessibility
```

In the fixture window:

1. Select `Select this sentence, then press Control–Option–R.`
2. Press `Control–Option–R` (`⌃⌥R`).
3. The selection should get a yellow outline and the emoji bar should appear.
4. Click elsewhere in the window; both overlay panels should disappear.

This is the same selection and shortcut path used in Codex.

### Build a stable native app bundle

```bash
cd experimentation/highlight_and_react
./scripts/build_app.sh
open build/HighlightAndReact.app
```

The app needs Accessibility access to resolve UI elements and Input Monitoring
access to observe the global shortcut and outside clicks:

- System Settings > Privacy & Security > Accessibility
- System Settings > Privacy & Security > Input Monitoring

The prototype never requests these permissions on a normal launch. Run the
binary with `--request-permission` only when you intentionally want the
Accessibility prompt:

```bash
build/HighlightAndReact.app/Contents/MacOS/highlight-and-react \
  --request-permission
```

After permission is granted, select text in Codex and press `⌃⌥R`. Press the
shortcut again to hide the overlay, or click anywhere outside the selected text
and reaction bar. The shortcut itself is consumed so it cannot replace the
selection; every other keyboard and mouse event passes through unchanged.

For the first live Codex run, add `--debug-accessibility`. It prints the role,
bounds, text preview, and supported selection attributes. That makes tuning
Codex selection handling empirical:

```bash
build/HighlightAndReact.app/Contents/MacOS/highlight-and-react \
  --debug-accessibility
```

### Why the fallback can be app-independent

The overlay uses three OS-level contracts rather than Codex internals:

- `CGEventTap` identifies `⌃⌥R` and outside clicks.
- `AXSelectedText` plus parameterized bounds resolves the selected text;
  Electron/WebKit text-marker attributes are supported as a fallback.
- `NSPanel` draws above other applications without taking keyboard focus.

The app-independent portion is the event monitor, target resolver, coordinate
conversion, overlay placement, and reaction event. App adapters only need to
improve target selection or decide what a reaction means.

### Codex-specific fallback uncertainty

Codex is Electron-based, and the useful Accessibility selection may belong to a
text node or a larger web-area ancestor depending on how its accessibility tree
is authored. The next useful experiment is to inspect those selection
attributes on an authorized machine without introducing any Codex process
injection.

## Safety and current limitations

- Renderer injection requires starting a Chromium app with a loopback-only
  DevTools port. The provided launcher never kills an existing Codex process.
- The renderer route does not modify Codex's signed app bundle or ASAR.
- Attune's approach applies to Electron and compatible CEF apps, not every macOS
  app. Native applications still need the Accessibility fallback.
- Renderer reactions are local DOM state and disappear when React replaces the
  message component or the renderer reloads; persistence needs a later service.
- The native fallback only resolves selected content after the explicit
  shortcut and prints reactions as local JSON events.
- Secure text fields can expose little or no Accessibility text, by design.
- Some apps flatten their Accessibility trees, so exact message bounds may need
  a small app-specific resolver.
- The prototype has a small `✦` menu-bar item for demo, hide, and quit. A
  production app should add a pause control, explicit privacy copy, and durable
  reaction storage.

## Verify

```bash
swift test
./scripts/build_app.sh
node --test Tests/renderer_injection.test.mjs
```

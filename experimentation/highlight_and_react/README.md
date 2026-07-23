# Highlight & React experiment

This is a deliberately isolated macOS prototype for placing a Messages-style
reaction bar over content in Codex or another application.

The experiment does not modify, inject code into, restart, or terminate the
target application. Its primary interaction is selection-first: select text and
press `Control–Option–R` (`⌃⌥R`). It asks macOS Accessibility for the selected
text and its screen bounds, then presents two non-activating floating panels:

1. a click-through highlight around the resolved target;
2. a reaction bar above or below that target.

Choosing a reaction prints a JSON event to standard output. That event is the
prototype seam for a future Electron service, local database, agent action, or
app-specific adapter.

## Try the overlay without permissions

```bash
cd experimentation/highlight_and_react
swift run highlight-and-react --demo
```

Use `--demo-seconds 10` to make the demo exit automatically.

## Test the keyboard shortcut in the built-in fixture

```bash
cd experimentation/highlight_and_react
./scripts/build_app.sh
build/HighlightAndReact.app/Contents/MacOS/highlight-and-react \
  --fixture --debug-candidates
```

In the fixture window:

1. Select `Select this sentence, then press Control–Option–R.`
2. Press `Control–Option–R` (`⌃⌥R`).
3. The selection should get a yellow outline and the emoji bar should appear.

This is the same selection and shortcut path used in Codex.

## Build a stable app bundle

```bash
cd experimentation/highlight_and_react
./scripts/build_app.sh
open build/HighlightAndReact.app
```

The app needs Accessibility access to resolve UI elements and Input Monitoring
access to observe double-clicks outside itself:

- System Settings > Privacy & Security > Accessibility
- System Settings > Privacy & Security > Input Monitoring

The prototype never requests these permissions on a normal launch. Run the
binary with `--request-permission` only when you intentionally want the
Accessibility prompt:

```bash
build/HighlightAndReact.app/Contents/MacOS/highlight-and-react \
  --request-permission
```

After permission is granted, select text in Codex and press `⌃⌥R`. Double-click
remains available as the earlier pointer-based experiment. The shortcut itself
is consumed so it cannot replace the selection; every other keyboard and mouse
event passes through unchanged.

For the first live Codex run, add `--debug-candidates`. It prints the role,
bounds, text preview, and score for each Accessibility ancestor under the
double-click. That makes tuning Codex message selection empirical:

```bash
build/HighlightAndReact.app/Contents/MacOS/highlight-and-react \
  --debug-candidates
```

## Why this can be app-independent

The overlay uses three OS-level contracts rather than Codex internals:

- `CGEventTap` identifies `⌃⌥R` or a double-click.
- `AXSelectedText` plus parameterized bounds resolves the selected text;
  Electron/WebKit text-marker attributes are supported as a fallback.
- `AXUIElementCopyElementAtPosition` supports the earlier double-click flow.
- `NSPanel` draws above other applications without taking keyboard focus.

The app-independent portion is the event monitor, target resolver, coordinate
conversion, overlay placement, and reaction event. App adapters only need to
improve target selection or decide what a reaction means.

## Codex-specific uncertainty to test

Codex is Electron-based, and the useful Accessibility ancestor may be a text
node, a message-sized group, or a much larger conversation container depending
on how its accessibility tree is authored. The current resolver scores the
first nine ancestors and prefers text-bearing, message-sized elements. The next
useful experiment is to log that candidate chain on an authorized machine and
tune the scoring without introducing any Codex process injection.

## Safety and current limitations

- No process injection, private Codex API, screen scraping, or target-app restart.
- The app only resolves content after the explicit shortcut or double-click.
- Reactions are local JSON events; they do not alter Codex messages.
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
```

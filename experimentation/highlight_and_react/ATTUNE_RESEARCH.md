# Attune research notes

The renderer experiment was derived from these repositories at the following
commits:

- `Panchangam18/attune` at `3599a0126f407d4fff049baf26f7e61ffd17ec29`
- `Panchangam18/attune-app` at `5745455357e3ac47e2692d51d97c962fc3da1d8d`

They were cloned under `/tmp/attune-research.LqNKRb` for this investigation.

## What Attune actually does

`attune/src/session.ts`:

1. launches Electron or compatible CEF apps with a loopback-only
   `--remote-debugging-port`;
2. discovers page renderers through `http://127.0.0.1:<port>/json/list`;
3. opens each page's DevTools WebSocket;
4. uses `Runtime.evaluate` to install one `<style>` and evaluate JavaScript
   stored inside `/* @attune-script ... */` CSS comments;
5. watches the source every 500 ms and cleans up an older script before
   evaluating a changed version.

This leaves the signed application bundle untouched. It only works for
Chromium-rendered applications; it cannot edit CSS in a native AppKit app.

`attune-app/electron/main.ts` provides the Codex-specific evidence used here:

- `[data-user-message-bubble]` is the known Codex user-message selector.
- `#attune-codex-git-modal` demonstrates a full-viewport, maximum-z-index
  injected overlay.
- the Git modal and Linear issue modal close when a background click has
  `event.target === modal`.
- the Linear overlay registers an Escape listener and removes its injected
  nodes during cleanup.

## Double-click finding

Neither repository's current tree nor any fetched branch contains `dblclick`,
`MouseEvent.detail === 2`, `getSelection()`, `selectionchange`, or range-bound
overlay code. The repositories provide the injection and overlay mechanism, but
not the Messages-style interaction itself.

The implementation in `renderer/highlight_and_react.css` therefore adds that
missing behavior:

- delegated `dblclick` on Codex message components;
- known Codex message attributes plus a content-block fallback for assistant
  paragraphs, code blocks, quotes, and list items;
- `Selection` and `Range.getClientRects()` for exact highlighted-text bounds;
- the CSS Custom Highlight API, so React-owned message text is not wrapped or
  rewritten;
- a fixed reaction toolbar placed from the live range rectangles;
- click-away and Escape dismissal;
- the existing `Control-Option-R` selection shortcut;
- a `data-highlight-and-react-reaction` attribute and visible reaction badge on
  the message component.

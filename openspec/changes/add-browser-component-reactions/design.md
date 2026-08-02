## Context

The current production component-reaction path is split cleanly between:

- a self-contained renderer controller injected over CDP;
- `ComponentReactionService`, which owns the global capture session, emoji
  recents, screenshot files, marked clipboard bundles, and reaction routing;
- the native companion/input bridge; and
- the existing Python/Rust runtime, which remains the only Codex mutation
  owner.

That path assumes the host can both inject JavaScript and capture a cropped PNG
through an attached Electron renderer. The browser experiments established
three important boundaries:

1. Chromium CDP works reliably only with a separate managed browser profile;
   current Chrome intentionally refuses remote debugging for its ordinary
   default profile.
2. SafariDriver can inspect and inject an isolated automation window, but
   Safari blocks the user's physical selection click in that window.
3. The production renderer controller itself works in both Chromium and
   WebKit. The missing production capability is a permitted delivery and
   screenshot transport for ordinary tabs.

A WebExtension content script is the browser-supported mechanism for ordinary
tab DOM access. Chrome and Safari implement the same core extension APIs for
content scripts, runtime messaging, visible-tab capture, and storage. Safari
requires a signed Safari Web Extension bundle plus a one-time user enable/site
access grant. Chrome likewise does not allow a desktop app to silently install
an unpacked extension into an ordinary signed-in profile.

The feature remains macOS-first. The startup-heartbeat invariant is unaffected:
the browser host is Electron-owned, never runs on the Python emotion event
loop, and does not change camera, provider, model, or freshness startup order.

## Goals / Non-Goals

**Goals:**

- Make ordinary Chrome and Safari webpage content selectable through the same
  `Control-Option-R`, emoji, clipboard, and Codex behavior as attached Electron
  renderers.
- Keep one global component-capture session and one global emoji-recents list
  across every transport.
- Share the production renderer controller rather than maintaining browser
  forks.
- Use a small typed host boundary so screenshot capture and visual settlement
  are transport details, not branches in the reaction policy.
- Keep installed browser controllers dormant when Vibecheck is disabled,
  paused, unavailable, or quit.
- Package production browser assets and a Safari Web Extension without any
  dependency on experimental files.
- Surface setup and transport failures honestly without treating “no browser
  extension installed” as a failure of working Electron reactions.

**Non-Goals:**

- Selecting browser chrome such as the address field, tabs, menus, bookmarks,
  extension buttons, or Safari toolbar controls.
- Silently installing an extension or changing a user's Chrome/Safari profile,
  developer setting, site-access policy, or enterprise policy.
- SafariDriver/WebDriver as a production interaction transport.
- Restarting a user's normal Chrome or Safari process to inject a debugging
  endpoint.
- Restricted browser-internal pages, extension-store pages, PDF viewers,
  closed shadow roots, or content into which the browser refuses extension
  injection.
- Firefox support in this change.
- A durable reaction queue, history UI, browser-specific recents, or different
  clipboard semantics.

## Decisions

### 1. Use one transport-neutral reaction context

`ComponentReactionService` will consume a normalized renderer context:

```text
RendererReactionContext
  source: { name, bundle_id, document/session identity }
  event: validated RendererCommit
  capture(): Promise<PNG>
  settle(outcome): Promise<void>
```

The CDP adapter will wrap its existing `Page.captureScreenshot` and controller
settlement in this interface. The browser adapter will wrap a validated
visible-tab screenshot and a response to the originating extension document.
The reaction service will no longer know which transport produced an event.

Toggle events are normalized separately and always enter the existing
serialized commit queue. This preserves ordering between starting/ending a
global capture session and commits arriving from any app.

Alternative considered: add browser branches directly to `handleCommit`.
That would couple copy/routing policy to screenshot transports and make later
adapters harder to test. It is rejected.

### 2. Extract, do not duplicate, the renderer controller

The self-contained renderer bootstrap becomes a production export with two
entry forms:

- CDP stringifies and evaluates it after installing the host binding.
- The extension content entry calls it directly after installing an extension
  host callback.

The controller remains idempotent and owns only document interaction/UI. It
does not detect browsers, open sockets, capture screenshots, update recents, or
route Codex events. Paper-specific private hit testing remains available only
where the host renderer exposes Paper; ordinary browser pages use standard DOM
selection.

Alternative considered: copy `renderer-source.ts` into extension JavaScript.
It would create two behavior contracts and guaranteed drift. It is rejected.

### 3. Use a background extension transport and thin content entries

The browser content entry:

- installs the shared controller in every permitted frame;
- forwards controller events to the extension background;
- applies `setEnabled`, `setCaptureSession`, `settle`, and `dispose` commands;
- reports a fresh document ID on every navigation.

The background:

- owns the single loopback WebSocket per browser profile;
- derives the tab, window, frame, and browser identity from trusted extension
  sender metadata rather than accepting them from page JavaScript;
- broadcasts authoritative enabled/session/recents state to content entries;
- captures the visible tab only after the controller has hidden its UI;
- attaches the PNG to the corresponding validated commit;
- routes settlement only to the matching tab, frame, and document.

All-frame content scripts give same-origin and cross-origin frames their own
isolated controllers where the browser grants extension access. A commit is
capturable only when its tab is active and its frame bounds resolve into the
captured visible viewport.

Alternative considered: one WebSocket per frame. It exposes untrusted page
identity to the host, scales poorly with tabs, and complicates settlement.
It is rejected.

### 4. Bind a bounded browser host to loopback only

Electron starts one `BrowserReactionHost` with component ownership and keeps it
listening for the Vibecheck lifetime. The host binds only to
`127.0.0.1` on a fixed product port so packaged extensions can find it without
editing browser profile files. The single-instance application lock prevents
two Vibecheck owners. A port collision degrades browser attachment only.

The WebSocket upgrade requires:

- an allowed extension-origin scheme;
- the exact protocol version;
- a bundled-client authentication challenge/response;
- a declared browser family and extension version;
- bounded JSON frames and exact-key validation.

The challenge prevents webpages and accidental local clients from submitting
events. It is defense in depth, not a privilege boundary against another
process already running as the same macOS user. Every commit is still
schema-validated, text- and image-bounded, associated with a live connection,
deduplicated by connection/document/event identity, and accepted only while
the feature is effective.

The server never accepts commands, paths, JavaScript, HTML, selectors, or
arbitrary screenshot destinations from the extension.

Alternative considered: an unauthenticated localhost HTTP endpoint. Browser
pages could reach it through fetch/WebSocket and manufacture explicit Codex
events. It is rejected.

Alternative considered: a separate browser-host daemon. It would violate
Vibecheck lifetime ownership and add another recovery/signing identity. It is
rejected.

### 5. Capture in the browser and crop in Electron

On emoji commit, the controller hides all Vibecheck interaction UI and yields
two animation frames. The extension background then uses
`tabs.captureVisibleTab` for the active tab and sends one PNG data URL with the
commit. Electron:

1. validates the data URL and encoded/decoded size;
2. decodes it with `nativeImage`;
3. reconciles image pixels with the reported viewport/device scale;
4. clips the padded component rectangle to the visible image;
5. crops and re-encodes a PNG;
6. hands that PNG to the existing reaction coordinator.

This keeps browser permission use in the extension and filesystem ownership in
Electron. Full-tab PNG bytes are never written to disk. The existing
component-sized runtime PNG remains owner-only and follows current cleanup
rules.

Alternative considered: element screenshot APIs through WebDriver/CDP. Those
APIs do not cover normal Safari tabs and would reintroduce browser automation.
It is rejected.

### 6. Preserve one authoritative global state

`ComponentReactionService` pushes the same effective enabled state, capture
session ID, and up to five Vibecheck emoji recents to CDP and browser
transports. A shortcut toggle from either transport updates both. A feature
pause, disable, or shutdown clears both.

Browser commits obey the existing rules unchanged:

- selected-text reactions are one-shot and replace the bundle;
- the first commit in a global session replaces the bundle;
- later commits in that session append;
- ending and later restarting the global session starts a fresh bundle;
- ordinary copy replacement clears the marked bundle through native
  pasteboard semantics;
- zero or multiple active Codex turns copy only;
- exactly one active turn receives the explicit reaction.

No browser process is restarted for enable/disable. The installed extension
stays present, reconnects with bounded exponential backoff, and remains dormant
until Electron supplies an effective state.

### 7. Treat browser availability as additive health

Runtime state adds browser transport detail:

```text
browser_transport: off | listening | connected | degraded
attached_browser_tabs: number
browser_last_error: string | null
```

The existing `attached_targets` continues to describe owned desktop
applications. Menu status may summarize the combined attachment count, but the
component reaction checkbox remains one top-level item with its state on that
same row.

No connected extension is a normal `listening` state, not degraded. A bind
failure, invalid packaged asset, repeated protocol failure, or connected
extension capture failure is degraded. A browser failure does not disable
healthy Electron targets; total feature health becomes degraded only when a
real browser transport error exists.

### 8. Package Chrome and Safari from production-owned artifacts

Vite builds:

- `content.js`, importing the shared production controller;
- `background.js`, containing the browser transport/capture adapter; and
- a static Manifest V3 manifest and owned icons.

The Chrome-compatible directory is shipped as a resource and is suitable for a
managed test profile, unpacked development installation, and later store
packaging.

On macOS, the component build script invokes Apple's Safari Web Extension
packager against the built production directory, builds the generated extension
target, and copies the `.appex` into a production staging directory. Electron
packaging embeds it in `Contents/PlugIns` before signing. The Safari extension
has its own least-privilege entitlements and is signed/notarized as nested code.

The menu exposes setup actions only when useful:

- open Chrome extension setup/documentation for the shipped build;
- ask Safari to show the extension preferences through a fixed native
  companion operation.

Neither action changes browser settings or grants site access.

Development without a signed Safari extension still builds and tests shared
assets; Safari activation is verified in the local-signed and release
acceptance lanes.

### 9. Keep shutdown and recovery bounded

On Vibecheck shutdown, Electron first broadcasts `dispose`, closes extension
connections and the loopback listener, then drains the existing commit queue
before stopping native/runtime owners. Browser background scripts reconnect
later but receive no host and therefore keep content entries dormant.

Unexpected extension disconnect removes its tab count and makes any pending
settlements obsolete. It does not cancel a reaction whose PNG and commit were
already accepted by Electron. Browser reconnection receives a full
authoritative state snapshot.

## Risks / Trade-offs

- **[Safari requires a visible user grant]** → Package a standard signed Safari
  Web Extension, expose setup status, and never claim readiness before a
  permitted content entry connects.
- **[Chrome cannot be silently installed in a normal profile]** → Ship the
  standards-compatible bundle, provide an explicit setup path, and use a
  managed isolated profile only in automated acceptance tests.
- **[Visible-tab capture can race tab focus or navigation]** → Bind commits to
  tab/frame/document identity, require the committing tab to remain active,
  validate dimensions, and settle with `copy_failed` on mismatch.
- **[Restricted pages reject content scripts or screenshots]** → Treat those
  pages as unsupported and never fall back to remote-debugging a normal
  profile.
- **[Fixed loopback port collision]** → Fail only the browser transport with a
  clear diagnostic; preserve Electron reactions and retry binding during
  recovery.
- **[Manifest/API differences between Chrome and Safari]** → Keep a narrow
  compatibility wrapper, build both artifacts from the same entries, and run a
  Chromium integration suite plus signed Safari acceptance.
- **[Large full-tab PNG frames]** → Enforce encoded and decoded byte limits
  before allocation/writes, crop immediately, and close abusive connections.
- **[Extension-origin authentication is not a same-user OS sandbox]** → Treat
  it as protection from webpages and accidental clients; keep all local inputs
  validated and retain the existing macOS-user trust boundary.

## Migration Plan

1. Introduce the normalized renderer context and keep all existing CDP tests
   passing.
2. Extract the renderer bootstrap and add extension bundle unit tests.
3. Add the loopback host behind the existing component-reaction service;
   absence of an extension remains a no-op.
4. Add Chrome managed-profile integration tests for selection, screenshot,
   navigation, frames, session stacking, and settlement.
5. Build/embed the Safari Web Extension and verify it under local signing.
6. Add menu setup/status projection and package guards.
7. Run component, Electron, native, Python topology/heartbeat, packaging, and
   production-independence regressions.

Rollback removes the browser host and embedded extension assets. The normalized
CDP context can remain because it is behavior-preserving. Existing preferences
and clipboard bundle formats require no migration.

## Open Questions

None for implementation. Browser-store publication identifiers and public
listing copy are release-distribution work, not runtime architecture.

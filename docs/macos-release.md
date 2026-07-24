# macOS preview release

Vibecheck’s first public preview is an arm64-only, direct-download menu-bar app.
Its bundle identifier is `com.rithvikprakki.vibecheck` and its Apple Developer
Team ID is `YU57297F36`. The account email, certificates, API keys, and passwords
must never be committed.

## Release prerequisites

The `macos-release` GitHub environment must require a reviewer and contain:

- `DEVELOPER_ID_APPLICATION_P12`
- `DEVELOPER_ID_APPLICATION_PASSWORD`
- `DEVELOPER_ID_APPLICATION_IDENTITY`
- `RELEASE_KEYCHAIN_PASSWORD`
- `APPLE_API_KEY_P8_BASE64`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Create a Developer ID Application certificate for Team `YU57297F36`, export it
with its private key as a password-protected PKCS#12 file, and store only its
base64 representation in the protected environment. Create a scoped App Store
Connect team API key for notarization and store it there as well. Pull requests
and forks must never receive this environment.

The current `codex-control` release uses `osascript` for the managed ChatGPT quit
path, so the app declares Apple Events usage and the automation entitlement.
This release does not request Accessibility access.

## Local unsigned build

Install Node 24, Python 3.11, Rust 1.91 or later, `uv`, and Xcode command-line
tools. Ensure the selected ONNX model exists at
`~/.emotiefflib/enet_b0_8_best_afew.onnx`, then run:

```bash
npm ci
scripts/build_runtime.sh
npm run app:package
```

The frozen runtime is built from a clean environment, contains the single
selected model and the release Rust sidecar, and is placed below the Electron
app’s `Contents/Resources`. Packaged code has no development-interpreter or
repository fallback.

## Release flow

Dispatch the `Release macOS preview` workflow with a version that exactly
matches both package manifests. The workflow creates an ephemeral keychain,
builds inside-out, applies Hardened Runtime signing, notarizes the app and DMG,
staples tickets, verifies Gatekeeper and every Mach-O signature/architecture,
then generates checksums. Its only user artifacts are an arm64 DMG and matching
update-ready ZIP; automatic updates are not implemented.

The final manual gate is installation from the downloaded DMG on a clean
supported Mac account. Verify one Vibecheck-owned camera prompt, denial and
later recovery, permission persistence across a same-identity update, all
feature transitions, pause/resume, graceful interruption drain, and that
quitting Vibecheck leaves Codex/ChatGPT running.

## User installation and privacy

Open the DMG, drag Vibecheck to Applications, and launch it. macOS verifies the
Developer ID and notarization ticket. Vibecheck asks for camera access only when
the user first enables a feature that requires expression inference. Frames and
expression results stay on device; the native menu displays neither.

If camera access was denied, enable Vibecheck under **System Settings → Privacy
& Security → Camera**, then choose **Try again**. Apple Events permission is
needed only for the current managed Codex integration. Mac App Store
distribution, Intel builds, and automatic updates are intentionally outside
this preview.

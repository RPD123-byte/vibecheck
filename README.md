# Uncover

On-device facial-expression inference, macOS notch presentation, and conservative
Codex interruption. Production code is self-contained under `src/`; research
prototypes and local model/data artifacts are never imported at runtime.

## Development

```bash
python -m pip install -e '.[test,inference,macos]'
pytest
cargo test --manifest-path src/native/expression_interruption/Cargo.toml
```

The default suite uses normalized and synthetic fixtures and does not download or
retain face images. The opt-in model suite downloads checksum-pinned, licensed
Wikimedia Commons images into pytest's temporary directory, runs the real
EmotiEffLib model and both consumer processes, then removes the images:

```bash
UNCOVER_RUN_MODEL_TESTS=1 pytest tests/model
```

The target-Mac visual suite renders the real AppKit view offscreen and compares
active, empty, health, dispatch, and error pixels with the validated experiment:

```bash
UNCOVER_RUN_VISUAL_TESTS=1 pytest tests/visual
```

The live Codex verification creates an isolated fixture task, performs a real
interrupt/restart through `codex-control`, and always archives the fixture. It
does not manage or restart the Codex GUI:

```bash
UNCOVER_RUN_LIVE_CODEX_TESTS=1 pytest tests/live
```

Run the complete synthetic, mutation-free process topology:

```bash
uncover-expression --mode demo --headless-notch --no-manage-codex-gui
```

Normal mode owns one camera/model worker, one AppKit notch worker, and one Rust
interruption worker. Ctrl-C stops only those Uncover workers; ChatGPT and its shared
daemon remain running.

The shared expression threshold defaults to 30% for notch entry and negative-only
interruption eligibility. The notch uses a 25% exit threshold, and interruption
still requires the same eligible negative expression continuously for one second.

## Runtime modes and safety

- `normal` starts camera inference, the AppKit notch, and live Codex interruption.
- `demo` runs the production topology with a synthetic, repeating emotion source
  and dry-run interruption.
- `dry-run` uses the configured camera/model and reports `would_send` without
  mutating a Codex task.
- `display-only` omits the interruption worker.

Every launch creates an owner-only temporary runtime directory and Unix sockets.
Inference events contain scores and face-box coordinates, never frames or crops.
Health is emitted as structured JSON with per-role lifecycle, readiness, stream
freshness, restart count, PID, and latest error. A worker is ready only after its
socket path is operational and, for consumers, a fresh inference event arrived.

`--manage-codex-gui` allows the live interruption worker to restart Codex once at
startup so the control daemon is correctly configured. Runtime shutdown never
asks `codex-control` to quit the GUI; it signals only validated process groups the
runtime itself launched. Use `--no-manage-codex-gui` for development and tests.

If a worker is disconnected, inspect its structured `stream` and `last_error`
fields. Stale sockets owned by dead processes are reclaimed; a live socket is
never unlinked. Native app bundling, camera entitlements, signing, installation,
and auto-launch are deliberately deferred until the core app packaging system is
selected.

During source development the supervisor uses an already-built release/debug
sidecar when present and otherwise invokes Cargo. Packaged builds should pass
`--interruption-binary /absolute/path/to/uncover-expression-interruption` (or set
`UNCOVER_INTERRUPTION_BINARY`) so runtime startup never depends on developer
tooling.

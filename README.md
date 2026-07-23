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

Run the complete synthetic, mutation-free process topology:

```bash
uncover-expression --mode demo --headless-notch --no-manage-codex-gui
```

Normal mode owns one camera/model worker, one AppKit notch worker, and one Rust
interruption worker. Ctrl-C stops only those Uncover workers; ChatGPT and its shared
daemon remain running.

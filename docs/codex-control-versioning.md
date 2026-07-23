# codex-control dependency versioning

`codex-control` is a Cargo package. Uncover consumes release `0.1.0` from the
immutable Git tag `v0.1.0` in `RPD123-byte/CodexWarden`, and also requires the
exact Cargo manifest version `=0.1.0`. `Cargo.lock` records the resolved source
commit (`3e101205e98869fcafdbeaa75548f714e501c343`).

For each compatible release:

1. Update the package version in `codex-control/Cargo.toml` using semantic
   versioning and run its full workspace test suite.
2. Create and push an annotated `v<package-version>` tag at the tested commit.
   Published tags are immutable; corrections require a new patch release.
3. Update both the Git `tag` and exact `version` requirement in Uncover.
4. Regenerate `Cargo.lock`, verify its source commit matches the tag, and run the
   Rust unit, dry-run integration, and opt-in live Codex fixture tests.

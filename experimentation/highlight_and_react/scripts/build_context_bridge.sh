#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
manifest="$project_dir/CodexBridge/Cargo.toml"

cargo build --quiet --manifest-path "$manifest"
print "$project_dir/CodexBridge/target/debug/highlight-context-bridge"

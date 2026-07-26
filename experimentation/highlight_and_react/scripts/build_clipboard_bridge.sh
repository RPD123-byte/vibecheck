#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}

swift build \
  --quiet \
  --package-path "$project_dir" \
  --product highlight-context-clipboard
bin_dir=$(swift build --package-path "$project_dir" --show-bin-path)
print "$bin_dir/highlight-context-clipboard"

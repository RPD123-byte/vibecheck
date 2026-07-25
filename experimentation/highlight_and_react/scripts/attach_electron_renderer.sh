#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
debug_port=${1:-9222}

exec node "$script_dir/devtools_injector.mjs" \
  --port "$debug_port" \
  --source "$script_dir/../renderer/highlight_and_react.css"

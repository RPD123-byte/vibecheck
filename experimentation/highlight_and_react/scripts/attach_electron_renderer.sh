#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
debug_port=${1:-9222}
context_mode=${HIGHLIGHT_CONTEXT_MODE:-codex}
typeset -a context_arguments
context_arguments=(--context-mode "$context_mode")

if [[ "$context_mode" == "codex" ]]; then
  context_bridge=${HIGHLIGHT_CONTEXT_BRIDGE:-}
  if [[ -z "$context_bridge" ]]; then
    context_bridge=$("$script_dir/build_context_bridge.sh")
  fi
  context_arguments+=(--context-bridge "$context_bridge")
fi

exec node "$script_dir/devtools_injector.mjs" \
  --port "$debug_port" \
  --source "$script_dir/../renderer/highlight_and_react.css" \
  "${context_arguments[@]}"

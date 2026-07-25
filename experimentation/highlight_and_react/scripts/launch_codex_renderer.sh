#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
debug_port=9222
if (( $# > 0 )) && [[ "$1" == <-> ]]; then
  debug_port=$1
  shift
fi

exec "$script_dir/launch_electron_renderer.sh" \
  --app /Applications/ChatGPT.app \
  --port "$debug_port" \
  "$@"

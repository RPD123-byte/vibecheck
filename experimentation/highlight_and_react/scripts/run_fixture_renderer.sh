#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
debug_port=${1:-9223}
electron_path=${ELECTRON_PATH:-/Users/computer/uncover/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron}

if [[ ! -x "$electron_path" ]]; then
  print -u2 "Electron not found at: $electron_path"
  print -u2 "Set ELECTRON_PATH to the Electron executable and retry."
  exit 1
fi

"$electron_path" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$debug_port" \
  "$project_dir/Fixtures/Renderer/main.mjs" &
fixture_pid=$!

cleanup() {
  kill "$fixture_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

print "Fixture running. Double-click text or select it and press Control-Option-R."
print "Press Control-C to close the fixture and injector."
node "$script_dir/devtools_injector.mjs" \
  --port "$debug_port" \
  --source "$project_dir/renderer/highlight_and_react.css" \
  --debug

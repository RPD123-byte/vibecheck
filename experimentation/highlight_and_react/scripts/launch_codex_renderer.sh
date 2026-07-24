#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
codex_executable="/Applications/ChatGPT.app/Contents/MacOS/ChatGPT"
debug_port=${1:-9222}

if [[ ! -x "$codex_executable" ]]; then
  print -u2 "Codex executable not found at: $codex_executable"
  exit 1
fi

if ps -axo pid=,args= | awk -v executable="$codex_executable" '
  {
    command = $0
    sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", command)
    if (index(command, executable) == 1) found = 1
  }
  END { exit !found }
'; then
  print -u2 "Codex is already running, so its DevTools port cannot be enabled in place."
  print -u2 "This script will not quit or restart it. Quit Codex yourself when ready, then run this again."
  exit 2
fi

"$codex_executable" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$debug_port" \
  --remote-allow-origins=http://localhost &

print "Started Codex with localhost DevTools on port $debug_port."
print "Watching renderer source; press Control-C to stop injection (Codex will stay open)."
exec "$script_dir/attach_codex_renderer.sh" "$debug_port"

#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
app_dir="$project_dir/build/HighlightAndReact.app"
binary="$app_dir/Contents/MacOS/highlight-and-react"

if [[ ! -x "$binary" ]]; then
  print -u2 "Built app not found at: $app_dir"
  print -u2 "Run ./scripts/build_app.sh once, grant permissions to that stable build, then retry."
  exit 1
fi

if (( $# > 0 )); then
  exec "$binary" "$@"
fi

open "$app_dir"
print "Highlight & React started. The global shortcut is Control-Option-R."

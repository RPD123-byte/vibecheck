#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
debug_port=${1:-9223}

resolve_electron_path() {
  if [[ -n "${ELECTRON_PATH:-}" ]]; then
    print "$ELECTRON_PATH"
    return
  fi

  local worktree_root
  local common_git_dir
  local repository_root
  worktree_root=$(git -C "$project_dir" rev-parse --show-toplevel)
  common_git_dir=$(git -C "$project_dir" rev-parse --path-format=absolute --git-common-dir)
  repository_root=${common_git_dir:h}

  local candidate
  for candidate in \
    "$worktree_root/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
    "$repository_root/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
    "/Applications/Electron.app/Contents/MacOS/Electron"
  do
    if [[ -x "$candidate" ]]; then
      print "$candidate"
      return
    fi
  done

  return 1
}

if ! electron_path=$(resolve_electron_path); then
  print -u2 "Electron was not found in the worktree, main checkout, or /Applications."
  print -u2 "Set ELECTRON_PATH to the Electron executable and retry."
  exit 1
fi

if [[ "${1:-}" == "--print-electron-path" ]]; then
  print "$electron_path"
  exit 0
fi

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

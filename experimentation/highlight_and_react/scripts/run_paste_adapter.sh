#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
context_mode=${HIGHLIGHT_CONTEXT_MODE:-codex}
typeset -a requested_ports
typeset -a adapter_arguments
typeset -a owned_injector_pids

usage() {
  print "Usage: ./scripts/run_paste_adapter.sh [options]"
  print ""
  print "Starts both halves of Highlight & React context delivery:"
  print "  1. renderer context hosts for active DevTools ports"
  print "  2. the native marked Command-V bundled paste adapter"
  print ""
  print "Options:"
  print "  --port PORT           Attach a specific active DevTools port (repeatable)"
  print "  --request-permission  Ask macOS for Accessibility permission"
  print "  --help                Show this help"
}

while (( $# > 0 )); do
  case "$1" in
    --port)
      requested_ports+=("${2:-}")
      shift 2
      ;;
    --request-permission)
      adapter_arguments+=("$1")
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      print -u2 "Unknown option: $1"
      usage >&2
      exit 2
      ;;
  esac
done

if (( ${#requested_ports[@]} == 0 )); then
  while IFS= read -r port; do
    [[ -n "$port" ]] && requested_ports+=("$port")
  done < <(
    ps -axo command= | "$script_dir/discover_devtools_ports.sh"
  )
fi

if (( ${#requested_ports[@]} == 0 )); then
  print -u2 "No running Electron app exposes a DevTools port."
  print -u2 "Launch the source app with launch_electron_renderer.sh, then retry."
  exit 4
fi

for port in "${requested_ports[@]}"; do
  if [[ "$port" != <-> ]] || (( port < 1 || port > 65535 )); then
    print -u2 "Invalid DevTools port: $port"
    exit 2
  fi
  if ! curl -fsS --max-time 1 "http://127.0.0.1:$port/json/list" >/dev/null; then
    print -u2 "No DevTools endpoint responded on 127.0.0.1:$port"
    exit 5
  fi
done

app_dir="$project_dir/build/HighlightAndReact.app"
executable="$app_dir/Contents/MacOS/highlight-and-react"
needs_build=false
if [[ ! -x "$executable" ]]; then
  needs_build=true
elif [[ "$project_dir/Package.swift" -nt "$executable" ]] \
  || [[ "$script_dir/build_app.sh" -nt "$executable" ]] \
  || find "$project_dir/Sources" "$project_dir/Resources" \
    -type f -newer "$executable" -print -quit \
    | grep -q .
then
  needs_build=true
fi

if $needs_build; then
  "$script_dir/build_app.sh" >&2
else
  print "[highlight-paste-adapter] reusing existing signed app build"
fi

injector_is_running() {
  local port=$1
  ps -axo args= | awk \
    -v injector="$script_dir/devtools_injector.mjs" \
    -v port="$port" \
    -v mode="$context_mode" '
      index($0, "node " injector) && index($0, "--port " port) &&
        index($0, "--context-mode " mode) { found = 1 }
      END { exit !found }
    '
}

incompatible_injector_is_running() {
  local port=$1
  ps -axo args= | awk \
    -v injector="$script_dir/devtools_injector.mjs" \
    -v port="$port" '
      index($0, "node " injector) && index($0, "--port " port) { found = 1 }
      END { exit !found }
    '
}

cleanup() {
  trap - EXIT INT TERM
  for pid in "${owned_injector_pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

for port in "${requested_ports[@]}"; do
  if injector_is_running "$port"; then
    print \
      "[highlight-paste-adapter] reusing context host on port $port " \
      "mode=$context_mode"
    continue
  fi
  if incompatible_injector_is_running "$port"; then
    print -u2 \
      "A context host on port $port is already running in a different mode."
    print -u2 \
      "Stop its terminal with Control-C, then rerun this command."
    exit 6
  fi
  HIGHLIGHT_CONTEXT_MODE="$context_mode" \
    "$script_dir/attach_electron_renderer.sh" "$port" &
  owned_injector_pids+=($!)
  print \
    "[highlight-paste-adapter] started context host on port $port " \
    "mode=$context_mode"
done

print "[highlight-paste-adapter] starting marked Command-V listener"
"$executable" --paste-adapter "${adapter_arguments[@]}"

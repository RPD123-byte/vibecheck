#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
app_path=''
debug_port=9222
print_executable=false

usage() {
  print "Usage: ./scripts/launch_electron_renderer.sh --app /path/to/App.app [options]"
  print ""
  print "Options:"
  print "  --port PORT          Local Chromium DevTools port (default: 9222)"
  print "  --print-executable   Resolve and print the app executable without launching"
  print "  --help               Show this help"
}

while (( $# > 0 )); do
  case "$1" in
    --app)
      app_path=${2:-}
      shift 2
      ;;
    --port)
      debug_port=${2:-}
      shift 2
      ;;
    --print-executable)
      print_executable=true
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

if [[ -z "$app_path" || ! -d "$app_path" ]]; then
  print -u2 "Electron app bundle not found: ${app_path:-<missing --app>}"
  exit 1
fi

frameworks_dir="$app_path/Contents/Frameworks"
chromium_runtime=$(
  find "$frameworks_dir" -path '*/Resources/icudtl.dat' -print -quit 2>/dev/null \
    || true
)
if [[ -z "$chromium_runtime" ]]; then
  print -u2 "$app_path does not expose an Electron or CEF renderer."
  print -u2 "Highlight & React uses one DOM/CSS renderer path; native AppKit apps are unsupported."
  exit 3
fi

executable_name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' \
  "$app_path/Contents/Info.plist" 2>/dev/null || true)
executable="$app_path/Contents/MacOS/$executable_name"
if [[ -z "$executable_name" || ! -x "$executable" ]]; then
  print -u2 "Could not resolve an executable from: $app_path"
  exit 1
fi

if $print_executable; then
  print "$executable"
  exit 0
fi

if [[ "$debug_port" != <-> ]] \
  || (( debug_port < 1 || debug_port > 65535 )); then
  print -u2 "--port must be an integer between 1 and 65535"
  exit 2
fi

if curl -fsS --max-time 1 "http://127.0.0.1:$debug_port/json/list" >/dev/null 2>&1; then
  print -u2 "DevTools port $debug_port is already in use."
  print -u2 "Choose a different --port so the injector cannot attach to the wrong app."
  exit 5
fi

if ps -axo pid=,args= | awk -v executable="$executable" '
  {
    command = $0
    sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", command)
    if (index(command, executable) == 1) found = 1
  }
  END { exit !found }
'; then
  print -u2 "$app_path is already running, so its DevTools port cannot be enabled in place."
  print -u2 "This script will not quit or restart it. Quit that app yourself, then retry."
  exit 4
fi

"$executable" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$debug_port" \
  --remote-allow-origins=http://localhost &

print "Started $app_path with localhost DevTools on port $debug_port."
print "Watching the shared Highlight & React renderer; Control-C stops injection only."
exec "$script_dir/attach_electron_renderer.sh" "$debug_port"

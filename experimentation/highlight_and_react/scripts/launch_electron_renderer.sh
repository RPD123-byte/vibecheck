#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
app_path=''
debug_port=9222
print_executable=false
restart_app=false

usage() {
  print "Usage: ./scripts/launch_electron_renderer.sh --app /path/to/App.app [options]"
  print ""
  print "Options:"
  print "  --port PORT          Local Chromium DevTools port (default: 9222)"
  print "  --restart            Gracefully quit a running app before relaunching it"
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
    --restart)
      restart_app=true
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
bundle_identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \
  "$app_path/Contents/Info.plist" 2>/dev/null || true)
executable="$app_path/Contents/MacOS/$executable_name"
if [[ -z "$executable_name" || ! -x "$executable" ]]; then
  print -u2 "Could not resolve an executable from: $app_path"
  exit 1
fi

case "$bundle_identifier" in
  com.google.Chrome*|com.brave.Browser*|com.microsoft.edgemac*|\
  com.operasoftware.Opera*|com.vivaldi.Vivaldi*|org.chromium.Chromium*|\
  company.thebrowser.*)
    print -u2 "$app_path is a standalone browser, not an Electron application."
    print -u2 "Its normal profile cannot be enabled for remote debugging safely; use a browser extension for websites."
    exit 7
    ;;
esac

if $print_executable; then
  print "$executable"
  exit 0
fi

if [[ "$debug_port" != <-> ]] \
  || (( debug_port < 1 || debug_port > 65535 )); then
  print -u2 "--port must be an integer between 1 and 65535"
  exit 2
fi

if /usr/sbin/lsof -nP -iTCP:"$debug_port" -sTCP:LISTEN 2>/dev/null \
  | /usr/bin/grep -q .; then
  print -u2 "DevTools port $debug_port is already in use."
  print -u2 "Choose a different --port so the injector cannot attach to the wrong app."
  exit 5
fi

is_app_running() {
  ps -axo pid=,args= | awk -v executable="$executable" '
    {
      command = $0
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", command)
      if (index(command, executable) == 1) found = 1
    }
    END { exit !found }
  '
}

if is_app_running; then
  if ! $restart_app; then
    print -u2 "$app_path is already running, so its DevTools port cannot be enabled in place."
    print -u2 "Quit it yourself, or rerun this command with --restart for a graceful relaunch."
    exit 4
  fi
  if [[ -z "$bundle_identifier" || "$bundle_identifier" == *[^A-Za-z0-9.-]* ]]; then
    print -u2 "Could not safely resolve the bundle identifier needed for --restart."
    exit 6
  fi

  print "Gracefully asking $app_path to quit..."
  /usr/bin/osascript \
    -e "tell application id \"$bundle_identifier\" to quit"
  for _ in {1..150}; do
    if ! is_app_running; then
      break
    fi
    sleep 0.1
  done
  if is_app_running; then
    print -u2 "$app_path did not quit within 15 seconds; it was not force-killed."
    exit 6
  fi
fi

"$executable" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$debug_port" \
  --remote-allow-origins=http://localhost &

print "Started $app_path with localhost DevTools on port $debug_port."
print "Watching the shared Highlight & React renderer; Control-C stops injection only."
exec "$script_dir/attach_electron_renderer.sh" "$debug_port"

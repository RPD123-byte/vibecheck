#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
base_port=9222
restart_apps=false

usage() {
  print "Usage: ./scripts/launch_all_electron_renderers.sh [options]"
  print ""
  print "Discovers every currently running Electron/CEF app, assigns one"
  print "localhost DevTools port per app, and injects the shared renderer."
  print ""
  print "Options:"
  print "  --restart          Gracefully quit and relaunch every discovered app"
  print "  --base-port PORT   Start assigning ports here (default: 9222)"
  print "  --help             Show this help"
  print ""
  print "Without --restart this command is a read-only preview."
}

while (( $# > 0 )); do
  case "$1" in
    --restart)
      restart_apps=true
      shift
      ;;
    --base-port)
      base_port=${2:-}
      shift 2
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

if [[ "$base_port" != <-> ]] \
  || (( base_port < 1 || base_port > 65535 )); then
  print -u2 "--base-port must be an integer between 1 and 65535"
  exit 2
fi

port_is_listening() {
  /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null \
    | /usr/bin/grep -q .
}

typeset -a app_paths
typeset -a skipped_browsers
while IFS= read -r candidate; do
  [[ -d "$candidate/Contents/Frameworks" ]] || continue
  chromium_runtime=$(
    find "$candidate/Contents/Frameworks" \
      -path '*/Resources/icudtl.dat' -print -quit 2>/dev/null \
      || true
  )
  [[ -n "$chromium_runtime" ]] || continue
  bundle_identifier=$(
    /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \
      "$candidate/Contents/Info.plist" 2>/dev/null || true
  )
  case "$bundle_identifier" in
    com.google.Chrome*|com.brave.Browser*|com.microsoft.edgemac*|\
    com.operasoftware.Opera*|com.vivaldi.Vivaldi*|org.chromium.Chromium*|\
    company.thebrowser.*)
      skipped_browsers+=("$candidate")
      continue
      ;;
  esac
  app_paths+=("$candidate")
done < <(
  ps -axo command= \
    | perl -ne 'if (m{^(/.*?\.app)/Contents/}) { print "$1\n" }' \
    | sort -u
)

if (( ${#app_paths[@]} == 0 )); then
  print "No running Electron or CEF applications were found."
  exit 0
fi

typeset -a app_ports
next_port=$base_port
for _ in "${app_paths[@]}"; do
  if (( next_port > 65535 )); then
    print -u2 "No free TCP port remains at or above $base_port."
    exit 5
  fi
  while port_is_listening "$next_port"; do
    (( next_port += 1 ))
    if (( next_port > 65535 )); then
      print -u2 "No free TCP port remains at or above $base_port."
      exit 5
    fi
  done
  app_ports+=("$next_port")
  (( next_port += 1 ))
done

print "Running Electron/CEF apps:"
for index in {1..${#app_paths[@]}}; do
  print "  ${app_paths[$index]} -> 127.0.0.1:${app_ports[$index]}"
done
if (( ${#skipped_browsers[@]} > 0 )); then
  print ""
  print "Skipped standalone browsers (websites need an extension instead):"
  for browser in "${skipped_browsers[@]}"; do
    print "  $browser"
  done
fi

if ! $restart_apps; then
  print ""
  print "Preview only; no application was changed."
  print "Rerun with --restart to gracefully relaunch these supported running apps."
  exit 0
fi

print ""
print "Gracefully relaunching ${#app_paths[@]} apps and starting renderer injection..."

typeset -a launcher_pids
stop_injectors() {
  trap - INT TERM
  for pid in "${launcher_pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  print ""
  print "Stopped Highlight & React injection. Relaunched apps were left open."
}
trap 'stop_injectors; exit 130' INT TERM

for index in {1..${#app_paths[@]}}; do
  "$script_dir/launch_electron_renderer.sh" \
    --app "${app_paths[$index]}" \
    --port "${app_ports[$index]}" \
    --restart &
  launcher_pids+=($!)
done

print "All launchers started. Keep this terminal open; Control-C stops injection only."

exit_status=0
for pid in "${launcher_pids[@]}"; do
  if ! wait "$pid"; then
    exit_status=1
  fi
done
exit "$exit_status"

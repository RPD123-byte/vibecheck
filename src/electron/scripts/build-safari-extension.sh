#!/usr/bin/env bash
set -euo pipefail

electron_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "${electron_root}/../.." && pwd)"
web_extension="${repo_root}/dist/component-reactions/browser-extension"
staging_root="${repo_root}/dist/component-reactions/safari"
extension_name="Vibecheck Browser Reactions Extension"
output="${staging_root}/${extension_name}.appex"
temporary="$(mktemp -d /tmp/vibecheck-safari-extension.XXXXXX)"

cleanup() {
  rm -rf -- "${temporary}"
}
trap cleanup EXIT

test -f "${web_extension}/manifest.json"
test -f "${web_extension}/content.js"
test -f "${web_extension}/background.js"

xcrun safari-web-extension-converter \
  "${web_extension}" \
  --project-location "${temporary}" \
  --app-name "Vibecheck Browser Reactions" \
  --bundle-identifier "com.rithvikprakki.vibecheck.browser" \
  --swift \
  --macos-only \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

project="${temporary}/Vibecheck Browser Reactions/Vibecheck Browser Reactions.xcodeproj"
products="${temporary}/Products"
objects="${temporary}/Objects"
xcodebuild \
  -quiet \
  -project "${project}" \
  -target "${extension_name}" \
  -configuration Release \
  "SYMROOT=${products}" \
  "OBJROOT=${objects}" \
  CODE_SIGNING_ALLOWED=NO \
  build

rm -rf -- "${staging_root}"
mkdir -p "${staging_root}"
cp -R \
  "${products}/Release/${extension_name}.appex" \
  "${output}"

test "$(
  /usr/libexec/PlistBuddy \
    -c 'Print :CFBundleIdentifier' \
    "${output}/Contents/Info.plist"
)" = "com.rithvikprakki.vibecheck.browser.Extension"
test -x "${output}/Contents/MacOS/${extension_name}"

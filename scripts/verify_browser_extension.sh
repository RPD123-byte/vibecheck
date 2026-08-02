#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
browser="${repo_root}/dist/component-reactions/browser-extension"
safari="${repo_root}/dist/component-reactions/safari/Vibecheck Browser Reactions Extension.appex"

for required in \
  "${browser}/manifest.json" \
  "${browser}/content.js" \
  "${browser}/content.css" \
  "${browser}/background.js" \
  "${safari}/Contents/Info.plist" \
  "${safari}/Contents/MacOS/Vibecheck Browser Reactions Extension";
do
  test -f "${required}"
done

node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const packageManifest = JSON.parse(
    fs.readFileSync(process.argv[2], "utf8")
  );
  if (manifest.manifest_version !== 3) throw new Error("Manifest V3 is required");
  if (manifest.version !== packageManifest.version) {
    throw new Error("Browser extension version does not match the app");
  }
  if (!manifest.host_permissions?.includes("<all_urls>")) {
    throw new Error("Visible-tab capture permission is missing");
  }
  const scripts = manifest.content_scripts?.[0];
  if (!scripts?.all_frames || !scripts.js?.includes("content.js") ||
      !scripts.css?.includes("content.css")) {
    throw new Error("Content entry contract is incomplete");
  }
  if (manifest.background?.service_worker !== "background.js") {
    throw new Error("Background entry contract is incomplete");
  }
' "${browser}/manifest.json" \
  "${repo_root}/src/electron/package.json"

test "$(
  /usr/libexec/PlistBuddy \
    -c 'Print :CFBundleIdentifier' \
    "${safari}/Contents/Info.plist"
)" = "com.rithvikprakki.vibecheck.browser.Extension"

file "${safari}/Contents/MacOS/Vibecheck Browser Reactions Extension"
lipo -info "${safari}/Contents/MacOS/Vibecheck Browser Reactions Extension" |
  rg -q 'arm64'

if find "${browser}" "${safari}" -type f -name '*.map' -print -quit | rg -q .; then
  echo "Browser extension contains source maps." >&2
  exit 1
fi

if rg -a -l \
  'experi'"mentation/"'|/Users/'"computer/"'|sourceMappingURL' \
  "${browser}" "${safari}";
then
  echo "Browser extension contains a prohibited development dependency." >&2
  exit 1
fi

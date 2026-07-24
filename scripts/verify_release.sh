#!/usr/bin/env bash
set -euo pipefail

output="${1:-out}"
app_path="$(find "${output}" -name 'Vibecheck.app' -type d -print -quit)"
dmg_path="$(find "${output}" -name '*.dmg' -type f -print -quit)"
zip_path="$(find "${output}" -name '*.zip' -type f -print -quit)"

test -n "${app_path}"
test -n "${dmg_path}"
test -n "${zip_path}"

codesign --verify --deep --strict --verbose=2 "${app_path}"
spctl --assess --type execute --verbose=4 "${app_path}"
xcrun stapler validate "${app_path}"
xcrun stapler validate "${dmg_path}"
hdiutil verify "${dmg_path}"

find "${app_path}" -type f -print0 |
  while IFS= read -r -d '' file_path; do
    if file "${file_path}" | rg -q 'Mach-O'; then
      file "${file_path}"
      lipo -info "${file_path}"
      codesign --verify --strict --verbose=2 "${file_path}"
      codesign -dv --verbose=4 "${file_path}" 2>&1 |
        rg 'Identifier=|TeamIdentifier=|Authority=|Runtime Version'
      if [[ "${file_path}" == *"/Resources/vibecheck-runtime/"* ]] &&
        codesign -d --entitlements :- "${file_path}" 2>/dev/null |
          rg -q 'allow-jit|automation.apple-events|get-task-allow|allow-unsigned-executable-memory|disable-library-validation';
      then
        echo "Native runtime has an Electron-only entitlement: ${file_path}" >&2
        exit 1
      fi
      if ! lipo -info "${file_path}" | rg -q 'arm64'; then
        echo "Non-arm64 Mach-O in release: ${file_path}" >&2
        exit 1
      fi
    fi
  done

if codesign -d --entitlements :- "${app_path}" 2>/dev/null |
  rg -q 'get-task-allow|allow-unsigned-executable-memory|disable-library-validation';
then
  echo "Forbidden broad entitlement found in release." >&2
  exit 1
fi

#!/usr/bin/env bash
set -euo pipefail

dmg_path="${1:?usage: verify_dmg_icon.sh DMG EXPECTED_ICNS}"
expected_icon="${2:?usage: verify_dmg_icon.sh DMG EXPECTED_ICNS}"
mount_path="$(mktemp -d "${TMPDIR:-/tmp}/vibecheck-dmg-icon.XXXXXX")"
attached=0

cleanup() {
  if [[ "${attached}" == "1" ]]; then
    hdiutil detach "${mount_path}" -quiet || true
  fi
  rmdir "${mount_path}" 2>/dev/null || true
}
trap cleanup EXIT

hdiutil attach \
  -readonly \
  -nobrowse \
  -mountpoint "${mount_path}" \
  "${dmg_path}" \
  -quiet
attached=1

volume_icon="${mount_path}/.VolumeIcon.icns"
if [[ ! -f "${volume_icon}" ]]; then
  echo "DMG does not contain a volume icon: ${dmg_path}" >&2
  exit 1
fi

if ! cmp -s "${volume_icon}" "${expected_icon}"; then
  echo "DMG volume icon does not match ${expected_icon}" >&2
  exit 1
fi

echo "DMG volume icon matches ${expected_icon}"

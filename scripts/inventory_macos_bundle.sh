#!/usr/bin/env bash
set -euo pipefail

app_path="${1:?usage: inventory_macos_bundle.sh APP_PATH [OUTPUT_TSV]}"
output_path="${2:-macos-binary-inventory.tsv}"

if [[ ! -d "${app_path}" ]]; then
  echo "App bundle not found: ${app_path}" >&2
  exit 1
fi

{
  printf 'path\tfile_type\tarchitectures\tsigning\tidentifier\tteam\n'
  find "${app_path}" -type f -print0 |
    while IFS= read -r -d '' candidate; do
      description="$(file -b "${candidate}")"
      if ! rg -q 'Mach-O' <<<"${description}"; then
        continue
      fi
      architectures="$(lipo -archs "${candidate}" 2>/dev/null || echo unknown)"
      signing_details="$(codesign -dv --verbose=4 "${candidate}" 2>&1 || true)"
      if codesign --verify --strict "${candidate}" >/dev/null 2>&1; then
        if rg -q '^Signature=adhoc$' <<<"${signing_details}"; then
          signing="ad-hoc"
        else
          signing="valid"
        fi
      else
        signing="unsigned-or-invalid"
      fi
      identifier="$(
        sed -n 's/^Identifier=//p' <<<"${signing_details}" | head -n 1
      )"
      team="$(
        sed -n 's/^TeamIdentifier=//p' <<<"${signing_details}" | head -n 1
      )"
      relative="${candidate#"${app_path}"/}"
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
        "${relative}" \
        "${description//$'\t'/ }" \
        "${architectures}" \
        "${signing}" \
        "${identifier:-none}" \
        "${team:-none}"
    done
} >"${output_path}"

echo "Wrote binary inventory to ${output_path}"

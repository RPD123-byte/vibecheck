#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d /tmp/vibecheck-browser-build.XXXXXX)"
isolated="${scratch}/repo"

cleanup() {
  rm -rf -- "${scratch}"
}
trap cleanup EXIT

mkdir -p \
  "${isolated}/src/electron" \
  "${isolated}/scripts"
cp -R "${repo_root}/src/electron/browser-extension" \
  "${isolated}/src/electron/browser-extension"
cp -R "${repo_root}/src/electron/resources" \
  "${isolated}/src/electron/resources"
cp -R "${repo_root}/src/electron/scripts" \
  "${isolated}/src/electron/scripts"
cp -R "${repo_root}/src/electron/src" \
  "${isolated}/src/electron/src"
cp "${repo_root}/src/electron/package.json" \
  "${isolated}/src/electron/package.json"
cp "${repo_root}/scripts/verify_browser_extension.sh" \
  "${isolated}/scripts/verify_browser_extension.sh"
ln -s "${repo_root}/node_modules" "${isolated}/node_modules"

build_and_verify() {
  node "${isolated}/src/electron/scripts/build-browser-extension.mjs"
  bash "${isolated}/src/electron/scripts/build-safari-extension.sh"
  bash "${isolated}/scripts/verify_browser_extension.sh"
}

chrome_digest() {
  (
    cd "${isolated}/dist/component-reactions/browser-extension"
    find . -type f -print0 |
      LC_ALL=C sort -z |
      xargs -0 shasum -a 256
  )
}

safari_inventory() {
  (
    cd "${isolated}/dist/component-reactions/safari"
    find . -type f -print |
      LC_ALL=C sort
  )
}

build_and_verify
first_chrome="$(chrome_digest)"
first_safari="$(safari_inventory)"
rm -rf -- "${isolated}/dist"
build_and_verify

test "$(chrome_digest)" = "${first_chrome}"
test "$(safari_inventory)" = "${first_safari}"

if find "${isolated}" -maxdepth 2 -type d -name experimentation -print -quit |
  rg -q .;
then
  echo "Isolated production build unexpectedly contains experimentation inputs." >&2
  exit 1
fi

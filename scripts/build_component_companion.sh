#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_path="${repo_root}/src/native/component_reactions"
output_path="${repo_root}/dist/component-reactions"
input_source="${repo_root}/src/native/component_reactions/VibecheckComponentInput.mm"
node_include="$(
  node -p 'require("node:path").resolve(require("node:path").dirname(process.execPath), "../include/node")'
)"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "The component companion must be built on arm64 macOS." >&2
  exit 1
fi

swift build \
  --package-path "${package_path}" \
  --configuration release \
  --arch arm64

mkdir -p "${output_path}"
cp \
  "${package_path}/.build/arm64-apple-macosx/release/vibecheck-component-companion" \
  "${output_path}/vibecheck-component-companion"
strip -S "${output_path}/vibecheck-component-companion"
chmod 0755 "${output_path}/vibecheck-component-companion"

clang++ \
  -std=c++17 \
  -fobjc-arc \
  -arch arm64 \
  -mmacosx-version-min=13.0 \
  -I "${node_include}" \
  -bundle \
  -undefined dynamic_lookup \
  -framework AppKit \
  -framework ApplicationServices \
  "${input_source}" \
  -o "${output_path}/vibecheck-component-input.node"
strip -S "${output_path}/vibecheck-component-input.node"
chmod 0755 "${output_path}/vibecheck-component-input.node"

file "${output_path}/vibecheck-component-companion"
lipo -info "${output_path}/vibecheck-component-companion"
file "${output_path}/vibecheck-component-input.node"
lipo -info "${output_path}/vibecheck-component-input.node"

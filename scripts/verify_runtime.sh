#!/usr/bin/env bash
set -euo pipefail

runtime_dir="${1:?usage: verify_runtime.sh PATH_TO_RUNTIME_DIR}"
runtime="${runtime_dir}/vibecheck-runtime"
rust="${runtime_dir}/vibecheck-expression-interruption"
model="${runtime_dir}/models/enet_b0_8_best_afew.onnx"

for required in "${runtime}" "${rust}" "${model}"; do
  if [[ ! -f "${required}" ]]; then
    echo "Missing packaged runtime asset: ${required}" >&2
    exit 1
  fi
done

file "${runtime}" "${rust}"
lipo -info "${runtime}"
lipo -info "${rust}"
"${runtime}" --help >/dev/null

if rg -a -l \
  '/Users/[^/]+/(vibe-check|uncover)|/experi'"mentation/"'|emotiefflib_repo' \
  "${runtime_dir}"; then
  echo "Packaged runtime contains a prohibited project development path." >&2
  exit 1
fi

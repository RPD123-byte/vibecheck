#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_root="${repo_root}/.build/release-runtime"
release_venv="${build_root}/venv"
model_source="${VIBECHECK_MODEL_SOURCE:-${HOME}/.emotiefflib/enet_b0_8_best_afew.onnx}"
rust_manifest="${repo_root}/src/native/expression_interruption/Cargo.toml"
rust_binary="${repo_root}/src/native/expression_interruption/target/release/vibecheck-expression-interruption"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "The first Vibecheck preview must be built on arm64 macOS." >&2
  exit 1
fi
if [[ ! -f "${model_source}" ]]; then
  echo "Missing selected model: ${model_source}" >&2
  exit 1
fi

mkdir -p "${build_root}"
uv venv --python 3.11 "${release_venv}"
uv pip install --python "${release_venv}/bin/python" \
  "${repo_root}[inference,macos,release]"
cargo build --release --locked --manifest-path "${rust_manifest}"

export VIBECHECK_MODEL_SOURCE="${model_source}"
export VIBECHECK_RUST_BINARY="${rust_binary}"
export VIBECHECK_REPO_ROOT="${repo_root}"
"${release_venv}/bin/pyinstaller" \
  --clean \
  --noconfirm \
  --distpath "${repo_root}/dist/runtime" \
  --workpath "${build_root}/pyinstaller" \
  "${repo_root}/packaging/vibecheck-runtime.spec"

"${repo_root}/scripts/verify_runtime.sh" \
  "${repo_root}/dist/runtime/vibecheck-runtime"

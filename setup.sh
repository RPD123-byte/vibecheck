#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rust_manifest="${repo_root}/src/native/expression_interruption/Cargo.toml"

fail() {
  echo "Setup failed: $*" >&2
  exit 1
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "Vibecheck currently supports macOS only."
fi

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Xcode Command Line Tools are required."
  echo "Starting Apple's installer. Run ./setup.sh again after installation finishes."
  xcode-select --install >/dev/null 2>&1 || true
  exit 1
fi

python_bin=""
for candidate in python3.11 python3; do
  if command -v "${candidate}" >/dev/null 2>&1 &&
    "${candidate}" -c \
      'import sys; raise SystemExit(sys.version_info[:2] != (3, 11))'
  then
    python_bin="$(command -v "${candidate}")"
    break
  fi
done
[[ -n "${python_bin}" ]] ||
  fail "Python 3.11 is required. Install it, then run ./setup.sh again."

command -v cargo >/dev/null 2>&1 ||
  fail "Rust 1.91+ is required. Install it from https://rustup.rs, then run ./setup.sh again."
command -v rustc >/dev/null 2>&1 ||
  fail "rustc is missing. Install Rust from https://rustup.rs, then run ./setup.sh again."

rust_version="$(rustc --version | awk '{print $2}')"
IFS=. read -r rust_major rust_minor _ <<<"${rust_version}"
if ((rust_major < 1 || (rust_major == 1 && rust_minor < 91))); then
  fail "Rust 1.91+ is required; found rustc ${rust_version}."
fi

echo "Creating Python environment..."
venv_python="${repo_root}/.venv/bin/python"
selected_python_version="$("${python_bin}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
venv_python_version=""
if [[ -x "${venv_python}" ]]; then
  venv_python_version="$("${venv_python}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)"
fi
if [[ -n "${venv_python_version}" && "${venv_python_version}" != "${selected_python_version}" ]]; then
  echo "Replacing Python ${venv_python_version} environment with Python ${selected_python_version}..."
  "${python_bin}" -m venv --clear "${repo_root}/.venv"
else
  "${python_bin}" -m venv "${repo_root}/.venv"
fi

echo "Installing Python dependencies..."
"${repo_root}/.venv/bin/python" -m pip install --upgrade pip
"${repo_root}/.venv/bin/python" -m pip install \
  -e "${repo_root}[inference,macos]"

echo "Building interruption component..."
cargo build \
  --locked \
  --release \
  --manifest-path "${rust_manifest}"

"${repo_root}/.venv/bin/vibecheck" --help >/dev/null

echo
echo "Vibecheck setup complete."
echo "Run:"
echo "  source \"${repo_root}/.venv/bin/activate\""
echo "  vibecheck --mode demo --no-manage-codex-gui"

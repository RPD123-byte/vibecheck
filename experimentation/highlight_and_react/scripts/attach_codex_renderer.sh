#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
debug_port=${1:-9222}

exec "$script_dir/attach_electron_renderer.sh" "$debug_port"

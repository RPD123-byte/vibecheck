#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_path="$repository_root/supabase/database.types.ts"
generated_path="$(mktemp)"
trap 'rm -f "$generated_path"' EXIT

cd "$repository_root"
npx --no-install supabase gen types typescript --local --schema public > "$generated_path"
mv "$generated_path" "$output_path"

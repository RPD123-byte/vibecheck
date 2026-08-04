#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
checked_in_path="$repository_root/supabase/database.types.ts"
generated_path="$(mktemp)"
trap 'rm -f "$generated_path"' EXIT

cd "$repository_root"
npx --no-install supabase gen types typescript --local --schema public > "$generated_path"

if ! diff -u "$checked_in_path" "$generated_path"; then
  echo >&2
  echo "Supabase database types are stale." >&2
  echo "Run 'npm run db:types:generate' with local Supabase running." >&2
  exit 1
fi

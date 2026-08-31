#!/usr/bin/env bash
# Runs seed-dev.ts against the local Supabase stack instead of the dev cloud
# project. scripts/seed-dev.ts loads .env.local via dotenv without
# `override: true`, so exporting these two vars here (shell env wins over
# .env.local) is what redirects it locally — see DEVELOPMENT.md.
set -euo pipefail

if ! supabase status >/dev/null 2>&1; then
  echo "Local Supabase stack is not running. Start it first: supabase start" >&2
  exit 1
fi

read -r API_URL SERVICE_ROLE_KEY < <(supabase status -o json | node -e \
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.API_URL,j.SERVICE_ROLE_KEY)})")

NEXT_PUBLIC_SUPABASE_URL="$API_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  tsx scripts/seed-dev.ts

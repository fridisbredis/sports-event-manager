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

SERVICE_ROLE_KEY=$(supabase status -o json | python3 -c "import json,sys; print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")

NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  tsx scripts/seed-dev.ts

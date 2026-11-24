#!/usr/bin/env bash
# Fails when a tenant table is not classified in supabase/tenant-restore-tables.txt
# (N25, decision 4 of 2026-11-24), or when the file lists a table that no
# longer is one, or uses a class other than restore / keep-live.
#
# Without it, the next migration that adds a log-like tenant table (another
# sms_queue) would be restored by default, and nobody would have decided that.
#
# USAGE: scripts/check-tenant-table-classification.sh [db-url]
#   db-url defaults to the local stack. It must have run every migration: CI
#   runs this in the integration job, right after `supabase start`.
#   Needs psql. Locally without psql, pipe the scope query through the db
#   container instead:
#     docker exec -i supabase_db_sports-event-manager psql -U postgres -At -F'|' \
#       -v tenant=00000000-0000-0000-0000-000000000000 < scripts/ops/tenant-scope.sql \
#       | scripts/check-tenant-table-classification.sh -
#   ("-" reads the scope query's output from stdin instead of running it.)

set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIST="$ROOT/supabase/tenant-restore-tables.txt"
DB_URL="${1:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ "$DB_URL" == "-" ]]; then
  cat
else
  # The tenant id only shapes the filter column, which this check ignores.
  psql "$DB_URL" -X -q -At -F'|' -v ON_ERROR_STOP=1 \
    -v tenant=00000000-0000-0000-0000-000000000000 -f "$ROOT/scripts/ops/tenant-scope.sql"
fi | cut -d'|' -f1 | sed '/^$/d' | sort -u >"$WORK/actual"

if [[ ! -s "$WORK/actual" ]]; then
  echo "::error::The scope query returned no tables. Is the database migrated?" >&2
  exit 1
fi

# "<table> <class>  # comment" -> table and class; blank and comment lines dropped.
sed 's/#.*//' "$LIST" | awk 'NF' >"$WORK/rows"
FAIL=0

BAD_CLASS="$(awk '$2 != "restore" && $2 != "keep-live" || NF != 2 { print "  " $0 }' "$WORK/rows")"
if [[ -n "$BAD_CLASS" ]]; then
  echo "::error::tenant-restore-tables.txt: every line must be '<table> restore' or '<table> keep-live':" >&2
  echo "$BAD_CLASS" >&2
  FAIL=1
fi

awk '{ print $1 }' "$WORK/rows" | sort >"$WORK/listed"
DUPLICATES="$(uniq -d "$WORK/listed")"
if [[ -n "$DUPLICATES" ]]; then
  echo "::error::tenant-restore-tables.txt lists a table twice: $DUPLICATES" >&2
  FAIL=1
fi

MISSING="$(comm -23 "$WORK/actual" <(sort -u "$WORK/listed"))"
if [[ -n "$MISSING" ]]; then
  echo "::error::Tenant table(s) not classified in supabase/tenant-restore-tables.txt:" >&2
  echo "$MISSING" | sed 's/^/  /' >&2
  echo "Add each as 'restore' (tenant data people edit) or 'keep-live' (a log or queue of things that already happened: never rolled back). See the file's header." >&2
  FAIL=1
fi

STALE="$(comm -13 "$WORK/actual" <(sort -u "$WORK/listed"))"
if [[ -n "$STALE" ]]; then
  echo "::error::supabase/tenant-restore-tables.txt lists table(s) that are not tenant tables (dropped or renamed?):" >&2
  echo "$STALE" | sed 's/^/  /' >&2
  FAIL=1
fi

if [[ "$FAIL" == 0 ]]; then
  echo "All $(wc -l <"$WORK/actual" | tr -d ' ') tenant tables are classified."
fi
exit "$FAIL"

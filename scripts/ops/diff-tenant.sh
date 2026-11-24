#!/usr/bin/env bash
# ==============================================================================
# scripts/ops/diff-tenant.sh
#
# N25 step 2: what restoring ONE tenant from a backup would change, table by
# table, compared with live prod. It writes nothing to prod and restores
# nothing anywhere — it only reports. The write is step 3, built separately.
#
# USAGE:
#   scripts/ops/diff-tenant.sh <restored-db-url> <live-db-url> <tenant-id> <out-dir>
#
#   <restored-db-url>  a database holding the restored backup — the throwaway
#                      local stack restore-prod-db.sh restored into. This
#                      script writes a scratch schema (n25_live) there.
#   <live-db-url>      live prod. Only read, and only inside READ ONLY
#                      transactions, so Postgres itself refuses any write
#                      even if a statement here were wrong.
#   <tenant-id>        the tenant's uuid.
#   <out-dir>          report.md and report.json are written here.
#
# Run by .github/workflows/restore-tenant-diff.yml. See docs/ops/backup-and-
# restore.md §6.
#
# WHICH TABLES. Found from the catalog of the restored database, not from a
# hand-kept list that would go stale with the next migration:
#   - public.tenants, the tenant's own row;
#   - every public table with a tenant_id column;
#   - every public table WITHOUT tenant_id that has a foreign key to one of
#     those (e.g. workstation_todos -> workstations), filtered through it.
# Tables keyed only by user (user_preferences, push_subscriptions, ...) are
# not the tenant's: a user can belong to several tenants. They are listed in
# the report as out of scope rather than silently ignored.
#
# THE REPORT HOLDS IDS AND COUNTS, NEVER VALUES. It ends up as a workflow
# artifact and in the run summary; the rows it describes hold phone numbers
# and names. Changed rows are described by which columns differ, not how.
# ==============================================================================

set -euo pipefail

RESTORED="${1:-}"
LIVE="${2:-}"
TENANT="${3:-}"
OUT="${4:-}"

if [[ -z "$RESTORED" || -z "$LIVE" || -z "$TENANT" || -z "$OUT" ]]; then
  echo "Usage: $0 <restored-db-url> <live-db-url> <tenant-id> <out-dir>" >&2
  exit 2
fi

# The tenant id is interpolated into SQL below, so it must be exactly a uuid.
if ! [[ "$TENANT" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "ERROR: tenant-id must be a lowercase uuid. Got: $TENANT" >&2
  exit 2
fi

# This script writes a scratch schema into <restored-db-url>. Never prod.
if [[ "$RESTORED" == *"rauvaxuypujbeintnnoe"* ]]; then
  echo "ERROR: restored-db-url points at the PROD project. It must be the throwaway restore target." >&2
  exit 1
fi

mkdir -p "$OUT"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Tables whose rows are a log or a queue rather than the tenant's data. They
# are diffed like the rest, but restoring them is a different question: put an
# already-sent SMS back into sms_queue as pending and the worker sends it
# again; roll back audit_events and the audit trail loses what happened since.
# Flagged in the report so step 3 decides them deliberately.
LOG_OR_QUEUE="audit_events auth_events sms_queue sms_usage sms_cap_warnings"

# client_min_messages: DROP SCHEMA ... CASCADE otherwise prints a NOTICE per table.
restored() { PGOPTIONS='-c client_min_messages=warning' psql "$RESTORED" -X -q -v ON_ERROR_STOP=1 "$@"; }
# Every statement against prod runs inside BEGIN READ ONLY. A write in a read-
# only transaction is an error (25006), whatever the role could otherwise do.
live() {
  psql "$LIVE" -X -q -v ON_ERROR_STOP=1 \
    -c 'SET default_transaction_read_only = on' \
    -c 'BEGIN READ ONLY' "$@" -c 'COMMIT'
}

echo "==> Finding the tenant's tables in the restored backup..."

# table|filter, one per line. The filter selects the tenant's rows of that
# table in whichever database it is run against.
restored -At -F'|' -c "
  WITH base AS (
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ),
  tenant_tables AS (
    SELECT b.relname FROM base b
    JOIN information_schema.columns col
      ON col.table_schema = 'public' AND col.table_name = b.relname AND col.column_name = 'tenant_id'
  ),
  one_hop AS (
    -- Single-column foreign keys from a table without tenant_id to one with it.
    SELECT DISTINCT ON (child.relname)
      child.relname,
      format('%I IN (SELECT %I FROM public.%I WHERE tenant_id = %L)',
             ca.attname, pa.attname, parent.relname, '$TENANT') AS filter
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace cn ON cn.oid = child.relnamespace AND cn.nspname = 'public'
    JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = con.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND cardinality(con.conkey) = 1
      AND parent.relname IN (SELECT relname FROM tenant_tables)
      AND child.relname NOT IN (SELECT relname FROM tenant_tables)
      AND child.relname <> 'tenants'
    ORDER BY child.relname, con.conname
  )
  SELECT 'tenants', format('id = %L', '$TENANT')
  UNION ALL
  SELECT relname, format('tenant_id = %L', '$TENANT') FROM tenant_tables
  UNION ALL
  SELECT relname, filter FROM one_hop
  ORDER BY 1" >"$WORK/scope"

restored -At -c "
  SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1" >"$WORK/all_tables"
cut -d'|' -f1 "$WORK/scope" >"$WORK/scope_tables"
OUT_OF_SCOPE="$(comm -23 "$WORK/all_tables" "$WORK/scope_tables" | paste -sd' ' -)"

if [[ "$(restored -At -c "SELECT count(*) FROM public.tenants WHERE id = '$TENANT'")" != "1" ]]; then
  echo "ERROR: tenant $TENANT is not in the restored backup." >&2
  exit 1
fi
LIVE_TENANT="$(live -At -c "SELECT count(*) FROM public.tenants WHERE id = '$TENANT'" | tail -n1)"

# Tables that hold tenant_id in live but did not exist in the backup: created
# by a migration since. Nothing in the backup can restore them.
live -At -c "
  SELECT table_name FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name = 'tenant_id' ORDER BY 1" |
  sed '/^$/d' >"$WORK/live_tenant_tables"
NEW_IN_LIVE="$(comm -23 "$WORK/live_tenant_tables" <(sort "$WORK/scope_tables") | paste -sd' ' -)"

echo "==> Copying the tenant's live rows (read-only) into scratch schema n25_live..."
restored -c 'DROP SCHEMA IF EXISTS n25_live CASCADE' -c 'CREATE SCHEMA n25_live'

: >"$WORK/tables.json"
while IFS='|' read -r TABLE FILTER; do
  # Primary key, from the backup's definition of the table.
  PK="$(restored -At -c "
    SELECT string_agg(quote_ident(a.attname), ',' ORDER BY k.ord)
    FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indrelid = 'public.\"$TABLE\"'::regclass AND i.indisprimary")"

  COLS_SQL="SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = '$TABLE'
              AND is_generated = 'NEVER' ORDER BY column_name"
  restored -At -c "$COLS_SQL" >"$WORK/cols_backup"
  live -At -c "$COLS_SQL" | sed '/^$/d' >"$WORK/cols_live"
  COMMON="$(comm -12 "$WORK/cols_backup" "$WORK/cols_live" | sed 's/.*/"&"/' | paste -sd, -)"
  ONLY_BACKUP="$(comm -23 "$WORK/cols_backup" "$WORK/cols_live" | paste -sd' ' -)"
  ONLY_LIVE="$(comm -13 "$WORK/cols_backup" "$WORK/cols_live" | paste -sd' ' -)"

  if [[ ! -s "$WORK/cols_live" ]]; then
    # Dropped from prod since the backup.
    restored -At -c "SELECT json_build_object('table', '$TABLE', 'missing_in_live', true,
        'backup_rows', (SELECT count(*) FROM public.\"$TABLE\" WHERE $FILTER))" >>"$WORK/tables.json"
    continue
  fi

  live -c "\\copy (SELECT $COMMON FROM public.\"$TABLE\" WHERE $FILTER) TO '$WORK/live.csv' WITH CSV" >/dev/null
  restored \
    -c "CREATE TABLE n25_live.\"$TABLE\" AS SELECT $COMMON FROM public.\"$TABLE\" WITH NO DATA" \
    -c "\\copy n25_live.\"$TABLE\" ($COMMON) FROM '$WORK/live.csv' WITH CSV"

  if [[ -z "$PK" ]]; then
    echo "WARNING: public.$TABLE has no primary key; comparing row counts only." >&2
    restored -At -c "SELECT json_build_object('table', '$TABLE', 'no_primary_key', true,
        'backup_rows', (SELECT count(*) FROM public.\"$TABLE\" WHERE $FILTER),
        'live_rows', (SELECT count(*) FROM n25_live.\"$TABLE\"))" >>"$WORK/tables.json"
    continue
  fi

  JOIN_ON="$(echo "$PK" | tr ',' '\n' | awk '{printf "%sb.%s = l.%s", (NR>1?" AND ":""), $0, $0}')"
  PK_TEXT="$(echo "$PK" | tr ',' '\n' | awk '{printf "%s%s::text", (NR>1?" || \x27,\x27 || ":""), $0}')"
  IS_LOG="false"
  [[ " $LOG_OR_QUEUE " == *" $TABLE "* ]] && IS_LOG="true"

  restored -At -c "
    WITH b AS (SELECT $COMMON FROM public.\"$TABLE\" WHERE $FILTER),
         l AS (SELECT * FROM n25_live.\"$TABLE\"),
         added AS (SELECT * FROM b WHERE NOT EXISTS (SELECT 1 FROM l WHERE $JOIN_ON)),
         removed AS (SELECT * FROM l WHERE NOT EXISTS (SELECT 1 FROM b WHERE $JOIN_ON)),
         pairs AS (SELECT to_jsonb(b) AS bj, to_jsonb(l) AS lj, b AS brow FROM b JOIN l ON $JOIN_ON),
         changed AS (SELECT * FROM pairs WHERE bj IS DISTINCT FROM lj)
    SELECT json_build_object(
      'table', '$TABLE',
      'log_or_queue', $IS_LOG,
      'backup_rows', (SELECT count(*) FROM b),
      'live_rows', (SELECT count(*) FROM l),
      'would_add', (SELECT count(*) FROM added),
      'would_remove', (SELECT count(*) FROM removed),
      'would_change', (SELECT count(*) FROM changed),
      'changed_columns', (
        SELECT coalesce(json_object_agg(key, n), '{}') FROM (
          SELECT e.key, count(*) AS n
          FROM changed c, jsonb_each(c.bj) e
          WHERE e.value IS DISTINCT FROM c.lj -> e.key
          GROUP BY e.key ORDER BY e.key) s),
      'sample_add', (SELECT coalesce(json_agg(id), '[]') FROM (
          SELECT $PK_TEXT AS id FROM added b ORDER BY 1 LIMIT 10) s),
      'sample_remove', (SELECT coalesce(json_agg(id), '[]') FROM (
          SELECT $PK_TEXT AS id FROM removed b ORDER BY 1 LIMIT 10) s),
      'sample_change', (SELECT coalesce(json_agg(id), '[]') FROM (
          SELECT $(echo "$PK" | tr ',' '\n' | awk '{printf "%s(brow).%s::text", (NR>1?" || \x27,\x27 || ":""), $0}') AS id
          FROM changed ORDER BY 1 LIMIT 10) s),
      'columns_only_in_backup', '$ONLY_BACKUP',
      'columns_only_in_live', '$ONLY_LIVE'
    )" >>"$WORK/tables.json"
done <"$WORK/scope"

echo "==> Checking references to users that no longer exist in live..."
# A restored row pointing at a user deleted since the backup (e.g. anonymised
# by the GDPR job) would be a dangling reference after step 3. auth.users is
# global, not the tenant's, so it is checked against live rather than restored.
: >"$WORK/dangling.json"
restored -At -F'|' -c "
  SELECT child.relname, ca.attname
  FROM pg_constraint con
  JOIN pg_class child ON child.oid = con.conrelid
  JOIN pg_namespace cn ON cn.oid = child.relnamespace AND cn.nspname = 'public'
  JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND cardinality(con.conkey) = 1
    AND con.confrelid = 'auth.users'::regclass
  ORDER BY 1, 2" >"$WORK/user_fks"
while IFS='|' read -r TABLE COL; do
  FILTER="$(grep "^$TABLE|" "$WORK/scope" | cut -d'|' -f2- || true)"
  [[ -z "$FILTER" ]] && continue
  IDS="$(restored -At -c "SELECT coalesce(string_agg(DISTINCT \"$COL\"::text, ','), '') FROM public.\"$TABLE\" WHERE $FILTER AND \"$COL\" IS NOT NULL")"
  [[ -z "$IDS" ]] && continue
  live -At -c "
    SELECT json_build_object('table', '$TABLE', 'column', '$COL',
      'missing_users', count(*), 'sample', coalesce(json_agg(id ORDER BY id) FILTER (WHERE rn <= 10), '[]'))
    FROM (SELECT u.id, row_number() OVER (ORDER BY u.id) AS rn
          FROM unnest('{$IDS}'::uuid[]) AS u(id)
          WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.id)) m
    HAVING count(*) > 0" | sed '/^$/d' >>"$WORK/dangling.json"
done <"$WORK/user_fks"

# Foreign keys INTO the tenant's tables from tables outside the scope: rows
# there could be left pointing at something step 3 removes. None exist today;
# listed so a future migration that adds one shows up here.
INBOUND="$(restored -At -c "
  SELECT coalesce(string_agg(DISTINCT format('%s.%s -> %s', child.relname, ca.attname, parent.relname), ', '), '')
  FROM pg_constraint con
  JOIN pg_class child ON child.oid = con.conrelid
  JOIN pg_class parent ON parent.oid = con.confrelid
  JOIN pg_namespace pn ON pn.oid = parent.relnamespace AND pn.nspname = 'public'
  JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = con.conkey[1]
  WHERE con.contype = 'f'
    AND parent.relname = ANY (string_to_array('$(paste -sd, "$WORK/scope_tables")', ','))
    AND child.relname <> ALL (string_to_array('$(paste -sd, "$WORK/scope_tables")', ','))")"

restored -c 'DROP SCHEMA n25_live CASCADE' >/dev/null

echo "==> Writing the report..."
{
  echo '{'
  echo "\"tenant_id\": \"$TENANT\","
  echo "\"tenant_in_live\": $([[ "$LIVE_TENANT" == "1" ]] && echo true || echo false),"
  echo "\"generated_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "\"slot\": \"${DIFF_SLOT:-}\","
  echo "\"tables_new_in_live\": \"$NEW_IN_LIVE\","
  echo "\"tables_out_of_scope\": \"$OUT_OF_SCOPE\","
  echo "\"inbound_foreign_keys\": \"$INBOUND\","
  echo "\"tables\": [$(paste -sd, "$WORK/tables.json")],"
  echo "\"missing_users\": [$(paste -sd, "$WORK/dangling.json")]"
  echo '}'
} >"$OUT/report.json"

# The markdown is rendered from report.json by Postgres (already at hand)
# rather than jq, which the macOS rehearsal path may not have.
restored -At -v report="$(cat "$OUT/report.json")" <<'SQL' >"$OUT/report.md"
WITH r AS (SELECT :'report'::jsonb AS j),
t AS (SELECT x FROM r, jsonb_array_elements(j -> 'tables') AS x)
SELECT concat_ws(E'\n',
  '## Tenant restore preview (N25 step 2)',
  '',
  format('Tenant `%s`%s · slot %s · generated %s', j ->> 'tenant_id',
         CASE WHEN (j ->> 'tenant_in_live')::boolean THEN '' ELSE ' (**not in live: deleted since the backup**)' END,
         coalesce(nullif(j ->> 'slot', ''), '?'), j ->> 'generated_at'),
  '',
  'What restoring this tenant from the backup would do to live prod. **Nothing has been written.** Counts and ids only, never values.',
  '',
  '| Table | Backup | Live | Would add | Would remove | Would change | Changed columns |',
  '|---|--:|--:|--:|--:|--:|---|',
  (SELECT string_agg(format('| %s%s | %s | %s | %s | %s | %s | %s |',
      x ->> 'table',
      CASE WHEN (x ->> 'log_or_queue')::boolean THEN ' ⚠︎ log/queue' ELSE '' END,
      coalesce(x ->> 'backup_rows', '?'), coalesce(x ->> 'live_rows', '–'),
      coalesce(x ->> 'would_add', '–'), coalesce(x ->> 'would_remove', '–'), coalesce(x ->> 'would_change', '–'),
      CASE
        WHEN (x ->> 'missing_in_live')::boolean THEN 'table no longer exists in live'
        WHEN (x ->> 'no_primary_key')::boolean THEN 'no primary key: counts only'
        ELSE coalesce((SELECT string_agg(format('%s (%s)', k, v), ', ' ORDER BY k)
                       FROM jsonb_each_text(x -> 'changed_columns') AS c(k, v)), '')
             || CASE WHEN coalesce(x ->> 'columns_only_in_live', '') <> ''
                     THEN ' · new in live: ' || (x ->> 'columns_only_in_live') ELSE '' END
             || CASE WHEN coalesce(x ->> 'columns_only_in_backup', '') <> ''
                     THEN ' · dropped from live: ' || (x ->> 'columns_only_in_backup') ELSE '' END
      END), E'\n' ORDER BY x ->> 'table') FROM t),
  '',
  '⚠︎ log/queue: restoring these is a separate decision for step 3 (an old sms_queue row put back as pending would be sent again; rolling back audit_events loses the audit trail since the backup).',
  '',
  CASE WHEN jsonb_array_length(j -> 'missing_users') = 0
       THEN '**Users:** every user the backup refers to still exists in live.'
       ELSE '**Users deleted since the backup** (restored rows would point at them): ' ||
            (SELECT string_agg(format('%s.%s: %s', m ->> 'table', m ->> 'column', m ->> 'missing_users'), ', ')
             FROM jsonb_array_elements(j -> 'missing_users') AS m)
  END,
  '',
  CASE WHEN coalesce(j ->> 'tables_new_in_live', '') = '' THEN NULL
       ELSE '**Tables created since the backup** (nothing to restore them from): ' || (j ->> 'tables_new_in_live') END,
  CASE WHEN coalesce(j ->> 'inbound_foreign_keys', '') = '' THEN NULL
       ELSE '**Foreign keys into the tenant''s tables from outside them:** ' || (j ->> 'inbound_foreign_keys') END,
  '',
  '<sub>Not the tenant''s, so not compared: ' || (j ->> 'tables_out_of_scope') || '</sub>'
) FROM r;
SQL

echo "==> Done: $OUT/report.md, $OUT/report.json"

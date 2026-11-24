#!/usr/bin/env bash
# ==============================================================================
# scripts/ops/restore-prod-db.sh
#
# Downloads a snapshot created by scripts/ops/snapshot-prod-db.sh and restores
# it. See REL-04 in docs/quality-requirements.md.
#
# SAFETY: this script NEVER restores directly to prod. It always restores to
# a target you name explicitly — the local stack, for a rehearsal
# (docs/testing/rollback-rehearsal.md), or a Supabase branch/dev project for
# inspecting a snapshot's contents. Restoring destructively over the live
# prod database is a decision for a human to make deliberately, with an
# incident in progress and eyes on it — not something this script automates,
# because a scripted one-liner is exactly the kind of thing that gets run
# against the wrong target under pressure.
#
# REQUIRES:
#   - 1Password CLI (`op`), signed in — unless BLOB_CONN_STR is set (below)
#   - psql (part of a full Postgres install)
#
# NON-INTERACTIVE USE (N25: .github/workflows/restore-tenant-diff.yml)
# A CI runner has neither 1Password nor a terminal to type into, so two
# environment variables stand in for them:
#   BLOB_CONN_STR=<connection string>  used instead of reading it from 1Password
#   RESTORE_CONFIRM=restore            answers the "Type 'restore'" prompt
# Neither weakens the prod guard below: that one still has no override. The
# workflow only ever restores into the throwaway local stack on its own runner.
#
# USAGE:
#   scripts/ops/restore-prod-db.sh <blob-name> <target-db-url> [--include-roles]
#
#   e.g. against the local stack for a rehearsal:
#     scripts/ops/restore-prod-db.sh 0048_pre-migration_2026-09-08T14-30-00Z.tar.gz \
#       "postgresql://postgres:postgres@localhost:54322/postgres"
#
#   e.g. against a Supabase branch (get its connection string via
#   list_branches / the Supabase dashboard first):
#     scripts/ops/restore-prod-db.sh 0048_pre-migration_2026-09-08T14-30-00Z.tar.gz \
#       "<branch-connection-string>"
#
# ROLES ARE SKIPPED BY DEFAULT. roles.sql includes `ALTER ROLE supabase_admin
# ...`, and supabase_admin is a reserved role on every Postgres target this
# script restores to (local stack, a branch, a dev project) — only a real
# superuser connection can alter it, and the restore's own --dbname
# connection isn't one. Confirmed 2026-09-07: a rehearsal restore against
# local stack failed on exactly this statement. Every Supabase environment
# already provisions its own roles identically from the same platform image,
# so roles.sql restores nothing that wasn't already there — it's
# infrastructure, not data. Pass --include-roles only if you specifically
# need to restore custom role passwords onto a target where you hold a true
# superuser connection (this is rare; the Supabase docs' own platform-to-
# self-hosted restore guide is the closest analog, and even there it's a
# separate deliberate step, not a default).
#
# This script will refuse to run if <target-db-url> looks like it points at
# the prod project ref (rauvaxuypujbeintnnoe) or hostname pattern — see the
# GUARD below. There is no override flag. If you genuinely need to restore
# onto prod, do it by hand with psql, deliberately, not through this script.
#
# TARGET MUST HAVE RUN THE MIGRATION SUITE AT LEAST ONCE, and this script
# handles the collisions that causes — no target choice avoids them, since
# they come from what the migrations/platform tables already contain, not
# from leftover seed data. Confirmed 2026-09-07 across four rehearsal
# attempts (including one against a stack freshly restarted via `supabase
# stop --no-backup && supabase start`, no seed applied — failure #2
# reproduced identically there):
#   1. "multiple primary keys for table announcements" — schema.sql's
#      ADD CONSTRAINT collided with the already-migrated public schema.
#      Fixed below: DROP SCHEMA public CASCADE + CREATE SCHEMA public
#      before restoring.
#   2. "duplicate key value violates unique constraint buckets_pkey"
#      (id=logos) — migration 0015 INSERTs the "logos" storage bucket row
#      directly (DML in a migration, not schema-only), so ANY target that
#      has ever run the migration suite already has that row — there is no
#      "fresh but migrated" environment where this doesn't collide. Grepped
#      the whole suite: 0015 is the only migration that INSERTs application
#      data rather than schema, so this is a known, singular, targeted
#      collision — fixed below with `TRUNCATE storage.buckets CASCADE`
#      (also empties storage.objects via FK; fine, data.sql repopulates it).
#   3. "permission denied for table buckets_vectors" — the local stack's
#      copy of storage.buckets_vectors/vector_indexes (Supabase Storage's
#      vector-search tables) rejects even a superuser GRANT with a silent
#      "no privileges were granted" warning; root cause not chased past
#      that (would mean digging into Supabase's own platform migrations,
#      not this repo's). This project doesn't use vector search — both
#      tables confirmed 0 rows on prod 2026-09-07 — so their COPY blocks
#      are stripped from data.sql before restoring rather than fighting the
#      permission. Revisit if either table is ever actually populated.
# If schema.sql/data.sql ever gain a similar failure from a different
# migration doing the same thing (INSERT instead of pure DDL), the fix is
# the same shape: a targeted TRUNCATE of that one table added here, not a
# blanket schema drop of auth/storage — those hold platform
# functions/types Supabase's own runtime needs, not just row data.
#
# WINDOWS / GIT BASH:
# Same risk class as F-MNT-18 (docs/quality-requirements.md) and
# snapshot-prod-db.sh's header — Git Bash's MSYS runtime can silently rewrite
# "/"-leading arguments (op:// references, connection strings) into Windows
# paths before they reach az/op, which are real Windows binaries, not MSYS
# tools. The MSYS GUARD below sets MSYS2_ARG_CONV_EXCL to cover this, but
# that guard has NOT been verified against a real Git Bash environment.
# ==============================================================================

set -euo pipefail

# MSYS GUARD: see snapshot-prod-db.sh's header for why this exists and its
# verification status. Harmless outside MSYS.
if [[ -n "${MSYSTEM:-}" ]]; then
  export MSYS2_ARG_CONV_EXCL="*"
fi

BLOB_NAME="${1:-}"
TARGET_DB_URL="${2:-}"
INCLUDE_ROLES=false
if [[ "${3:-}" == "--include-roles" ]]; then
  INCLUDE_ROLES=true
fi

if [[ -z "${BLOB_NAME}" || -z "${TARGET_DB_URL}" ]]; then
  echo "Usage: $0 <blob-name> <target-db-url> [--include-roles]" >&2
  echo "  e.g.: $0 0048_pre-migration_2026-09-08T14-30-00Z.tar.gz \"postgresql://postgres:postgres@localhost:54322/postgres\"" >&2
  exit 1
fi

# GUARD: blob names come from scripts/ops/snapshot-prod-db.sh's own output
# (<migration-number>_pre-migration_<timestamp>.tar.gz) and are otherwise
# operator-typed, but BLOB_NAME is used unsanitized below as both an `az`
# argument and a path component under WORKDIR — a name containing "/" (e.g.
# a "../"-style value) could escape the tempdir. Restrict it to the actual
# expected shape rather than trying to blocklist "..".
if [[ "${BLOB_NAME}" == */* || ! "${BLOB_NAME}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "ERROR: blob-name must contain only letters, digits, '.', '_', '-' — no path separators." >&2
  echo "Got: ${BLOB_NAME}" >&2
  exit 1
fi

# GUARD: refuse anything that looks like the prod project. No override.
if [[ "${TARGET_DB_URL}" == *"rauvaxuypujbeintnnoe"* ]]; then
  echo "ERROR: target-db-url looks like the PROD Supabase project (rauvaxuypujbeintnnoe)." >&2
  echo "This script will not restore onto prod. Restore by hand with psql if you" >&2
  echo "deliberately intend to overwrite prod during a live incident." >&2
  exit 1
fi

if [[ -z "${BLOB_CONN_STR:-}" ]] && ! command -v op >/dev/null 2>&1; then
  echo "ERROR: 1Password CLI (op) not found, and BLOB_CONN_STR is not set." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found. Install the PostgreSQL client tools." >&2
  exit 1
fi

# stderr is NOT merged into this capture (no 2>&1) — see the matching note
# in snapshot-prod-db.sh for why: a stray op warning must not silently end
# up concatenated into the connection string.
if [[ -z "${BLOB_CONN_STR:-}" ]]; then
  BLOB_CONN_STR="$(op read "op://Viadal Event Manager/Azure Blob sportsevtmgrprodsnaps/password" --account extrapreneurab.1password.com)" || {
    echo "ERROR: could not read the Azure Blob connection string from 1Password." >&2
    exit 1
  }
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

echo "==> Downloading ${BLOB_NAME}..."
az storage blob download \
  --connection-string "${BLOB_CONN_STR}" \
  --container-name db-snapshots \
  --name "${BLOB_NAME}" \
  --file "${WORKDIR}/${BLOB_NAME}" \
  --only-show-errors

echo "==> Extracting..."
tar -xzf "${WORKDIR}/${BLOB_NAME}" -C "${WORKDIR}"

# Confirmed 2026-09-07: storage.buckets_vectors and storage.vector_indexes
# (Supabase Storage's vector-search tables — this project doesn't use
# vector search, confirmed 0 rows in both on prod at the time of writing)
# reject even a superuser GRANT with a silent "no privileges were granted"
# warning on the local stack's copy of these tables — root cause not
# chased further than that (would require digging into Supabase's own
# platform migrations, not this repo's). Since both are confirmed empty on
# prod, dropping their COPY blocks from data.sql loses nothing and avoids
# chasing a permissions issue in platform-owned tables this project never
# populates. If either table is ever actually used, this needs revisiting
# — check row counts before assuming this filter is still safe.
echo "==> Removing empty-on-prod vector-search tables from data.sql (see script header)..."
for VECTOR_TABLE in buckets_vectors vector_indexes; do
  sed -i.bak "/^COPY \"storage\"\.\"${VECTOR_TABLE}\" /,/^\\\\\\.\$/d" "${WORKDIR}/data.sql"
done
rm -f "${WORKDIR}/data.sql.bak"

# Collision #6, found by the first N25 preview run (2026-11-24): prod's auth
# schema had gained tables (auth.mfa_recovery_code_sets, auth.scim_users, ...)
# and columns (auth.one_time_tokens.expires_at) that the local stack of the
# pinned CLI (2.116.0) does not have, and data.sql's COPY into them killed the
# restore. Supabase upgrades its own platform services in the cloud on its own
# schedule, so prod's auth/storage schemas will keep drifting ahead of whatever
# a target runs. Rather than chasing each table by name (the vector-table fix
# above), auth/storage data is fitted to the TARGET: a table it lacks is left
# out, a column it lacks is cut from every row, and both are reported with how
# much data was dropped. public is never touched: schema.sql creates every
# public table, so a mismatch there is a real error.
#
# Acceptable for the targets this script restores to (inspection and
# rehearsal); the app uses phone OTP only, not MFA or SCIM. If something
# reported as dropped matters, upgrade the target's CLI instead.
echo "==> Fitting auth/storage data to the target's platform schema..."
psql --no-psqlrc -At -F' ' --dbname "${TARGET_DB_URL}" -c \
  "SELECT format('\"%s\".\"%s\"', table_schema, table_name), column_name
   FROM information_schema.columns WHERE table_schema IN ('auth', 'storage')" \
  >"${WORKDIR}/target-platform-columns"
# COPY text format escapes tabs inside values as \t, so a literal tab always
# separates fields and cutting a column is cutting a field.
awk -v known="${WORKDIR}/target-platform-columns" -v report="${WORKDIR}/fitted" '
  BEGIN {
    FS = "\t"; OFS = "\t"
    while ((getline line < known) > 0) { split(line, p, " "); table[p[1]] = 1; col[p[1] SUBSEP p[2]] = 1 }
  }
  mode == "skip" {
    if ($0 == "\\.") { printf "skipped table %s: %d row(s)\n", name, rows >> report; mode = "" } else rows++
    next
  }
  mode == "cut" {
    if ($0 == "\\.") {
      printf "cut %s from %s: %d non-null value(s) dropped\n", dropped, name, lost >> report
      mode = ""; print; next
    }
    out = ""
    for (i = 1; i <= n; i++) {
      if (keep[i]) out = out (out == "" ? "" : "\t") $i
      else if ($i != "\\N") lost++
    }
    print out
    next
  }
  /^COPY "(auth|storage)"\."[^"]+" / {
    split($0, w, " "); name = w[2]
    if (!(name in table)) { mode = "skip"; rows = 0; next }
    cols = $0; sub(/^[^(]*\(/, "", cols); sub(/\) FROM stdin;$/, "", cols)
    n = split(cols, c, ", ")
    kept = ""; dropped = ""
    for (i = 1; i <= n; i++) {
      bare = c[i]; gsub(/"/, "", bare)
      keep[i] = ((name SUBSEP bare) in col)
      if (keep[i]) kept = kept (kept == "" ? "" : ", ") c[i]
      else dropped = dropped (dropped == "" ? "" : ",") bare
    }
    if (dropped == "") { print; next }
    printf "COPY %s (%s) FROM stdin;\n", name, kept
    mode = "cut"; lost = 0
    next
  }
  { print }
' "${WORKDIR}/data.sql" >"${WORKDIR}/data.fitted.sql"
mv "${WORKDIR}/data.fitted.sql" "${WORKDIR}/data.sql"
if [[ -s "${WORKDIR}/fitted" ]]; then
  sed 's/^/    /' "${WORKDIR}/fitted" >&2
else
  echo "    nothing to fit"
fi

echo ""
echo "About to restore onto:"
echo "  ${TARGET_DB_URL}"
echo ""
echo "This DROPS AND RECREATES the 'public' schema on that target first —"
echo "schema.sql is built to apply to an empty database (the same way a real"
echo "incident restore would target a fresh database), so any existing"
echo "tables/constraints on the target (e.g. from 'supabase db reset') are"
echo "destroyed before the restore, not merged with. The prod-target guard"
echo "above already refused this for anything matching the prod project ref;"
echo "this is an additional, separate confirmation because dropping a schema"
echo "is destructive in its own right, independent of which target it's run"
echo "against."
echo ""
if [[ -n "${RESTORE_CONFIRM:-}" ]]; then
  CONFIRMATION="${RESTORE_CONFIRM}"
  echo "Confirmation taken from RESTORE_CONFIRM."
else
  read -r -p "Type 'restore' to confirm: " CONFIRMATION
fi
if [[ "${CONFIRMATION}" != "restore" ]]; then
  echo "Aborted."
  exit 1
fi

echo "==> Dropping and recreating the 'public' schema on the target..."
# The CREATE grant to cache_rpc_reader is not incidental — it is required for
# the restore to complete at all, and it is this script's own DROP SCHEMA
# (the fix for collision #1) that destroys it.
#
# schema.sql contains five `ALTER FUNCTION ... OWNER TO "cache_rpc_reader"`
# statements. Since the CVE-2018-1058-era hardening, Postgres requires the
# RECEIVING role to hold CREATE on the containing schema before it will
# reassign ownership — reassignment is treated as equivalent to being able to
# (re)create the object there. Migration 0050 issues this grant for exactly
# that reason (see its comment), but a dropped schema takes the grant with it,
# and schema.sql never re-issues it: pg_dump emits object ownership, not the
# schema-level grants that make the ownership transfer legal.
#
# Without this line the restore dies at schema.sql:805 with "permission denied
# for schema public". Found in the Del 6 rehearsal 2026-10-19; collision #5,
# in the same family as the four in the header above. USAGE alone is not
# enough — it must be CREATE.
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --command 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT USAGE, CREATE ON SCHEMA public TO cache_rpc_reader;' \
  --dbname "${TARGET_DB_URL}"

# Migration 0015 INSERTs the "logos" storage bucket row directly (DML in a
# migration, not just DDL) — so any target that has ever run the migration
# suite already has this row, and data.sql's COPY into storage.buckets
# collides with it regardless of how "fresh" the target otherwise is.
# Confirmed 2026-09-07: reproduced even against a stack that had just run
# `supabase stop --no-backup && supabase start` with no seed applied.
# Truncating just this one table (not the whole storage schema) is safe:
# 0015 is the only migration across the whole suite that INSERTs
# application data rather than schema (grepped for `insert into`), so this
# is a targeted fix for a known, singular collision, not a blanket workaround.
# CASCADE also empties storage.objects (FK to buckets) — fine on a target
# that's about to be overwritten by data.sql anyway, but this means any
# real uploaded files on the target (not prod — the target) are gone.
echo "==> Clearing storage.buckets (migration 0015 seeds it; would collide with data.sql)..."
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --command 'TRUNCATE storage.buckets CASCADE;' \
  --dbname "${TARGET_DB_URL}"

if [[ "${INCLUDE_ROLES}" == true ]]; then
  echo "==> Restoring (roles, schema, data — single transaction)..."
  echo "    --include-roles passed: this will attempt ALTER ROLE supabase_admin," >&2
  echo "    which requires a true superuser connection — expect it to fail" >&2
  echo "    otherwise (see the ROLES ARE SKIPPED BY DEFAULT note in this" >&2
  echo "    script's header)." >&2
  psql \
    --single-transaction \
    --variable ON_ERROR_STOP=1 \
    --file "${WORKDIR}/roles.sql" \
    --file "${WORKDIR}/schema.sql" \
    --command 'SET session_replication_role = replica' \
    --file "${WORKDIR}/data.sql" \
    --dbname "${TARGET_DB_URL}"
else
  echo "==> Restoring (schema, data — single transaction; roles.sql skipped, see --include-roles)..."
  psql \
    --single-transaction \
    --variable ON_ERROR_STOP=1 \
    --file "${WORKDIR}/schema.sql" \
    --command 'SET session_replication_role = replica' \
    --file "${WORKDIR}/data.sql" \
    --dbname "${TARGET_DB_URL}"
fi

echo ""
echo "=============================================================================="
echo "RESTORE COMPLETE onto: ${TARGET_DB_URL}"
echo "Verify row counts / spot-check tables before trusting this restore."
echo "=============================================================================="

# Storage files, if this archive carries them. Weekly slots from ISO week 44
# onward include a storage/ directory; anything older (and every
# pre-migration snapshot) does not, so its absence is normal rather than a
# fault.
#
# They are NOT uploaded automatically. This script's whole safety model is
# that it writes only to a database target the caller named explicitly, and
# an upload would have to pick a Storage endpoint on its own — exactly the
# kind of implicit targeting the prod guard above exists to prevent. So the
# files are extracted and the operator is told where they are.
if [ -d "${WORKDIR}/storage" ]; then
  STORAGE_OUT="./restored-storage-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -R "${WORKDIR}/storage" "${STORAGE_OUT}"
  FILE_COUNT=$(find "${STORAGE_OUT}" -type f | wc -l | tr -d ' ')

  echo ""
  echo "Storage: ${FILE_COUNT} file(s) extracted to ${STORAGE_OUT}"
  echo ""
  echo "  The database restore above did NOT put these back. storage.objects"
  echo "  rows now describe files that may no longer exist in the bucket,"
  echo "  which renders as broken images rather than missing ones."
  echo ""
  echo "  To upload them to a target you choose, deliberately:"
  echo "    supabase storage cp -r ${STORAGE_OUT}/logos ss:///logos \\"
  echo "      --project-ref <ref> --experimental"
  echo "    supabase storage cp -r ${STORAGE_OUT}/avatars ss:///avatars \\"
  echo "      --project-ref <ref> --experimental"
  echo ""
  echo "  <ref> is never implied: the repo's CLI is linked to dev, so an"
  echo "  omitted --project-ref writes to the wrong environment and succeeds."
  echo ""
  echo "  These are prod files. Delete ${STORAGE_OUT} when done — see the"
  echo "  GDPR note in docs/testing/rollback-rehearsal.md."
else
  echo ""
  echo "Storage: no storage/ directory in this archive (normal for slots"
  echo "captured before ISO week 44, and for pre-migration snapshots)."
fi

#!/usr/bin/env bash
# ==============================================================================
# scripts/ops/snapshot-prod-db.sh
#
# Takes a full data + schema + roles dump of the PROD Supabase database and
# uploads it to Azure Blob Storage, so a `destructive` migration (a backfill,
# a DROP COLUMN) that runs cleanly but against the wrong rows has something
# to recover from. See F-REL-20 in docs/quality-requirements.md for why this
# exists: PITR is deliberately off (cost), and Supabase Preview Branching was
# evaluated and rejected as a substitute — a branch replays
# supabase/migrations/ against a fresh/seeded database, so it verifies
# schema, not prod's actual rows.
#
# Run this by hand, immediately before `supabase db push` for any migration
# classified `destructive` in its Forward-fix header. It is NOT called from
# any deploy workflow — CI has no Blob Storage write credentials, and
# shouldn't gain them just for this.
#
# SCOPE: prod only. Dev is disposable and reseedable via `npm run seed:dev`.
#
# REQUIRES:
#   - Docker running (supabase db dump runs pg_dump inside a container)
#   - 1Password CLI (`op`), signed in
#   - A "db connection string" field on the "Supabase Sports Event Manager
#     prod" item in the "Viadal Event Manager" vault — the Session pooler
#     connection string from the prod project's Dashboard → Connect page.
#     This script does not derive or guess that value; it must already be
#     stored there.
#   - Azure CLI (`az`), logged in, with access to the sportsevtmgrprodsnaps
#     storage account (or the connection string in 1Password item
#     "Azure Blob sportsevtmgrprodsnaps" — this script uses that instead of
#     `az` credentials, so it works for anyone with 1Password access alone).
#
# USAGE:
#   scripts/ops/snapshot-prod-db.sh <migration-version>
#
#   e.g. scripts/ops/snapshot-prod-db.sh 0048
#   e.g. scripts/ops/snapshot-prod-db.sh 20260908143000
#
# <migration-version> is the migration file's own version prefix — a legacy
# 00NN number or a YYYYMMDDHHMMSS timestamp (see .claude/CLAUDE.md
# "Migration naming") — passed through verbatim into the snapshot filename.
#
# The migration version is required so the snapshot filename can be referenced
# from that migration's Forward-fix `Data:` line — the connective tissue this
# script exists to provide.
#
# WINDOWS / GIT BASH:
# This is the same risk class as F-MNT-18 (docs/quality-requirements.md):
# Git Bash's MSYS runtime auto-converts any command-line argument starting
# with "/" into a Windows filesystem path before it reaches a non-MSYS
# binary — `az` and `op` are both real Windows binaries, not MSYS tools.
# This script passes several such arguments (op:// references,
# --container-name/--name values, --dbname connection strings). Unlike
# F-MNT-18 — where the fix was applied by hand at run time — this script
# sets MSYS2_ARG_CONV_EXCL itself below (see MSYS GUARD), so it should be
# safe to run unmodified from Git Bash. That guard has NOT been verified
# against a real Git Bash environment; if a downloaded snapshot or restore
# looks wrong on Windows, suspect silent path conversion first and compare
# against WSL2 or macOS/Linux before assuming the data itself is bad.
# ==============================================================================

set -euo pipefail

# MSYS GUARD: on Git Bash (MSYS), stop auto-conversion of "/"-leading
# arguments into Windows paths before they reach az/op. Harmless outside
# MSYS — the variable is simply unused. "*" excludes conversion for every
# argument rather than a narrow prefix, since this script's "/"-leading
# arguments (op:// references, blob names, connection strings) don't share
# a common prefix the way F-MNT-18's did.
if [[ -n "${MSYSTEM:-}" ]]; then
  export MSYS2_ARG_CONV_EXCL="*"
fi

MIGRATION_NUMBER="${1:-}"

if [[ -z "${MIGRATION_NUMBER}" ]]; then
  echo "Usage: $0 <migration-version>" >&2
  echo "  e.g.: $0 0048" >&2
  echo "  e.g.: $0 20260908143000" >&2
  exit 1
fi

if ! command -v op >/dev/null 2>&1; then
  echo "ERROR: 1Password CLI (op) not found. Install it and sign in first." >&2
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: supabase CLI not found." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running. 'supabase db dump' runs pg_dump inside a container." >&2
  exit 1
fi

# stderr is NOT merged into these captures (no 2>&1) — op writing a stray
# warning to stderr on an otherwise-successful read must not silently end
# up concatenated into the captured secret value. Only exit status decides
# success/failure here; op's own stderr still reaches the terminal directly
# for the operator to see.
DB_URL="$(op read "op://Viadal Event Manager/Supabase Sports Event Manager prod/db connection string" --account extrapreneurab.1password.com)" || {
  echo "ERROR: could not read the prod DB connection string from 1Password." >&2
  echo "Expected a field named 'db connection string' on the item" >&2
  echo "'Supabase Sports Event Manager prod' in the 'Viadal Event Manager' vault." >&2
  echo "Get it from the Supabase Dashboard (prod project -> Connect -> Session pooler)" >&2
  echo "and add it there first — this script does not derive or guess it." >&2
  exit 1
}

BLOB_CONN_STR="$(op read "op://Viadal Event Manager/Azure Blob sportsevtmgrprodsnaps/password" --account extrapreneurab.1password.com)" || {
  echo "ERROR: could not read the Azure Blob connection string from 1Password." >&2
  exit 1
}

TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
SNAPSHOT_PREFIX="${MIGRATION_NUMBER}_pre-migration_${TIMESTAMP}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

echo "==> Dumping prod database (roles, schema, data)..."
echo "    Migration: ${MIGRATION_NUMBER}"
echo "    Timestamp: ${TIMESTAMP}"
echo "    Workdir:   ${WORKDIR}"

supabase db dump --db-url "${DB_URL}" -f "${WORKDIR}/roles.sql" --role-only
supabase db dump --db-url "${DB_URL}" -f "${WORKDIR}/schema.sql"
supabase db dump --db-url "${DB_URL}" -f "${WORKDIR}/data.sql" --use-copy --data-only

echo "==> Compressing dump..."
ARCHIVE_NAME="${SNAPSHOT_PREFIX}.tar.gz"
tar -czf "${WORKDIR}/${ARCHIVE_NAME}" -C "${WORKDIR}" roles.sql schema.sql data.sql

ARCHIVE_SIZE="$(du -h "${WORKDIR}/${ARCHIVE_NAME}" | cut -f1)"
echo "    Archive size: ${ARCHIVE_SIZE}"

echo "==> Uploading to Azure Blob Storage (container: db-snapshots)..."
az storage blob upload \
  --connection-string "${BLOB_CONN_STR}" \
  --container-name db-snapshots \
  --name "${ARCHIVE_NAME}" \
  --file "${WORKDIR}/${ARCHIVE_NAME}" \
  --only-show-errors

echo "==> Verifying upload..."
az storage blob show \
  --connection-string "${BLOB_CONN_STR}" \
  --container-name db-snapshots \
  --name "${ARCHIVE_NAME}" \
  --query "{name:name, size:properties.contentLength, lastModified:properties.lastModified}" \
  --output table

echo ""
echo "=============================================================================="
echo "SNAPSHOT COMPLETE"
echo "  Blob name: ${ARCHIVE_NAME}"
echo ""
echo "Reference this filename on migration ${MIGRATION_NUMBER}'s Forward-fix"
echo "'Data:' line before pushing to prod. Restore with:"
echo "  scripts/ops/restore-prod-db.sh ${ARCHIVE_NAME}"
echo "=============================================================================="

#!/usr/bin/env bash
# ==============================================================================
# scripts/ops/restore-prod-db.sh
#
# Downloads a snapshot created by scripts/ops/snapshot-prod-db.sh and restores
# it. See F-REL-20 in docs/quality-requirements.md.
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
#   - 1Password CLI (`op`), signed in
#   - psql (part of a full Postgres install)
#
# USAGE:
#   scripts/ops/restore-prod-db.sh <blob-name> <target-db-url>
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
# This script will refuse to run if <target-db-url> looks like it points at
# the prod project ref (rauvaxuypujbeintnnoe) or hostname pattern — see the
# GUARD below. There is no override flag. If you genuinely need to restore
# onto prod, do it by hand with psql, deliberately, not through this script.
# ==============================================================================

set -euo pipefail

BLOB_NAME="${1:-}"
TARGET_DB_URL="${2:-}"

if [[ -z "${BLOB_NAME}" || -z "${TARGET_DB_URL}" ]]; then
  echo "Usage: $0 <blob-name> <target-db-url>" >&2
  echo "  e.g.: $0 0048_pre-migration_2026-09-08T14-30-00Z.tar.gz \"postgresql://postgres:postgres@localhost:54322/postgres\"" >&2
  exit 1
fi

# GUARD: refuse anything that looks like the prod project. No override.
if [[ "${TARGET_DB_URL}" == *"rauvaxuypujbeintnnoe"* ]]; then
  echo "ERROR: target-db-url looks like the PROD Supabase project (rauvaxuypujbeintnnoe)." >&2
  echo "This script will not restore onto prod. Restore by hand with psql if you" >&2
  echo "deliberately intend to overwrite prod during a live incident." >&2
  exit 1
fi

if ! command -v op >/dev/null 2>&1; then
  echo "ERROR: 1Password CLI (op) not found." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found. Install the PostgreSQL client tools." >&2
  exit 1
fi

BLOB_CONN_STR="$(op read "op://Sports Event Manager/Azure Blob sportsevtmgrprodsnaps/password" 2>&1)" || {
  echo "ERROR: could not read the Azure Blob connection string from 1Password." >&2
  exit 1
}

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

echo ""
echo "About to restore onto:"
echo "  ${TARGET_DB_URL}"
echo ""
read -r -p "Type 'restore' to confirm: " CONFIRMATION
if [[ "${CONFIRMATION}" != "restore" ]]; then
  echo "Aborted."
  exit 1
fi

echo "==> Restoring (roles, schema, data — single transaction)..."
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "${WORKDIR}/roles.sql" \
  --file "${WORKDIR}/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "${WORKDIR}/data.sql" \
  --dbname "${TARGET_DB_URL}"

echo ""
echo "=============================================================================="
echo "RESTORE COMPLETE onto: ${TARGET_DB_URL}"
echo "Verify row counts / spot-check tables before trusting this restore."
echo "=============================================================================="

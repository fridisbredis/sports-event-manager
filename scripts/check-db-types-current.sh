#!/usr/bin/env bash
#
# Fails if src/types/database.ts does not match what `npm run db:types` produces
# — ignoring the one field that is not part of the schema.
#
# WHY THIS EXISTS
#
# The deploy workflows regenerate the types and fail if the result differs from
# what is committed. That gate is worth having: it catches a migration that
# landed without its types being regenerated, which is how `any` casts and
# wrong nullability get into the codebase.
#
# But `supabase gen types` also emits the PostgREST version of whichever
# instance answered:
#
#   __InternalSupabase: {
#     PostgrestVersion: '14.5'
#   }
#
# The MINOR of that value is infrastructure, not schema. It has flipped between
# '14.5' and '14.17' on the dev project alone — '14.5' originally, '14.17' from
# the PERF-04 commit, '14.5' again as of 2026-08-31 — with no migration
# involved. The MAJOR is not cosmetic and is still compared: postgrest-js gates
# two type-level feature flags on it, so a 14.x -> 15.x move has to fail this
# gate rather than slip past it.
# Every flip fails the gate on the next merge to main and blocks the deploy
# until someone commits a one-line change that describes nothing about this
# codebase. It fails the deploy AFTER the migration has already been applied,
# which is the worst moment to be blocked by a cosmetic diff.
#
# It also makes the gate impossible to check before merging: PR CI never
# applies the migration, and `supabase gen types --local` reports the local
# container's PostgREST version, which differs from dev's again.
#
# So: compare everything the schema determines, ignore the version line.
# A real schema drift — a new table, a changed column, different nullability —
# still fails, because it appears outside this field.

set -euo pipefail

TYPES_FILE="src/types/database.ts"

if [[ ! -f "$TYPES_FILE" ]]; then
  echo "$TYPES_FILE does not exist — nothing to check." >&2
  exit 1
fi

# Masks the MINOR of PostgrestVersion and keeps the major. Anchored to the field
# name, so a version string appearing anywhere else in the file is still compared.
#
# The major is load-bearing: @supabase/postgrest-js gates MaxAffectedEnabled and
# SpreadOnManyEnabled on it (src/types/feature-flags.ts), branching on the major
# prefix alone -- `PostgrestVersion extends \`14${string}\``. So 14.5 <-> 14.17 is
# genuinely inert, which is the churn this exists to absorb, but a 14.x -> 15.x
# move (or a downgrade to 12.x) flips both flags. Blanking the whole value would
# let exactly that through silently, which is the drift the gate is for.
strip_version() {
  sed -E "s/(PostgrestVersion: ')([0-9]+)\.[^']*(')/\1\2.IGNORED\3/"
}

# `npm run db:types` has already overwritten the working tree by the time this
# runs, so the freshly generated types are on disk and the reviewed ones are in
# HEAD. Read from HEAD rather than the index so the check does not depend on
# whether anything has been staged.
generated=$(strip_version < "$TYPES_FILE")
committed=$(git show "HEAD:$TYPES_FILE" 2>/dev/null | strip_version || true)

if [[ -z "$committed" ]]; then
  echo "Could not read $TYPES_FILE from HEAD." >&2
  exit 1
fi

if [[ "$generated" == "$committed" ]]; then
  # Restore the committed version so the deploy builds the reviewed file rather
  # than one carrying a stray version bump.
  git checkout -- "$TYPES_FILE"
  echo "$TYPES_FILE is current (PostgrestVersion ignored — it reflects the"
  echo "responding instance, not the schema)."
  exit 0
fi

echo "$TYPES_FILE is out of date."
echo
echo "Run 'npm run db:types' locally and commit the result."
echo
echo "The PostgrestVersion field is excluded from this comparison, so the diff"
echo "below is a real schema difference — a table, column, nullability or"
echo "relationship that the committed types do not describe:"
echo
diff <(echo "$committed") <(echo "$generated") || true
exit 1

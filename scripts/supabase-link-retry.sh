#!/usr/bin/env bash
# Link the Supabase CLI to a project, retrying on transient API failures.
#
# `supabase link` is a network call to the Supabase Management API with no
# retry of its own, and it is the FIRST thing both deploy workflows do. A
# momentary blip there takes down the whole deploy before a single migration
# is read. That is not hypothetical: run 37429666160 (dev, 2026-10-06) died
# after 15s with
#
#   Unexpected error retrieving remote project status:
#   {"message":"FGA Authentication Error. Unauthorized", "errorEventId":...}
#
# and the next two pushes, with no change to the token, the project ref or
# the CLI version, linked fine. FGA is Supabase's authorization service, so
# a wobble there surfaces as "Unauthorized" even when the token is healthy
# -- the message describes the answer the server could not produce, not a
# real permission problem.
#
# Retrying is safe because `link` is idempotent: it resolves the project and
# writes supabase/.temp/, and re-running it just overwrites that with the
# same values.
#
# A genuinely bad token also returns 401, and this will dutifully retry it
# three times before failing. That costs ~12 wasted seconds on a deploy that
# was doomed anyway, which is a good trade for not losing healthy deploys to
# a one-second blip. The error output is printed on every attempt so the
# distinction stays visible in the log.
set -euo pipefail

PROJECT_REF="${1:?usage: supabase-link-retry.sh <project-ref>}"

ATTEMPTS=3
DELAY=5

for i in $(seq 1 "$ATTEMPTS"); do
  # Must not be fatal on its own: this script runs under `set -e`, so an
  # uncaught non-zero exit from `link` would abort before the retry.
  if supabase link --project-ref "$PROJECT_REF"; then
    echo "Linked to $PROJECT_REF (attempt $i)"
    exit 0
  fi

  if [ "$i" -lt "$ATTEMPTS" ]; then
    echo "supabase link failed (attempt $i/$ATTEMPTS), retrying in ${DELAY}s..."
    sleep "$DELAY"
  fi
done

echo "::error::supabase link failed after $ATTEMPTS attempts. If every attempt reported an auth error, check that the SUPABASE_ACCESS_TOKEN secret is still valid and belongs to an account with access to $PROJECT_REF."
exit 1

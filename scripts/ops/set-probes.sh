#!/usr/bin/env bash
# ==============================================================================
# scripts/ops/set-probes.sh
#
#   ##########################################################################
#   #  ONE-TIME, MANUALLY-RUN SCRIPT.  DO NOT CALL FROM ANY DEPLOY WORKFLOW.  #
#   ##########################################################################
#
# WHY THIS MUST NEVER RUN IN CI / A DEPLOY JOB
# ------------------------------------------------------------------------------
# Azure Container Apps has no dedicated CLI flags for health probes — probes
# can only be set by supplying a full resource definition via `--yaml`. That
# matters for automation because `az containerapp create --yaml <file>` is
# documented to say:
#
#     "All other parameters will be ignored."
#
# i.e. if a deploy step ever ran something like
#     az containerapp create --yaml probes.yaml --image myimage:$SHA
# the --image value would be silently dropped and the deploy would exit 0
# without actually deploying the new image - a silent no-op, which is worse
# than a loud failure.
#
# PRECISION ABOUT WHAT IS AND ISN'T VERIFIED:
#   - The "all other parameters ignored" behaviour above is CONFIRMED, but
#     only for `az containerapp create --yaml`.
#   - This script uses `az containerapp update --yaml` (see APPLY below), and
#     the equivalent behaviour for `update` has NOT been verified - the CLI
#     reference page for `update` was never fetched while writing this
#     script. Do not assume `update` behaves the same as `create` either way.
#     If you are extending this script, or wiring anything like it into
#     automation, run `az containerapp update --help` and read the current
#     docs for --yaml first.
#
# Because of that uncertainty, this script protects itself regardless of how
# `update --yaml` actually behaves: it exports the app's current live
# configuration first and builds the probe change on top of that export (see
# PRE-FLIGHT EXPORT below), so the image tag, replica settings and env vars
# it applies are the ones already running - not some other stale or default
# set that "all other parameters ignored" could otherwise clobber.
#
# THAT PROTECTION DOES NOT EXTEND TO SECRETS. `az containerapp show` returns
# `.properties.configuration.secrets` as names only - values are always
# omitted from a `show`/export response, which is exactly why `az
# containerapp secret list --show-values` exists as a separate command. So
# the export this script builds on is never a faithful copy of secrets (it
# is faithful for image tag / replicas / env vars, just not this one field).
# Re-applying it as-is would risk blanking real secret values, including the
# ACR pull credential for sportsevtmgrprod.azurecr.io. See the jq del() in
# the update-building pipeline below, which strips
# .properties.configuration.secrets and .properties.configuration.registries
# from the payload entirely, and the SECRETS ASSERTION immediately after it,
# which fails loudly if either field is still present in the built payload -
# rather than trying to guess or merge real secret values back in.
# ------------------------------------------------------------------------------
#
# WHAT THIS SCRIPT DOES
#   1. Exports the current prod Container App config to a local backup file.
#   2. Builds an updated copy of that export with liveness / readiness /
#      startup probes added, all pointed at /api/health/live - see PROBE
#      CONFIG below for why never /api/health.
#   3. Prompts for confirmation, then applies via `az containerapp update
#      --yaml`.
#   4. Reads the probe config back with `az containerapp show` so you can
#      confirm the change rather than assume it worked.
#
# Run this by hand, once, after review. Re-running it is not dangerous (it
# always re-exports current state first) but there should be no routine need
# to.
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# PROBE CONFIG - why /api/health/live and never /api/health
# ------------------------------------------------------------------------------
# /api/health queries Supabase. In Azure Container Apps a READINESS probe
# failure RESTARTS the replica - unlike vanilla Kubernetes, where a failed
# readiness probe just pulls the replica out of rotation without restarting
# it. If probes pointed at the DB-backed endpoint, a Supabase outage would
# fail readiness on every replica at once, ACA would restart all of them,
# they would come back up, immediately fail the DB check again, and restart
# again - a permanent restart loop that turns a partial outage (DB down, app
# otherwise fine) into a total one (app never stable enough to serve
# anything).
#
# Confirmed against Microsoft's own docs, not just inferred:
# https://learn.microsoft.com/en-us/azure/container-apps/health-probes -
# "A revision state appears as unhealthy if any of its replicas fails its
# readiness probe check... Container Apps restarts the replica in question
# until it's healthy again or the failure threshold is exceeded."
#
# The DB-down signal still needs to reach someone - that's the job of the
# 5xx-count metric alert in create-alerts.sh (health returns 503 on DB
# failure, which passes through as a 5xx), not a probe.
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# CONFIG - override via environment variables if reusing this script for a
# different environment. Defaults below are prod (see .claude/CLAUDE.md).
# ------------------------------------------------------------------------------
SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-dc64af83-c062-48db-abae-4cb73a478bb2}"
RESOURCE_GROUP="${RESOURCE_GROUP:-sports-event-manager-prod-rg}"
APP_NAME="${APP_NAME:-sports-event-manager-prod}"
TARGET_PORT="${TARGET_PORT:-3000}"
HEALTH_PATH="${HEALTH_PATH:-/api/health/live}"

# Startup probe grace period = failureThreshold * periodSeconds.
# ACA's *implicit* default, when no `probes` array is configured at all, is
# 240 * 1 = 240s (~4 min) of cold-start grace. The moment a `probes` array is
# defined explicitly - which this script does, to repoint probes at
# /api/health/live - any field not set explicitly falls back to the API's
# own much shorter default instead of that implicit 240x1 grace. So these
# two MUST be set explicitly here, or this script would silently recreate
# the Phase 5 incident from .claude/CLAUDE.md Lessons Learned ("Probe of
# StartUp failed with status code: 1" - prod fell back to the hello-world
# placeholder revision because the probe gave up too early during cold
# start).
#
# The implicit 240x1 default CANNOT be reproduced literally, though - the
# Azure Container Apps ARM schema (ContainerApps stable/2025-07-01
# CommonDefinitions.json, ContainerAppProbe) caps failureThreshold at a
# MAXIMUM of 10 (min 1) and periodSeconds at a maximum of 240 (min 1). A
# genuine oddity: Azure's own portal-injected implicit default (240x1)
# is itself above the maximum its public schema permits for an explicit
# probe. So the same 240s of total grace has to be reassembled from
# different factors that both stay within range:
#   failureThreshold=10 (the schema max) * periodSeconds=24 = 240s total,
# same grace as before, but legal. Do not set STARTUP_FAILURE_THRESHOLD
# above 10 or STARTUP_PERIOD_SECONDS above 240 - the API will either
# reject the value outright or (worse, silently) clamp it, which is what
# a naive 240x1 configuration risked doing to the failureThreshold here.
STARTUP_FAILURE_THRESHOLD="${STARTUP_FAILURE_THRESHOLD:-10}"
STARTUP_PERIOD_SECONDS="${STARTUP_PERIOD_SECONDS:-24}"
# Arithmetic: 10 * 24 = 240 seconds (~4 minutes) of startup grace - matches,
# rather than shrinks, the previous implicit default, while staying inside
# the schema's failureThreshold<=10 / periodSeconds<=240 limits above.

# Liveness / readiness: steady-state values, not the cold-start allowance.
# 3 * 10 = 30s of consecutive failures before ACA acts. Set explicitly for
# the same reason as the startup probe above - no implicit default should be
# relied on once any probe is explicitly configured.
LIVENESS_FAILURE_THRESHOLD="${LIVENESS_FAILURE_THRESHOLD:-3}"
LIVENESS_PERIOD_SECONDS="${LIVENESS_PERIOD_SECONDS:-10}"
# NOTE: a READINESS probe failure in ACA also restarts the replica (see
# PROBE CONFIG above) - it does not just derotate it like vanilla
# Kubernetes. Keep this threshold conservative; a flaky /api/health/live
# under load would cause avoidable restarts, not just avoidable derotation.
READINESS_FAILURE_THRESHOLD="${READINESS_FAILURE_THRESHOLD:-3}"
READINESS_PERIOD_SECONDS="${READINESS_PERIOD_SECONDS:-10}"

# ------------------------------------------------------------------------------
# SCHEMA BOUNDS SANITY CHECK - every *_FAILURE_THRESHOLD / *_PERIOD_SECONDS
# above can be overridden via environment variable, so a hardcoded default
# being legal is not enough; an override could still smuggle an
# out-of-range value through to the apply step. Enforce the same ARM schema
# limits here that motivated the startup 10x24 split above (Azure
# ContainerApps stable/2025-07-01 CommonDefinitions.json, ContainerAppProbe):
# failureThreshold and successThreshold in [1,10], periodSeconds and
# timeoutSeconds in [1,240]. This script never sets successThreshold or
# timeoutSeconds explicitly (they fall back to the API's own defaults,
# which are within range), so only failureThreshold/periodSeconds need
# checking here.
# ------------------------------------------------------------------------------
for pair in \
  "STARTUP_FAILURE_THRESHOLD:$STARTUP_FAILURE_THRESHOLD:1:10" \
  "STARTUP_PERIOD_SECONDS:$STARTUP_PERIOD_SECONDS:1:240" \
  "LIVENESS_FAILURE_THRESHOLD:$LIVENESS_FAILURE_THRESHOLD:1:10" \
  "LIVENESS_PERIOD_SECONDS:$LIVENESS_PERIOD_SECONDS:1:240" \
  "READINESS_FAILURE_THRESHOLD:$READINESS_FAILURE_THRESHOLD:1:10" \
  "READINESS_PERIOD_SECONDS:$READINESS_PERIOD_SECONDS:1:240"
do
  IFS=":" read -r name value min max <<< "$pair"
  # Integer check FIRST. [[ ]] evaluates -lt arithmetically, so a non-integer
  # never reaches the range test intact: "3.5" raises a bash arithmetic syntax
  # error and the test evaluates false, so BOTH comparisons fall through and
  # the value is reported in range, then handed to --argjson. "0x9" is worse -
  # bash reads it as hex 9, passes [1,10] legitimately, and then breaks jq
  # mid-run because 0x9 is not valid JSON.
  #
  # Leading zeros are rejected too, rather than normalised: the payload below
  # reads $STARTUP_FAILURE_THRESHOLD and friends directly, not this loop's
  # $value, so normalising here would fix nothing and "08" would still reach
  # --argjson as invalid JSON. In a probe threshold a leading zero is a typo,
  # not an input worth accepting.
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: ${name}=${value} is not a positive integer without leading zeros." >&2
    echo "Probe thresholds are written into the update payload as JSON numbers; a" >&2
    echo "non-integer override would either be silently accepted as an out-of-range" >&2
    echo "value or abort this script mid-apply. Set an integer in [${min}, ${max}]." >&2
    exit 1
  fi
  if [[ "$value" -lt "$min" || "$value" -gt "$max" ]]; then
    echo "ERROR: ${name}=${value} is outside the ARM schema's legal range [${min}, ${max}]." >&2
    echo "Azure will reject or silently clamp an out-of-range probe value - see the STARTUP" >&2
    echo "grace comment above for why 240 alone is no longer a legal failureThreshold." >&2
    exit 1
  fi
done

# ------------------------------------------------------------------------------
# PRE-FLIGHT CHECKS
# ------------------------------------------------------------------------------
if ! command -v az >/dev/null 2>&1; then
  echo "ERROR: az CLI not found on PATH. Install/configure the Azure CLI before running this script." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq not found on PATH. This script edits the exported config with jq (not yq) because jq" >&2
  echo "is the tool confirmed present on this project's machines; install jq before running this script." >&2
  exit 1
fi

echo "Setting subscription context to ${SUBSCRIPTION_ID}..."
az account set --subscription "$SUBSCRIPTION_ID"

# ------------------------------------------------------------------------------
# PRE-FLIGHT EXPORT - protects against the create/update --yaml uncertainty
# above no matter how it resolves: the YAML we apply is always built from a
# fresh export of what's actually running, so image tag / replicas / env
# vars travel with the request instead of being left to chance.
# ------------------------------------------------------------------------------
TMP_DIR="${TMPDIR:-/tmp}"
BACKUP_FILE="$(mktemp "${TMP_DIR}/containerapp-${APP_NAME}-backup-XXXXXX.yaml")"
UPDATED_FILE="$(mktemp "${TMP_DIR}/containerapp-${APP_NAME}-with-probes-XXXXXX.yaml")"
# Both files hold JSON content saved with a .yaml extension: JSON is a valid
# subset of YAML, `az containerapp ... --yaml` accepts it, and this lets the
# script use jq instead of depending on yq (not confirmed installed
# anywhere for this project).

echo "Exporting current config for '${APP_NAME}' (resource group '${RESOURCE_GROUP}')..."
az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --output json > "$BACKUP_FILE"

echo "Backup of current live config written to: ${BACKUP_FILE}"
echo "(keep this until the change below is confirmed - it is the fastest path back to the exact prior config if needed)"

CONTAINER_COUNT=$(jq '.properties.template.containers | length' "$BACKUP_FILE")
if [[ "$CONTAINER_COUNT" -ne 1 ]]; then
  echo "ERROR: expected exactly 1 container in .properties.template.containers, found ${CONTAINER_COUNT}." >&2
  echo "This script assumes a single-container app (this repo's Dockerfile builds one Next.js container)" >&2
  echo "and doesn't know which container the probes should attach to. Aborting without making any change." >&2
  exit 1
fi

echo "Building updated config with probes pointed at ${HEALTH_PATH}:${TARGET_PORT}..."
jq \
  --arg path "$HEALTH_PATH" \
  --argjson port "$TARGET_PORT" \
  --argjson startupFailureThreshold "$STARTUP_FAILURE_THRESHOLD" \
  --argjson startupPeriodSeconds "$STARTUP_PERIOD_SECONDS" \
  --argjson livenessFailureThreshold "$LIVENESS_FAILURE_THRESHOLD" \
  --argjson livenessPeriodSeconds "$LIVENESS_PERIOD_SECONDS" \
  --argjson readinessFailureThreshold "$READINESS_FAILURE_THRESHOLD" \
  --argjson readinessPeriodSeconds "$READINESS_PERIOD_SECONDS" \
  '
  # Strip read-only / computed ARM fields that a live GET carries but that a
  # subsequent update call should not be asked to re-set. id / systemData /
  # provisioningState are near-universal ARM read-only fields; the rest are
  # Container-Apps-specific computed values. This list is general defensive
  # practice for the export-edit-reapply pattern, not a confirmed-required
  # list from Azure support.
  #
  # .properties.configuration.secrets and .properties.configuration.registries
  # are ALSO stripped here, deliberately, not just defensively: `az
  # containerapp show` returns secret values as omitted (never the real
  # value), so if this payload re-declared secrets at all it would be
  # re-declaring them with empty/absent values - including the ACR pull
  # credential for sportsevtmgrprod.azurecr.io, which was configured via `az
  # containerapp registry set` and is stored as one of these secrets. Instead
  # of declaring-and-then-gating-on that risk, remove the fields from the
  # payload entirely so the update call never mentions secrets/registries at
  # all. See SECRETS ASSERTION below for the one part of this that is not
  # verified.
  del(
    .id, .systemData,
    .properties.provisioningState,
    .properties.runningStatus,
    .properties.latestRevisionName,
    .properties.latestReadyRevisionName,
    .properties.latestRevisionFqdn,
    .properties.customDomainVerificationId,
    .properties.outboundIPs,
    .properties.eventStreamEndpoint,
    .properties.configuration.ingress.fqdn,
    .properties.configuration.secrets,
    .properties.configuration.registries
  )
  |
  .properties.template.containers[0].probes = [
    {
      type: "Startup",
      httpGet: { path: $path, port: $port, scheme: "HTTP" },
      failureThreshold: $startupFailureThreshold,
      periodSeconds: $startupPeriodSeconds
    },
    {
      type: "Liveness",
      httpGet: { path: $path, port: $port, scheme: "HTTP" },
      failureThreshold: $livenessFailureThreshold,
      periodSeconds: $livenessPeriodSeconds
    },
    {
      type: "Readiness",
      httpGet: { path: $path, port: $port, scheme: "HTTP" },
      failureThreshold: $readinessFailureThreshold,
      periodSeconds: $readinessPeriodSeconds
    }
  ]
  ' \
  "$BACKUP_FILE" > "$UPDATED_FILE"

echo "Updated config (not yet applied) written to: ${UPDATED_FILE}"

# ------------------------------------------------------------------------------
# SECRETS ASSERTION - `az containerapp show` returns secret NAMES only;
# values are always omitted from the export (that's why `az containerapp
# secret list --show-values` exists as a separate command). If $UPDATED_FILE
# declared secrets at all, applying it would re-declare them with empty/
# absent values - including the ACR pull credential for
# sportsevtmgrprod.azurecr.io, which was configured via `az containerapp
# registry set` and is stored as one of these secrets.
#
# The del() in the jq pipeline above already strips
# .properties.configuration.secrets and .properties.configuration.registries
# from $UPDATED_FILE, so that risk should not exist by the time we get here.
# This check is deliberately checked against $UPDATED_FILE, not
# $BACKUP_FILE - checking the backup would just re-detect that the *live*
# app has secrets (always true, since prod's ACR credential is one), which
# is expected and fine; it says nothing about what the jq pipeline above
# actually produced. Checking $UPDATED_FILE turns this into a real invariant
# assertion: "the payload we are about to apply must carry no secrets or
# registries keys at all." If this fires, it means the del() above failed to
# do its job - a bug in this script, not something an operator did wrong.
#
# ONE RESIDUAL UNKNOWN, stated honestly rather than assumed away (same
# hedged style as the `update --yaml` caveat at the top of this file): it is
# NOT verified whether `az containerapp update --yaml` treats an ABSENT
# `.properties.configuration.secrets` key (rather than an explicit `[]`) as
# "leave the existing secrets alone" or as "clear them". If it turns out to
# mean "clear them", run_credential_check (defined just before the apply, and
# armed there as an EXIT trap so it runs even if the apply itself fails)
# detects it and exits non-zero naming every secret that disappeared, with the
# `az containerapp registry set` remedy. So the outcome is detected rather
# than silent - but detection is after the fact, not prevention, and it
# compares secret NAMES only, since `show` never returns values. Still not
# proven safe in advance; see the SCOPE note in that function.
# ------------------------------------------------------------------------------
UPDATED_SECRET_COUNT=$(jq '(.properties.configuration.secrets // []) | length' "$UPDATED_FILE")
UPDATED_REGISTRIES_COUNT=$(jq '(.properties.configuration.registries // []) | length' "$UPDATED_FILE")
if [[ "$UPDATED_SECRET_COUNT" -gt 0 || "$UPDATED_REGISTRIES_COUNT" -gt 0 ]]; then
  echo "ERROR: \$UPDATED_FILE still declares ${UPDATED_SECRET_COUNT} secret(s) and" >&2
  echo "${UPDATED_REGISTRIES_COUNT} registrie(s) after the jq del() that is supposed to strip both -" >&2
  echo "that del() should have removed .properties.configuration.secrets and" >&2
  echo ".properties.configuration.registries entirely. This is a bug in this script's jq" >&2
  echo "pipeline, not an operator problem. Aborting without making any change." >&2
  echo "Exported (unmodified) backup is still at: ${BACKUP_FILE}" >&2
  echo "Updated (not applied) config is at: ${UPDATED_FILE}" >&2
  exit 1
fi

# ------------------------------------------------------------------------------
# CONFIRM AND APPLY
# ------------------------------------------------------------------------------
echo ""
echo "About to update probes on Container App '${APP_NAME}' (resource group '${RESOURCE_GROUP}', subscription ${SUBSCRIPTION_ID})."
echo "New liveness/readiness/startup probes will target HTTP GET ${HEALTH_PATH} on port ${TARGET_PORT}."
echo "Startup grace period: ${STARTUP_FAILURE_THRESHOLD} x ${STARTUP_PERIOD_SECONDS}s = $((STARTUP_FAILURE_THRESHOLD * STARTUP_PERIOD_SECONDS))s."
read -r -p "Type the app name (${APP_NAME}) to continue, anything else aborts: " CONFIRM
if [[ "$CONFIRM" != "$APP_NAME" ]]; then
  echo "Aborted - confirmation did not match. No changes were applied." >&2
  echo "Exported (unmodified) backup is still at: ${BACKUP_FILE}" >&2
  exit 1
fi

# ------------------------------------------------------------------------------
# CREDENTIAL-SURVIVAL CHECK - defined here, and armed as an EXIT trap, BEFORE
# the apply below.
#
# The check diffs the live config against $BACKUP_FILE (the pre-change GET
# taken above) and fails if anything present before is missing now. What
# matters is WHEN it runs. An earlier version ran it inline at the very end of
# the VERIFY section, after the startup-probe grace assertion. That left two
# `exit 1`s and one `az containerapp show` between the apply and the check, so
# under `set -euo pipefail` it never ran in three of the cases it exists for:
#
#   - the apply itself exits non-zero (a partial apply - the case where a
#     credential wipe is MOST likely),
#   - the probe read-back GET fails,
#   - the applied probe config does not match what was requested.
#
# Reordering alone fixes only the last two. The trap is what covers a failed
# apply, because nothing after `az containerapp update` runs at all then. So:
# armed immediately before the apply - NOT at the top of the script, since
# every pre-flight abort above this point applied nothing, and a credential
# diff after those would print a reassuring report about a change that never
# happened - and invoked inline immediately after the apply so its output
# appears in reading order on a normal run. $CREDENTIAL_CHECK_DONE stops it
# running twice.
#
# The handler obeys three rules a naive `trap ... EXIT` does not:
#
#   1. It captures $? FIRST and exits with it, so a probe-assertion failure or
#      a failed apply keeps its own exit code instead of being masked by the
#      handler's own success.
#   2. It runs under `set +e` so it cannot die half-way through its own
#      report - but see rule 3, because `set +e` is also what would let it lie.
#   3. It distinguishes "the secret is gone" from "I could not read the live
#      config". Under `set +e` a failed `az containerapp show` leaves the
#      after-list EMPTY, which is indistinguishable from a total wipe: the
#      diff would then report every secret as missing and send an operator to
#      run `az containerapp registry set` against a perfectly healthy app. An
#      expired token, throttling, or whatever just killed the apply are all
#      routes into exactly that. So the GET is checked before its result is
#      interpreted, and an unreadable config reports "could not verify"
#      (exit 2), never "missing".
#
# Interrupts: the INT/TERM trap below sets a flag AND exits explicitly. Ctrl-C
# during the apply - the operator watching it hang and losing nerve - is
# exactly when the credential state matters most. Without an INT trap the
# shell dies without running the check. With an INT trap that only sets a flag
# and does not exit, Ctrl-C would stop terminating the script at all. And the
# code has to be set explicitly: the usual `trap - INT; kill -INT $$` re-raise
# runs the EXIT handler a second time and double-prints the report.
# ------------------------------------------------------------------------------
INTERRUPTED=0
CREDENTIAL_CHECK_DONE=0
CREDENTIAL_CHECK_RC=0

# 0 = intact | 1 = loss detected | 2 = could not verify
run_credential_check() {
  CREDENTIAL_CHECK_DONE=1
  local live_json secrets_before secrets_after missing_secrets
  local registries_before registries_after secret_count secret_name

  echo ""
  echo "Verifying secrets and registry wiring survived the apply..."

  # One GET serves both comparisons, so each diff has the same shape on both
  # sides - a full-object export against a full-object export, rather than an
  # export on one side and a --query projection on the other.
  #
  # Names only, never --show-values: that would print secret values to the
  # terminal and into any CI log capturing this script's output.
  if ! live_json=$(az containerapp show \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --output json 2>/dev/null) || [[ -z "$live_json" ]]; then
    echo "WARNING: could not read the live config back after the apply, so whether the" >&2
    echo "secrets and the ACR pull credential survived is UNKNOWN. This is NOT a report" >&2
    echo "that they are intact, and NOT a report that they are gone. Check by hand" >&2
    echo "before the next prod deploy:" >&2
    echo "  az containerapp secret list --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --output table" >&2
    echo "  az containerapp show --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --query properties.configuration.registries" >&2
    echo "Pre-change config is at: ${BACKUP_FILE}" >&2
    return 2
  fi

  # `| tr -d '\r'` is load-bearing, not cosmetic. jq on Git Bash / msys (the
  # Windows dev machines for this project) writes CRLF, and these two are
  # MULTI-LINE outputs. A single-value `$(jq ...)` is safe because command
  # substitution strips the whole trailing CRLF, but in a multi-line list every
  # line except the last keeps its \r. `read -r` then leaves that \r in the
  # name while msys grep strips \r from its input, so `grep -qxF` fails to
  # match and EVERY secret except the last is reported missing - a false wipe
  # report on a completely healthy app, sending the operator to re-run
  # `az containerapp registry set` for nothing. Observed, not theoretical:
  # this check reported acr-password and cron-secret gone on a clean run
  # before the tr was added.
  secrets_before=$(jq -r '[.properties.configuration.secrets // [] | .[].name] | sort | .[]' "$BACKUP_FILE" | tr -d '\r')
  secrets_after=$(jq -r '[.properties.configuration.secrets // [] | .[].name] | sort | .[]' <<< "$live_json" | tr -d '\r')

  missing_secrets=""
  while IFS= read -r secret_name; do
    [[ -z "$secret_name" ]] && continue
    if ! grep -qxF "$secret_name" <<< "$secrets_after"; then
      missing_secrets+="  - ${secret_name}"$'\n'
    fi
  done <<< "$secrets_before"

  if [[ -n "$missing_secrets" ]]; then
    echo "ERROR: secret(s) present before this update are missing from the live config now:" >&2
    printf '%s' "$missing_secrets" >&2
    echo "The update payload deliberately strips .properties.configuration.secrets, and" >&2
    echo "these names are no longer on the live app. Stated as observed, not as settled" >&2
    echo "Azure semantics: whether an absent key means 'clear' is still unverified, and a" >&2
    echo "concurrent change by someone else is another explanation. Either way, act now." >&2
    echo "" >&2
    echo "If the ACR pull credential is among them, restore it before the next deploy:" >&2
    echo "  az containerapp registry set --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} \\" >&2
    echo "    --server <acr-login-server> --username <username> --password <password>" >&2
    echo "Credentials for sportsevtmgrprod are in 1Password as 'ACR sportsevtmgrprod'." >&2
    echo "Pre-change config is at: ${BACKUP_FILE}" >&2
    return 1
  fi

  # Same tr for the same reason. Both sides would carry CRLF identically here,
  # so the comparison happens to survive without it - but relying on "both
  # sides are broken the same way" is not a property worth depending on.
  registries_before=$(jq -S '.properties.configuration.registries // []' "$BACKUP_FILE" | tr -d '\r')
  registries_after=$(jq -S '.properties.configuration.registries // []' <<< "$live_json" | tr -d '\r')

  if [[ "$registries_before" != "$registries_after" ]]; then
    echo "ERROR: registry configuration changed across this update." >&2
    echo "Before: ${registries_before}" >&2
    echo "After:  ${registries_after}" >&2
    echo "An image pull will fail on the next deploy. Restore with 'az containerapp registry set'." >&2
    echo "Pre-change config is at: ${BACKUP_FILE}" >&2
    return 1
  fi

  # [SCOPE] This compares secret NAMES and the registry block, because `az
  # containerapp show` never returns secret VALUES. A blanked value under a
  # surviving name would pass. If the next prod deploy fails at image pull
  # despite this reporting intact, that is the case to suspect.
  secret_count=$(grep -c . <<< "$secrets_before" || true)
  echo "Secret names intact (${secret_count} present before and after); registry wiring unchanged."
  echo "(Names and registry block only - secret VALUES are never returned by 'show'.)"
  return 0
}

credential_check_trap() {
  local rc=$?
  set +e
  if [[ "$CREDENTIAL_CHECK_DONE" -eq 0 ]]; then
    run_credential_check
    local check_rc=$?
    if [[ "$rc" -eq 0 && "$check_rc" -ne 0 ]]; then
      rc=$check_rc
    fi
  fi
  if [[ "$INTERRUPTED" -eq 1 ]]; then
    echo "" >&2
    echo "Interrupted. The credential report above is the state as of the interrupt." >&2
    exit 130
  fi
  exit "$rc"
}

trap 'INTERRUPTED=1; exit 130' INT TERM
trap credential_check_trap EXIT

echo "Applying update..."
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --yaml "$UPDATED_FILE" \
  --output none

# Credential check FIRST, before the probe read-back below - see the block
# above for why the order matters. A DETECTED LOSS stops here (exit 1): a
# wiped ACR pull credential needs acting on now, and the probe config can
# still be read back by hand with the command in
# docs/ops/operational-readiness.md section 7. "COULD NOT VERIFY" (2) does
# not stop here - the probe read-back is still worth having - but it is
# re-asserted before "Done." so this run cannot report success while the
# credential state is unknown.
CREDENTIAL_CHECK_RC=0
run_credential_check || CREDENTIAL_CHECK_RC=$?
if [[ "$CREDENTIAL_CHECK_RC" -eq 1 ]]; then
  exit 1
fi

# ------------------------------------------------------------------------------
# VERIFY - read the config back rather than assume the update worked.
# ------------------------------------------------------------------------------
echo ""
echo "Reading back applied probe config for confirmation:"
PROBES_JSON=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.template.containers[0].probes" \
  --output json)
echo "$PROBES_JSON" | jq .

# Real assertion, not just a printout: the previous version of this script
# printed the probe config and stopped, so a silent API clamp (e.g.
# failureThreshold accepted but capped below what was requested) would
# never be noticed. Read back the applied Startup probe's actual
# failureThreshold/periodSeconds and confirm their product still equals the
# intended grace period - if Azure clamped either value, this will not
# match and the script exits non-zero instead of reporting false success.
APPLIED_STARTUP_FAILURE_THRESHOLD=$(echo "$PROBES_JSON" | jq '[.[] | select(.type == "Startup")][0].failureThreshold')
APPLIED_STARTUP_PERIOD_SECONDS=$(echo "$PROBES_JSON" | jq '[.[] | select(.type == "Startup")][0].periodSeconds')
INTENDED_STARTUP_GRACE=$((STARTUP_FAILURE_THRESHOLD * STARTUP_PERIOD_SECONDS))
if [[ "$APPLIED_STARTUP_FAILURE_THRESHOLD" == "null" || "$APPLIED_STARTUP_PERIOD_SECONDS" == "null" ]]; then
  echo "ERROR: no Startup probe found in the applied config - the update did not apply as expected." >&2
  exit 1
fi
APPLIED_STARTUP_GRACE=$((APPLIED_STARTUP_FAILURE_THRESHOLD * APPLIED_STARTUP_PERIOD_SECONDS))
if [[ "$APPLIED_STARTUP_GRACE" -ne "$INTENDED_STARTUP_GRACE" ]]; then
  echo "ERROR: applied Startup probe grace (${APPLIED_STARTUP_FAILURE_THRESHOLD} x ${APPLIED_STARTUP_PERIOD_SECONDS}s = ${APPLIED_STARTUP_GRACE}s)" >&2
  echo "does not match the intended grace (${STARTUP_FAILURE_THRESHOLD} x ${STARTUP_PERIOD_SECONDS}s = ${INTENDED_STARTUP_GRACE}s)." >&2
  echo "Azure may have clamped a value on apply. Investigate before relying on this probe config." >&2
  exit 1
fi
echo "Startup probe grace confirmed: ${APPLIED_STARTUP_FAILURE_THRESHOLD} x ${APPLIED_STARTUP_PERIOD_SECONDS}s = ${APPLIED_STARTUP_GRACE}s (matches intended)."

# The credential-survival check already ran immediately after the apply, and
# is also armed as an EXIT trap, so it runs even if this script died before
# reaching that call. All that is left here is making sure a "could not
# verify" result cannot be walked past.
if [[ "$CREDENTIAL_CHECK_RC" -ne 0 ]]; then
  echo "" >&2
  echo "ERROR: the probes applied and verified, but the credential-survival check could" >&2
  echo "not be completed (see the warning above). Do not treat this run as finished" >&2
  echo "until the secrets and registry wiring have been confirmed by hand." >&2
  exit "$CREDENTIAL_CHECK_RC"
fi

echo ""
echo "Done. Backup of the pre-change config remains at: ${BACKUP_FILE}"
echo "To re-run this same verification query later by hand:"
echo "  az containerapp show --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --query \"properties.template.containers[0].probes\" --output jsonc"
echo "  az containerapp secret list --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --output table"
echo "  az containerapp show --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --query \"properties.configuration.registries\" --output jsonc"

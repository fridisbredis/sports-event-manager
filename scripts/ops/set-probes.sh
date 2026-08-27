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
STARTUP_FAILURE_THRESHOLD="${STARTUP_FAILURE_THRESHOLD:-240}"
STARTUP_PERIOD_SECONDS="${STARTUP_PERIOD_SECONDS:-1}"
# Arithmetic: 240 * 1 = 240 seconds (~4 minutes) of startup grace - matches,
# rather than shrinks, the previous implicit default.

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
    .properties.configuration.ingress.fqdn
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

echo "Applying update..."
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --yaml "$UPDATED_FILE" \
  --output none

# ------------------------------------------------------------------------------
# VERIFY - read the config back rather than assume the update worked.
# ------------------------------------------------------------------------------
echo ""
echo "Reading back applied probe config for confirmation:"
az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.template.containers[0].probes" \
  --output jsonc

echo ""
echo "Done. Backup of the pre-change config remains at: ${BACKUP_FILE}"
echo "To re-run this same verification query later by hand:"
echo "  az containerapp show --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --query \"properties.template.containers[0].probes\" --output jsonc"

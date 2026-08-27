#!/usr/bin/env bash
# ==============================================================================
# scripts/ops/create-alerts.sh
#
# Sets up baseline Azure Monitor alerting for the prod Container App: one
# email action group, plus three metric alerts wired to it (5xx errors,
# replicas pinned at the max, and container restarts).
#
# Run this by hand. It is NOT called from any deploy workflow. Every
# create call below is an upsert keyed on --name + --resource-group (action
# group create, and metric alert create both work this way), so re-running
# this script is safe - it re-applies the same config rather than creating
# duplicates.
#
# SCOPE NOTE: this does not create an Application Insights resource. Azure
# Monitor already collects Requests / Replicas / RestartCount for Container
# Apps platform-side. App Insights would be for custom/app-level telemetry -
# a separate concern from these three infra-level alerts.
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# REQUIRED - recipient for all three alerts. Intentionally has NO default:
# this script must not invent or ship a placeholder address. Export it
# before running:
#   export ALERT_EMAIL="oncall@example.com"
#   ./scripts/ops/create-alerts.sh
# ------------------------------------------------------------------------------
ALERT_EMAIL="${ALERT_EMAIL:?Set ALERT_EMAIL to the alert recipient address before running this script, e.g. export ALERT_EMAIL=\"oncall@example.com\"}"

# ------------------------------------------------------------------------------
# CONFIG - prod defaults from .claude/CLAUDE.md; override via environment
# variables if reusing this script for a different environment.
# ------------------------------------------------------------------------------
SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-dc64af83-c062-48db-abae-4cb73a478bb2}"
RESOURCE_GROUP="${RESOURCE_GROUP:-sports-event-manager-prod-rg}"
APP_NAME="${APP_NAME:-sports-event-manager-prod}"

ACTION_GROUP_NAME="${ACTION_GROUP_NAME:-ag-sports-event-manager-prod}"
# Azure Monitor caps the action group "short name" (used as the SMS/email
# subject tag) at 12 characters - keep any override under that.
ACTION_GROUP_SHORT_NAME="${ACTION_GROUP_SHORT_NAME:-semprod}"
ACTION_GROUP_EMAIL_RECEIVER_NAME="${ACTION_GROUP_EMAIL_RECEIVER_NAME:-oncall-email}"

# Replica ceiling used by ALERT 2's saturation condition (see below). NOT
# hardcoded here - it is read from the live Container App's
# properties.template.scale.maxReplicas at MAX_REPLICAS DISCOVERY, below the
# PRE-FLIGHT CHECKS, since that requires an `az` call this script hasn't
# made yet at this point in the file. MAX_REPLICAS remains an explicit env
# var override for anyone who needs to set it without touching the live
# app. "Pinned at the current ceiling" is the best available saturation
# signal, not a scientifically derived one - revisit once PERF-01 produces a
# measured per-replica capacity figure.

WINDOW_SIZE="${WINDOW_SIZE:-15m}"
EVALUATION_FREQUENCY="${EVALUATION_FREQUENCY:-5m}"

# ------------------------------------------------------------------------------
# PRE-FLIGHT CHECKS
# ------------------------------------------------------------------------------
if ! command -v az >/dev/null 2>&1; then
  echo "ERROR: az CLI not found on PATH. Install/configure the Azure CLI before running this script." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq not found on PATH. RECEIVER CHECK below needs jq to inspect every receiver type" >&2
  echo "(email/SMS/webhook/etc.), not just emailReceivers - jq is the tool confirmed present on this" >&2
  echo "project's machines (see scripts/ops/set-probes.sh); install jq before running this script." >&2
  exit 1
fi

echo "Setting subscription context to ${SUBSCRIPTION_ID}..."
az account set --subscription "$SUBSCRIPTION_ID"

CONTAINER_APP_ID=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query id --output tsv)
echo "Target Container App resource id: ${CONTAINER_APP_ID}"

# ------------------------------------------------------------------------------
# MAX_REPLICAS DISCOVERY - read the live ceiling instead of hardcoding it.
# This used to be a hardcoded default of 3, duplicating --max-replicas 3 in
# deploy-prod.yml with nothing linking the two. PERF-05 just moved the
# replica floor (min-replicas 1 -> 2) in that same workflow, which is
# exactly the kind of change that could silently desync a hardcoded copy
# here: if --max-replicas is ever raised in deploy-prod.yml without a
# matching change to this script, ALERT 2's "min Replicas >= MAX_REPLICAS"
# saturation condition would keep firing at the OLD, lower ceiling - a
# false-positive generator once traffic legitimately grows toward the new,
# real one. Reading properties.template.scale.maxReplicas directly from the
# running app removes that duplication; MAX_REPLICAS above is kept only as
# an explicit override for cases where reading the live value isn't
# appropriate (e.g. testing against a different app).
# ------------------------------------------------------------------------------
DISCOVERED_MAX_REPLICAS=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.template.scale.maxReplicas" \
  --output tsv 2>/dev/null || echo "")
# Only abort when discovery failed AND no explicit override was supplied.
# Checking $MAX_REPLICAS here is load-bearing, not belt-and-braces: without
# it the abort below fires before the ${MAX_REPLICAS:-...} fallback on the
# next line is ever reached, so the remedy this error message prints ("set
# MAX_REPLICAS explicitly and re-run") would not actually change the
# outcome - a re-run with MAX_REPLICAS exported would hit the identical
# hard-fail. A gate whose printed escape route doesn't work is worse than
# no gate, because it sends the operator in circles.
if [[ -z "${MAX_REPLICAS:-}" \
      && ( -z "$DISCOVERED_MAX_REPLICAS" || "$DISCOVERED_MAX_REPLICAS" == "null" ) ]]; then
  echo "ERROR: could not read properties.template.scale.maxReplicas from '${APP_NAME}'." >&2
  echo "Either the app has no scale.maxReplicas set, or the query failed. This script will not" >&2
  echo "guess a saturation ceiling - set MAX_REPLICAS explicitly and re-run, e.g.:" >&2
  echo "  export MAX_REPLICAS=3" >&2
  exit 1
fi
MAX_REPLICAS="${MAX_REPLICAS:-$DISCOVERED_MAX_REPLICAS}"
echo "Replica ceiling for saturation alert: ${MAX_REPLICAS} (live value on '${APP_NAME}': ${DISCOVERED_MAX_REPLICAS:-<unreadable>})"

# ------------------------------------------------------------------------------
# ACTION GROUP - create idempotently. No action group exists yet anywhere
# for this project (verified before writing this script), so a script that
# assumed one already existed would fail on first run. `az monitor
# action-group create` upserts on --name + --resource-group, so this is
# also safe to re-run if the recipient email ever needs to change.
#
# CAUTION - "upsert" here means REPLACE, not MERGE: the --action flags on a
# given `create` call become the entire receiver set, full stop. If anyone
# ever adds a second recipient by hand through the Azure portal, the next
# run of this script silently deletes it - this script only ever knows
# about $ALERT_EMAIL. PERF-05 alerting is single-email today, so this has
# not bitten yet, but it will the first time a second person is added
# outside this script. The RECEIVER CHECK below guards against that by
# refusing to proceed quietly if more receivers already exist than this
# script is about to set.
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# RECEIVER CHECK - read existing receivers before the replace-not-merge
# create call above can delete them. Must tolerate the action group not
# existing yet (the normal first-run case, not an error) - under `set -e` a
# failing command substitution would otherwise abort the whole script, so
# stderr is suppressed and a failure is treated as "no existing receivers"
# by falling back to an empty object / "{}".
#
# Checks every receiver category Azure Monitor action groups support, not
# just emailReceivers - properties.emailReceivers alone misses SMS, webhook,
# ARM-role, Azure Function, Logic App, voice, event hub, app-push, and ITSM
# receivers. Any of those added by hand through the portal is exactly what
# the replace-not-merge `create` call below would silently delete if this
# check only ever looked at emailReceivers.
#
# Gated on "the existing receiver set differs from what this script is
# about to apply" (one email receiver, name=$ACTION_GROUP_EMAIL_RECEIVER_NAME,
# address=$ALERT_EMAIL, nothing else) rather than on a receiver count > 1.
# A count-based gate let two holes through: (a) it never looked outside
# emailReceivers, so a single non-email receiver was invisible to it, and
# (b) "exactly one email receiver, but a DIFFERENT address than
# $ALERT_EMAIL" also has a count of 1 and was let through unchallenged, even
# though proceeding would silently replace that receiver's address. Diffing
# against the intended end state catches both, while still not prompting on
# a normal first run (nothing exists yet) or a plain re-run (existing state
# already matches what this script would set).
# ------------------------------------------------------------------------------
EXISTING_PROPERTIES_JSON=$(az monitor action-group show \
  --name "$ACTION_GROUP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties" \
  --output json 2>/dev/null || echo "{}")

RECEIVERS_DIFFER_FROM_INTENDED=$(echo "$EXISTING_PROPERTIES_JSON" | jq -r \
  --arg name "$ACTION_GROUP_EMAIL_RECEIVER_NAME" \
  --arg email "$ALERT_EMAIL" \
  '
  def count(key): (.[key] // []) | length;
  (count("smsReceivers") + count("webhookReceivers") + count("armRoleReceivers") +
   count("azureFunctionReceivers") + count("logicAppReceivers") + count("voiceReceivers") +
   count("eventHubReceivers") + count("azureAppPushReceivers") + count("itsmReceivers")) as $nonEmailCount
  | ((.emailReceivers // [])) as $emails
  | ($emails | length) as $emailCount
  | ($emailCount == 1 and $emails[0].name == $name and $emails[0].emailAddress == $email) as $emailMatchesIntended
  | (($nonEmailCount > 0) or ($emailCount > 1) or ($emailCount == 1 and ($emailMatchesIntended | not)))
  ')

if [[ "$RECEIVERS_DIFFER_FROM_INTENDED" == "true" ]]; then
  EXISTING_RECEIVERS_SUMMARY=$(echo "$EXISTING_PROPERTIES_JSON" | jq '{
    emailReceivers: (.emailReceivers // []),
    smsReceivers: (.smsReceivers // []),
    webhookReceivers: (.webhookReceivers // []),
    armRoleReceivers: (.armRoleReceivers // []),
    azureFunctionReceivers: (.azureFunctionReceivers // []),
    logicAppReceivers: (.logicAppReceivers // []),
    voiceReceivers: (.voiceReceivers // []),
    eventHubReceivers: (.eventHubReceivers // []),
    azureAppPushReceivers: (.azureAppPushReceivers // []),
    itsmReceivers: (.itsmReceivers // [])
  }')
  echo "WARNING: action group '${ACTION_GROUP_NAME}' has receivers that differ from what this script is about to set:" >&2
  echo "${EXISTING_RECEIVERS_SUMMARY}" >&2
  echo "" >&2
  echo "'az monitor action-group create' REPLACES the entire receiver set - it does not merge." >&2
  echo "Proceeding will delete everything shown above except a single email receiver for ${ALERT_EMAIL}." >&2
  read -r -p "Type the app name (${APP_NAME}) to continue, anything else aborts: " CONFIRM
  if [[ "$CONFIRM" != "$APP_NAME" ]]; then
    echo "Aborted - confirmation did not match. No changes were applied." >&2
    exit 1
  fi
fi

echo "Creating/updating action group '${ACTION_GROUP_NAME}'..."
az monitor action-group create \
  --name "$ACTION_GROUP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --short-name "$ACTION_GROUP_SHORT_NAME" \
  --action email "$ACTION_GROUP_EMAIL_RECEIVER_NAME" "$ALERT_EMAIL" \
  --output none

ACTION_GROUP_ID=$(az monitor action-group show \
  --name "$ACTION_GROUP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query id --output tsv)
echo "Action group id: ${ACTION_GROUP_ID}"

# ------------------------------------------------------------------------------
# ALERT 1 - 5xx errors: COUNT, not RATE.
#
# On a low-traffic app, an error RATE (errors / total requests) gets diluted
# by whatever healthy traffic is also flowing, and can fail to cross a
# percentage threshold even while real errors are happening. An absolute
# COUNT doesn't have that problem: this fires on "at least 2 five-hundred
# class responses in 15 minutes", full stop, regardless of total traffic.
#
# Aggregation note: the condition below uses `total` (sum of request
# occurrences across the window), NOT Azure Monitor's `count` aggregation
# keyword. For a pre-aggregated metric like Requests, Monitor's `count`
# aggregation means "number of metric samples received" - an unrelated
# number. `total` is what actually sums how many 5xx requests occurred.
#
# This is also how a Supabase/DB outage surfaces: /api/health returns 503 on
# DB failure (see set-probes.sh for why the probes themselves target the
# DB-free /api/health/live instead), that 503 passes through ingress as a
# 5xx, and is caught by this same alert. No separate DB-outage alert is
# needed.
#
# Dimension-filter keyword: this uses `includes` (lowercase) for the
# StatusCodeCategory filter. az CLI's metric-alert dimension-filter syntax
# has differed across versions/docs (e.g. `Include`/`IncludeAny` elsewhere).
# This was not verified against a live `az` (none available while writing
# this script) - if this create fails with a parse error on --condition,
# check `az monitor metrics alert create --help` for the current keyword.
# ------------------------------------------------------------------------------
echo "Creating/updating alert: 5xx errors..."
az monitor metrics alert create \
  --name "alert-sem-prod-5xx-errors" \
  --resource-group "$RESOURCE_GROUP" \
  --scopes "$CONTAINER_APP_ID" \
  --condition "total Requests where StatusCodeCategory includes '5xx' >= 2" \
  --window-size "$WINDOW_SIZE" \
  --evaluation-frequency "$EVALUATION_FREQUENCY" \
  --severity 1 \
  --action "$ACTION_GROUP_ID" \
  --description "Fires when >= 2 responses categorised as 5xx are recorded on ${APP_NAME} within ${WINDOW_SIZE}. Also the surfacing path for DB outages (see /api/health's 503-on-DB-failure behaviour)." \
  --output none

# ------------------------------------------------------------------------------
# ALERT 2 - replicas pinned at the ceiling.
#
# Aggregation is `min`, deliberately, not `avg` or `max`: `min Replicas >=
# MAX_REPLICAS` over the window only fires if the replica count never
# dropped below the ceiling for the ENTIRE window - sustained saturation.
# `avg` could still fire on a value that dipped and recovered, and `max`
# would fire on a single instantaneous spike. Neither of those is "sitting
# at the ceiling for 15 minutes".
# ------------------------------------------------------------------------------
echo "Creating/updating alert: replicas at max..."
az monitor metrics alert create \
  --name "alert-sem-prod-replicas-at-max" \
  --resource-group "$RESOURCE_GROUP" \
  --scopes "$CONTAINER_APP_ID" \
  --condition "min Replicas >= ${MAX_REPLICAS}" \
  --window-size "$WINDOW_SIZE" \
  --evaluation-frequency "$EVALUATION_FREQUENCY" \
  --severity 2 \
  --action "$ACTION_GROUP_ID" \
  --description "Fires when replica count has not dropped below the current ceiling (${MAX_REPLICAS}) for a full ${WINDOW_SIZE} - sustained saturation, not a brief spike. Ceiling is provisional; revisit once PERF-01 has a measured per-replica capacity figure." \
  --output none

# ------------------------------------------------------------------------------
# ALERT 3 - restarts.
#
# Same `total` (sum-in-window) reasoning as Alert 1: this sums restart
# occurrences across the window rather than counting metric samples, so it
# reads as "at least 3 container restarts within 15 minutes" - a
# crash-loop signal.
# ------------------------------------------------------------------------------
echo "Creating/updating alert: restarts..."
az monitor metrics alert create \
  --name "alert-sem-prod-restarts" \
  --resource-group "$RESOURCE_GROUP" \
  --scopes "$CONTAINER_APP_ID" \
  --condition "total RestartCount >= 3" \
  --window-size "$WINDOW_SIZE" \
  --evaluation-frequency "$EVALUATION_FREQUENCY" \
  --severity 1 \
  --action "$ACTION_GROUP_ID" \
  --description "Fires when RestartCount sums to >= 3 within ${WINDOW_SIZE} on ${APP_NAME} - a crash-loop signal." \
  --output none

# ------------------------------------------------------------------------------
# VERIFY - list what's actually configured rather than assume the creates
# above worked.
# ------------------------------------------------------------------------------
echo ""
echo "Action group:"
az monitor action-group show \
  --name "$ACTION_GROUP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --output jsonc

echo ""
echo "Metric alerts on ${APP_NAME}:"
az monitor metrics alert list \
  --resource-group "$RESOURCE_GROUP" \
  --query "[?contains(scopes[0], '${APP_NAME}')].{name:name, severity:severity, enabled:enabled, description:description}" \
  --output table

echo ""
echo "Done."

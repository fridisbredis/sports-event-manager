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

# Provisional replica ceiling - matches the current prod --max-replicas (see
# .claude/CLAUDE.md prod facts). Revisit once PERF-01 produces a measured
# per-replica capacity figure; until then, "pinned at the current ceiling"
# is the best available saturation signal, not a scientifically derived one.
MAX_REPLICAS="${MAX_REPLICAS:-3}"

WINDOW_SIZE="${WINDOW_SIZE:-15m}"
EVALUATION_FREQUENCY="${EVALUATION_FREQUENCY:-5m}"

# ------------------------------------------------------------------------------
# PRE-FLIGHT CHECKS
# ------------------------------------------------------------------------------
if ! command -v az >/dev/null 2>&1; then
  echo "ERROR: az CLI not found on PATH. Install/configure the Azure CLI before running this script." >&2
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
# ACTION GROUP - create idempotently. No action group exists yet anywhere
# for this project (verified before writing this script), so a script that
# assumed one already existed would fail on first run. `az monitor
# action-group create` upserts on --name + --resource-group, so this is
# also safe to re-run if the recipient email ever needs to change.
# ------------------------------------------------------------------------------
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

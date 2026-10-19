// Per-environment infra identifiers used to build console deep links.
// Grouped here rather than inlined in page.tsx so a future environment
// change (new subscription, project move) is a one-line edit.

// The Supabase project ref is the subdomain of the project's API URL, so it
// doesn't need its own constant — this derives it instead of duplicating it.
// Named for what it returns, not an assumed environment: this app can be
// pointed at dev, prod, perf, or a local Docker stack via
// NEXT_PUBLIC_SUPABASE_URL, and the health page must show whichever one it
// actually is, not assume dev.
//
// A function, not a module-level constant: reading env at import time makes
// every test importing this module (even indirectly) need the var set.
export function currentSupabaseProjectRef() {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    ? 'local (Docker)'
    : url.hostname.split('.')[0]
}

// Not derivable from any env var available to this app — see CLAUDE.md's
// Infrastructure section for where these come from.
export const AZURE_SUBSCRIPTION_ID = 'dc64af83-c062-48db-abae-4cb73a478bb2'
export const AZURE_DEV_RESOURCE_GROUP = 'sports-event-manager-dev-rg'
export const AZURE_PROD_RESOURCE_GROUP = 'sports-event-manager-prod-rg'

// The Azure AD tenant domain, required in the portal URL's #@ segment — an
// empty segment only happens to resolve for a single-tenant signed-in user,
// not the canonical link (az account show --query tenantDefaultDomain).
export const AZURE_TENANT_DOMAIN = 'extrapreneur.se'

export function azurePortalResourceGroupUrl(resourceGroup: string) {
  return `https://portal.azure.com/#@${AZURE_TENANT_DOMAIN}/resource/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${resourceGroup}/overview`
}

// The Container App resource names, needed both for the ARM status probe and
// to deep-link the portal at the app itself rather than its resource group.
// Verified against `az containerapp list` on 2026-10-13.
//
// Note that sports-event-manager-perf also lives in the dev resource group;
// it is deliberately not surfaced here, since the health page reports on the
// two environments that serve users, not the throwaway perf rig.
export const AZURE_DEV_CONTAINER_APP = 'sports-event-manager-dev'
export const AZURE_PROD_CONTAINER_APP = 'sports-event-manager-prod'

export function azurePortalContainerAppUrl(resourceGroup: string, containerApp: string) {
  return `https://portal.azure.com/#@${AZURE_TENANT_DOMAIN}/resource/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${resourceGroup}/providers/Microsoft.App/containerApps/${containerApp}/overview`
}

// ─── Database backups (N9) ──────────────────────────────────────────────────
//
// The Supabase organisation is on the Pro plan (verified against the
// Management API, 2026-10-19), which includes daily automated backups with
// seven days of retention. Nothing in this repo produces those — the platform
// does, and there is no runtime credential here that could ask it about them.
//
// So this is a documented fact with a deep link, not a live probe: the health
// page states what the plan provides and sends the operator to the dashboard
// to see the actual list. Inventing an "ok" status from a constant would be
// worse than saying plainly where the truth lives.
//
// Retention is SEVEN days, not the thirty the requirement on card N9 asks
// for. Closing that gap costs money (the PITR add-on, or running our own
// nightly dump pipeline) and is Peter's call, tracked on the card.
//
// Not to be confused with scripts/ops/snapshot-prod-db.sh: that is a manual
// pre-migration dump for REL-04, taken before a destructive migration, and it
// is not a schedule and not a backup policy.
export const SUPABASE_PLAN = 'pro'
export const SUPABASE_BACKUP_RETENTION_DAYS = 7
export const SUPABASE_BACKUP_FREQUENCY = 'daily'

export function supabaseBackupsUrl(projectRef: string) {
  return `https://supabase.com/dashboard/project/${projectRef}/database/backups/scheduled`
}

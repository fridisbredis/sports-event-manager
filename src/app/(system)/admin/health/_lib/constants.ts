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

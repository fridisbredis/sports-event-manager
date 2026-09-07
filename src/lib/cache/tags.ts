// Cache tags for PERF-06 / F-PERF-04 (ADR-0003). One helper per cached shape
// so the tag string is defined once and can't drift between the page that
// registers it (unstable_cache) and the mutation sites that invalidate it
// (revalidateTag).

export function officialHomeCacheTag(tenantId: string, userId: string): string {
  return `tenant-${tenantId}-official-${userId}-home`
}

export function eventInfoCacheTag(tenantId: string): string {
  return `tenant-${tenantId}-event-info`
}

export function adminEventCacheTag(tenantId: string): string {
  return `tenant-${tenantId}-admin-event`
}

export function workstationsCacheTag(tenantId: string): string {
  return `tenant-${tenantId}-admin-workstations`
}

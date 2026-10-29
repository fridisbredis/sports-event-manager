// N23: every event-scoped admin screen lives under
// /[tenantSlug]/admin/events/[eventId]/…, so a link names the event it is for
// instead of each page discovering "the tenant's event". Pure and client-safe:
// server pages, server actions and client components all build paths here.

export type AdminEventSegment =
  | 'dashboard'
  | 'event'
  | 'workstations'
  | 'officials'
  | 'participants'
  | 'scheduling'
  | 'communication'

export function adminEventPath(tenantSlug: string, eventId: string, subpath = ''): string {
  const base = `/${tenantSlug}/admin/events/${eventId}`
  return subpath ? `${base}/${subpath.replace(/^\/+/, '')}` : base
}

// The route patterns behind adminEventPath, for revalidatePath(pattern,
// 'page'). A server action that only knows the tenant can then refresh the
// screen without being told which event the caller was looking at.
export function adminEventRoutePattern(subpath: string): string {
  return `/[tenantSlug]/admin/events/[eventId]/${subpath.replace(/^\/+/, '')}`
}

// N23: the official surfaces of one event live under
// /[tenantSlug]/events/[eventId]/… (home, event-info, schedule,
// announcements, availability); the picker is /[tenantSlug]/events.
export function officialEventPath(tenantSlug: string, eventId: string, subpath = ''): string {
  const base = `/${tenantSlug}/events/${eventId}`
  return subpath ? `${base}/${subpath.replace(/^\/+/, '')}` : base
}

export function officialEventRoutePattern(subpath: string): string {
  return `/[tenantSlug]/events/[eventId]/${subpath.replace(/^\/+/, '')}`
}

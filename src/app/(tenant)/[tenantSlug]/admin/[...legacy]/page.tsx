import { notFound, redirect } from 'next/navigation'
import { getDefaultAdminEventId } from '@/lib/events/admin-event'
import { adminEventPath } from '@/lib/events/paths'

interface Props {
  params: Promise<{ tenantSlug: string; legacy: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// N23: before events had their own URL segment the admin screens lived at
// /[tenantSlug]/admin/dashboard, /admin/scheduling, … — in bookmarks, in
// e-mails, in the post-login redirect of a deployed client. Those land here
// (account and events are static siblings, so they never do) and are sent to
// the same screen of the tenant's default event, query string included.
//
// The admin check is the layout's; getDefaultAdminEventId repeats it and
// returns null for a caller who is not this tenant's admin.
const LEGACY_SEGMENTS = new Set([
  'dashboard',
  'event',
  'workstations',
  'officials',
  'participants',
  'scheduling',
  'communication',
])

export default async function LegacyAdminRedirect({ params, searchParams }: Props) {
  const { tenantSlug, legacy } = await params
  if (!LEGACY_SEGMENTS.has(legacy[0])) notFound()

  const eventId = await getDefaultAdminEventId(tenantSlug)
  if (!eventId) redirect(`/${tenantSlug}/admin`)

  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, v)
    }
  }
  const search = query.size > 0 ? `?${query.toString()}` : ''

  redirect(
    `${adminEventPath(tenantSlug, eventId, legacy.map(encodeURIComponent).join('/'))}${search}`
  )
}

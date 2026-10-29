import { notFound, redirect } from 'next/navigation'
import { getSoleOfficialEventId } from '@/lib/events/official-event'
import { officialEventPath } from '@/lib/events/paths'

interface Props {
  params: Promise<{ tenantSlug: string; legacy: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// N23: official screens used to live at /[tenantSlug]/home, /schedule, … —
// in links already sent by SMS, in home-screen shortcuts, in the post-login
// redirect of a deployed client. They land here (account, events and admin
// are static siblings, so they never do). With one event the official goes
// straight to the same screen of it, query string included; with several
// they pick one first. The parent layout has checked access to the tenant.
const LEGACY_SEGMENTS = new Set(['home', 'event-info', 'schedule', 'announcements', 'availability'])

export default async function LegacyOfficialRedirect({ params, searchParams }: Props) {
  const { tenantSlug, legacy } = await params
  if (!LEGACY_SEGMENTS.has(legacy[0])) notFound()

  const eventId = await getSoleOfficialEventId(tenantSlug)
  if (!eventId) redirect(`/${tenantSlug}/events`)

  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, v)
    }
  }
  const search = query.size > 0 ? `?${query.toString()}` : ''

  redirect(
    `${officialEventPath(tenantSlug, eventId, legacy.map(encodeURIComponent).join('/'))}${search}`
  )
}

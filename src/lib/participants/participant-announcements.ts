import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getEventInfoCached } from '@/lib/events/event-info-cached'
import { isParticipantSideOpen } from '@/lib/events/participant-side'
import { pageRange, splitPage } from '@/lib/pagination'
import type { ResolvedParticipantTenant } from '@/lib/auth/tenant'

// N44: ANN-02, the participant channel's timeline. Tenant-wide like PAR-01:
// a runner sees one list for every event they are entered in, and only the
// events whose participant side is open (PB3, PB7). A closed event's
// announcements stay in the database and come back when it reopens.

export interface ParticipantAnnouncement {
  id: string
  body: string
  publishedAt: string
  // Named only when the runner has more than one open event; with one, every
  // announcement is about the event they already know.
  eventName: string | null
}

export type ParticipantAnnouncements =
  // Every one of the caller's events is closed: the page says "not available
  // right now" rather than "no announcements", which would be untrue.
  { open: false } | { open: true; items: ParticipantAnnouncement[]; hasMore: boolean }

// Errors are thrown, never read as "nothing there" (F-REL-10).
export async function loadParticipantAnnouncements(
  tenant: ResolvedParticipantTenant,
  page: number
): Promise<ParticipantAnnouncements> {
  const eventIds = [...new Set(tenant.entries.map((e) => e.eventId))]
  const infos = await Promise.all(eventIds.map((id) => getEventInfoCached(tenant.id, id)))

  const openEvents = new Map<string, string>()
  eventIds.forEach((id, i) => {
    const event = infos[i].event
    if (event && isParticipantSideOpen(event, tenant.tier)) openEvents.set(id, event.name ?? '')
  })

  if (openEvents.size === 0) return { open: false }

  // Through the caller's session: event_participant_read_announcements (N43)
  // limits it to the participant channel of events they are entered in. The
  // filters say the same in the app and keep closed events out.
  const supabase = await createSupabaseServerClient()
  const { from, to } = pageRange(page)
  const { data, error } = await supabase
    .from('announcements')
    .select('id, event_id, body, published_at')
    .eq('tenant_id', tenant.id)
    .eq('channel', 'participants')
    .in('event_id', [...openEvents.keys()])
    .order('published_at', { ascending: false })
    .range(from, to)

  if (error) throw error

  const { items, hasMore } = splitPage(data ?? [])
  const several = openEvents.size > 1

  return {
    open: true,
    hasMore,
    items: items.map((a) => ({
      id: a.id,
      body: a.body,
      publishedAt: a.published_at,
      eventName: several ? (openEvents.get(a.event_id) ?? null) : null,
    })),
  }
}

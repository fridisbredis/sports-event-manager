import { cache } from 'react'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant, hasAdminScreens } from '@/lib/auth/tenant'
import { officialEventPath } from '@/lib/events/paths'

const eventIdSchema = z.string().uuid()

export type OfficialEventSummary = {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  status: string
  // N23: added to this event since the official last opened it — the
  // in-app notice that replaces an SMS (seen_at NULL on the membership).
  isNew: boolean
}

// N23: the events a caller may open on the official surfaces of a tenant.
//
// An official sees the events they are a member of (official_events), and
// nothing else in the tenant — Peter's isolation rule. A tenant admin or
// system admin looking at the official view sees every event, as they do in
// admin. Archived events are left out: they are locked and finished.
//
// Ordered latest first, which is also the order the picker shows them in.
export const listOfficialEvents = cache(
  async (tenantSlug: string): Promise<OfficialEventSummary[]> => {
    const tenant = await getOfficialTenant(tenantSlug)
    if (!tenant) return []

    const supabase = await createSupabaseServerClient()

    const seenByEvent = new Map<string, boolean>()
    if (tenant.officialId) {
      const { data, error } = await supabase
        .from('official_events')
        .select('event_id, seen_at')
        .eq('official_id', tenant.officialId)
      if (error) throw error
      for (const m of data ?? []) seenByEvent.set(m.event_id, m.seen_at != null)
    }

    const isAdmin = await hasAdminScreens(tenantSlug)
    if (!isAdmin && seenByEvent.size === 0) return []

    let query = supabase
      .from('events')
      .select('id, name, start_date, end_date, status')
      .eq('tenant_id', tenant.id)
      .neq('status', 'archived')
    if (!isAdmin) query = query.in('id', [...seenByEvent.keys()])

    const { data, error } = await query
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
    if (error) throw error

    return (data ?? []).map((e) => ({
      ...e,
      isNew: seenByEvent.has(e.id) && !seenByEvent.get(e.id),
    }))
  }
)

// N35 (L5): the role a person holds in one event. Roles belong to the event
// membership, not to the user — official_events for an official, a linked
// participants row for a participant — so one account can be an official in
// one event and a participant in another, or both in the same event.
export type EventRole = 'official' | 'participant'

export type MemberEventSummary = OfficialEventSummary & {
  roles: EventRole[]
  // Whether the event has screens this caller can open. Participant screens
  // come with N43; until then a participant-only membership is listed but
  // not linked.
  canOpen: boolean
}

function byStartDateDesc(a: MemberEventSummary, b: MemberEventSummary): number {
  if (a.start_date === b.start_date) return 0
  if (a.start_date === null) return 1
  if (b.start_date === null) return -1
  return a.start_date < b.start_date ? 1 : -1
}

// N35: every event the caller is a member of in this tenant, with the role(s)
// they hold in each — what the event picker lists. The official events are
// listOfficialEvents' answer unchanged; the participant ones are the caller's
// own linked participants rows (participant_read_own), and the events row is
// readable to them through event_participant_read_events (migration
// 20261106120000). Archived events are left out, as for officials.
export const listMemberEvents = cache(async (tenantSlug: string): Promise<MemberEventSummary[]> => {
  const tenant = await getOfficialTenant(tenantSlug)
  if (!tenant) return []
  const user = await getCurrentUser()
  if (!user) return []

  const officialEvents = await listOfficialEvents(tenantSlug)

  const supabase = await createSupabaseServerClient()
  const { data: entries, error } = await supabase
    .from('participants')
    .select('event_id')
    .eq('tenant_id', tenant.id)
    .eq('user_id', user.id)
  if (error) throw error

  const participantEventIds = new Set((entries ?? []).map((p) => p.event_id))

  const members: MemberEventSummary[] = officialEvents.map((event) => ({
    ...event,
    roles: participantEventIds.has(event.id) ? ['official', 'participant'] : ['official'],
    canOpen: true,
  }))

  const participantOnlyIds = [...participantEventIds].filter(
    (id) => !officialEvents.some((event) => event.id === id)
  )
  if (participantOnlyIds.length > 0) {
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, name, start_date, end_date, status')
      .eq('tenant_id', tenant.id)
      .in('id', participantOnlyIds)
      .neq('status', 'archived')
    if (eventsError) throw eventsError
    for (const event of events ?? []) {
      members.push({ ...event, isNew: false, roles: ['participant'], canOpen: false })
    }
  }

  return members.sort(byStartDateDesc)
})

// The event named in an official URL, or null when the caller may not open
// it. The layout at /[tenantSlug]/events/[eventId] turns null into a 404.
// Archived events stay reachable by URL (a bookmark to last year's schedule)
// for members and admins; they are only left out of the picker.
export const getOfficialEvent = cache(
  async (tenantSlug: string, eventId: string): Promise<{ id: string } | null> => {
    if (!eventIdSchema.safeParse(eventId).success) return null

    const tenant = await getOfficialTenant(tenantSlug)
    if (!tenant) return null

    const supabase = await createSupabaseServerClient()

    if (!(await hasAdminScreens(tenantSlug))) {
      if (!tenant.officialId) return null
      const { data, error } = await supabase
        .from('official_events')
        .select('event_id')
        .eq('official_id', tenant.officialId)
        .eq('event_id', eventId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
    }

    const { data, error } = await supabase
      .from('events')
      .select('id')
      .eq('id', eventId)
      .eq('tenant_id', tenant.id)
      .maybeSingle()
    if (error) throw error
    return data
  }
)

// The event an official lands on when the URL names none (a pre-N23 link, an
// SMS sent before the move): their only event, or null when they have none or
// several and must pick.
export async function getSoleOfficialEventId(tenantSlug: string): Promise<string | null> {
  const events = await listOfficialEvents(tenantSlug)
  return events.length === 1 ? events[0].id : null
}

// Where "My shifts" on the participant surfaces leads: straight to the
// schedule when the caller has one event, the event picker when they have
// several. Mirrors the landing logic above so the link never asks the caller
// to pick when there is nothing to pick between.
export async function officialShiftsPath(tenantSlug: string): Promise<string> {
  const eventId = await getSoleOfficialEventId(tenantSlug)
  return eventId ? officialEventPath(tenantSlug, eventId, 'schedule') : `/${tenantSlug}/events`
}

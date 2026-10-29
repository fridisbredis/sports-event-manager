import { cache } from 'react'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOfficialTenant, hasAdminScreens } from '@/lib/auth/tenant'

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

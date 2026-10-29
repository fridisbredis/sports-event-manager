import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export const EVENT_STATUSES = ['draft', 'published', 'archived'] as const

export type EventStatus = (typeof EVENT_STATUSES)[number]

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === 'string' && (EVENT_STATUSES as readonly string[]).includes(value)
}

export type TenantEventSummary = {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  status: string
  stageCount: number
  officialsInvited: number
  officialsConfirmed: number
  participantCount: number
}

// N23 / TEN-01: one row per event of the tenant, with the core figures the
// tenant dashboard lists. One query: the counts come back as PostgREST
// embeds rather than one round trip per event.
//
// Takes the caller's client rather than creating one so it runs under the
// caller's RLS — the page passes the cookie client, and the integration test
// a signed-in tenant admin. The tenant filter is the app-side half of the
// defence in depth; RLS is the other.
//
// Officials are counted per event through official_events, the same
// membership the event dashboard counts (migration 20261028140031), so the
// two screens agree. An embed is not subject to PostgREST's top-level row
// limit, and an event's roster is tens of rows.
export async function readTenantEvents(
  supabase: SupabaseClient<Database>,
  tenantId: string
): Promise<TenantEventSummary[]> {
  const { data, error } = await supabase
    .from('events')
    .select(
      'id, name, start_date, end_date, status, event_stages(count), participants(count), official_events(officials(invite_status))'
    )
    .eq('tenant_id', tenantId)
    .order('start_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) throw error

  return data.map((event) => {
    const statuses = event.official_events.map((m) => m.officials?.invite_status)
    return {
      id: event.id,
      name: event.name,
      start_date: event.start_date,
      end_date: event.end_date,
      status: event.status,
      stageCount: event.event_stages[0]?.count ?? 0,
      participantCount: event.participants[0]?.count ?? 0,
      officialsInvited: statuses.filter((s) => s === 'invited').length,
      officialsConfirmed: statuses.filter((s) => s === 'confirmed').length,
    }
  })
}

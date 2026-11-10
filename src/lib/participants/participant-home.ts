import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getEventInfoCached } from '@/lib/events/event-info-cached'
import { isParticipantSideOpen } from '@/lib/events/participant-side'
import type { ResolvedParticipantTenant } from '@/lib/auth/tenant'

// N43: what PAR-01 shows — one block per event the caller is entered in, with
// a card per Race stage of that event (L16, O18), and the newest announcement
// on the participant channel across their open events (L28).

export interface ParticipantStage {
  id: string
  name: string
}

export interface ParticipantHomeEvent {
  eventId: string
  name: string
  // isParticipantSideOpen for this event. A closed event shows only the
  // "not available right now" notice (PB3) — no bib, no stages.
  open: boolean
  bib: string | null
  category: string | null
  raceResultsUrl: string | null
  stages: ParticipantStage[]
}

export interface LatestAnnouncement {
  body: string
  publishedAt: string
}

export interface ParticipantHome {
  events: ParticipantHomeEvent[]
  latestAnnouncement: LatestAnnouncement | null
}

// Errors are thrown, never read as "nothing there" (F-REL-10): an empty card
// list on a failed read would tell a runner they are entered in no stage.
export async function loadParticipantHome(
  tenant: ResolvedParticipantTenant,
  // ACCT-01 reuses the per-event facts and has no use for the announcement.
  { withAnnouncement = true }: { withAnnouncement?: boolean } = {}
): Promise<ParticipantHome> {
  const supabase = await createSupabaseServerClient()
  const participantIds = tenant.entries.map((e) => e.participantId)

  // Both reads go through the caller's session: participant_read_own and
  // participant_read_own_participant_stages (N43) scope them to the caller.
  // The id filter is the app-side half of defense in depth, not the scope.
  const [participantsResult, stagesResult, infos] = await Promise.all([
    supabase
      .from('participants')
      .select('id, event_id, bib, category, race_results_url')
      .in('id', participantIds),
    supabase
      .from('participant_stages')
      .select('participant_id, stage_id')
      .in('participant_id', participantIds),
    // Event name, status and stage names. The RPC answers for any event, so
    // it is asked only for events in the caller's own entries.
    Promise.all(tenant.entries.map((e) => getEventInfoCached(tenant.id, e.eventId))),
  ])

  if (participantsResult.error) throw participantsResult.error
  if (stagesResult.error) throw stagesResult.error

  const rowById = new Map(participantsResult.data.map((row) => [row.id, row]))

  const events: ParticipantHomeEvent[] = tenant.entries.map((entry, i) => {
    const info = infos[i]
    const row = rowById.get(entry.participantId)
    const open = info.event ? isParticipantSideOpen(info.event, tenant.tier) : false

    const myStageIds = new Set(
      stagesResult.data
        .filter((ps) => ps.participant_id === entry.participantId)
        .map((ps) => ps.stage_id)
    )
    // Race stages only (L16), in the admin's order. A link to a non-race
    // stage is left out rather than shown as a race.
    const stages = info.stages
      .filter((s) => s.stage_type === 'race' && myStageIds.has(s.id))
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, name: s.name }))

    return {
      eventId: entry.eventId,
      name: info.event?.name ?? '',
      open,
      bib: row?.bib ?? null,
      category: row?.category ?? null,
      raceResultsUrl: row?.race_results_url ?? null,
      stages,
    }
  })

  const openEventIds = events.filter((e) => e.open).map((e) => e.eventId)
  let latestAnnouncement: LatestAnnouncement | null = null

  if (withAnnouncement && openEventIds.length > 0) {
    // event_participant_read_announcements (N43) limits this to the
    // participant channel of the caller's events; the filters say the same
    // thing in the app and keep a closed event's announcements off the page.
    const { data, error } = await supabase
      .from('announcements')
      .select('body, published_at')
      .eq('tenant_id', tenant.id)
      .eq('channel', 'participants')
      .in('event_id', openEventIds)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (data) latestAnnouncement = { body: data.body, publishedAt: data.published_at }
  }

  return { events, latestAnnouncement }
}

import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { getCurrentStage } from '@/lib/scheduling/grid-logic'
import { getAllocableDays } from '@/lib/scheduling/allocable-range'
import { logger } from '@/lib/logger'
import { SchedulingGrid } from './_components/scheduling-grid'
import type { UnavailabilityPeriod } from '@/lib/scheduling/unavailability'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ day?: string; stage?: string }>
}

// Assignments are scoped to a single calendar day (UTC) rather than fetched for
// the whole tenant — a tenant running many events can accumulate far more than
// PostgREST's 1000-row default max, which previously required manual pagination.
// The grid only ever shows one day at a time, so the server only needs to send that.
export async function fetchAssignmentsForDay(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  day: string
) {
  const dayStart = new Date(`${day}T00:00:00.000Z`)
  const dayEnd = new Date(dayStart)
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

  const { data, error } = await supabase
    .from('assignments')
    .select('id, official_id, workstation_id, timeslot_start, timeslot_end, status, slot_index')
    .eq('tenant_id', tenantId)
    .gte('timeslot_start', dayStart.toISOString())
    .lt('timeslot_start', dayEnd.toISOString())
    .order('id', { ascending: true })

  if (error) throw error
  return data ?? []
}

// Self-reported unavailability overlapping the day on screen, for the grid's
// advisory overlay. Scoped to the day the same way assignments are, and by
// overlap rather than by start: a period running Friday to Sunday starts
// before Saturday and must still shade Saturday's cells.
//
// Read with the admin's RLS client — the tenant_admin policy on this table is
// what admits it. An official reading the same table sees only their own rows.
export async function fetchUnavailabilityForDay(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  day: string
): Promise<UnavailabilityPeriod[]> {
  const dayStart = new Date(`${day}T00:00:00.000Z`)
  const dayEnd = new Date(dayStart)
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

  // Half-open overlap, matching periodsOverlap: a period ending exactly at
  // midnight belongs to the previous day and must not shade this one.
  const { data, error } = await supabase
    .from('official_unavailability')
    .select('id, official_id, starts_at, ends_at, reason')
    .eq('tenant_id', tenantId)
    .lt('starts_at', dayEnd.toISOString())
    .gt('ends_at', dayStart.toISOString())

  // Never fatal: this is an advisory overlay on a screen whose primary job is
  // assigning shifts. An admin must still be able to schedule when the overlay
  // cannot load — losing the warning degrades the screen, losing the grid
  // breaks it. Logged rather than swallowed, per F-REL-10.
  if (error) {
    logger.error('Scheduling: unavailability read failed', error, { tenantId, day })
    return []
  }

  return (data ?? []) as UnavailabilityPeriod[]
}

export default async function SchedulingPage({ params, searchParams }: Props) {
  const { tenantSlug } = await params

  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout above already
  // resolved and authorized this tenant, so this reuses that result
  // instead of repeating the GoTrue round trip and the access-context
  // queries. The check still runs for this page — it is not skipped.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

  const { data: event } = await supabase
    .from('events')
    .select('id, scheduling_granularity_min')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!event) notFound()

  const [
    { data: stages, error: stagesError },
    { data: workstations, error: workstationsError },
    { data: officials, error: officialsError },
  ] = await Promise.all([
    supabase
      .from('event_stages')
      .select('id, name, stage_type, stage_date, start_time, end_time')
      .eq('event_id', event.id)
      .eq('tenant_id', tenant.id)
      .order('position', { ascending: true }),

    supabase
      .from('workstations')
      .select(
        'id, name, color, capacity_ceiling, stage_id, workstation_operating_windows(id, window_start, window_end)'
      )
      .eq('event_id', event.id)
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: true }),

    supabase
      .from('officials')
      .select('id, name, invite_status, avatar_url')
      .eq('tenant_id', tenant.id)
      .eq('invite_status', 'confirmed')
      .order('name', { ascending: true }),
  ])

  const queryError = stagesError ?? workstationsError ?? officialsError
  if (queryError) throw queryError

  const { day, stage: stageParam } = await searchParams
  // A `?stage=` from e.g. the dashboard's "review this warning" link takes
  // priority over the grid's own default (current stage, or the first one)
  // — but only if it actually names a stage of this event, so a stale or
  // tampered param can't put the grid in a broken state.
  const requestedStage = stageParam ? (stages ?? []).find((s) => s.id === stageParam) : undefined
  const selectedStage = requestedStage ?? getCurrentStage(stages ?? []) ?? (stages ?? [])[0]
  const selectedStageDays = selectedStage ? getAllocableDays(selectedStage) : []
  const today = new Date().toISOString().slice(0, 10)
  // Same defensive validation as ?stage= above: a `?day=` from a stale link
  // (e.g. the dashboard's earliest-warning day, after a stage's own dates
  // were edited later) must not put the grid on a day outside the selected
  // stage's allocable range — dayIndex would resolve to -1 downstream.
  const selectedDay =
    day && selectedStageDays.includes(day)
      ? day
      : selectedStageDays.includes(today)
        ? today
        : selectedStageDays[0]

  const [assignments, unavailability] = selectedDay
    ? await Promise.all([
        fetchAssignmentsForDay(supabase, tenant.id, selectedDay),
        fetchUnavailabilityForDay(supabase, tenant.id, selectedDay),
      ])
    : [[], []]

  return (
    <div className="px-8 py-8">
      <SchedulingGrid
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        eventId={event.id}
        granularityMin={event.scheduling_granularity_min}
        stages={stages ?? []}
        workstations={workstations ?? []}
        officials={officials ?? []}
        initialAssignments={assignments}
        unavailability={unavailability}
        initialSelectedDay={selectedDay ?? ''}
        initialSelectedStageId={selectedStage?.id ?? ''}
      />
    </div>
  )
}

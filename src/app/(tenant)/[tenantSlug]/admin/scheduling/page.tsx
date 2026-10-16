import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { getCurrentStage } from '@/lib/scheduling/grid-logic'
import { getAllocableDays } from '@/lib/scheduling/allocable-range'
import { logger } from '@/lib/logger'
import { SchedulingGrid } from './_components/scheduling-grid'
import { MobileCoverageView } from './_components/mobile-coverage-view'
import { fetchDayCoverage } from '@/lib/scheduling/coverage'
import { hasFeature } from '@/lib/tiers/features'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { Monitor } from 'lucide-react'
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

// Unavailability overlapping the day on screen, for the grid's blocked-cell
// overlay. Scoped to the day the same way assignments are, and by
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
    .select('id, official_id, starts_at, ends_at, created_by_role')
    .eq('tenant_id', tenantId)
    .lt('starts_at', dayEnd.toISOString())
    .gt('ends_at', dayStart.toISOString())

  // Never fatal: this overlay marks blocked cells on a screen whose primary
  // job is assigning shifts. An admin must still be able to schedule when it
  // cannot load — losing the shading degrades the screen, losing the grid
  // breaks it, and the save action re-checks the periods server-side anyway,
  // so a missing overlay cannot let an assignment through. Logged rather than
  // swallowed, per F-REL-10.
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

  // N18: the phone-shaped read-only view, rendered alongside the grid and
  // swapped by a CSS breakpoint rather than by sniffing the device — one
  // route, so a link into scheduling works from either.
  //
  // Premium and up. Gated here rather than in the component so a Standard
  // tenant is not shipped the coverage read at all; there is no mutation
  // behind this feature, so unlike the colour theme it needs no second gate
  // on a server action.
  const showMobileView = hasFeature(tenant.tier, 'mobileSchedule')

  // Only the selected stage's work areas: a work area belongs to a stage
  // (migration 0039), and listing another stage's areas as "unstaffed" would
  // invent coverage gaps that do not exist.
  const stageWorkstations = (workstations ?? []).filter(
    (ws) => !selectedStage || ws.stage_id === selectedStage.id
  )

  const coverage =
    showMobileView && selectedDay
      ? await fetchDayCoverage(supabase, {
          tenantId: tenant.id,
          day: selectedDay,
          workstations: stageWorkstations.map((ws) => ({
            id: ws.id,
            name: ws.name,
            color: ws.color,
          })),
        })
      : null

  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  return (
    <>
      {/* Below md only. The grid above it is hidden rather than unmounted at
          this width: both are server-rendered from the same data, and keeping
          one route means no second URL to maintain and no device sniffing. */}
      <div className="px-4 py-6 md:hidden">
        {coverage ? (
          <MobileCoverageView
            tenantSlug={tenantSlug}
            days={selectedStageDays}
            selectedDay={selectedDay ?? ''}
            areas={coverage.areas}
            ok={coverage.ok}
          />
        ) : (
          <EmptyStateCard
            Icon={Monitor}
            title={t('scheduling.mobileUpgradeTitle')}
            description={t('scheduling.mobileUpgradeBody')}
          />
        )}
      </div>

      <div className="hidden px-8 py-8 md:block">
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
    </>
  )
}

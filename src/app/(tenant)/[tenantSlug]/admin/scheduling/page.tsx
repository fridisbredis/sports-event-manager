import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { getCurrentStage } from '@/lib/scheduling/grid-logic'
import { getAllocableDays } from '@/lib/scheduling/allocable-range'
import { SchedulingGrid } from './_components/scheduling-grid'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ day?: string }>
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
        'id, name, capacity_ceiling, stage_id, workstation_operating_windows(id, window_start, window_end)'
      )
      .eq('event_id', event.id)
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: true }),

    supabase
      .from('officials')
      .select('id, name, invite_status')
      .eq('tenant_id', tenant.id)
      .eq('invite_status', 'confirmed')
      .order('name', { ascending: true }),
  ])

  const queryError = stagesError ?? workstationsError ?? officialsError
  if (queryError) throw queryError

  const { day } = await searchParams
  const defaultStage = getCurrentStage(stages ?? []) ?? (stages ?? [])[0]
  const defaultDays = defaultStage ? getAllocableDays(defaultStage) : []
  const today = new Date().toISOString().slice(0, 10)
  const selectedDay = day ?? (defaultDays.includes(today) ? today : defaultDays[0])

  const assignments = selectedDay
    ? await fetchAssignmentsForDay(supabase, tenant.id, selectedDay)
    : []

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
        initialSelectedDay={selectedDay ?? ''}
      />
    </div>
  )
}

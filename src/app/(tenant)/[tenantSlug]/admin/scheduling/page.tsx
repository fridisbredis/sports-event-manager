import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { SchedulingGrid } from './_components/scheduling-grid'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

// PostgREST caps unbounded selects at its configured max-rows (1000 by
// default) — a single .select() silently truncates once a tenant accumulates
// more assignments than that, dropping rows with no error. Page through
// explicitly so the grid always sees the full set regardless of event size.
const ASSIGNMENTS_PAGE_SIZE = 1000

async function fetchAllAssignments(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string
) {
  const rows: {
    id: string
    official_id: string
    workstation_id: string | null
    timeslot_start: string
    timeslot_end: string
    status: string
    slot_index: number | null
  }[] = []

  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('assignments')
      .select('id, official_id, workstation_id, timeslot_start, timeslot_end, status, slot_index')
      .eq('tenant_id', tenantId)
      .order('id', { ascending: true })
      .range(from, from + ASSIGNMENTS_PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    rows.push(...data)
    if (data.length < ASSIGNMENTS_PAGE_SIZE) break
    from += ASSIGNMENTS_PAGE_SIZE
  }

  return rows
}

export default async function SchedulingPage({ params }: Props) {
  const { tenantSlug } = await params

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, slug')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) notFound()

  if (!(await hasAdminAccessToTenant(user.id, tenant.id))) notFound()

  const service = await createSupabaseServiceClient()

  const { data: event } = await supabase
    .from('events')
    .select('id, scheduling_granularity_min')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!event) notFound()

  const [{ data: stages }, { data: workstations }, { data: officials }, assignments] =
    await Promise.all([
      supabase
        .from('event_stages')
        .select('id, name, stage_type, stage_date, start_time, end_time')
        .eq('event_id', event.id)
        .eq('tenant_id', tenant.id)
        .order('position', { ascending: true }),

      supabase
        .from('workstations')
        .select('id, name, capacity_ceiling, stage_id, workstation_operating_windows(id, window_start, window_end)')
        .eq('event_id', event.id)
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: true }),

      supabase
        .from('officials')
        .select('id, name, invite_status')
        .eq('tenant_id', tenant.id)
        .eq('invite_status', 'confirmed')
        .order('name', { ascending: true }),

      fetchAllAssignments(supabase, tenant.id),
    ])

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
      />
    </div>
  )
}

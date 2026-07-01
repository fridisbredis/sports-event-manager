'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

export interface StageInput {
  name: string
  stage_type: 'race' | 'non_race'
  race_type: 'distance' | 'time'
  start_time: string | null
  end_time: string | null
  venue: string
  position: number
  distances: LabelInput[]
}

export interface LabelInput {
  label: string
  position: number
}

export interface SaveEventInput {
  tenantSlug: string
  tenantId: string
  eventId: string
  name: string
  event_type: string
  description: string
  location: string
  logo_url: string
  scheduling_granularity_min: number
  stages: StageInput[]
  facilities: LabelInput[]
  // start_date and end_date are derived from Race stage times in this action
}

export interface SaveEventResult {
  error?: string
}

export async function saveEvent(input: SaveEventInput): Promise<SaveEventResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const service = await createSupabaseServiceClient()
  const { data: roleRow } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()

  if (!roleRow || (roleRow.role !== 'tenant_admin' && roleRow.role !== 'system_admin')) {
    return { error: 'Not authorized' }
  }

  // Derive start_date / end_date from Race stage times so the events row stays
  // coherent even though those columns are now nullable.
  const raceStages = input.stages.filter((s) => s.stage_type === 'race' && s.start_time)
  const derivedStartDate = raceStages.length > 0 ? raceStages[0].start_time!.slice(0, 10) : null
  const derivedEndDate =
    raceStages.length > 0
      ? ((raceStages.at(-1)!.end_time ?? raceStages.at(-1)!.start_time)?.slice(0, 10) ?? null)
      : null

  // NOT NULL columns: only include if non-empty so we don't violate constraints
  // on an incomplete draft. Nullable columns: always include so admins can clear them.
  const { error: eventError } = await supabase
    .from('events')
    .update({
      ...(input.name ? { name: input.name } : {}),
      ...(input.event_type ? { event_type: input.event_type } : {}),
      start_date: derivedStartDate,
      end_date: derivedEndDate,
      description: input.description || null,
      location: input.location || null,
      logo_url: input.logo_url || null,
      scheduling_granularity_min: input.scheduling_granularity_min,
    })
    .eq('id', input.eventId)
    .eq('tenant_id', input.tenantId)

  if (eventError) return { error: eventError.message }

  // Atomically replace all stages AND their distances via RPC (delete + insert
  // in one transaction). Distances are now embedded per Race stage in p_stages.
  const stageRows = input.stages
    .filter((s) => s.name.trim())
    .map((s, i) => ({
      name: s.name,
      stage_type: s.stage_type,
      race_type: s.race_type,
      start_time: s.start_time || null,
      end_time: s.end_time || null,
      venue: s.venue,
      position: i,
      distances: s.distances.filter((d) => d.label.trim()).map((d, j) => ({ label: d.label, position: j })),
    }))

  const { error: rpcError } = await supabase.rpc('sync_event_stages', {
    p_event_id: input.eventId,
    p_tenant_id: input.tenantId,
    p_stages: stageRows,
  })

  if (rpcError) return { error: rpcError.message }

  // Facilities: delete + insert (unchanged pattern from before).
  const { error: delFacError } = await supabase
    .from('event_facilities')
    .delete()
    .eq('event_id', input.eventId)
    .eq('tenant_id', input.tenantId)
  if (delFacError) return { error: delFacError.message }

  const facilityRows = input.facilities
    .filter((f) => f.label.trim())
    .map((f, i) => ({
      label: f.label,
      position: i,
      event_id: input.eventId,
      tenant_id: input.tenantId,
    }))
  if (facilityRows.length > 0) {
    const { error: insFacError } = await supabase.from('event_facilities').insert(facilityRows)
    if (insFacError) return { error: insFacError.message }
  }

  revalidatePath(`/${input.tenantSlug}/event`)
  revalidatePath(`/${input.tenantSlug}/dashboard`)

  return {}
}

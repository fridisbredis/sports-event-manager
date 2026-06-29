'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

export interface StageInput {
  name: string
  stage_date: string
  venue: string
  position: number
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
  start_date: string
  end_date: string
  scheduling_granularity_min: number
  category_type: 'distance' | 'time'
  stages: StageInput[]
  distances: LabelInput[]
  facilities: LabelInput[]
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

  // NOT NULL columns: only include in the update when the value is non-empty so we
  // don't violate the constraint while a draft is still incomplete.
  // Nullable columns: always include so admins can clear them.
  const { error: eventError } = await supabase
    .from('events')
    .update({
      ...(input.name ? { name: input.name } : {}),
      ...(input.event_type ? { event_type: input.event_type } : {}),
      ...(input.start_date ? { start_date: input.start_date } : {}),
      ...(input.end_date ? { end_date: input.end_date } : {}),
      description: input.description || null,
      location: input.location || null,
      logo_url: input.logo_url || null,
      scheduling_granularity_min: input.scheduling_granularity_min,
      category_type: input.category_type,
    })
    .eq('id', input.eventId)
    .eq('tenant_id', input.tenantId)

  if (eventError) return { error: eventError.message }

  // Atomically replace all stages via RPC (delete + insert in one transaction).
  const stageRows = input.stages
    .filter((s) => s.name.trim() && s.stage_date)
    .map((s, i) => ({ ...s, position: i }))

  const { error: rpcError } = await supabase.rpc('sync_event_stages', {
    p_event_id: input.eventId,
    p_tenant_id: input.tenantId,
    p_stages: stageRows,
  })

  if (rpcError) return { error: rpcError.message }

  // Atomically replace distances and facilities (delete + insert).
  const { error: delDistError } = await supabase
    .from('event_distances')
    .delete()
    .eq('event_id', input.eventId)
    .eq('tenant_id', input.tenantId)
  if (delDistError) return { error: delDistError.message }

  const distanceRows = input.distances
    .filter((d) => d.label.trim())
    .map((d, i) => ({ label: d.label, position: i, event_id: input.eventId, tenant_id: input.tenantId }))
  if (distanceRows.length > 0) {
    const { error: insDistError } = await supabase.from('event_distances').insert(distanceRows)
    if (insDistError) return { error: insDistError.message }
  }

  const { error: delFacError } = await supabase
    .from('event_facilities')
    .delete()
    .eq('event_id', input.eventId)
    .eq('tenant_id', input.tenantId)
  if (delFacError) return { error: delFacError.message }

  const facilityRows = input.facilities
    .filter((f) => f.label.trim())
    .map((f, i) => ({ label: f.label, position: i, event_id: input.eventId, tenant_id: input.tenantId }))
  if (facilityRows.length > 0) {
    const { error: insFacError } = await supabase.from('event_facilities').insert(facilityRows)
    if (insFacError) return { error: insFacError.message }
  }

  revalidatePath(`/${input.tenantSlug}/event`)
  revalidatePath(`/${input.tenantSlug}/dashboard`)

  return {}
}

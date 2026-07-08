'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'

export interface StageInput {
  id?: string
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

  if (!(await hasAdminAccessToTenant(user.id, input.tenantId))) return { error: 'Not authorized' }

  const service = await createSupabaseServiceClient()

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
      ...(s.id ? { id: s.id } : {}),
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

  revalidatePath(`/${input.tenantSlug}/admin/event`)
  revalidatePath(`/${input.tenantSlug}/admin/dashboard`)

  return {}
}

export interface UploadLogoResult {
  publicUrl?: string
  error?: string
}

function extractStoragePath(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(url.slice(idx + marker.length))
}

export async function uploadEventLogo(formData: FormData): Promise<UploadLogoResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const file = formData.get('file')
  const tenantId = formData.get('tenantId') as string
  const eventId = formData.get('eventId') as string
  const oldLogoUrl = (formData.get('oldLogoUrl') as string) || ''

  if (!(file instanceof File)) return { error: 'No file provided' }
  if (!file.type.startsWith('image/')) return { error: 'Please choose an image file' }
  if (file.size > 2 * 1024 * 1024) return { error: 'Image must be smaller than 2 MB' }
  if (!tenantId || !eventId) return { error: 'Missing tenant or event ID' }

  if (!(await hasAdminAccessToTenant(user.id, tenantId))) return { error: 'Not authorized' }

  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
  const path = `${tenantId}/${eventId}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('logos')
    .upload(path, file, { contentType: file.type })

  if (uploadError) return { error: uploadError.message }

  // Best-effort cleanup of old logo — ignore errors
  const oldPath = extractStoragePath(oldLogoUrl, 'logos')
  if (oldPath) {
    await supabase.storage.from('logos').remove([oldPath])
  }

  const { data } = supabase.storage.from('logos').getPublicUrl(path)
  return { publicUrl: data.publicUrl }
}

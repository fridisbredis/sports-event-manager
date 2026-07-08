'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'

export interface PublishEventInput {
  tenantSlug: string
  tenantId: string
  eventId: string
}

export interface PublishEventResult {
  error?: string
}

/**
 * Publishes a draft event. Shared between EVT-01 (dashboard) and EVT-02 (config).
 * Re-verifies publish requirements and admin role on the server at call time.
 * Stage model v0.7: requires name + at least one Race stage (not event-level dates).
 */
export async function publishEvent(input: PublishEventInput): Promise<PublishEventResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  if (!(await hasAdminAccessToTenant(user.id, input.tenantId))) return { error: 'Not authorized' }

  const service = await createSupabaseServiceClient()

  // Re-verify publish requirements at action time
  const { data: ev } = await supabase
    .from('events')
    .select('name, status')
    .eq('id', input.eventId)
    .eq('tenant_id', input.tenantId)
    .single()

  if (!ev) return { error: 'Event not found.' }
  if (ev.status === 'published') return {}

  if (!ev.name?.trim()) return { error: 'Event name is required before publishing.' }

  // Stage model v0.7: at least one Race stage is required (satisfies the "at least one date"
  // requirement since a Race stage carries its own start/end time).
  const { count: raceStageCount } = await supabase
    .from('event_stages')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', input.eventId)
    .eq('stage_type', 'race')

  if (!raceStageCount || raceStageCount === 0) {
    return { error: 'Add at least one Race stage before publishing.' }
  }

  const { error } = await supabase
    .from('events')
    .update({ status: 'published' })
    .eq('id', input.eventId)

  if (error) return { error: error.message }

  revalidatePath(`/${input.tenantSlug}/admin/event`)
  revalidatePath(`/${input.tenantSlug}/admin/dashboard`)

  return {}
}

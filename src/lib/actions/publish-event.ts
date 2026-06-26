'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

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
 */
export async function publishEvent(input: PublishEventInput): Promise<PublishEventResult> {
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

  // Re-verify publish requirements at action time
  const { data: ev } = await supabase
    .from('events')
    .select('name, start_date, end_date, status')
    .eq('id', input.eventId)
    .eq('tenant_id', input.tenantId)
    .single()

  if (!ev) return { error: 'Event not found.' }
  if (ev.status === 'published') return {}

  if (!ev.name?.trim()) return { error: 'Event name is required before publishing.' }
  if (!ev.start_date || !ev.end_date) return { error: 'Date range is required before publishing.' }

  const { count: stageCount } = await supabase
    .from('event_stages')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', input.eventId)

  if (!stageCount || stageCount === 0) {
    return { error: 'At least one stage/day is required before publishing.' }
  }

  const { error } = await supabase
    .from('events')
    .update({ status: 'published' })
    .eq('id', input.eventId)

  if (error) return { error: error.message }

  revalidatePath(`/${input.tenantSlug}/event`)
  revalidatePath(`/${input.tenantSlug}/dashboard`)

  return {}
}

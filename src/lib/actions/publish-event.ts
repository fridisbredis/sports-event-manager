'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'

const tenantIdSchema = z.string().uuid()

export interface PublishEventInput {
  tenantSlug: string
  tenantId: string
  eventId: string
}

export interface PublishEventResult {
  error?: string
}

export async function publishEvent(input: PublishEventInput): Promise<PublishEventResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const parsedTenantId = tenantIdSchema.safeParse(input.tenantId)
  if (!parsedTenantId.success) {
    console.error('publishEvent: invalid tenantId', input.tenantId)
    return { error: 'Not authorized' }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: 'Not authorized' }

  const { data: ev } = await supabase
    .from('events')
    .select('name, status')
    .eq('id', input.eventId)
    .eq('tenant_id', parsedTenantId.data)
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

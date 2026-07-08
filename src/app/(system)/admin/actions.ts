'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { toSlug } from './_utils'

async function assertSystemAdmin(): Promise<{ error?: string }> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = await createSupabaseServiceClient()
  const { data } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'system_admin')
    .limit(1)
    .maybeSingle()

  if (!data) return { error: 'Forbidden' }
  return {}
}

export async function createTenant(name: string): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (check.error) return check

  const slug = toSlug(name)
  if (!slug) return { error: 'Invalid name' }

  const service = await createSupabaseServiceClient()

  const { data: tenant, error: tenantError } = await service
    .from('tenants')
    .insert({ name: name.trim(), slug, is_active: true, tier: 'standard', feature_flags: {} })
    .select('id')
    .single()

  if (tenantError) {
    if (tenantError.code === '23505') return { error: 'A tenant with that name already exists' }
    return { error: 'Failed to create tenant' }
  }

  const { data: event, error: eventError } = await service
    .from('events')
    .insert({
      tenant_id: tenant.id,
      name: name.trim(),
      event_type: 'Event',
      status: 'draft',
      scheduling_granularity_min: 60,
    })
    .select('id')
    .single()

  if (eventError || !event) return { error: 'Failed to create event' }

  const { error: stagesError } = await service.from('event_stages').insert([
    { event_id: event.id, tenant_id: tenant.id, name: 'Setup', stage_type: 'non_race', race_type: 'distance', position: 0 },
    { event_id: event.id, tenant_id: tenant.id, name: 'Race', stage_type: 'race', race_type: 'distance', position: 1 },
    { event_id: event.id, tenant_id: tenant.id, name: 'Teardown', stage_type: 'non_race', race_type: 'distance', position: 2 },
  ])

  if (stagesError) return { error: 'Failed to create default stages' }

  revalidatePath('/admin')
  return {}
}

export async function setTenantActive(tenantId: string, isActive: boolean): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (check.error) return check

  const service = await createSupabaseServiceClient()
  const { error } = await service
    .from('tenants')
    .update({ is_active: isActive })
    .eq('id', tenantId)

  if (error) return { error: 'Failed to update tenant' }

  revalidatePath('/admin')
  revalidatePath('/admin/' + tenantId)
  return {}
}

export async function setTenantTier(
  tenantId: string,
  tier: 'standard' | 'premium' | 'professional'
): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (check.error) return check

  const service = await createSupabaseServiceClient()
  const { error } = await service
    .from('tenants')
    .update({ tier })
    .eq('id', tenantId)

  if (error) return { error: 'Failed to update tier' }

  revalidatePath('/admin/' + tenantId)
  return {}
}

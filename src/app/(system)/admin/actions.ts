'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { toSlug } from './_utils'
import { z } from 'zod'

const createTenantSchema = z.object({
  name: z.string().trim().min(1),
})

const setTenantActiveSchema = z.object({
  tenantId: z.string().uuid(),
  isActive: z.boolean(),
})

const setTenantTierSchema = z.object({
  tenantId: z.string().uuid(),
  tier: z.enum(['standard', 'premium', 'professional']),
})

type SystemAdminCheck =
  | { ok: false; error: string }
  | { ok: true; supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> }

async function assertSystemAdmin(): Promise<SystemAdminCheck> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Bootstrap lookup: determines the role RLS itself would gate on, so RLS
  // can't be used here. See row #1 in docs/security/service-role-audit.md.
  const service = await createSupabaseServiceClient()
  const { data } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'system_admin')
    .limit(1)
    .maybeSingle()

  if (!data) return { ok: false, error: 'Forbidden' }
  return { ok: true, supabase }
}

export async function createTenant(name: string): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (!check.ok) return { error: check.error }
  const { supabase } = check

  const parsed = createTenantSchema.safeParse({ name })
  if (!parsed.success) return { error: 'Invalid name' }

  const slug = toSlug(parsed.data.name)
  if (!slug) return { error: 'Invalid name' }

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({
      name: parsed.data.name,
      slug,
      is_active: true,
      tier: 'standard',
      feature_flags: {},
    })
    .select('id')
    .single()

  if (tenantError) {
    if (tenantError.code === '23505') return { error: 'A tenant with that name already exists' }
    return { error: 'Failed to create tenant' }
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .insert({
      tenant_id: tenant.id,
      name: parsed.data.name,
      event_type: 'Event',
      status: 'draft',
      scheduling_granularity_min: 60,
    })
    .select('id')
    .single()

  if (eventError || !event) return { error: 'Failed to create event' }

  const { error: stagesError } = await supabase.from('event_stages').insert([
    {
      event_id: event.id,
      tenant_id: tenant.id,
      name: 'Setup',
      stage_type: 'non_race',
      race_type: 'distance',
      position: 0,
    },
    {
      event_id: event.id,
      tenant_id: tenant.id,
      name: 'Race',
      stage_type: 'race',
      race_type: 'distance',
      position: 1,
    },
    {
      event_id: event.id,
      tenant_id: tenant.id,
      name: 'Teardown',
      stage_type: 'non_race',
      race_type: 'distance',
      position: 2,
    },
  ])

  if (stagesError) return { error: 'Failed to create default stages' }

  revalidatePath('/admin')
  return {}
}

export async function setTenantActive(
  tenantId: string,
  isActive: boolean
): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (!check.ok) return { error: check.error }
  const { supabase } = check

  const parsed = setTenantActiveSchema.safeParse({ tenantId, isActive })
  if (!parsed.success) return { error: 'Invalid request' }

  const { error } = await supabase
    .from('tenants')
    .update({ is_active: parsed.data.isActive })
    .eq('id', parsed.data.tenantId)

  if (error) return { error: 'Failed to update tenant' }

  revalidatePath('/admin')
  revalidatePath('/admin/' + parsed.data.tenantId)
  return {}
}

export async function setTenantTier(
  tenantId: string,
  tier: 'standard' | 'premium' | 'professional'
): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (!check.ok) return { error: check.error }
  const { supabase } = check

  const parsed = setTenantTierSchema.safeParse({ tenantId, tier })
  if (!parsed.success) return { error: 'Invalid request' }

  const { error } = await supabase
    .from('tenants')
    .update({ tier: parsed.data.tier })
    .eq('id', parsed.data.tenantId)

  if (error) return { error: 'Failed to update tier' }

  revalidatePath('/admin/' + parsed.data.tenantId)
  return {}
}

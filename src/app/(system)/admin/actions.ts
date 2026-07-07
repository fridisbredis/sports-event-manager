'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireSystemAdmin } from '@/lib/auth/tenant'

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

export async function createTenant(name: string): Promise<{ error?: string }> {
  const auth = await requireSystemAdmin()
  if ('error' in auth) return { error: 'Forbidden' }

  const slug = toSlug(name)
  if (!slug) return { error: 'Invalid name' }

  const service = await createSupabaseServiceClient()
  const { error } = await service
    .from('tenants')
    .insert({ name: name.trim(), slug, is_active: true, tier: 'standard', feature_flags: {} })

  if (error) {
    if (error.code === '23505') return { error: 'A tenant with that name already exists' }
    return { error: 'Failed to create tenant' }
  }

  revalidatePath('/admin')
  return {}
}

export async function setTenantActive(tenantId: string, isActive: boolean): Promise<{ error?: string }> {
  const auth = await requireSystemAdmin()
  if ('error' in auth) return { error: 'Forbidden' }

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
  const auth = await requireSystemAdmin()
  if ('error' in auth) return { error: 'Forbidden' }

  const service = await createSupabaseServiceClient()
  const { error } = await service
    .from('tenants')
    .update({ tier })
    .eq('id', tenantId)

  if (error) return { error: 'Failed to update tier' }

  revalidatePath('/admin/' + tenantId)
  return {}
}

'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log-audit-event'
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
  | {
      ok: true
      supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
      userId: string
    }

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
  return { ok: true, supabase, userId: user.id }
}

export async function createTenant(name: string): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (!check.ok) return { error: check.error }
  const { supabase, userId } = check

  const parsed = createTenantSchema.safeParse({ name })
  if (!parsed.success) return { error: 'Invalid name' }

  const slug = toSlug(parsed.data.name)
  if (!slug) return { error: 'Invalid name' }

  // REL-01: tenant + default event + default stages are created atomically
  // by this RPC — see migration 20260908130253 and
  // docs/patterns/atomic-multi-table-writes.md. Previously these were three
  // separate .insert() calls with no transaction, so a failure on the third
  // step left an orphaned tenant with no event/stages behind.
  const { data: rpcData, error: rpcError } = await supabase.rpc('create_tenant_with_defaults', {
    p_name: parsed.data.name,
    p_slug: slug,
  })

  if (rpcError) {
    if (rpcError.code === '23505') return { error: 'A tenant with that name already exists' }
    return { error: 'Failed to create tenant' }
  }

  const { tenant_id: tenantId } = rpcData as unknown as { tenant_id: string; event_id: string }

  await logAuditEvent({
    tenantId,
    actorUserId: userId,
    actorRole: 'system_admin',
    action: 'tenant_created',
    targetType: 'tenant',
    targetId: tenantId,
    detail: { name: parsed.data.name, slug },
  })

  revalidatePath('/admin')
  return {}
}

export async function setTenantActive(
  tenantId: string,
  isActive: boolean
): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (!check.ok) return { error: check.error }
  const { supabase, userId } = check

  const parsed = setTenantActiveSchema.safeParse({ tenantId, isActive })
  if (!parsed.success) return { error: 'Invalid request' }

  const { error } = await supabase
    .from('tenants')
    .update({ is_active: parsed.data.isActive })
    .eq('id', parsed.data.tenantId)

  if (error) return { error: 'Failed to update tenant' }

  await logAuditEvent({
    tenantId: parsed.data.tenantId,
    actorUserId: userId,
    actorRole: 'system_admin',
    action: parsed.data.isActive ? 'tenant_activated' : 'tenant_deactivated',
    targetType: 'tenant',
    targetId: parsed.data.tenantId,
    detail: { isActive: parsed.data.isActive },
  })

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
  const { supabase, userId } = check

  const parsed = setTenantTierSchema.safeParse({ tenantId, tier })
  if (!parsed.success) return { error: 'Invalid request' }

  const { error } = await supabase
    .from('tenants')
    .update({ tier: parsed.data.tier })
    .eq('id', parsed.data.tenantId)

  if (error) return { error: 'Failed to update tier' }

  await logAuditEvent({
    tenantId: parsed.data.tenantId,
    actorUserId: userId,
    actorRole: 'system_admin',
    action: 'tenant_tier_changed',
    targetType: 'tenant',
    targetId: parsed.data.tenantId,
    detail: { tier: parsed.data.tier },
  })

  revalidatePath('/admin/' + parsed.data.tenantId)
  return {}
}

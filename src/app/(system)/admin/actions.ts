'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log-audit-event'
import { toSlug } from './_utils'
import { z } from 'zod'
import { translateActionError as tError } from '@/lib/actions/action-error'
import { normalizePhoneToE164, PHONE_COUNTRIES } from '@/lib/phone'
import { logger } from '@/lib/logger'
import {
  resolveAdminAuthUser,
  grantTenantAdminRole,
  revokeTenantAdminRole,
  type AdminRoleChangeResult,
} from '@/lib/auth/tenant-admins'
import { grantSystemAdminRole, revokeSystemAdminRole } from '@/lib/auth/system-admins'
import { smsSenderIdSchema } from '@/lib/sms/sender'

const setTenantActiveSchema = z.object({
  tenantId: z.string().uuid(),
  isActive: z.boolean(),
})

const setTenantTierSchema = z.object({
  tenantId: z.string().uuid(),
  tier: z.enum(['standard', 'premium', 'professional']),
})

const setTenantSmsSenderIdSchema = z.object({
  tenantId: z.string().uuid(),
  smsSenderId: smsSenderIdSchema,
})

const PHONE_COUNTRY_CODES = PHONE_COUNTRIES.map((c) => c.code)

const grantAdminSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().trim().min(1),
  phone: z.string().min(1),
  phoneCountry: z.enum(PHONE_COUNTRY_CODES as [string, ...string[]]),
})

const revokeAdminSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
})

const grantSystemAdminSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().min(1),
  phoneCountry: z.enum(PHONE_COUNTRY_CODES as [string, ...string[]]),
})

const revokeSystemAdminSchema = z.object({
  userId: z.string().uuid(),
})

const ownSystemAdminNameSchema = z.object({
  name: z.string().trim().min(1).max(200),
})

const createTenantWithAdminSchema = z.object({
  name: z.string().trim().min(1),
  adminName: z.string().trim().min(1),
  adminPhone: z.string().min(1),
  adminPhoneCountry: z.enum(PHONE_COUNTRY_CODES as [string, ...string[]]),
})

// SYS-02's wording for a refused grant or revoke. Written for a system admin,
// who can act on it: raise the tier, or deactivate the tenant.
function adminRoleErrorKey(
  reason: Extract<AdminRoleChangeResult, { ok: false }>['reason'],
  failedKey: string
) {
  if (reason === 'capReached') return 'actionErrors.adminCapReached'
  if (reason === 'lastAdmin') return 'actionErrors.lastAdminCannotRemove'
  return failedKey
}

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

  if (!data) return { ok: false, error: await tError('actionErrors.notAuthorized') }
  return { ok: true, supabase, userId: user.id }
}

// N20: creates a tenant together with its first admin.
//
// The admin is not optional here. Before this, SYS-01 produced a tenant with
// no role row at all — nobody could sign in to it, and the only way in was to
// remember to visit SYS-02 afterwards. That is how two of the three tenants in
// prod ended up unreachable. Asking for the admin at creation time removes the
// step that was being forgotten.
export async function createTenant(
  name: string,
  adminName: string,
  adminPhone: string,
  adminPhoneCountry: string
): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (!check.ok) return { error: check.error }
  const { userId } = check

  const parsed = createTenantWithAdminSchema.safeParse({
    name,
    adminName,
    adminPhone,
    adminPhoneCountry,
  })
  if (!parsed.success) return { error: await tError('actionErrors.invalidName') }

  const slug = toSlug(parsed.data.name)
  if (!slug) return { error: await tError('actionErrors.invalidName') }

  const normalizedPhone = normalizePhoneToE164(
    parsed.data.adminPhone,
    parsed.data.adminPhoneCountry as (typeof PHONE_COUNTRY_CODES)[number]
  )
  if (!normalizedPhone) return { error: await tError('actionErrors.invalidPhone') }

  // create_tenant_with_defaults is SECURITY DEFINER as of migration
  // 20261015124237 and granted to service_role only, so it needs the service
  // client. Its body re-checks that the caller is a system_admin.
  const service = await createSupabaseServiceClient()

  // The auth user is resolved BEFORE the tenant transaction. If this fails,
  // nothing has been created yet — whereas creating the tenant first and
  // failing here is exactly the admin-less tenant this change exists to
  // prevent.
  const adminUser = await resolveAdminAuthUser(service, normalizedPhone, parsed.data.adminName, {
    slug,
  })
  if (!adminUser.ok) return { error: await tError('actionErrors.grantAdminFailed') }

  // REL-01: tenant + default event + default stages + the first admin and its
  // roster row, all in one transaction — see migrations 20260908130253 and
  // 20261015124237, and docs/patterns/atomic-multi-table-writes.md.
  const { data: rpcData, error: rpcError } = await service.rpc('create_tenant_with_defaults', {
    p_name: parsed.data.name,
    p_slug: slug,
    p_admin_user_id: adminUser.userId,
    p_admin_name: parsed.data.adminName,
  })

  if (rpcError) {
    if (rpcError.code === '23505') return { error: await tError('actionErrors.tenantNameTaken') }
    logger.error('Create tenant: RPC failed', rpcError, { slug })
    return { error: await tError('actionErrors.createTenantFailed') }
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

  // The first admin is part of creating the tenant, but it is still a
  // privilege grant and is logged as one — otherwise the only record of who
  // can administer a new tenant would be the role row itself.
  await logAuditEvent({
    tenantId,
    actorUserId: userId,
    actorRole: 'system_admin',
    action: 'tenant_admin_granted',
    targetType: 'user_role',
    targetId: adminUser.userId,
    detail: { firstAdmin: true },
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
  if (!parsed.success) return { error: await tError('actionErrors.invalidRequest') }

  const { error } = await supabase
    .from('tenants')
    .update({ is_active: parsed.data.isActive })
    .eq('id', parsed.data.tenantId)

  if (error) return { error: await tError('actionErrors.updateTenantFailed') }

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
  if (!parsed.success) return { error: await tError('actionErrors.invalidRequest') }

  const { error } = await supabase
    .from('tenants')
    .update({ tier: parsed.data.tier })
    .eq('id', parsed.data.tenantId)

  if (error) return { error: await tError('actionErrors.updateTierFailed') }

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

// N13: set or clear a tenant's alphanumeric SMS sender name. An empty value
// clears it, which puts the tenant back on the platform number.
//
// Saved regardless of tier: whether the name is USED is decided per message
// by resolveSmsSender, so a name entered on a Premium tenant waits on the row
// and takes effect on an upgrade to Professional.
//
// The database also refuses this write from anyone but a system admin
// (trigger guard_tenant_sms_sender_id), since tenant admins can otherwise
// update their own tenant row.
export async function setTenantSmsSenderId(
  tenantId: string,
  smsSenderId: string
): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (!check.ok) return { error: check.error }
  const { supabase, userId } = check

  const parsed = setTenantSmsSenderIdSchema.safeParse({ tenantId, smsSenderId })
  if (!parsed.success) return { error: await tError('actionErrors.invalidSmsSenderId') }

  const { error } = await supabase
    .from('tenants')
    .update({ sms_sender_id: parsed.data.smsSenderId })
    .eq('id', parsed.data.tenantId)

  if (error) return { error: await tError('actionErrors.updateSmsSenderFailed') }

  await logAuditEvent({
    tenantId: parsed.data.tenantId,
    actorUserId: userId,
    actorRole: 'system_admin',
    action: 'tenant_sms_sender_changed',
    targetType: 'tenant',
    targetId: parsed.data.tenantId,
    detail: { smsSenderId: parsed.data.smsSenderId },
  })

  revalidatePath('/admin/' + parsed.data.tenantId)
  return {}
}

// N20: make someone a tenant admin, by phone number.
//
// Phone rather than email because it is the only identity this platform has —
// sign-in is SMS OTP throughout, and `officials.phone` is what invite
// confirmation binds against (0017/0018).
//
// Also the path by which a brand-new tenant gets its FIRST admin. Until this
// existed, createTenant produced a tenant nobody could enter: it creates the
// tenant, its event and three stages, but no role row, and every other RPC
// that writes user_roles hardcodes 'official'.
export async function grantTenantAdmin(
  tenantId: string,
  name: string,
  phone: string,
  phoneCountry: string
): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (!check.ok) return { error: check.error }
  const { userId } = check

  const parsed = grantAdminSchema.safeParse({ tenantId, name, phone, phoneCountry })
  if (!parsed.success) return { error: await tError('actionErrors.invalidRequest') }

  const normalizedPhone = normalizePhoneToE164(
    parsed.data.phone,
    parsed.data.phoneCountry as (typeof PHONE_COUNTRY_CODES)[number]
  )
  if (!normalizedPhone) return { error: await tError('actionErrors.invalidPhone') }

  // auth.admin.* and the grant RPC both need the service client: neither
  // auth.users nor user_roles is reachable by the authenticated role under
  // RLS. The caller is already verified as system_admin above.
  const service = await createSupabaseServiceClient()

  const adminUser = await resolveAdminAuthUser(service, normalizedPhone, parsed.data.name, {
    tenantId: parsed.data.tenantId,
  })
  if (!adminUser.ok) return { error: await tError('actionErrors.grantAdminFailed') }
  const adminUserId = adminUser.userId

  const result = await grantTenantAdminRole(parsed.data.tenantId, adminUserId, {
    userId,
    role: 'system_admin',
  })
  if (!result.ok) {
    return {
      error: await tError(adminRoleErrorKey(result.reason, 'actionErrors.grantAdminFailed')),
    }
  }

  revalidatePath('/admin/' + parsed.data.tenantId)
  return {}
}

// N20: remove someone's tenant admin role.
//
// Leaves their officials row intact and, since 20261026123231, demotes their
// role to 'official' rather than deleting it, so they stay an ordinary official
// who can still sign in — not a roster row nobody can reach. Their identity,
// assignments and consent state are kept;
// removing the person entirely is remove_official's job (0025), and SYS-02
// does not need a second way to do it.
export async function revokeTenantAdmin(
  tenantId: string,
  targetUserId: string
): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (!check.ok) return { error: check.error }
  const { userId } = check

  const parsed = revokeAdminSchema.safeParse({ tenantId, userId: targetUserId })
  if (!parsed.success) return { error: await tError('actionErrors.invalidRequest') }

  const result = await revokeTenantAdminRole(parsed.data.tenantId, parsed.data.userId, {
    userId,
    role: 'system_admin',
  })
  if (!result.ok) {
    return {
      error: await tError(adminRoleErrorKey(result.reason, 'actionErrors.revokeAdminFailed')),
    }
  }

  revalidatePath('/admin/' + parsed.data.tenantId)
  return {}
}

// N28: make someone a system admin, by phone number — the same identity
// path as grantTenantAdmin, through resolveAdminAuthUser. The role is global,
// so there is no tenant to validate and nothing to revalidate but the list.
export async function grantSystemAdmin(
  name: string,
  phone: string,
  phoneCountry: string
): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (!check.ok) return { error: check.error }
  const { userId } = check

  const parsed = grantSystemAdminSchema.safeParse({ name, phone, phoneCountry })
  if (!parsed.success) return { error: await tError('actionErrors.invalidRequest') }

  const normalizedPhone = normalizePhoneToE164(
    parsed.data.phone,
    parsed.data.phoneCountry as (typeof PHONE_COUNTRY_CODES)[number]
  )
  if (!normalizedPhone) return { error: await tError('actionErrors.invalidPhone') }

  const service = await createSupabaseServiceClient()
  const adminUser = await resolveAdminAuthUser(service, normalizedPhone, parsed.data.name, {
    scope: 'system_admin',
  })
  if (!adminUser.ok) return { error: await tError('actionErrors.grantAdminFailed') }

  const result = await grantSystemAdminRole(adminUser.userId, userId)
  if (!result.ok) return { error: await tError('actionErrors.grantAdminFailed') }

  revalidatePath('/admin/system-admins')
  return {}
}

// N28: remove someone's system admin role. Any tenant roles they hold stay.
//
// Removing yourself is refused here rather than in the RPC, which runs as
// service_role and cannot see who is calling. Without it, the last-admin
// guard would still stop an empty platform, but an admin could lock
// themselves out while others remain — a mistake only another admin can
// undo.
export async function revokeSystemAdmin(targetUserId: string): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (!check.ok) return { error: check.error }
  const { userId } = check

  const parsed = revokeSystemAdminSchema.safeParse({ userId: targetUserId })
  if (!parsed.success) return { error: await tError('actionErrors.invalidRequest') }

  if (parsed.data.userId === userId) {
    return { error: await tError('actionErrors.cannotChangeOwnAdminRole') }
  }

  const result = await revokeSystemAdminRole(parsed.data.userId, userId)
  if (!result.ok) {
    return {
      error: await tError(
        result.reason === 'lastAdmin'
          ? 'actionErrors.lastSystemAdminCannotRemove'
          : 'actionErrors.revokeAdminFailed'
      ),
    }
  }

  revalidatePath('/admin/system-admins')
  return {}
}

// N28: a system admin names themselves. Their name lives in auth
// user_metadata — they have no officials roster row to hold it, which is why
// ACCT-01 has nothing to offer them. Only the caller's own user is ever
// written: there is no target id to tamper with, so no audit event either,
// matching ACCT-01's own name edit.
export async function updateOwnSystemAdminName(name: string): Promise<{ error?: string }> {
  const check = await assertSystemAdmin()
  if (!check.ok) return { error: check.error }
  const { userId } = check

  const parsed = ownSystemAdminNameSchema.safeParse({ name })
  if (!parsed.success) return { error: await tError('actionErrors.invalidRequest') }

  // GoTrue merges user_metadata keys, so other metadata survives.
  const service = await createSupabaseServiceClient()
  const { error } = await service.auth.admin.updateUserById(userId, {
    user_metadata: { name: parsed.data.name },
  })
  if (error) {
    logger.error('System admin name update failed', error)
    return { error: await tError('actionErrors.updateNameFailed') }
  }

  revalidatePath('/admin/system-admins')
  return {}
}

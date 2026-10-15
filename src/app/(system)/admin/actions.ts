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

const setTenantActiveSchema = z.object({
  tenantId: z.string().uuid(),
  isActive: z.boolean(),
})

const setTenantTierSchema = z.object({
  tenantId: z.string().uuid(),
  tier: z.enum(['standard', 'premium', 'professional']),
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

const createTenantWithAdminSchema = z.object({
  name: z.string().trim().min(1),
  adminName: z.string().trim().min(1),
  adminPhone: z.string().min(1),
  adminPhoneCountry: z.enum(PHONE_COUNTRY_CODES as [string, ...string[]]),
})

type ResolvedAdminUser = { ok: true; userId: string } | { ok: false; error: string }

// Turns a phone number into an auth user id, creating the account when the
// number is new and reusing it when it is not.
//
// The auth row is created up front rather than lazily on first sign-in, for
// the same reason the officials invite route does it (src/app/api/officials/
// route.ts): it lets "Allow new users to sign up" stay disabled in Supabase
// Auth, so a phone number cannot self-register just by requesting an OTP.
//
// `name` is written to user_metadata because ensure_admin_roster_row
// (migration 20260911130436) builds the roster row's display name from
// raw_user_meta_data->>'name' and falls back to the phone number when it is
// empty — which is what made early admins appear named after their own number.
// An existing account keeps the name it already has: a system admin typing a
// name here must not silently rewrite one the person chose themselves.
async function resolveAdminAuthUser(
  service: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  normalizedPhone: string,
  name: string,
  logContext: Record<string, unknown>
): Promise<ResolvedAdminUser> {
  const { data: created, error: createUserError } = await service.auth.admin.createUser({
    phone: normalizedPhone,
    phone_confirm: true,
    user_metadata: { name },
  })

  if (!createUserError) return { ok: true, userId: created.user.id }

  if (createUserError.code !== 'phone_exists') {
    logger.error('Admin grant: failed to create auth user', createUserError, logContext)
    return { ok: false, error: await tError('actionErrors.grantAdminFailed') }
  }

  const { data: existingUserId, error: lookupError } = await service.rpc('get_user_id_by_phone', {
    p_phone: normalizedPhone,
  })

  if (lookupError || !existingUserId) {
    // phone_exists said the auth row is there, so an empty result is a real
    // inconsistency rather than an ordinary miss.
    logger.error(
      'Admin grant: phone exists but no auth user found',
      lookupError ?? undefined,
      logContext
    )
    return { ok: false, error: await tError('actionErrors.grantAdminFailed') }
  }

  const { data: existing } = await service.auth.admin.getUserById(existingUserId)
  const currentName =
    typeof existing?.user?.user_metadata?.name === 'string'
      ? existing.user.user_metadata.name.trim()
      : ''

  if (!currentName) {
    const { error: updateError } = await service.auth.admin.updateUserById(existingUserId, {
      user_metadata: { ...(existing?.user?.user_metadata ?? {}), name },
    })
    // Not fatal: the grant itself is what matters, and the roster row falls
    // back to the phone number for a display name. Logged so an odd-looking
    // name is traceable rather than mysterious.
    if (updateError) {
      logger.error('Admin grant: could not set name on existing auth user', updateError, logContext)
    }
  }

  return { ok: true, userId: existingUserId }
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
  if (!adminUser.ok) return { error: adminUser.error }

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
  if (!adminUser.ok) return { error: adminUser.error }
  const adminUserId = adminUser.userId

  const { data, error } = await service.rpc('grant_tenant_admin', {
    p_tenant_id: parsed.data.tenantId,
    p_user_id: adminUserId,
  })

  if (error) {
    // P0001 from the RPC is the cap being full — a normal outcome the system
    // admin should see explained, not a failure to log as an error.
    if (error.code === 'P0001') return { error: await tError('actionErrors.adminCapReached') }
    logger.error('Admin grant: RPC failed', error, { tenantId: parsed.data.tenantId })
    return { error: await tError('actionErrors.grantAdminFailed') }
  }

  const { granted } = data as unknown as { granted: boolean }

  // Only audit an actual change. Re-granting an existing admin is idempotent
  // and would otherwise fill the log with no-ops.
  if (granted) {
    await logAuditEvent({
      tenantId: parsed.data.tenantId,
      actorUserId: userId,
      actorRole: 'system_admin',
      action: 'tenant_admin_granted',
      targetType: 'user_role',
      targetId: adminUserId,
      detail: {},
    })
  }

  revalidatePath('/admin/' + parsed.data.tenantId)
  return {}
}

// N20: remove someone's tenant admin role.
//
// Leaves their officials row intact, so they stay an ordinary official of the
// tenant rather than losing their identity, assignments and consent state —
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

  const service = await createSupabaseServiceClient()
  const { data, error } = await service.rpc('revoke_tenant_admin', {
    p_tenant_id: parsed.data.tenantId,
    p_user_id: parsed.data.userId,
  })

  if (error) {
    // P0001 is the last-admin guard: refusing to leave a tenant with nobody
    // who can enter it. An expected outcome, not an error to log.
    if (error.code === 'P0001') return { error: await tError('actionErrors.lastAdminCannotRemove') }
    logger.error('Admin revoke: RPC failed', error, { tenantId: parsed.data.tenantId })
    return { error: await tError('actionErrors.revokeAdminFailed') }
  }

  const { revoked } = data as unknown as { revoked: boolean }

  if (revoked) {
    await logAuditEvent({
      tenantId: parsed.data.tenantId,
      actorUserId: userId,
      actorRole: 'system_admin',
      action: 'tenant_admin_revoked',
      targetType: 'user_role',
      targetId: parsed.data.userId,
      detail: {},
    })
  }

  revalidatePath('/admin/' + parsed.data.tenantId)
  return {}
}

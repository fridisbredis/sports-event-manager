// N20: tenant admins — listing them in order, and the per-tier cap.
// N27: granting and revoking the role, shared by SYS-02 and OFF-01.
//
// Kept out of lib/auth/tenant.ts deliberately. That module is the
// authorization spine (who may see what, per request, memoised); this one is
// the admin management surface that reads and writes role rows. Mixing them
// would put write paths behind helpers whose whole contract is that they are
// side-effect-free reads.

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/lib/audit/log-audit-event'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { maxTenantAdmins } from '@/lib/tiers/features'
import type { AuditActorRole } from '@/types/app'

// A tenant cannot hold more admin rows than the highest cap, so anything past
// this is a data-integrity trip-wire rather than a real limit — same reasoning
// as the other admin-facing read ceilings. Deliberately far above
// MAX_TENANT_ADMINS.professional so that a tenant that somehow exceeded its cap
// (a tier downgrade, a hand-edited row) still lists completely, locked rows
// included: hiding them would make the over-cap state invisible in the one
// screen meant to resolve it.
const TENANT_ADMIN_CEILING = 100

export type TenantAdmin = {
  userId: string
  name: string | null
  phone: string | null
  createdAt: string
  // False when this row falls outside the tenant's current tier cap: it is
  // still a tenant_admin row, but the login guard refuses it. Only ever true
  // for rows past the cap, which today means after a tier downgrade.
  lockedOut: boolean
}

// Every tenant_admin of a tenant, oldest first, each flagged with whether the
// tier cap currently admits it.
//
// Ordering is (created_at, id) — the migration's index covers exactly that.
// The id tiebreak matters: two admins added in the same microsecond would
// otherwise order arbitrarily per query, so a locked-out admin could appear to
// swap places with an active one between two page loads.
export async function listTenantAdmins(tenantId: string, tier: string): Promise<TenantAdmin[]> {
  const service = await createSupabaseServiceClient()

  const { data, error } = await service
    .from('user_roles')
    .select('id, user_id, created_at')
    .eq('tenant_id', tenantId)
    .eq('role', 'tenant_admin')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(0, TENANT_ADMIN_CEILING)

  if (error) {
    logger.error('Failed to list tenant admins', error, { tenantId })
    return []
  }

  const rows = checkReadCeiling(data ?? [], {
    ceiling: TENANT_ADMIN_CEILING,
    page: 'system-admin/tenant-detail',
    message: 'Tenant admin list hit its read ceiling — later admins are missing',
  })

  if (rows.length === 0) return []

  // The display name and phone live on `officials`, not on the role row.
  // Fetched in one query rather than per row. A tenant_admin added before
  // ensure_admin_roster_row (migration 20260911130436) existed may have no
  // roster row at all, so both fields are nullable all the way to the UI
  // rather than being faked here.
  const userIds = rows.map((row) => row.user_id)
  const { data: rosterRows, error: rosterError } = await service
    .from('officials')
    .select('user_id, name, phone')
    .eq('tenant_id', tenantId)
    .in('user_id', userIds)

  if (rosterError) {
    // A failed roster lookup must not hide the admins themselves — the cap and
    // the locked-out state are the point of this list, and both come from the
    // role rows. Degrade to ids rather than returning nothing.
    logger.error('Failed to fetch tenant admin roster rows', rosterError, { tenantId })
  }

  const roster = new Map(
    (rosterRows ?? []).map((row) => [row.user_id, { name: row.name, phone: row.phone }])
  )

  const cap = maxTenantAdmins(tier)

  return rows.map((row, index) => {
    const entry = roster.get(row.user_id)
    return {
      userId: row.user_id,
      name: entry?.name ?? null,
      phone: entry?.phone ?? null,
      createdAt: row.created_at,
      lockedOut: index >= cap,
    }
  })
}

// Whether `userId` is a tenant_admin of `tenantId` that the tier cap still
// admits. Used by the login guard, which is why it re-derives the order from
// the database rather than trusting a count: a tenant over its cap must admit
// exactly the first N, not the first N the caller happened to pass in.
//
// Returns false for a user with no tenant_admin row at all, so callers can use
// it as the single question "may this admin act for this tenant".
export async function isAdminWithinCap(
  userId: string,
  tenantId: string,
  tier: string
): Promise<boolean> {
  const admins = await listTenantAdmins(tenantId, tier)
  const match = admins.find((admin) => admin.userId === userId)

  return match !== undefined && !match.lockedOut
}

// How many more admins this tenant may add before it hits its cap. Never
// negative: a tenant already over its cap (after a downgrade) has no room,
// not negative room.
export function remainingAdminSlots(currentCount: number, tier: string): number {
  return Math.max(0, maxTenantAdmins(tier) - currentCount)
}

// No message on failure: this module sits under the auth spine (tenant.ts
// imports it), so callers translate. Every failure here is logged already.
export type ResolvedAdminUser = { ok: true; userId: string } | { ok: false }

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
// An existing account keeps the name it already has: an admin typing a name
// here must not silently rewrite one the person chose themselves.
//
// N27: moved here from (system)/admin/actions.ts so OFF-01 can promote an
// official who has no account yet (invited, or put on the roster directly)
// through the same path SYS-02 uses to add an admin by phone.
export async function resolveAdminAuthUser(
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
    return { ok: false }
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
    return { ok: false }
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

// Who is making a role change, for the audit row. The caller has already
// authorised them; these helpers do not re-check.
export type AdminRoleActor = { userId: string; role: AuditActorRole }

// Why a grant or revoke did not happen. A reason rather than a message,
// because SYS-02 and OFF-01 explain the same refusal differently: "raise the
// tier" is advice for a system admin, not for a tenant admin who cannot.
export type AdminRoleChangeResult =
  | { ok: true }
  | { ok: false; reason: 'capReached' | 'lastAdmin' | 'failed' }

// Makes `targetUserId` a tenant admin of `tenantId`, through the RPC that
// enforces the tier cap and writes the roster row in one transaction
// (20261015122314). The service client is required: the RPC is granted to
// service_role only, because it writes user_roles.
export async function grantTenantAdminRole(
  tenantId: string,
  targetUserId: string,
  actor: AdminRoleActor
): Promise<AdminRoleChangeResult> {
  const service = await createSupabaseServiceClient()
  const { data, error } = await service.rpc('grant_tenant_admin', {
    p_tenant_id: tenantId,
    p_user_id: targetUserId,
  })

  if (error) {
    // P0001 from the RPC is the cap being full — a normal outcome the caller
    // should see explained, not a failure to log as an error.
    if (error.code === 'P0001') return { ok: false, reason: 'capReached' }
    logger.error('Admin grant: RPC failed', error, { tenantId })
    return { ok: false, reason: 'failed' }
  }

  const { granted } = data as unknown as { granted: boolean }

  // Only audit an actual change. Re-granting an existing admin is idempotent
  // and would otherwise fill the log with no-ops.
  if (granted) {
    await logAuditEvent({
      tenantId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'tenant_admin_granted',
      targetType: 'user_role',
      targetId: targetUserId,
      detail: {},
    })
  }

  return { ok: true }
}

// Removes `targetUserId`'s tenant admin role. Since 20261026123231 the RPC
// demotes them to 'official' when they have a confirmed roster row, so they
// can still sign in; it deletes the role only for an admin with no roster row.
export async function revokeTenantAdminRole(
  tenantId: string,
  targetUserId: string,
  actor: AdminRoleActor
): Promise<AdminRoleChangeResult> {
  const service = await createSupabaseServiceClient()
  const { data, error } = await service.rpc('revoke_tenant_admin', {
    p_tenant_id: tenantId,
    p_user_id: targetUserId,
  })

  if (error) {
    // P0001 is the last-admin guard: refusing to leave a tenant with nobody
    // who can enter it. An expected outcome, not an error to log.
    if (error.code === 'P0001') return { ok: false, reason: 'lastAdmin' }
    logger.error('Admin revoke: RPC failed', error, { tenantId })
    return { ok: false, reason: 'failed' }
  }

  // `demoted` is optional: on a database where 20261026123231 has not been
  // applied yet, the old body returns `revoked` alone.
  const { revoked, demoted } = data as unknown as { revoked: boolean; demoted?: boolean }

  if (revoked) {
    await logAuditEvent({
      tenantId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'tenant_admin_revoked',
      targetType: 'user_role',
      targetId: targetUserId,
      detail: { demotedToOfficial: demoted ?? false },
    })
  }

  return { ok: true }
}

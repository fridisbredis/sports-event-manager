// N28: system admins — listing them, and granting and revoking the global
// role. The tenant-scoped counterpart is tenant-admins.ts; kept apart because
// this role opens every tenant, and its rules (no tenant, no tier cap, the
// last-admin guard counted platform-wide) share nothing with that one beyond
// the shape.

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/lib/audit/log-audit-event'
import { checkReadCeiling } from '@/lib/db/bounded-read'

// A data-integrity trip-wire, not a real limit: the platform has three system
// admins in prod. Far enough above that to never matter, low enough that the
// per-admin auth lookup below stays cheap.
const SYSTEM_ADMIN_CEILING = 50

export type SystemAdmin = {
  userId: string
  // From auth user_metadata: a system admin has no officials roster row to
  // take a name from. Null for one created by hand without a name.
  name: string | null
  phone: string | null
  createdAt: string
}

// Every system admin, oldest first.
//
// One person can hold several system_admin rows (see migration
// 20261026134923's header), so rows are collapsed to one entry per user,
// keeping their earliest row's created_at as "admin since".
export async function listSystemAdmins(): Promise<SystemAdmin[]> {
  const service = await createSupabaseServiceClient()

  const { data, error } = await service
    .from('user_roles')
    .select('id, user_id, created_at')
    .eq('role', 'system_admin')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(0, SYSTEM_ADMIN_CEILING)

  if (error) {
    logger.error('Failed to list system admins', error)
    return []
  }

  const rows = checkReadCeiling(data ?? [], {
    ceiling: SYSTEM_ADMIN_CEILING,
    page: 'system-admin/system-admins',
    message: 'System admin list hit its read ceiling — later admins are missing',
  })

  const firstRowByUser = new Map<string, string>()
  for (const row of rows) {
    if (!firstRowByUser.has(row.user_id)) firstRowByUser.set(row.user_id, row.created_at)
  }

  // auth.users is not reachable through PostgREST, so each admin is one
  // auth.admin call. Fine at this size; see SYSTEM_ADMIN_CEILING.
  return Promise.all(
    [...firstRowByUser].map(async ([userId, createdAt]) => {
      const { data: authData, error: authError } = await service.auth.admin.getUserById(userId)

      if (authError) {
        // Degrade to the id rather than dropping the admin: who holds the
        // role is the point of this list.
        logger.error('Failed to fetch system admin auth user', authError, { userId })
      }

      const user = authData?.user
      const rawName = user?.user_metadata?.name
      const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null

      return { userId, name, phone: user?.phone || null, createdAt }
    })
  )
}

// Why a grant or revoke did not happen. 'lastAdmin' is the RPC's P0001.
export type SystemAdminRoleChangeResult =
  | { ok: true }
  | { ok: false; reason: 'lastAdmin' | 'failed' }

// Makes `targetUserId` a system admin. The caller has already verified that
// `actorUserId` is one; this does not re-check.
export async function grantSystemAdminRole(
  targetUserId: string,
  actorUserId: string
): Promise<SystemAdminRoleChangeResult> {
  const service = await createSupabaseServiceClient()
  const { data, error } = await service.rpc('grant_system_admin', { p_user_id: targetUserId })

  if (error) {
    logger.error('System admin grant: RPC failed', error)
    return { ok: false, reason: 'failed' }
  }

  const { granted } = data as unknown as { granted: boolean }

  // Only an actual change is audited; re-granting is an idempotent no-op.
  if (granted) {
    await logAuditEvent({
      tenantId: null,
      actorUserId,
      actorRole: 'system_admin',
      action: 'system_admin_granted',
      targetType: 'user_role',
      targetId: targetUserId,
      detail: {},
    })
  }

  return { ok: true }
}

// Removes `targetUserId`'s system admin role, leaving any tenant roles they
// hold. Refusing self-removal is the caller's job: the RPC runs as
// service_role and cannot tell who is asking.
export async function revokeSystemAdminRole(
  targetUserId: string,
  actorUserId: string
): Promise<SystemAdminRoleChangeResult> {
  const service = await createSupabaseServiceClient()
  const { data, error } = await service.rpc('revoke_system_admin', { p_user_id: targetUserId })

  if (error) {
    // P0001 is the last-admin guard: an expected refusal, not an error.
    if (error.code === 'P0001') return { ok: false, reason: 'lastAdmin' }
    logger.error('System admin revoke: RPC failed', error)
    return { ok: false, reason: 'failed' }
  }

  const { revoked } = data as unknown as { revoked: boolean }

  if (revoked) {
    await logAuditEvent({
      tenantId: null,
      actorUserId,
      actorRole: 'system_admin',
      action: 'system_admin_revoked',
      targetType: 'user_role',
      targetId: targetUserId,
      detail: {},
    })
  }

  return { ok: true }
}

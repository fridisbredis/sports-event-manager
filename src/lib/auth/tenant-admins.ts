// N20: tenant admins — listing them in order, and the per-tier cap.
//
// Kept out of lib/auth/tenant.ts deliberately. That module is the
// authorization spine (who may see what, per request, memoised); this one is
// a system-admin management surface (SYS-02) that reads and writes role rows.
// Mixing them would put write paths behind helpers whose whole contract is
// that they are side-effect-free reads.

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { maxTenantAdmins } from '@/lib/tiers/features'

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

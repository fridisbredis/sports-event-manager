'use server'

import { redirect } from 'next/navigation'
import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'

import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireTenantAdmin, getAdminTenant } from '@/lib/auth/tenant'
import { logQueryError } from '@/lib/db/query-error'
import { adminDashboardCacheTag } from '@/lib/cache/tags'
import {
  resolveAdminAuthUser,
  grantTenantAdminRole,
  revokeTenantAdminRole,
  type AdminRoleChangeResult,
} from '@/lib/auth/tenant-admins'
import { logger } from '@/lib/logger'
import { translateActionError as tError } from '@/lib/actions/action-error'
import type { AuditActorRole } from '@/types/app'
import { adminEventRoutePattern } from '@/lib/events/paths'

// N27: a tenant admin makes an official an admin, or takes it back, from
// OFF-01. The role write itself is the same RPC SYS-02 uses (via
// lib/auth/tenant-admins.ts), so the tier cap and the last-admin guard hold
// here exactly as they do there — both are enforced inside the database, not
// by this file.

const inputSchema = z.object({
  tenantSlug: z.string().min(1),
  tenantId: z.string().uuid(),
  officialId: z.string().uuid(),
})

type Input = z.infer<typeof inputSchema>

type Actor = { userId: string; role: AuditActorRole }

type Target =
  | { ok: false; error: string }
  | { ok: true; actor: Actor; tenantId: string; userId: string }

/**
 * Authorises the caller and resolves the official they clicked on.
 *
 * The client sends an official id, never a user id: the official row is what
 * the admin clicked on, and resolving it here — filtered to this tenant —
 * means a crafted request cannot name a user from another tenant.
 *
 * Only a CONFIRMED official can be made admin (Frida 2026-10-26). An invited
 * row is a number someone typed: granting it admin would hand the event to
 * whoever holds that number, typo or not, and skip the consent step. The UI
 * greys the action out for invited rows; this is the check that holds.
 *
 * A confirmed official without an account (put on the roster directly, as
 * the seed does) gets one created or found by phone — the same thing SYS-02
 * does when it adds an admin by number — and grant_tenant_admin's
 * ensure_admin_roster_row then links this very row to it.
 *
 * The caller cannot change their own role. Demoting yourself is the one
 * action on this screen you cannot undo yourself, and the row for the current
 * user already shows no actions.
 */
async function resolveTarget(input: Input, mode: 'make' | 'remove'): Promise<Target> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: await tError('actionErrors.invalidRequest') }
  const { tenantId, officialId } = parsed.data

  // requireTenantAdmin rather than hasAdminAccessToTenant: the audit row
  // needs to know whether the actor is a tenant admin or a system admin, and
  // this is the helper that says. It also applies the N20 tier cap to the
  // caller, so a locked-out admin cannot grant roles either.
  const auth = await requireTenantAdmin(tenantId)
  if ('error' in auth) {
    if (auth.error.status === 401) redirect('/login')
    return { ok: false, error: await tError('actionErrors.notAuthorized') }
  }
  // requireTenantAdmin only ever returns 'system_admin' | 'tenant_admin',
  // though its type is the broader shared TenantRole.
  const actor: Actor = { userId: auth.user.id, role: auth.role as AuditActorRole }

  // The caller's own session, not the service client: tenant_admin_manage_
  // officials already lets them read this tenant's roster, and RLS then
  // backs up the tenant filter below.
  const supabase = await createSupabaseServerClient()
  const { data: official, error } = await supabase
    .from('officials')
    .select('user_id, name, phone, invite_status')
    .eq('id', officialId)
    .eq('tenant_id', tenantId)
    .neq('invite_status', 'removed')
    .maybeSingle()

  if (error) {
    logger.error('Admin role change: official lookup failed', error, { tenantId, officialId })
    return { ok: false, error: await tError('actionErrors.adminRoleOfficialUnavailable') }
  }

  if (!official) {
    return { ok: false, error: await tError('actionErrors.adminRoleOfficialUnavailable') }
  }

  if (official.invite_status !== 'confirmed') {
    return { ok: false, error: await tError('actionErrors.adminRoleRequiresConfirmed') }
  }

  let userId = official.user_id

  if (!userId) {
    // Nobody without an account can hold the role, so there is nothing to
    // remove — a stale page, since the link only says "remove" for admins.
    if (mode === 'remove') {
      return { ok: false, error: await tError('actionErrors.adminRoleOfficialUnavailable') }
    }

    // officials.phone is stored as international digits without the '+'
    // (0020's normalisation); auth wants E.164.
    const e164 = `+${official.phone.replace(/^\+/, '')}`
    // auth.admin.* needs the service client; the caller is authorised above.
    const service = await createSupabaseServiceClient()
    const resolved = await resolveAdminAuthUser(service, e164, official.name, {
      tenantId,
      officialId,
    })
    if (!resolved.ok) return { ok: false, error: await tError('actionErrors.grantAdminFailed') }
    userId = resolved.userId
  }

  if (userId === auth.user.id) {
    return { ok: false, error: await tError('actionErrors.cannotChangeOwnAdminRole') }
  }

  return { ok: true, actor, tenantId, userId }
}

// OFF-01's wording for a refused change. Unlike SYS-02's, it does not tell
// the reader to raise the tier — a tenant admin cannot.
async function refusal(
  reason: Extract<AdminRoleChangeResult, { ok: false }>['reason'],
  failedKey: string
) {
  if (reason === 'capReached') return tError('actionErrors.adminCapReachedForTenant')
  if (reason === 'lastAdmin') return tError('actionErrors.lastAdminCannotRemoveForTenant')
  return tError(failedKey)
}

export async function makeTenantAdmin(input: Input): Promise<{ error?: string }> {
  const target = await resolveTarget(input, 'make')
  if (!target.ok) return { error: target.error }

  const result = await grantTenantAdminRole(target.tenantId, target.userId, target.actor)
  if (!result.ok) return { error: await refusal(result.reason, 'actionErrors.grantAdminFailed') }

  revalidatePath(adminEventRoutePattern('officials'), 'page')
  return {}
}

export async function removeTenantAdmin(input: Input): Promise<{ error?: string }> {
  const target = await resolveTarget(input, 'remove')
  if (!target.ok) return { error: target.error }

  const result = await revokeTenantAdminRole(target.tenantId, target.userId, target.actor)
  if (!result.ok) return { error: await refusal(result.reason, 'actionErrors.revokeAdminFailed') }

  revalidatePath(adminEventRoutePattern('officials'), 'page')
  return {}
}

const addSchema = z.object({
  tenantSlug: z.string().min(1),
  eventId: z.string().uuid(),
  officialIds: z.array(z.string().uuid()).min(1).max(500),
})

// N23 (7c): add officials the tenant already has — from its other events —
// to this event. A person is one officials row per tenant, so inviting the
// same number again is refused as a duplicate; this is the way to bring them
// in instead.
//
// They join unseen (seen_at NULL), which is what shows the in-app "added to
// a new event" notice (N23 (b): in-app by default, no SMS). Invite status is
// per person: a confirmed official needs no new acceptance, an invited one
// joins still invited.
//
// One insert, so no RPC (REL-01). The ids are re-read under the tenant
// filter and RLS, so a crafted id from another tenant, or a removed
// official, is simply not added; the composite FK on official_events refuses
// an event from another tenant.
export async function addOfficialsToEvent(
  input: z.infer<typeof addSchema>
): Promise<{ error?: string; added?: number }> {
  const parsed = addSchema.safeParse(input)
  if (!parsed.success) return { error: await tError('actionErrors.invalidRequest') }
  const { tenantSlug, eventId, officialIds } = parsed.data

  const tenant = await getAdminTenant(tenantSlug)
  if (!tenant) return { error: await tError('actionErrors.notAuthorized') }

  const supabase = await createSupabaseServerClient()
  const { data: officials, error: readError } = await supabase
    .from('officials')
    .select('id')
    .eq('tenant_id', tenant.id)
    .in('id', officialIds)
    .neq('invite_status', 'removed')

  if (readError) {
    logQueryError(readError, {
      op: 'addOfficialsToEvent',
      table: 'officials',
      kind: 'select',
      tenantId: tenant.id,
      extra: { eventId },
    })
    return { error: await tError('actionErrors.addOfficialsFailed') }
  }
  if (!officials || officials.length === 0) {
    return { error: await tError('actionErrors.invalidRequest') }
  }

  const { data: inserted, error } = await supabase
    .from('official_events')
    .upsert(
      officials.map((o) => ({ official_id: o.id, event_id: eventId, tenant_id: tenant.id })),
      { onConflict: 'official_id,event_id', ignoreDuplicates: true }
    )
    .select('official_id')

  if (error) {
    logQueryError(error, {
      op: 'addOfficialsToEvent',
      table: 'official_events',
      kind: 'insert',
      tenantId: tenant.id,
      extra: { eventId, count: officials.length },
    })
    return { error: await tError('actionErrors.addOfficialsFailed') }
  }

  revalidatePath(adminEventRoutePattern('officials'), 'page')
  revalidatePath(adminEventRoutePattern('scheduling'), 'page')
  updateTag(adminDashboardCacheTag(tenant.id))

  return { added: inserted?.length ?? 0 }
}

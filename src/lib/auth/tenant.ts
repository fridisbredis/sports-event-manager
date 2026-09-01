import { cache } from 'react'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import type { User } from '@supabase/supabase-js'

const tenantIdSchema = z.string().uuid()

export type TenantRole = 'system_admin' | 'tenant_admin' | 'official' | 'participant'

export type UserRoleWithTenant = {
  role: TenantRole
  tenant_id: string | null
  tenantSlug: string
}

const ROLE_PRIORITY: Record<TenantRole, number> = {
  system_admin: 1,
  tenant_admin: 2,
  official: 3,
  participant: 4,
}

export async function getUserRoles(userId: string): Promise<UserRoleWithTenant[]> {
  const service = await createSupabaseServiceClient()
  const { data, error } = await service
    .from('user_roles')
    .select('role, tenant_id, tenants(slug)')
    .eq('user_id', userId)

  if (error || !data) return []

  return data.map((row) => ({
    role: row.role as TenantRole,
    tenant_id: row.tenant_id,
    tenantSlug: (row.tenants as { slug: string } | null)?.slug ?? '',
  }))
}

export function resolvePostLoginRedirect(roles: UserRoleWithTenant[]): string | null {
  if (roles.length === 0) return null

  const primary = [...roles].sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role])[0]

  switch (primary.role) {
    case 'system_admin':
      return '/admin'
    case 'tenant_admin':
      return `/${primary.tenantSlug}/admin/dashboard`
    case 'official':
      return `/${primary.tenantSlug}/home`
    case 'participant':
      return `/${primary.tenantSlug}/participant`
  }
}

export async function confirmOfficialInvite(userId: string, phone: string): Promise<string | null> {
  const service = await createSupabaseServiceClient()

  // SEC-04/F-SEC-11: confirm_official_invite_by_phone (migration 0018) does
  // the lookup, the atomic status-guarded update, and the user_roles insert
  // in one transaction, so concurrent logins for the same invited phone
  // can't both succeed.
  const { data, error } = await service.rpc('confirm_official_invite_by_phone', {
    p_user_id: userId,
    p_user_phone: phone,
  })

  if (error) return null

  const tenantId = (data as unknown as { tenant_id: string }).tenant_id

  const { data: tenant, error: tenantError } = await service
    .from('tenants')
    .select('slug')
    .eq('id', tenantId)
    .maybeSingle()

  if (tenantError) return null

  return tenant?.slug ?? null
}

type AuthSuccess = { user: User; role: TenantRole }
type AuthFailure = { error: NextResponse }

type RoleRow = { role: TenantRole; tenant_id: string | null }

type AccessContext = { roleRows: RoleRow[]; tenantIsActive: boolean }

// Loads everything an authorization decision for a single tenant needs: every
// role row the caller holds (across all tenants, so the global system_admin
// bypass can be evaluated) and whether the target tenant is active. Keep both
// queries on `.eq()` — supabase-js encodes those values, so a crafted tenantId
// has no filter text to inject into. `.or()` takes a raw filter string and
// would reopen that hole.
async function fetchAccessContext(userId: string, tenantId: string): Promise<AccessContext | null> {
  const service = createSupabaseServiceClient()

  const [roleResult, tenantResult] = await Promise.all([
    service.from('user_roles').select('role, tenant_id').eq('user_id', userId),
    service.from('tenants').select('is_active').eq('id', tenantId).maybeSingle(),
  ])

  if (roleResult.error) {
    logger.error('Failed to fetch user roles', roleResult.error)
    return null
  }

  if (tenantResult.error) {
    logger.error('Failed to fetch tenant status', tenantResult.error)
    return null
  }

  return {
    roleRows: (roleResult.data ?? []) as RoleRow[],
    tenantIsActive: tenantResult.data?.is_active ?? false,
  }
}

function isGlobalSystemAdmin(roleRows: RoleRow[]): boolean {
  return roleRows.some((row) => row.role === 'system_admin')
}

function hasTenantScopedRole(
  roleRows: RoleRow[],
  tenantId: string,
  allowedRoles: readonly TenantRole[]
): boolean {
  return roleRows.some((row) => row.tenant_id === tenantId && allowedRoles.includes(row.role))
}

// system_admin access is global — no per-tenant row required. A suspended
// (is_active = false) tenant stays administrable by a global system_admin so
// it can be reactivated, but a tenant-scoped tenant_admin loses access.
export async function hasAdminAccessToTenant(userId: string, tenantId: string): Promise<boolean> {
  if (!tenantIdSchema.safeParse(tenantId).success) return false

  const context = await fetchAccessContext(userId, tenantId)
  if (!context) return false

  if (isGlobalSystemAdmin(context.roleRows)) return true
  if (!context.tenantIsActive) return false

  return hasTenantScopedRole(context.roleRows, tenantId, ['tenant_admin'])
}

// Official surfaces — the mobile screens under (official)/[tenantSlug] — are
// visible to officials, tenant admins and system admins. Named for the surface
// rather than the role because three roles pass; "isOfficial" would read as a
// role check and invite the wrong call site.
// system_admin access is global — no per-tenant row required, same as
// hasAdminAccessToTenant, including the is_active exemption.
// Per docs/flows/officials-management-registration.md, an official only gains
// sign-in and access to these screens once Confirmed — Invited is SMS-link-only.
// tenant_admin/system_admin have no officials row and are exempt from this check.
export async function canViewOfficialSurfaces(userId: string, tenantId: string): Promise<boolean> {
  if (!tenantIdSchema.safeParse(tenantId).success) return false

  const context = await fetchAccessContext(userId, tenantId)
  if (!context) return false

  if (isGlobalSystemAdmin(context.roleRows)) return true
  if (!context.tenantIsActive) return false

  if (hasTenantScopedRole(context.roleRows, tenantId, ['tenant_admin'])) return true

  if (!hasTenantScopedRole(context.roleRows, tenantId, ['official'])) return false

  return (await getConfirmedOfficial(userId, tenantId)) !== null
}

/**
 * The caller's confirmed `officials` row for a tenant, or null.
 *
 * Memoised per render pass, and exported, for one reason: MYSCH-01 needs the
 * same row this guard needs. Before this, `canViewOfficialSurfaces` fetched it,
 * discarded everything but "did it exist", and the page then re-fetched the
 * identical row — a second dependent round trip on a path where PERF-01
 * measured every hop at ~67 ms under load. `cache()` collapses both callers
 * onto one query.
 *
 * Ask for a confirmed row and take the first, rather than asking for "the" row:
 * removal is a soft delete, so a re-invited official has both a 'removed' row and a
 * 'confirmed' row for this (user_id, tenant_id). maybeSingle() alone treats that
 * second row as an error, and the guard above reads any error as deny — locking a
 * legitimately confirmed official out of every official surface. limit(1) makes the
 * two-row shape unrepresentable instead of relying on it never occurring, so the
 * guard cannot fail closed on a data shape 0020 permits by design.
 *
 * Returns null on error, which keeps the guard's fail-closed behaviour: a query
 * failure must never read as "confirmed".
 */
export const getConfirmedOfficial = cache(
  async (userId: string, tenantId: string): Promise<{ id: string } | null> => {
    const service = createSupabaseServiceClient()
    const { data, error } = await service
      .from('officials')
      .select('id')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .eq('invite_status', 'confirmed')
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.error('Failed to fetch official invite status', error)
      return null
    }

    return data
  }
)

export async function requireSystemAdmin(): Promise<{ user: User } | AuthFailure> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const service = createSupabaseServiceClient()
  // user_roles is unique per (user_id, tenant_id), not per role, so a
  // system_admin can legally hold a row in more than one tenant. Fetch the
  // full set rather than a single row so that case authorizes instead of
  // erroring out via maybeSingle().
  const { data: roleRows, error } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'system_admin')

  if (error) {
    logger.error('Failed to fetch user role', error)
    return { error: NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
  }

  if (!roleRows || roleRows.length === 0) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { user }
}

// Defense-in-depth: RLS protects the database, but this also catches
// application-level logic errors where the wrong tenant_id is passed.
export async function requireTenantAdmin(tenantId: string): Promise<AuthSuccess | AuthFailure> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  if (!tenantIdSchema.safeParse(tenantId).success) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  // Use service client to look up role — bypasses RLS, which is fine
  // because we're using user.id from the verified session, not from input.
  // system_admin access is global — no per-tenant row required, same as hasAdminAccessToTenant.
  const service = createSupabaseServiceClient()
  const [roleResult, tenantResult] = await Promise.all([
    service.from('user_roles').select('role, tenant_id').eq('user_id', user.id),
    service.from('tenants').select('is_active').eq('id', tenantId).maybeSingle(),
  ])

  if (roleResult.error) {
    logger.error('Failed to fetch user role', roleResult.error)
    return { error: NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
  }

  if (tenantResult.error) {
    logger.error('Failed to fetch tenant status', tenantResult.error)
    return { error: NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
  }

  const roleRows = (roleResult.data ?? []) as RoleRow[]

  if (isGlobalSystemAdmin(roleRows)) {
    return { user, role: 'system_admin' }
  }

  const tenantScopedAdminRow = roleRows.find(
    (r) => r.tenant_id === tenantId && r.role === 'tenant_admin'
  )

  if (!tenantResult.data?.is_active || !tenantScopedAdminRow) {
    // No admin role in this active tenant and not a system_admin — could be a
    // malicious cross-tenant attempt, a suspended tenant, or a stale UI.
    // Either way, 403 is correct.
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { user, role: tenantScopedAdminRow.role }
}

export type ResolvedTenant = {
  id: string
  slug: string
  color_palette: string
  is_active: boolean
}

async function resolveTenantBySlug(tenantSlug: string): Promise<ResolvedTenant | null> {
  const service = createSupabaseServiceClient()
  const { data, error } = await service
    .from('tenants')
    .select('id, slug, color_palette, is_active')
    .eq('slug', tenantSlug)
    .maybeSingle()

  if (error) {
    logger.error('Failed to resolve tenant by slug', error)
    return null
  }

  return data
}

// Resolves a tenant slug to its row only once the caller has passed the admin
// access check for that tenant, so a page cannot read the tenant without also
// being gated by it. Returns null on a missing tenant or a failed check —
// callers should treat that as notFound().
export async function resolveTenantForAdmin(
  tenantSlug: string,
  userId: string
): Promise<ResolvedTenant | null> {
  const tenant = await resolveTenantBySlug(tenantSlug)
  if (!tenant) return null

  if (!(await hasAdminAccessToTenant(userId, tenant.id))) return null

  return tenant
}

// Same guarded-resolve pattern as resolveTenantForAdmin, gated by
// canViewOfficialSurfaces instead.
export async function resolveTenantForOfficial(
  tenantSlug: string,
  userId: string
): Promise<ResolvedTenant | null> {
  const tenant = await resolveTenantBySlug(tenantSlug)
  if (!tenant) return null

  if (!(await canViewOfficialSurfaces(userId, tenant.id))) return null

  return tenant
}

// ---------------------------------------------------------------------------
// Request-scoped memoisation (F-PERF-07)
// ---------------------------------------------------------------------------
//
// Every admin page render used to resolve the caller three times: once in the
// proxy, once in the tenant layout, and once in the page itself. Each
// auth.getUser() is a network round trip to GoTrue that validates the JWT
// against the database, and the layout/page pair additionally repeated the
// whole tenant lookup plus authorization check — 6 of 10 operations per render
// were duplicated work.
//
// Measured 2026-08-27 (npm run perf:measure, 20 concurrent sessions): GoTrue
// /user answered at p50 313 ms and p95 1748 ms, against a page p95 of
// 704-804 ms. A single p95 auth call therefore exceeded the whole page's p95,
// which is why all four PERF-01 read paths failed the 300% ceiling at a 0%
// error rate. The queries were never the bottleneck.
//
// React's cache() memoises for the duration of one render pass, which is
// exactly the scope needed: the layout and the pages beneath it share one
// resolution, and nothing leaks between requests. This is the Data Access Layer
// pattern the installed Next.js docs recommend for authorization
// (node_modules/next/dist/docs/01-app/02-guides/authentication.md).
//
// The proxy's own getUser() is deliberately NOT covered here. Proxy is a
// separate execution context — the same docs are explicit that it must not rely
// on shared modules — and @supabase/ssr needs that call to refresh the session
// cookie. It can be made cheaper, never deduplicated.
//
// Safety note: fetchAccessContext uses the service client, not the session
// client (ADR-0001, category 1 bootstrap lookup), so these queries do not
// depend on the request JWT. Memoising them per render cannot leak one user's
// access context into another user's request.

// Zero arguments on purpose. Reading the cookies internally means every caller
// in a render pass produces the same cache key, so the memoisation cannot be
// defeated by two callers passing subtly different arguments.
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

// One argument, not two: userId is derived internally rather than passed in,
// for the same cache-key reason. tenantSlug stays because it is genuinely part
// of the question's identity — a render may legitimately ask about more than
// one tenant.
//
// This does not weaken the layout-as-gate property. The layout and the page
// both still call it and both still act on the result; the authorization check
// is memoised, not skipped.
export const getAdminTenant = cache(async (tenantSlug: string): Promise<ResolvedTenant | null> => {
  const user = await getCurrentUser()
  if (!user) return null
  return resolveTenantForAdmin(tenantSlug, user.id)
})

// Official-surface counterpart. The official pages already went through
// resolveTenantForOfficial, so this only adds the memoisation.
export const getOfficialTenant = cache(
  async (tenantSlug: string): Promise<ResolvedTenant | null> => {
    const user = await getCurrentUser()
    if (!user) return null
    return resolveTenantForOfficial(tenantSlug, user.id)
  }
)

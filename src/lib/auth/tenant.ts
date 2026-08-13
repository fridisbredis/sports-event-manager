import { NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import type { User } from '@supabase/supabase-js'

export type TenantRole = 'system_admin' | 'tenant_admin' | 'official' | 'participant'

export type UserRoleWithTenant = {
  role: TenantRole
  tenant_id: string
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

  const { data: tenant } = await service.from('tenants').select('slug').eq('id', tenantId).maybeSingle()

  return tenant?.slug ?? null
}

type AuthSuccess = { user: User; role: TenantRole }
type AuthFailure = { error: NextResponse }

// system_admin access is global — no per-tenant row required.
export async function hasAdminAccessToTenant(userId: string, tenantId: string): Promise<boolean> {
  const service = await createSupabaseServiceClient()
  const { data } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .or(`and(tenant_id.eq.${tenantId},role.in.(tenant_admin,system_admin)),role.eq.system_admin`)
    .limit(1)
    .maybeSingle()
  return !!data
}

export async function requireSystemAdmin(): Promise<{ user: User } | AuthFailure> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const service = await createSupabaseServiceClient()
  const { data: roleRow } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'system_admin')
    .maybeSingle()

  if (!roleRow) {
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

  // Use service client to look up role — bypasses RLS, which is fine
  // because we're using user.id from the verified session, not from input.
  // system_admin access is global — no per-tenant row required, same as hasAdminAccessToTenant.
  const service = await createSupabaseServiceClient()
  const { data: roleRows, error } = await service
    .from('user_roles')
    .select('role, tenant_id')
    .eq('user_id', user.id)
    .or(`and(tenant_id.eq.${tenantId},role.in.(tenant_admin,system_admin)),role.eq.system_admin`)

  if (error) {
    console.error('Failed to fetch user role:', error)
    return { error: NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
  }

  if (!roleRows || roleRows.length === 0) {
    // User has no admin role in this tenant and isn't a system_admin —
    // could be a malicious cross-tenant attempt or just a stale UI. Either way, 403 is correct.
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const tenantRow = roleRows.find((r) => r.tenant_id === tenantId)
  const role = (tenantRow?.role ?? roleRows[0].role) as TenantRole

  return { user, role }
}

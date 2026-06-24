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
      return `/${primary.tenantSlug}/dashboard`
    case 'official':
      return `/${primary.tenantSlug}/assignments`
    case 'participant':
      return `/${primary.tenantSlug}/participant`
  }
}

type AuthSuccess = { user: User; role: TenantRole }
type AuthFailure = { error: NextResponse }

/**
 * Verifies that the current user is authenticated and has the tenant_admin
 * role for the given tenantId. Returns either { user, role } on success or
 * { error: NextResponse } that can be returned directly from a route handler.
 *
 * Defense-in-depth: RLS protects the database, but this also catches
 * application-level logic errors where the wrong tenant_id is passed.
 */
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
  const service = await createSupabaseServiceClient()
  const { data: roleRow, error } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch user role:', error)
    return { error: NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
  }

  if (!roleRow) {
    // User has no role in this tenant — could be a malicious cross-tenant attempt
    // or just a stale UI. Either way, 403 is correct.
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const role = roleRow.role as TenantRole

  if (role !== 'tenant_admin' && role !== 'system_admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { user, role }
}

import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { logAuditEvent } from '@/lib/audit/log-audit-event'
import { officialHomeCacheTag, adminDashboardCacheTag } from '@/lib/cache/tags'
import type { AuditActorRole } from '@/types/app'
import { z } from 'zod'

const deleteSchema = z.object({
  tenantId: z.string().uuid(),
})

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const tenantId = request.nextUrl.searchParams.get('tenantId')

  const parsed = deleteSchema.safeParse({ tenantId })
  if (!parsed.success) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }

  const auth = await requireTenantAdmin(parsed.data.tenantId)
  if ('error' in auth) return auth.error

  const supabase = await createSupabaseServerClient()

  // remove_official (migration 0025) does the following atomically, in one
  // transaction, as the caller's own session (SECURITY INVOKER — relies on
  // this caller's tenant_admin_manage_officials/_assignments and migration
  // 0024's tenant_admin_revoke_official_role RLS grants, not a bypass):
  //
  //   1. Free any assignments this official holds.
  //   2. Soft-delete the officials row — kept for history, but every live
  //      handle on it is dropped: user_id (so a later re-invite of the same
  //      person doesn't produce two rows sharing (user_id, tenant_id)), and
  //      invite_token/expiry (a bearer secret that has no reason to outlive
  //      the invitation).
  //   3. Revoke the official's user_roles row, scoped to role = 'official'
  //      so a tenant_admin who also holds an officials row keeps their
  //      admin access. A surviving row here would otherwise keep steering
  //      this phone's post-login redirect to this tenant forever, since
  //      resolvePostLoginRedirect reads user_roles alone.
  const { data, error } = await supabase.rpc('remove_official', {
    p_official_id: id,
    p_tenant_id: parsed.data.tenantId,
  })

  if (error) {
    if (error.message === 'not_found') {
      return NextResponse.json({ error: 'Official not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to remove official' }, { status: 500 })
  }

  // Migration 0048: remove_official returns the revoked official's user_id,
  // captured before the UPDATE nulls the officials row's own copy. Single
  // source for both the audit target below and the HOME-01 cache tag — this
  // route previously re-read it with its own pre-call select, which 0048
  // made redundant. Optional key + null-safe access: on a database where
  // 0048 has not been applied, user_id is absent from the jsonb response
  // rather than present-and-null.
  const revokedUserId = (data as unknown as { user_id?: string | null } | null)?.user_id ?? null

  if (revokedUserId) {
    // PERF-06 / F-PERF-04 Phase 1: { expire: 0 }, not profile="max" — a
    // removed official's cached greeting name (migration 0050) should not
    // keep showing for up to 60s after removal. Null means they never had a
    // user_id, so no HOME-01 cache entry exists to invalidate. On a database
    // predating 0048 this degrades to the 60s revalidate rather than going
    // stale indefinitely; 0048 is already on main, so that window is closed.
    revalidateTag(officialHomeCacheTag(parsed.data.tenantId, revokedUserId), {
      expire: 0,
    })
  }

  // PERF-06 / F-PERF-04 Phase 3: unconditional, unlike the tag above —
  // remove_official (step 1 in the comment above) frees this official's
  // assignments regardless of whether they ever had a user_id, and the
  // dashboard's officials counts change either way.
  revalidateTag(adminDashboardCacheTag(parsed.data.tenantId), { expire: 0 })

  await logAuditEvent({
    tenantId: parsed.data.tenantId,
    actorUserId: auth.user.id,
    // requireTenantAdmin only ever returns 'system_admin' | 'tenant_admin',
    // though its type is the broader shared TenantRole.
    actorRole: auth.role as AuditActorRole,
    action: 'role_revoked',
    targetType: 'user_role',
    targetId: revokedUserId,
    detail: { officialId: id },
  })

  return NextResponse.json({ ok: true })
}

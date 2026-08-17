import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireTenantAdmin } from '@/lib/auth/tenant'
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

  const service = await createSupabaseServiceClient()

  const { data: official } = await service
    .from('officials')
    .select('id, tenant_id, user_id')
    .eq('id', id)
    .eq('tenant_id', parsed.data.tenantId)
    .single()

  if (!official) {
    return NextResponse.json({ error: 'Official not found' }, { status: 404 })
  }

  // Free any assignments this official holds
  await service
    .from('assignments')
    .delete()
    .eq('official_id', id)
    .eq('tenant_id', parsed.data.tenantId)

  // The row is kept for history, but every live handle on it is dropped:
  //
  //   user_id — leaving the link in place means a later re-invite of the same person
  //     produces two rows sharing (user_id, tenant_id), a shape the per-user officials
  //     lookups cannot represent. Those lookups filter on invite_status too; clearing
  //     the link removes the ambiguity at the source rather than relying on every call
  //     site to filter correctly.
  //
  //   invite_token / expiry — the token is a bearer secret sitting in the removed
  //     official's SMS history. confirm_official_invite (0017) does reject a non-'invited'
  //     row, so the stale link cannot currently regain access, but the token has no
  //     reason to outlive the invitation and nothing else should have to enforce that.
  //     Multiple NULLs are fine under the unique constraint from 0010.
  //     Resend is unaffected: it already rejects anything that isn't 'invited'.
  const { error } = await service
    .from('officials')
    .update({
      invite_status: 'removed',
      user_id: null,
      invite_token: null,
      invite_token_expires_at: null,
    })
    .eq('id', id)
    .eq('tenant_id', parsed.data.tenantId)

  if (error) {
    return NextResponse.json({ error: 'Failed to remove official' }, { status: 500 })
  }

  // Removal is a soft delete on officials, but the role has to be revoked for real.
  // A surviving user_roles row keeps steering this phone's post-login redirect to
  // this tenant forever — even after every officials row here has been removed —
  // because resolvePostLoginRedirect reads user_roles alone and never looks at
  // invite_status.
  //
  // Scoped to role = 'official' deliberately: user_roles is unique per
  // (user_id, tenant_id), not per (user_id, tenant_id, role), so a tenant_admin who
  // also has an officials row holds a single tenant_admin row here. An unscoped
  // delete would revoke their admin access.
  //
  // Runs after the status update, so a failed update leaves the role intact rather
  // than half-revoking. Both steps are idempotent, so a 500 here is safe to retry.
  if (official.user_id) {
    const { error: roleError } = await service
      .from('user_roles')
      .delete()
      .eq('user_id', official.user_id)
      .eq('tenant_id', parsed.data.tenantId)
      .eq('role', 'official')

    if (roleError) {
      return NextResponse.json({ error: 'Failed to remove official' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

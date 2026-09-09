import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAuthEvent } from '@/lib/audit/log-auth-event'
import { officialHomeCacheTag, adminDashboardCacheTag } from '@/lib/cache/tags'
import { z } from 'zod'
import { logQueryError } from '@/lib/db/query-error'

const confirmSchema = z.object({
  token: z.string().uuid(),
  name: z.string().min(1),
  privacyAccepted: z.literal(true),
})

export async function POST(request: NextRequest) {
  const json = await request.json()
  const parsed = confirmSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { token, name, privacyAccepted } = parsed.data

  // User must be authenticated (OTP verified) before we confirm the invite.
  // Accept Bearer token from the Authorization header (set by the invite form
  // immediately after verifyOtp) to avoid relying on cookie propagation timing.
  const supabase = await createSupabaseServerClient()
  const authHeader = request.headers.get('Authorization')
  let user = null
  let authError = null

  if (authHeader?.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7)
    const { data, error } = await supabase.auth.getUser(bearerToken)
    user = data.user
    authError = error
  } else {
    const { data, error } = await supabase.auth.getUser()
    user = data.user
    authError = error
  }

  // An expired or malformed token is the ordinary path to the 401 below and is
  // not logged — that is a user with a stale session, not a defect. Anything
  // else (Auth unreachable, a 5xx from GoTrue) would otherwise be
  // indistinguishable from it, and the invitee just sees "Unauthorized".
  if (authError && authError.status !== undefined && authError.status >= 500) {
    logQueryError(authError, {
      op: 'POST /api/officials/confirm',
      table: 'auth.users',
      kind: 'select',
      extra: { via: authHeader?.startsWith('Bearer ') ? 'bearer' : 'cookie' },
    })
  }

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!user.phone) {
    return NextResponse.json(
      { error: 'No verified phone on account', code: 'phone_mismatch' },
      { status: 403 }
    )
  }

  const service = await createSupabaseServiceClient()

  // SEC-04: confirm_official_invite (migration 0017) does the phone-match
  // check and the whole read-check-update-upsert atomically in one
  // transaction, so concurrent confirm attempts can't both succeed.
  const { data, error } = await service.rpc('confirm_official_invite', {
    p_token: token,
    p_user_id: user.id,
    p_user_phone: user.phone,
    p_name: name,
    p_privacy_accepted: privacyAccepted,
  })

  if (error) {
    switch (error.message) {
      case 'not_found':
      case 'expired':
        return NextResponse.json(
          { error: 'Invite not found or expired', code: 'not_found' },
          { status: 404 }
        )
      case 'already_confirmed':
        return NextResponse.json(
          { error: 'Invite already confirmed', code: 'already_confirmed' },
          { status: 409 }
        )
      case 'phone_mismatch':
        return NextResponse.json(
          { error: 'Phone number does not match the invitation', code: 'phone_mismatch' },
          { status: 403 }
        )
      case 'privacy_not_accepted':
        return NextResponse.json(
          { error: 'Privacy policy must be accepted', code: 'privacy_not_accepted' },
          { status: 400 }
        )
      default:
        // The named cases above are the RPC's deliberate business-rule
        // signals (migration 0017) and are not defects. Reaching here means
        // something else went wrong — a schema change, an RLS regression, a
        // renamed raise — and this is the branch that used to 500 silently.
        logQueryError(error, {
          op: 'POST /api/officials/confirm',
          table: 'confirm_official_invite',
          kind: 'rpc',
        })
        return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
    }
  }

  const { tenant_id: tenantId, role_granted: roleGranted } = data as unknown as {
    tenant_id: string
    role_granted: boolean
  }

  // PERF-06 / F-PERF-04 Phase 1: this confirm just flipped invite_status to
  // 'confirmed' and set officials.name — HOME-01's cached read (migration
  // 0050) would otherwise keep serving the stale pre-confirm shape (no name,
  // treated as not-yet-confirmed) for up to the 60s revalidate window.
  // { expire: 0 } (immediate), not the docs' recommended profile="max": this
  // route redirects straight to /home right after, and "max" would still
  // serve the stale pre-confirm shape on that very next load — the opposite
  // of what invalidating here is for. updateTag isn't available — this is a
  // Route Handler, not a Server Action.
  revalidateTag(officialHomeCacheTag(tenantId, user.id), { expire: 0 })

  // PERF-06 / F-PERF-04 Phase 3: this confirm just moved one official from
  // invited to confirmed on the dashboard's officials counts. Same
  // { expire: 0 } / Route-Handler reasoning as the HOME-01 tag above.
  revalidateTag(adminDashboardCacheTag(tenantId), { expire: 0 })

  // SEC-07: only log when the RPC actually inserted a user_roles row.
  // confirm_official_invite's insert is `on conflict do nothing`, so a
  // successful call does not always mean a grant happened (migration 0043).
  // Fire-and-forget, not awaited: logAuthEvent is already fail-safe
  // internally (try/catch, logs via logger.error), so there is nothing
  // useful to await here — awaiting it would couple this route's latency
  // to auth_events' write latency and let a hypothetical future throw
  // inside logAuthEvent turn a successful confirmation into a 500.
  if (roleGranted) {
    void logAuthEvent({
      phone: user.phone,
      event: 'role_granted_via_invite_confirmation',
      actorUserId: user.id,
      tenantId,
      detail: { role: 'official' },
    })
  }

  const { data: tenant, error: tenantError } = await service
    .from('tenants')
    .select('slug')
    .eq('id', tenantId)
    .maybeSingle()

  // The confirmation itself already committed, so this must not fail the
  // request — but a missing slug drops the caller's post-confirm redirect, so
  // it should not be silent either.
  if (tenantError) {
    logQueryError(tenantError, {
      op: 'POST /api/officials/confirm',
      table: 'tenants',
      kind: 'select',
      tenantId,
      extra: { usage: 'post_confirm_redirect' },
    })
  }

  return NextResponse.json({ ok: true, tenantSlug: tenant?.slug })
}

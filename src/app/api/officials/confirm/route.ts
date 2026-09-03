import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAuthEvent } from '@/lib/audit/log-auth-event'
import { z } from 'zod'

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

  if (authHeader?.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7)
    const { data } = await supabase.auth.getUser(bearerToken)
    user = data.user
  } else {
    const { data } = await supabase.auth.getUser()
    user = data.user
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
        return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
    }
  }

  const { tenant_id: tenantId, role_granted: roleGranted } = data as unknown as {
    tenant_id: string
    role_granted: boolean
  }

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

  const { data: tenant } = await service
    .from('tenants')
    .select('slug')
    .eq('id', tenantId)
    .maybeSingle()

  return NextResponse.json({ ok: true, tenantSlug: tenant?.slug })
}

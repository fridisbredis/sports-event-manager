import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import {
  checkClaimListSendRateLimit,
  checkLoginSendRateLimit,
  type RateLimitResult,
} from '@/lib/rate-limit'
import { stripE164Plus } from '@/lib/phone'
import { logAuthEvent } from '@/lib/audit/log-auth-event'
import { logger } from '@/lib/logger'
import { isExpectedAuthError } from '@/lib/auth/auth-error-keys'
import { loadClaimTarget } from '@/lib/participants/claim-target'

// N40 (CLAIM-02, L2, L15): the claim form's "Send code".
//
// Reached without a session (src/proxy.ts exempts this exact path), so the
// checks here are the whole guard:
//
//   1. The token and participant id must name an OPEN event and an offered
//      row in it (loadClaimTarget). No SMS is ever sent for a closed event or
//      an unknown row. A row someone already claimed DOES get a code (N42):
//      "This is me" needs a verified number to store as the conflict, and
//      the rate limits below bound it exactly as they bound a first claim.
//   2. Rate limits (L15), per number and per claim list. The per-number half
//      is the sign-in bucket itself (checkLoginSendRateLimit): one number,
//      one budget of codes, whichever page asks.
//   3. The code goes through Supabase Auth, exactly as sign-in does, and is
//      NOT counted toward the N24 SMS cap (Frida 2026-11-10): a cap that can
//      stop sign-in codes locks people out of the app, and N24 already
//      decided login OTP is never capped.

const schema = z.object({
  token: z.string().uuid(),
  participantId: z.string().uuid(),
  // E.164, leading '+' optional — the same rule as /api/auth/send-otp. The
  // form normalizes what the runner typed before posting.
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
})

const OP = 'POST /api/claim/send-otp'

function rateLimitFailure(err: unknown, phone: string, tenantId: string) {
  const cause =
    err instanceof Error ? (err.cause as { message?: unknown } | undefined)?.message : undefined
  try {
    logger.error('Claim send rate limit check failed', undefined, { cause: cause ?? 'unknown' })
  } catch {
    // Logging must never be able to change the response.
  }
  void logAuthEvent({
    phone,
    event: 'otp_send_rate_limit_error',
    tenantId,
    detail: { via: 'claim' },
  })
  return NextResponse.json({ error: 'Rate limit check failed' }, { status: 503 })
}

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null)
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { token, participantId } = parsed.data
  const phone = stripE164Plus(parsed.data.phone)

  const target = await loadClaimTarget(createSupabaseServiceClient(), token, participantId, OP)
  if (target.kind === 'not_found') {
    return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
  }
  if (target.kind === 'closed') {
    return NextResponse.json({ error: 'Claiming is not open', code: 'not_open' }, { status: 403 })
  }
  // Number first (the narrower limit), and short-circuit on reject so a
  // blocked number does not also spend the list's budget — the same order
  // checkInviteRateLimit uses.
  let rateLimit: RateLimitResult
  try {
    rateLimit = await checkLoginSendRateLimit(phone)
    if (rateLimit.allowed) rateLimit = await checkClaimListSendRateLimit(target.eventId)
  } catch (err) {
    return rateLimitFailure(err, phone, target.tenantId)
  }
  if (!rateLimit.allowed) {
    void logAuthEvent({
      phone,
      event: 'otp_send_rate_limited',
      tenantId: target.tenantId,
      detail: { via: 'claim' },
    })
    return NextResponse.json(
      { error: 'Too many requests', code: 'over_request_rate_limit' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    )
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithOtp({ phone })
  if (error) {
    // Same split as /api/auth/send-otp: error.code is a stable GoTrue enum
    // the form maps to a translated message; error.message is for logs.
    const details = { code: error.code, message: error.message }
    if (isExpectedAuthError(error.code)) {
      logger.warn('Claim signInWithOtp failed', details)
    } else {
      logger.error('Claim signInWithOtp failed', undefined, details)
    }
    void logAuthEvent({
      phone,
      event: 'otp_send_failed',
      errorCode: error.code ?? null,
      tenantId: target.tenantId,
      detail: { via: 'claim' },
    })
    return NextResponse.json(
      { error: 'Request failed', code: error.code },
      { status: error.status ?? 400 }
    )
  }

  void logAuthEvent({
    phone,
    event: 'otp_send_succeeded',
    tenantId: target.tenantId,
    detail: { via: 'claim' },
  })
  return NextResponse.json({ ok: true })
}

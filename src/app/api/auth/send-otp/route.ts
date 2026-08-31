import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkLoginSendRateLimit, type RateLimitResult } from '@/lib/rate-limit'
import { logAuthEvent } from '@/lib/audit/log-auth-event'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// E.164: leading +, then 1-15 digits. The client already normalized via
// normalizePhoneToE164 before calling here — this just rejects malformed input.
const sendOtpSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/),
})

// F-SEC-08: login has no server route in front of it today, so it has no
// rate limiting — POST /api/officials already solved this shape for invites
// (checkInviteRateLimit); this mirrors that pattern for login OTP requests.
export async function POST(request: NextRequest) {
  const json = await request.json()
  const parsed = sendOtpSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  }
  const { phone } = parsed.data

  let rateLimit: RateLimitResult
  try {
    rateLimit = await checkLoginSendRateLimit(phone)
  } catch (err) {
    const cause =
      err instanceof Error ? (err.cause as { message?: unknown } | undefined)?.message : undefined
    try {
      logger.error('Login send rate limit check failed', undefined, { cause: cause ?? 'unknown' })
    } catch {
      // Logging must never be able to change the response.
    }
    await logAuthEvent({ phone, event: 'otp_send_rate_limit_error' })
    return NextResponse.json({ error: 'Rate limit check failed' }, { status: 503 })
  }
  if (!rateLimit.allowed) {
    await logAuthEvent({ phone, event: 'otp_send_rate_limited' })
    return NextResponse.json(
      { error: 'Too many requests', code: 'over_request_rate_limit' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    )
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithOtp({ phone })
  if (error) {
    // CLAUDE.md: never expose raw errors to the client — error.code is a
    // stable GoTrue enum the login page already maps to a translated
    // message; error.message is developer-worded prose meant for logs.
    logger.error('signInWithOtp failed', undefined, { code: error.code, message: error.message })
    await logAuthEvent({ phone, event: 'otp_send_failed', errorCode: error.code ?? null })
    return NextResponse.json(
      { error: 'Request failed', code: error.code },
      { status: error.status ?? 400 }
    )
  }

  await logAuthEvent({ phone, event: 'otp_send_succeeded' })
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkLoginVerifyRateLimit, type RateLimitResult } from '@/lib/rate-limit'
import { logAuthEvent } from '@/lib/audit/log-auth-event'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const verifyOtpSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/),
  token: z.string().length(6),
})

// Routed through the server (rather than the browser calling verifyOtp
// directly) so the OTP guess can be rate-limited — see send-otp/route.ts.
// Uses the cookie-bound server client so a successful verify persists the
// session into sb-* cookies on this response, same as the browser client did.
export async function POST(request: NextRequest) {
  const json = await request.json()
  const parsed = verifyOtpSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { phone, token } = parsed.data

  let rateLimit: RateLimitResult
  try {
    rateLimit = await checkLoginVerifyRateLimit(phone)
  } catch (err) {
    const cause =
      err instanceof Error ? (err.cause as { message?: unknown } | undefined)?.message : undefined
    try {
      logger.error('Login verify rate limit check failed', undefined, {
        cause: cause ?? 'unknown',
      })
    } catch {
      // Logging must never be able to change the response.
    }
    await logAuthEvent({ phone, event: 'otp_verify_rate_limit_error' })
    return NextResponse.json({ error: 'Rate limit check failed' }, { status: 503 })
  }
  if (!rateLimit.allowed) {
    await logAuthEvent({ phone, event: 'otp_verify_rate_limited' })
    return NextResponse.json(
      { error: 'Too many attempts', code: 'over_request_rate_limit' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    )
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' })
  if (error) {
    // CLAUDE.md: never expose raw errors to the client — error.code is a
    // stable GoTrue enum the login page already maps to a translated
    // message; error.message is developer-worded prose meant for logs.
    logger.error('verifyOtp failed', undefined, { code: error.code, message: error.message })
    await logAuthEvent({ phone, event: 'otp_verify_failed', errorCode: error.code ?? null })
    return NextResponse.json(
      { error: 'Request failed', code: error.code },
      { status: error.status ?? 400 }
    )
  }

  if (!data.user) {
    // GoTrue's contract is that a null error implies a populated user for
    // this call — this branch means that contract broke. Treat it as a
    // failure (never respond ok:true for a login the audit trail can't
    // attribute to anyone) rather than silently logging a "succeeded" row
    // with a null actor, which is indistinguishable from an intentionally
    // anonymous event.
    logger.error('verifyOtp returned no error but no user', undefined, { phone: '[redacted]' })
    await logAuthEvent({ phone, event: 'otp_verify_failed', errorCode: 'no_user_in_response' })
    return NextResponse.json(
      { error: 'Request failed', code: 'no_user_in_response' },
      {
        status: 500,
      }
    )
  }

  await logAuthEvent({ phone, event: 'otp_verify_succeeded', actorUserId: data.user.id })
  return NextResponse.json({ ok: true })
}

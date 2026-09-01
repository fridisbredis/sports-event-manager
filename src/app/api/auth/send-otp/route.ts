import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkLoginSendRateLimit, type RateLimitResult } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// E.164, leading '+' optional. normalizePhoneToE164 strips the '+' so its output
// matches the shape Supabase Auth stores in user.phone, and that stripped value is
// what the login page posts — requiring the '+' here rejected every real login.
// GoTrue normalizes either shape, so both are accepted and passed through as-is.
const sendOtpSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
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
    return NextResponse.json({ error: 'Rate limit check failed' }, { status: 503 })
  }
  if (!rateLimit.allowed) {
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
    return NextResponse.json(
      { error: 'Request failed', code: error.code },
      { status: error.status ?? 400 }
    )
  }

  return NextResponse.json({ ok: true })
}

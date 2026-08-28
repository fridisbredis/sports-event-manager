import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkLoginVerifyRateLimit, type RateLimitResult } from '@/lib/rate-limit'
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
    return NextResponse.json({ error: 'Rate limit check failed' }, { status: 503 })
  }
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts', code: 'over_request_rate_limit' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    )
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' })
  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status ?? 400 }
    )
  }

  return NextResponse.json({ ok: true })
}

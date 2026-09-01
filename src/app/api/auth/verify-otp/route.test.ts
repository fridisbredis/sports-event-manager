import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkLoginVerifyRateLimit } from '@/lib/rate-limit'
import { logAuthEvent } from '@/lib/audit/log-auth-event'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkLoginVerifyRateLimit: vi.fn(),
}))

vi.mock('@/lib/audit/log-auth-event', () => ({
  logAuthEvent: vi.fn(),
}))

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// What normalizePhoneToE164 actually produces: E.164 with the '+' stripped.
const PHONE = '46701234567'
const TOKEN = '123456'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/auth/verify-otp', () => {
  it('returns 400 for a malformed request', async () => {
    vi.mocked(checkLoginVerifyRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })

    const res = await POST(makeRequest({ phone: PHONE, token: '123' }))

    expect(res.status).toBe(400)
    expect(checkLoginVerifyRateLimit).not.toHaveBeenCalled()
  })

  it('returns 429 with Retry-After when the rate limit is exceeded, without calling GoTrue', async () => {
    vi.mocked(checkLoginVerifyRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 300,
    })

    const res = await POST(makeRequest({ phone: PHONE, token: TOKEN }))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('300')
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
    expect(logAuthEvent).toHaveBeenCalledWith({ phone: PHONE, event: 'otp_verify_rate_limited' })
  })

  it('returns 503 when the rate limit check itself fails', async () => {
    vi.mocked(checkLoginVerifyRateLimit).mockRejectedValue(new Error('db down'))

    const res = await POST(makeRequest({ phone: PHONE, token: TOKEN }))

    expect(res.status).toBe(503)
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
    expect(logAuthEvent).toHaveBeenCalledWith({
      phone: PHONE,
      event: 'otp_verify_rate_limit_error',
    })
  })

  it('calls verifyOtp and returns ok when under the limit', async () => {
    vi.mocked(checkLoginVerifyRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    const verifyOtp = vi.fn().mockResolvedValue({ error: null, data: { user: { id: 'user-1' } } })
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { verifyOtp },
    } as never)

    const res = await POST(makeRequest({ phone: PHONE, token: TOKEN }))
    const body = await res.json()

    expect(verifyOtp).toHaveBeenCalledWith({ phone: PHONE, token: TOKEN, type: 'sms' })
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(logAuthEvent).toHaveBeenCalledWith({
      phone: PHONE,
      event: 'otp_verify_succeeded',
      actorUserId: 'user-1',
    })
  })

  // See send-otp/route.test.ts — the '+' is optional, both shapes pass through.
  it('also accepts E.164 with a leading +', async () => {
    vi.mocked(checkLoginVerifyRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    const verifyOtp = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { verifyOtp },
    } as never)

    const res = await POST(makeRequest({ phone: `+${PHONE}`, token: TOKEN }))

    expect(verifyOtp).toHaveBeenCalledWith({ phone: `+${PHONE}`, token: TOKEN, type: 'sms' })
    expect(res.status).toBe(200)
  })

  it('never forwards GoTrue error.message to the client', async () => {
    vi.mocked(checkLoginVerifyRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    const verifyOtp = vi.fn().mockResolvedValue({
      error: { message: 'some internal GoTrue detail', code: 'otp_expired', status: 400 },
    })
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { verifyOtp },
    } as never)

    const res = await POST(makeRequest({ phone: PHONE, token: TOKEN }))
    const body = await res.json()

    expect(body.error).not.toContain('internal GoTrue detail')
    expect(body.code).toBe('otp_expired')
    expect(logAuthEvent).toHaveBeenCalledWith({
      phone: PHONE,
      event: 'otp_verify_failed',
      errorCode: 'otp_expired',
    })
  })

  it('treats a null error with no user as a failure, not a success', async () => {
    vi.mocked(checkLoginVerifyRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    const verifyOtp = vi.fn().mockResolvedValue({ error: null, data: { user: null } })
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { verifyOtp },
    } as never)

    const res = await POST(makeRequest({ phone: PHONE, token: TOKEN }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.code).toBe('no_user_in_response')
    expect(logAuthEvent).toHaveBeenCalledWith({
      phone: PHONE,
      event: 'otp_verify_failed',
      errorCode: 'no_user_in_response',
    })
    expect(logAuthEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'otp_verify_succeeded' })
    )
  })
})

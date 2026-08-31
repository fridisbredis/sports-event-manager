import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkLoginSendRateLimit } from '@/lib/rate-limit'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkLoginSendRateLimit: vi.fn(),
}))

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const PHONE = '+46701234567'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/auth/send-otp', () => {
  it('returns 400 for a malformed phone number', async () => {
    vi.mocked(checkLoginSendRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })

    const res = await POST(makeRequest({ phone: 'not-a-phone' }))

    expect(res.status).toBe(400)
    expect(checkLoginSendRateLimit).not.toHaveBeenCalled()
  })

  it('returns 429 with Retry-After when the rate limit is exceeded, without calling GoTrue', async () => {
    vi.mocked(checkLoginSendRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 120,
    })

    const res = await POST(makeRequest({ phone: PHONE }))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('120')
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })

  it('returns 503 when the rate limit check itself fails', async () => {
    vi.mocked(checkLoginSendRateLimit).mockRejectedValue(new Error('db down'))

    const res = await POST(makeRequest({ phone: PHONE }))

    expect(res.status).toBe(503)
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })

  it('calls signInWithOtp and returns ok when under the limit', async () => {
    vi.mocked(checkLoginSendRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithOtp },
    } as never)

    const res = await POST(makeRequest({ phone: PHONE }))
    const body = await res.json()

    expect(signInWithOtp).toHaveBeenCalledWith({ phone: PHONE })
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
  })

  it('never forwards GoTrue error.message to the client', async () => {
    vi.mocked(checkLoginSendRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    const signInWithOtp = vi.fn().mockResolvedValue({
      error: {
        message: 'some internal GoTrue detail',
        code: 'over_sms_send_rate_limit',
        status: 429,
      },
    })
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { signInWithOtp },
    } as never)

    const res = await POST(makeRequest({ phone: PHONE }))
    const body = await res.json()

    expect(body.error).not.toContain('internal GoTrue detail')
    expect(body.code).toBe('over_sms_send_rate_limit')
  })
})

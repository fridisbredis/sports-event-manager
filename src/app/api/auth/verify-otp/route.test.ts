import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkLoginVerifyRateLimit } from '@/lib/rate-limit'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkLoginVerifyRateLimit: vi.fn(),
}))

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const PHONE = '+46701234567'
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
  })

  it('returns 503 when the rate limit check itself fails', async () => {
    vi.mocked(checkLoginVerifyRateLimit).mockRejectedValue(new Error('db down'))

    const res = await POST(makeRequest({ phone: PHONE, token: TOKEN }))

    expect(res.status).toBe(503)
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })

  it('calls verifyOtp and returns ok when under the limit', async () => {
    vi.mocked(checkLoginVerifyRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    const verifyOtp = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { verifyOtp },
    } as never)

    const res = await POST(makeRequest({ phone: PHONE, token: TOKEN }))
    const body = await res.json()

    expect(verifyOtp).toHaveBeenCalledWith({ phone: PHONE, token: TOKEN, type: 'sms' })
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
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
  })
})

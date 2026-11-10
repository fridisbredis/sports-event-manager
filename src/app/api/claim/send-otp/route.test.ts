import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import { POST } from './route'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkClaimListSendRateLimit, checkLoginSendRateLimit } from '@/lib/rate-limit'
import { logAuthEvent } from '@/lib/audit/log-auth-event'
import { loadClaimTarget } from '@/lib/participants/claim-target'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(() => ({})),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkLoginSendRateLimit: vi.fn(),
  checkClaimListSendRateLimit: vi.fn(),
}))
vi.mock('@/lib/audit/log-auth-event', () => ({ logAuthEvent: vi.fn() }))
vi.mock('@/lib/participants/claim-target', () => ({ loadClaimTarget: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

const TOKEN = '0b8a3c3e-6f1d-4c55-9a43-0f5e2b7d9a11'
const PARTICIPANT = '22222222-2222-4222-8222-222222222222'
const PHONE = '46701234567'

const signInWithOtp = vi.fn()

function request(body: unknown) {
  return new NextRequest('http://localhost/api/claim/send-otp', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const valid = { token: TOKEN, participantId: PARTICIPANT, phone: `+${PHONE}` }

function openTarget(claimed = false) {
  vi.mocked(loadClaimTarget).mockResolvedValue({
    kind: 'open',
    event: { name: 'Viadal', logoUrl: null, palette: 'default' },
    eventId: 'event-1',
    tenantId: 'tenant-1',
    participant: { id: PARTICIPANT, bib: '101', name: 'Lisa Nord', claimed },
  })
}

const allowed = { allowed: true, retryAfterSeconds: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ auth: { signInWithOtp } } as never)
  signInWithOtp.mockResolvedValue({ error: null })
  vi.mocked(checkLoginSendRateLimit).mockResolvedValue(allowed)
  vi.mocked(checkClaimListSendRateLimit).mockResolvedValue(allowed)
})

describe('POST /api/claim/send-otp (N40)', () => {
  it('sends a code through Supabase Auth to the normalized number', async () => {
    openTarget()

    const res = await POST(request(valid))

    expect(res.status).toBe(200)
    expect(loadClaimTarget).toHaveBeenCalledWith(
      expect.anything(),
      TOKEN,
      PARTICIPANT,
      expect.any(String)
    )
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: PHONE })
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'otp_send_succeeded', tenantId: 'tenant-1' })
    )
  })

  it('rejects a malformed body before looking anything up', async () => {
    const res = await POST(request({ ...valid, phone: 'not a phone' }))

    expect(res.status).toBe(400)
    expect(loadClaimTarget).not.toHaveBeenCalled()
  })

  it.each([
    ['not_found', { kind: 'not_found' }, 404],
    ['closed', { kind: 'closed', event: { name: 'V', logoUrl: null, palette: 'd' } }, 403],
  ] as const)('sends nothing when the target is %s', async (_label, target, status) => {
    vi.mocked(loadClaimTarget).mockResolvedValue(target as never)

    const res = await POST(request(valid))

    expect(res.status).toBe(status)
    expect(checkLoginSendRateLimit).not.toHaveBeenCalled()
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it('sends a code for a row someone already claimed, under the same limits (N42 "This is me")', async () => {
    openTarget(true)

    const res = await POST(request(valid))

    expect(res.status).toBe(200)
    expect(checkLoginSendRateLimit).toHaveBeenCalled()
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: PHONE })
  })

  it('uses the sign-in bucket per number, keyed on the number without its plus', async () => {
    openTarget()

    await POST(request(valid))

    expect(checkLoginSendRateLimit).toHaveBeenCalledWith(PHONE)
    expect(checkClaimListSendRateLimit).toHaveBeenCalledWith('event-1')
  })

  it('stops at the per-number limit without spending the list budget', async () => {
    openTarget()
    vi.mocked(checkLoginSendRateLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 60 })

    const res = await POST(request(valid))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(checkClaimListSendRateLimit).not.toHaveBeenCalled()
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it('stops at the per-list limit', async () => {
    openTarget()
    vi.mocked(checkClaimListSendRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 900,
    })

    const res = await POST(request(valid))

    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('over_request_rate_limit')
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the rate limit cannot be checked', async () => {
    openTarget()
    vi.mocked(checkLoginSendRateLimit).mockRejectedValue(new Error('db down'))

    const res = await POST(request(valid))

    expect(res.status).toBe(503)
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it('passes a GoTrue error code through for the form to translate', async () => {
    openTarget()
    signInWithOtp.mockResolvedValue({
      error: { code: 'over_sms_send_rate_limit', message: 'x', status: 429 },
    })

    const res = await POST(request(valid))

    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('over_sms_send_rate_limit')
  })
})

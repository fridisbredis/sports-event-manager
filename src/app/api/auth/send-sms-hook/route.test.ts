import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { resolveOtpSender } from '@/lib/sms/otp-sender'
import { logger } from '@/lib/logger'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/sms/otp-sender', () => ({
  resolveOtpSender: vi.fn(),
}))

const messagesCreate = vi.fn()
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const KEY = Buffer.from('route-test-signing-key')
const SECRET = `v1,whsec_${KEY.toString('base64')}`
const PLATFORM = '+46700000000'
const OTP = '482913'
const PHONE = '46701234567'

const PAYLOAD = {
  user: { id: '00000000-0000-4000-8000-000000000001', phone: PHONE },
  sms: { otp: OTP },
}

function hookRequest(body: unknown = PAYLOAD, opts: { key?: Buffer; timestamp?: number } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const id = 'msg_test'
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', opts.key ?? KEY)
    .update(`${id}.${timestamp}.${raw}`)
    .digest('base64')
  return new NextRequest('http://localhost/api/auth/send-sms-hook', {
    method: 'POST',
    body: raw,
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${signature}`,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SEND_SMS_HOOK_SECRET', SECRET)
  vi.stubEnv('TWILIO_PHONE_NUMBER', PLATFORM)
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACtest')
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'token')
  vi.mocked(resolveOtpSender).mockResolvedValue({ from: 'Viadal', tenantName: 'Viadal Ultra' })
  messagesCreate.mockResolvedValue({ sid: 'SM1' })
})

describe('POST /api/auth/send-sms-hook', () => {
  it('sends the code from the tenant sender with the tenant in the body', async () => {
    const res = await POST(hookRequest())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(messagesCreate).toHaveBeenCalledWith({
      body: `Your Viadal Ultra code is ${OTP}`,
      from: 'Viadal',
      to: `+${PHONE}`,
    })
  })

  it('sends a plain body from the platform number when no tenant applies', async () => {
    vi.mocked(resolveOtpSender).mockResolvedValue({ from: PLATFORM, tenantName: null })

    const res = await POST(hookRequest())

    expect(res.status).toBe(200)
    expect(messagesCreate).toHaveBeenCalledWith({
      body: `Your code is ${OTP}`,
      from: PLATFORM,
      to: `+${PHONE}`,
    })
  })

  // A lower tier: platform sender, but the body still names the tenant.
  it('names the tenant in the body when sending from the platform number', async () => {
    vi.mocked(resolveOtpSender).mockResolvedValue({ from: PLATFORM, tenantName: 'Other club' })

    const res = await POST(hookRequest())

    expect(res.status).toBe(200)
    expect(messagesCreate).toHaveBeenCalledWith({
      body: `Your Other club code is ${OTP}`,
      from: PLATFORM,
      to: `+${PHONE}`,
    })
  })

  it('rejects a request signed with another key and sends nothing', async () => {
    const res = await POST(hookRequest(PAYLOAD, { key: Buffer.from('attacker') }))

    expect(res.status).toBe(401)
    expect(messagesCreate).not.toHaveBeenCalled()
    expect(resolveOtpSender).not.toHaveBeenCalled()
  })

  it('rejects a replayed request outside the window', async () => {
    const res = await POST(hookRequest(PAYLOAD, { timestamp: Math.floor(Date.now() / 1000) - 600 }))

    expect(res.status).toBe(401)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  // Fail closed: without the secret nothing can be verified.
  it('answers 500 when the hook secret is unset', async () => {
    vi.stubEnv('SEND_SMS_HOOK_SECRET', '')

    const res = await POST(hookRequest())

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: { http_code: 500, message: 'SMS hook is not configured' },
    })
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('rejects a signed but malformed payload', async () => {
    const res = await POST(hookRequest({ user: { id: 'x' }, sms: {} }))

    expect(res.status).toBe(400)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('answers 500 when the platform number is unset', async () => {
    vi.stubEnv('TWILIO_PHONE_NUMBER', '')

    const res = await POST(hookRequest())

    expect(res.status).toBe(500)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  // A sign-in must not fail over a sender name.
  it('retries from the platform number when the name is refused', async () => {
    messagesCreate.mockRejectedValueOnce({ code: 21212 }).mockResolvedValueOnce({ sid: 'SM2' })

    const res = await POST(hookRequest())

    expect(res.status).toBe(200)
    expect(messagesCreate).toHaveBeenCalledTimes(2)
    expect(messagesCreate.mock.calls[1][0]).toEqual({
      body: `Your Viadal Ultra code is ${OTP}`,
      from: PLATFORM,
      to: `+${PHONE}`,
    })
  })

  it('answers 502 when the platform-number retry also fails', async () => {
    messagesCreate.mockRejectedValue({ code: 20003 })

    const res = await POST(hookRequest())

    expect(res.status).toBe(502)
    expect(messagesCreate).toHaveBeenCalledTimes(2)
  })

  it('does not retry when the platform number itself was refused', async () => {
    vi.mocked(resolveOtpSender).mockResolvedValue({ from: PLATFORM, tenantName: null })
    messagesCreate.mockRejectedValue({ code: 20003 })

    const res = await POST(hookRequest())

    expect(res.status).toBe(502)
    expect(messagesCreate).toHaveBeenCalledTimes(1)
  })

  it('sends from the platform number when the sender lookup throws', async () => {
    vi.mocked(resolveOtpSender).mockRejectedValue(new Error('boom'))

    const res = await POST(hookRequest())

    expect(res.status).toBe(200)
    expect(messagesCreate).toHaveBeenCalledWith({
      body: `Your code is ${OTP}`,
      from: PLATFORM,
      to: `+${PHONE}`,
    })
  })

  it('never logs the code or the phone number', async () => {
    messagesCreate.mockRejectedValue({ code: 20003 })

    await POST(hookRequest())

    const logged = JSON.stringify([
      vi.mocked(logger.error).mock.calls,
      vi.mocked(logger.warn).mock.calls,
      vi.mocked(logger.info).mock.calls,
    ])
    expect(logged).not.toContain(OTP)
    expect(logged).not.toContain(PHONE)
  })
})

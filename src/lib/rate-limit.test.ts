import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  checkInviteRateLimit,
  checkLoginSendRateLimit,
  checkLoginVerifyRateLimit,
  releaseInviteRateLimit,
} from './rate-limit'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { stripE164Plus } from '@/lib/phone'
import type { Database } from '@/types/database'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

const rpc = vi.fn()

const phoneHash = (phone: string) =>
  createHash('sha256').update(phone.replace(/\D/g, '')).digest('hex')

const expectedPhoneKey = (tenantId: string, phone: string) =>
  `invite:phone:${tenantId}:${phoneHash(phone)}`

const expectedLoginKey = (prefix: string, phone: string) => `login:${prefix}:${phoneHash(phone)}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createSupabaseServiceClient).mockReturnValue({
    rpc,
  } as unknown as SupabaseClient<Database>)
})

describe('checkInviteRateLimit', () => {
  it('checks the phone key first and short-circuits (never checks the admin key) when the phone check is not allowed', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, retry_after_ms: 5000 }], error: null })

    const result = await checkInviteRateLimit('tenant-1', '46700000001', 'user-1')

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 5 })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('check_rate_limit', {
      p_key: expectedPhoneKey('tenant-1', '46700000001'),
      p_limit: 3,
      p_duration_seconds: 3600,
    })
  })

  it('checks the admin key when the phone check passes, and returns the admin check result', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: true, retry_after_ms: 0 }], error: null })
    rpc.mockResolvedValueOnce({ data: [{ allowed: true, retry_after_ms: 0 }], error: null })

    const result = await checkInviteRateLimit('tenant-1', '46700000001', 'user-1')

    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenNthCalledWith(2, 'check_rate_limit', {
      p_key: 'invite:admin:user-1',
      p_limit: 100,
      p_duration_seconds: 3600,
    })
  })

  it('rounds retryAfterSeconds up from retry_after_ms rather than passing it through raw', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, retry_after_ms: 1500 }], error: null })

    const result = await checkInviteRateLimit('tenant-1', '46700000001', 'user-1')

    expect(result.retryAfterSeconds).toBe(2)
  })

  it('propagates a throw when the RPC call errors, rather than swallowing it', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })

    await expect(checkInviteRateLimit('tenant-1', '46700000001', 'user-1')).rejects.toThrow(
      'rate limit check failed'
    )
  })

  it('propagates a throw when the RPC call resolves with no data', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })

    await expect(checkInviteRateLimit('tenant-1', '46700000001', 'user-1')).rejects.toThrow(
      'rate limit check failed'
    )
  })

  it('propagates a throw when the RPC call resolves with an empty data array', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null })

    await expect(checkInviteRateLimit('tenant-1', '46700000001', 'user-1')).rejects.toThrow(
      'rate limit check failed'
    )
  })
})

describe('releaseInviteRateLimit', () => {
  it('calls release_rate_limit for the phone key only, never the admin key', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await releaseInviteRateLimit('tenant-1', '46700000001')

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('release_rate_limit', {
      p_key: expectedPhoneKey('tenant-1', '46700000001'),
    })
  })

  it('swallows an RPC error result, logging it without the phone number', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint (invite:phone:tenant-1:46700000001)',
      },
    })

    await expect(releaseInviteRateLimit('tenant-1', '46700000001')).resolves.toBeUndefined()

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const loggedMessage = consoleErrorSpy.mock.calls[0][0] as string
    expect(loggedMessage).toContain('tenant-1')
    expect(loggedMessage).not.toContain('46700000001')

    consoleErrorSpy.mockRestore()
  })

  it('swallows a thrown/rejected RPC call, logging it without the phone number', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockRejectedValueOnce(new Error('network down'))

    await expect(releaseInviteRateLimit('tenant-1', '46700000001')).resolves.toBeUndefined()

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const loggedMessage = consoleErrorSpy.mock.calls[0][0] as string
    expect(loggedMessage).toContain('network down')
    expect(loggedMessage).toContain('tenant-1')
    expect(loggedMessage).not.toContain('46700000001')

    consoleErrorSpy.mockRestore()
  })

  it('swallows createSupabaseServiceClient throwing synchronously, still resolving', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(createSupabaseServiceClient).mockImplementationOnce(() => {
      throw new Error('missing service key')
    })

    await expect(releaseInviteRateLimit('tenant-1', '46700000001')).resolves.toBeUndefined()

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    consoleErrorSpy.mockRestore()
  })
})

describe('login rate limits', () => {
  it('checks the send key against a 5-per-hour limit', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: true, retry_after_ms: 0 }], error: null })

    const result = await checkLoginSendRateLimit('46700000001')

    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('check_rate_limit', {
      p_key: expectedLoginKey('send', '46700000001'),
      p_limit: 5,
      p_duration_seconds: 3600,
    })
  })

  it('checks the verify key against a 10-per-hour limit', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, retry_after_ms: 2500 }], error: null })

    const result = await checkLoginVerifyRateLimit('46700000001')

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 3 })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('check_rate_limit', {
      p_key: expectedLoginKey('verify', '46700000001'),
      p_limit: 10,
      p_duration_seconds: 3600,
    })
  })

  // Deliberate design decision, documented in rate-limit.ts: login is not
  // tenant-scoped, because the same phone can hold roles across tenants and the
  // caller has no tenant context until after authentication. A tenant segment
  // added here would silently split one person's login budget per tenant,
  // multiplying the effective brute-force ceiling. This test pins the absence.
  it('builds login keys with no tenant segment, unlike the invite key for the same phone', async () => {
    rpc.mockResolvedValue({ data: [{ allowed: true, retry_after_ms: 0 }], error: null })

    await checkLoginSendRateLimit('46700000001')
    await checkLoginVerifyRateLimit('46700000001')

    const sendKey = rpc.mock.calls[0][1].p_key as string
    const verifyKey = rpc.mock.calls[1][1].p_key as string

    expect(sendKey).toBe(`login:send:${phoneHash('46700000001')}`)
    expect(verifyKey).toBe(`login:verify:${phoneHash('46700000001')}`)
    expect(sendKey).not.toBe(verifyKey)

    for (const key of [sendKey, verifyKey]) {
      expect(key.split(':')).toHaveLength(3)
      expect(key).not.toContain('tenant')
    }

    expect(sendKey).not.toBe(expectedPhoneKey('tenant-1', '46700000001'))
  })

  // phoneRateLimitKey strips non-digits, so punctuation collapses on its own — but
  // it does NOT reconcile a leading '+' with its absence, and both spellings pass the
  // OTP routes' schema. Callers must therefore hand it one agreed shape; the routes
  // use stripE164Plus for exactly that. Pinned here because the collapse is what keeps
  // one person on one bucket: without it a direct API caller gets double the ceiling.
  it('keys the same number identically whether or not the caller kept the + prefix', async () => {
    rpc.mockResolvedValue({ data: [{ allowed: true, retry_after_ms: 0 }], error: null })

    await checkLoginSendRateLimit(stripE164Plus('+46701234567'))
    await checkLoginSendRateLimit(stripE164Plus('46701234567'))
    await checkLoginSendRateLimit(stripE164Plus('+46 70 123 45 67'))

    const keys = rpc.mock.calls.map((c) => c[1].p_key as string)

    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toBe(`login:send:${phoneHash('46701234567')}`)
  })

  it('propagates a throw when the RPC errors, rather than failing open', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })

    await expect(checkLoginSendRateLimit('46700000001')).rejects.toThrow('rate limit check failed')
  })

  it('propagates a throw when the RPC resolves with an empty data array', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null })

    await expect(checkLoginVerifyRateLimit('46700000001')).rejects.toThrow(
      'rate limit check failed'
    )
  })
})

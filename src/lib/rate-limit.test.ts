import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkInviteRateLimit, releaseInviteRateLimit } from './rate-limit'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

const rpc = vi.fn()

const expectedPhoneKey = (tenantId: string, phone: string) =>
  `invite:phone:${tenantId}:${createHash('sha256').update(phone.replace(/\D/g, '')).digest('hex')}`

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

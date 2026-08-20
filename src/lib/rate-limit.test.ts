import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkInviteRateLimit, releaseInviteRateLimit } from './rate-limit'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

const rpc = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createSupabaseServiceClient).mockReturnValue({
    rpc,
  } as unknown as SupabaseClient<Database>)
})

describe('checkInviteRateLimit', () => {
  it('checks the phone key first and short-circuits (never checks the admin key) when the phone check is not allowed', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, retry_after_ms: 5000 }], error: null })

    const result = await checkInviteRateLimit('tenant-1', '+46700000001', 'user-1')

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 5 })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('check_rate_limit', {
      p_key: 'invite:phone:tenant-1:+46700000001',
      p_limit: 3,
      p_duration_seconds: 3600,
    })
  })

  it('checks the admin key when the phone check passes, and returns the admin check result', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: true, retry_after_ms: 0 }], error: null })
    rpc.mockResolvedValueOnce({ data: [{ allowed: true, retry_after_ms: 0 }], error: null })

    const result = await checkInviteRateLimit('tenant-1', '+46700000001', 'user-1')

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

    const result = await checkInviteRateLimit('tenant-1', '+46700000001', 'user-1')

    expect(result.retryAfterSeconds).toBe(2)
  })

  it('propagates a throw when the RPC call errors, rather than swallowing it', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })

    await expect(checkInviteRateLimit('tenant-1', '+46700000001', 'user-1')).rejects.toThrow(
      'rate limit check failed'
    )
  })

  it('propagates a throw when the RPC call resolves with no data', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })

    await expect(checkInviteRateLimit('tenant-1', '+46700000001', 'user-1')).rejects.toThrow(
      'rate limit check failed'
    )
  })

  it('propagates a throw when the RPC call resolves with an empty data array', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null })

    await expect(checkInviteRateLimit('tenant-1', '+46700000001', 'user-1')).rejects.toThrow(
      'rate limit check failed'
    )
  })
})

describe('releaseInviteRateLimit', () => {
  it('calls release_rate_limit for the phone key only, never the admin key', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await releaseInviteRateLimit('tenant-1', '+46700000001')

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('release_rate_limit', {
      p_key: 'invite:phone:tenant-1:+46700000001',
    })
  })
})

import { createHash } from 'crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logAuthEvent } from './log-auth-event'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function mockInsert(result: { error: unknown }) {
  const insert = vi.fn().mockResolvedValue(result)
  const from = vi.fn(() => ({ insert }))
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never)
  return { from, insert }
}

const PHONE = '+46701234567'
const PHONE_HASH = createHash('sha256').update('46701234567').digest('hex')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('logAuthEvent', () => {
  it('hashes the phone number and inserts a row with the expected shape', async () => {
    const { from, insert } = mockInsert({ error: null })

    await logAuthEvent({
      phone: PHONE,
      event: 'otp_verify_succeeded',
      actorUserId: 'user-1',
    })

    expect(from).toHaveBeenCalledWith('auth_events')
    expect(insert).toHaveBeenCalledWith({
      phone_hash: PHONE_HASH,
      event: 'otp_verify_succeeded',
      actor_user_id: 'user-1',
      error_code: null,
      detail: {},
    })
  })

  it('never includes the raw phone number in the inserted row', async () => {
    const { insert } = mockInsert({ error: null })

    await logAuthEvent({ phone: PHONE, event: 'otp_send_succeeded' })

    const inserted = insert.mock.calls[0][0]
    expect(JSON.stringify(inserted)).not.toContain(PHONE)
    expect(JSON.stringify(inserted)).not.toContain('701234567')
  })

  it('defaults actorUserId and errorCode to null and detail to {} when omitted', async () => {
    const { insert } = mockInsert({ error: null })

    await logAuthEvent({ phone: PHONE, event: 'otp_send_failed' })

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_user_id: null, error_code: null, detail: {} })
    )
  })

  it('passes errorCode through for failed events', async () => {
    const { insert } = mockInsert({ error: null })

    await logAuthEvent({ phone: PHONE, event: 'otp_verify_failed', errorCode: 'otp_expired' })

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ error_code: 'otp_expired' }))
  })

  it('logs via logger.error and does not throw when the insert returns an error', async () => {
    mockInsert({ error: { message: 'permission denied', code: '42501' } })

    await expect(
      logAuthEvent({ phone: PHONE, event: 'otp_send_succeeded' })
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to write auth event',
      { message: 'permission denied', code: '42501' },
      { event: 'otp_send_succeeded' }
    )
  })

  it('logs via logger.error and does not throw when the client construction itself throws', async () => {
    vi.mocked(createSupabaseServiceClient).mockImplementation(() => {
      throw new Error('boom')
    })

    await expect(
      logAuthEvent({ phone: PHONE, event: 'otp_send_succeeded' })
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      'Auth event write threw unexpectedly',
      expect.any(Error),
      { event: 'otp_send_succeeded' }
    )
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchSupabaseStatus, fetchTwilioStatus } from './fetch-status'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.limit = vi.fn(() => Promise.resolve(result))
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchSupabaseStatus', () => {
  it('returns ok when the query succeeds', async () => {
    const fromMock = vi.fn().mockReturnValue(chain({ error: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    expect(await fetchSupabaseStatus()).toEqual({ status: 'ok' })
  })

  it('returns error when the query fails', async () => {
    const fromMock = vi.fn().mockReturnValue(chain({ error: { message: 'boom' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    expect(await fetchSupabaseStatus()).toEqual({ status: 'error' })
  })

  it('returns error, not a hang, when the query never resolves in time', async () => {
    vi.useFakeTimers()
    const neverResolves = new Promise(() => {})
    const builder: Record<string, unknown> = {}
    builder.select = vi.fn(() => builder)
    builder.limit = vi.fn(() => neverResolves)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(builder),
    } as never)

    const resultPromise = fetchSupabaseStatus()
    await vi.advanceTimersByTimeAsync(3000)

    expect(await resultPromise).toEqual({ status: 'error' })
    vi.useRealTimers()
  })
})

describe('fetchTwilioStatus', () => {
  const ENV = process.env

  beforeEach(() => {
    process.env = { ...ENV, TWILIO_ACCOUNT_SID: 'sid', TWILIO_AUTH_TOKEN: 'token' }
  })

  afterEach(() => {
    process.env = ENV
    vi.unstubAllGlobals()
  })

  it('returns unknown when credentials are missing', async () => {
    process.env.TWILIO_ACCOUNT_SID = undefined
    process.env.TWILIO_AUTH_TOKEN = undefined

    expect(await fetchTwilioStatus()).toEqual({ status: 'unknown' })
  })

  it('returns unknown when the request is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    expect(await fetchTwilioStatus()).toEqual({ status: 'unknown' })
  })

  it('returns unknown when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))

    expect(await fetchTwilioStatus()).toEqual({ status: 'unknown' })
  })

  it('sums outbound counts and requests the sms-outbound category, not the sms parent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ usage_records: [{ count: '3' }, { count: '4' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchTwilioStatus()).toEqual({ status: 'ok', sentToday: 7 })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('Category=sms-outbound')
  })

  it('treats a non-numeric count as 0 instead of surfacing NaN', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ usage_records: [{ count: 'not-a-number' }] }),
      })
    )

    expect(await fetchTwilioStatus()).toEqual({ status: 'ok', sentToday: 0 })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchSupabaseStatus, fetchTwilioStatus, fetchSentryStatus } from './fetch-status'
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
    process.env = {
      ...ENV,
      TWILIO_ACCOUNT_SID: 'sid',
      TWILIO_AUTH_TOKEN: 'token',
      TWILIO_PHONE_NUMBER: '+46700000000',
    }
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

  it('returns unknown when the sender number is missing', async () => {
    process.env.TWILIO_PHONE_NUMBER = undefined

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

  it("counts only this environment's sender, filtering by From", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          messages: [{ direction: 'outbound-api' }, { direction: 'outbound-api' }],
        }),
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchTwilioStatus()).toEqual({
      status: 'ok',
      sentToday: 2,
      fromNumber: '+46700000000',
    })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('From=%2B46700000000')
  })

  it('excludes inbound messages so a STOP reply cannot inflate "sent today"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            messages: [{ direction: 'outbound-api' }, { direction: 'inbound' }],
          }),
      })
    )

    expect(await fetchTwilioStatus()).toEqual({
      status: 'ok',
      sentToday: 1,
      fromNumber: '+46700000000',
    })
  })

  it('returns 0, not undefined, when there are no messages today', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ messages: [] }) })
    )

    expect(await fetchTwilioStatus()).toEqual({
      status: 'ok',
      sentToday: 0,
      fromNumber: '+46700000000',
    })
  })

  it('returns the sender number so the UI can disambiguate dev/prod on a shared subaccount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ messages: [] }) })
    )

    const result = await fetchTwilioStatus()
    expect(result.fromNumber).toBe('+46700000000')
  })
})

describe('fetchSentryStatus', () => {
  const ENV = process.env

  beforeEach(() => {
    process.env = {
      ...ENV,
      SENTRY_ORG: 'extrapreneur',
      SENTRY_PROJECT: 'viadal-event-dev',
      SENTRY_API_TOKEN: 'token',
    }
  })

  afterEach(() => {
    process.env = ENV
    vi.unstubAllGlobals()
  })

  it('returns unknown when the token is missing (e.g. local dev)', async () => {
    process.env.SENTRY_API_TOKEN = undefined

    expect(await fetchSentryStatus()).toEqual({ status: 'unknown' })
  })

  it('returns unknown when org or project is missing', async () => {
    process.env.SENTRY_ORG = undefined

    expect(await fetchSentryStatus()).toEqual({ status: 'unknown' })
  })

  it('returns unknown when the request is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    expect(await fetchSentryStatus()).toEqual({ status: 'unknown' })
  })

  it('returns unknown when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))

    expect(await fetchSentryStatus()).toEqual({ status: 'unknown' })
  })

  it("counts unresolved issues and queries this environment's own org/project", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ id: '1' }, { id: '2' }, { id: '3' }]),
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchSentryStatus()).toEqual({ status: 'ok', unresolvedCount: 3 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/projects/extrapreneur/viadal-event-dev/issues/')
    expect(url).toContain('query=is%3Aunresolved')
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer token')
  })

  it('returns 0, not undefined, when there are no unresolved issues', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }))

    expect(await fetchSentryStatus()).toEqual({ status: 'ok', unresolvedCount: 0 })
  })
})

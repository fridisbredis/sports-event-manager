import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchSupabaseStatus,
  fetchTwilioStatus,
  fetchSentryStatus,
  fetchGitHubActionsStatus,
} from './fetch-status'
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

  it('filters by DateSent> so a spike on a prior day cannot inflate "sent today"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ direction: 'outbound-api' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchTwilioStatus()

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('DateSent%3E=')
  })

  it('sends DateSent> as midnight UTC, not a bare date, so an exclusive boundary cannot read 0 all day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T15:30:00Z'))

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ direction: 'outbound-api' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchTwilioStatus()

    const [url] = fetchMock.mock.calls[0]
    expect(decodeURIComponent(url as string)).toContain('DateSent>=2026-09-02T00:00:00Z')

    vi.useRealTimers()
  })

  it('pages through next_page_uri and sums counts, rather than fetching one 1000-message page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            messages: Array(50).fill({ direction: 'outbound-api' }),
            meta: { next_page_uri: '/2010-04-01/Accounts/sid/Messages.json?Page=1' },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            messages: [{ direction: 'outbound-api' }],
            meta: { next_page_uri: null },
          }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTwilioStatus()

    expect(result).toEqual({ status: 'ok', sentToday: 51, fromNumber: '+46700000000' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [firstUrl] = fetchMock.mock.calls[0]
    expect(firstUrl).toContain('PageSize=50')
    const [secondUrl] = fetchMock.mock.calls[1]
    expect(secondUrl).toBe('https://api.twilio.com/2010-04-01/Accounts/sid/Messages.json?Page=1')
  })

  it('stops after the page-fetch limit instead of following next_page_uri forever', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          messages: [{ direction: 'outbound-api' }],
          meta: { next_page_uri: '/2010-04-01/Accounts/sid/Messages.json?Page=next' },
        }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTwilioStatus()

    expect(result.status).toBe('ok')
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5)
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

describe('fetchGitHubActionsStatus', () => {
  const ENV = process.env

  function runResponse(run: Record<string, unknown> | null) {
    return {
      ok: true,
      json: () => Promise.resolve({ workflow_runs: run ? [run] : [] }),
    }
  }

  beforeEach(() => {
    process.env = { ...ENV }
    delete process.env.GITHUB_API_TOKEN
  })

  afterEach(() => {
    process.env = ENV
    vi.unstubAllGlobals()
  })

  it('reports ok and one row per deploy workflow when both succeeded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        runResponse({
          conclusion: 'success',
          html_url: 'https://github.com/run/1',
          run_started_at: '2026-10-06T10:00:00Z',
        })
      )
    )

    const result = await fetchGitHubActionsStatus()

    expect(result.status).toBe('ok')
    expect(result.runs).toHaveLength(2)
    expect(result.runs?.map((r) => r.workflow)).toEqual(['deploy-dev.yml', 'deploy-prod.yml'])
  })

  it('reports error when any deploy workflow failed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(runResponse({ conclusion: 'success', html_url: 'u' }))
      .mockResolvedValueOnce(runResponse({ conclusion: 'failure', html_url: 'u' }))
    vi.stubGlobal('fetch', fetchMock)

    expect((await fetchGitHubActionsStatus()).status).toBe('error')
  })

  it('does not treat a cancelled run as a broken deploy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(runResponse({ conclusion: 'cancelled' })))

    expect((await fetchGitHubActionsStatus()).status).toBe('ok')
  })

  it('reports an in-progress run as running, not as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(runResponse({ conclusion: null })))

    const result = await fetchGitHubActionsStatus()

    expect(result.status).toBe('ok')
    expect(result.runs?.[0].conclusion).toBe('running')
  })

  it('still reports the workflow that answered when the other one fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(runResponse({ conclusion: 'success', html_url: 'u' }))
      .mockResolvedValueOnce({ ok: false, status: 404 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGitHubActionsStatus()

    expect(result.status).toBe('ok')
    expect(result.runs).toHaveLength(1)
    expect(result.runs?.[0].workflow).toBe('deploy-dev.yml')
  })

  it('returns unknown when neither workflow answers (e.g. rate limited)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))

    expect(await fetchGitHubActionsStatus()).toEqual({ status: 'unknown' })
  })

  it('returns unknown when a workflow has never run', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(runResponse(null)))

    expect(await fetchGitHubActionsStatus()).toEqual({ status: 'unknown' })
  })

  it('returns unknown when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))

    expect(await fetchGitHubActionsStatus()).toEqual({ status: 'unknown' })
  })

  it('sends no Authorization header when no token is set (public repo)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(runResponse({ conclusion: 'success' }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchGitHubActionsStatus()

    const [, init] = fetchMock.mock.calls[0]
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBeUndefined()
  })

  it('sends the token when one is set, so a private repo or rate limit is a config change', async () => {
    process.env.GITHUB_API_TOKEN = 'ghp_test'
    const fetchMock = vi.fn().mockResolvedValue(runResponse({ conclusion: 'success' }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchGitHubActionsStatus()

    const [, init] = fetchMock.mock.calls[0]
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
      'Bearer ghp_test'
    )
  })
})

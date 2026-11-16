import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { logger } from '@/lib/logger'
import { checkBackupFreshness } from './check-freshness'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const SAS_URL =
  'https://sportsevtmgrprodsnaps.blob.core.windows.net/db-snapshots?sv=2022-11-02&sp=l&sig=SECRET'

function listXml(capturedat: string) {
  return `<?xml version="1.0" encoding="utf-8"?><EnumerationResults><Blobs><Blob><Name>weekly-slot-0.tar.gz</Name><Properties><Last-Modified>Sun, 01 Nov 2026 10:37:36 GMT</Last-Modified></Properties><Metadata><capturedat>${capturedat}</capturedat><isoweek>44</isoweek></Metadata></Blob></Blobs></EnumerationResults>`
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('BACKUP_SLOTS_LIST_URL', SAS_URL)
  vi.stubEnv('SENTRY_ENVIRONMENT', 'production')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function loggedText() {
  return JSON.stringify([
    vi.mocked(logger.error).mock.calls,
    vi.mocked(logger.info).mock.calls,
    vi.mocked(logger.warn).mock.calls,
  ])
}

describe('checkBackupFreshness', () => {
  it('lists the weekly slots with metadata, keeping the SAS query', async () => {
    fetchMock.mockResolvedValue(new Response(listXml('2026-11-01T10:37:35Z')))

    await checkBackupFreshness(new Date('2026-11-02T04:00:00Z'))

    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe(
      'https://sportsevtmgrprodsnaps.blob.core.windows.net/db-snapshots'
    )
    expect(url.searchParams.get('sig')).toBe('SECRET')
    expect(url.searchParams.get('sp')).toBe('l')
    expect(url.searchParams.get('comp')).toBe('list')
    expect(url.searchParams.get('restype')).toBe('container')
    expect(url.searchParams.get('prefix')).toBe('weekly-slot')
    expect(url.searchParams.get('include')).toBe('metadata')
  })

  it('is fresh, and reports nothing to Sentry, after a normal run', async () => {
    fetchMock.mockResolvedValue(new Response(listXml('2026-11-01T10:37:35Z')))

    const result = await checkBackupFreshness(new Date('2026-11-02T04:00:00Z'))

    expect(result).toEqual({ status: 'fresh', newest: 'weekly-slot-0.tar.gz', ageDays: 0.7 })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('reports a stale backup to Sentry via logger.error', async () => {
    fetchMock.mockResolvedValue(new Response(listXml('2026-11-01T10:37:35Z')))

    const result = await checkBackupFreshness(new Date('2026-11-16T04:00:00Z'))

    expect(result).toEqual({ status: 'stale', newest: 'weekly-slot-0.tar.gz', ageDays: 14.7 })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.error).mock.calls[0][0]).toMatch(/stale/)
  })

  it('reports an empty container as stale', async () => {
    fetchMock.mockResolvedValue(new Response('<EnumerationResults><Blobs /></EnumerationResults>'))

    const result = await checkBackupFreshness(new Date('2026-11-16T04:00:00Z'))

    expect(result).toEqual({ status: 'stale', newest: null, ageDays: null })
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('reports a rejected token (e.g. expired SAS) without logging the URL', async () => {
    fetchMock.mockResolvedValue(new Response('AuthenticationFailed', { status: 403 }))

    const result = await checkBackupFreshness(new Date('2026-11-16T04:00:00Z'))

    expect(result).toEqual({ status: 'error' })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(loggedText()).not.toContain('SECRET')
  })

  it('reports a network failure without throwing', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const result = await checkBackupFreshness(new Date('2026-11-16T04:00:00Z'))

    expect(result).toEqual({ status: 'error' })
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('is an error in prod when the URL is unset — the check must not vanish quietly', async () => {
    vi.stubEnv('BACKUP_SLOTS_LIST_URL', '')

    const result = await checkBackupFreshness()

    expect(result).toEqual({ status: 'unconfigured' })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is silent outside prod when the URL is unset', async () => {
    vi.stubEnv('BACKUP_SLOTS_LIST_URL', '')
    vi.stubEnv('SENTRY_ENVIRONMENT', 'development')

    const result = await checkBackupFreshness()

    expect(result).toEqual({ status: 'unconfigured' })
    expect(logger.error).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/tenant', () => ({ getOfficialTenant: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ checkTournamentTokenRateLimit: vi.fn() }))
vi.mock('@/lib/tournament/token', () => ({ signTournamentToken: vi.fn() }))
vi.mock('@/lib/i18n/user-language', () => ({ getUserLanguage: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { getOfficialTenant } from '@/lib/auth/tenant'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkTournamentTokenRateLimit } from '@/lib/rate-limit'
import { signTournamentToken } from '@/lib/tournament/token'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { logger } from '@/lib/logger'
import { POST } from './route'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'

const tenant = {
  id: 'ten-1',
  slug: 'viadal',
  color_palette: 'default',
  tier: 'premium',
  is_active: true,
  officialId: 'off-1',
}

type Row = Record<string, unknown> | null

/** A session client whose two lookups answer with the given rows, recording every filter. */
function sessionClient({ membership, official }: { membership: Row; official: Row }) {
  const filters: Record<string, [string, unknown][]> = {}
  const client = {
    from: vi.fn((table: string) => {
      filters[table] = []
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[table].push([column, value])
          return builder
        },
        maybeSingle: () =>
          Promise.resolve({
            data: table === 'official_events' ? membership : official,
            error: null,
          }),
      }
      return builder
    }),
  }
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never)
  return filters
}

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/tournament-token', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOfficialTenant).mockResolvedValue(tenant)
  vi.mocked(getUserLanguage).mockResolvedValue('en')
  sessionClient({ membership: { event_id: EVENT_ID }, official: { name: 'Anna Berg' } })
  vi.mocked(checkTournamentTokenRateLimit).mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  })
  vi.mocked(signTournamentToken).mockResolvedValue({
    token: 'signed.jwt.value',
    expiresAt: '2026-11-17T12:15:00.000Z',
  })
})

describe('POST /api/tournament-token', () => {
  it('issues a token for a confirmed official on the event, uncached', async () => {
    const res = await post({ tenantSlug: 'viadal', eventId: EVENT_ID })

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({
      token: 'signed.jwt.value',
      expiresAt: '2026-11-17T12:15:00.000Z',
    })
    expect(signTournamentToken).toHaveBeenCalledWith({
      officialId: 'off-1',
      name: 'Anna Berg',
      eventId: EVENT_ID,
      tenantId: 'ten-1',
      tier: 'premium',
      locale: 'en',
    })
  })

  it("carries the official's Viadal language", async () => {
    vi.mocked(getUserLanguage).mockResolvedValue('sv')

    await post({ tenantSlug: 'viadal', eventId: EVENT_ID })

    expect(signTournamentToken).toHaveBeenCalledWith(expect.objectContaining({ locale: 'sv' }))
  })

  it('scopes both lookups to the official, the event and the tenant', async () => {
    const filters = sessionClient({
      membership: { event_id: EVENT_ID },
      official: { name: 'Anna Berg' },
    })

    await post({ tenantSlug: 'viadal', eventId: EVENT_ID })

    expect(filters.official_events).toEqual([
      ['official_id', 'off-1'],
      ['event_id', EVENT_ID],
      ['tenant_id', 'ten-1'],
    ])
    expect(filters.officials).toEqual([
      ['id', 'off-1'],
      ['tenant_id', 'ten-1'],
    ])
  })

  it('logs the issue with ids only, never the token or the name', async () => {
    await post({ tenantSlug: 'viadal', eventId: EVENT_ID })

    expect(logger.info).toHaveBeenCalledWith('Tournament token issued', {
      officialId: 'off-1',
      eventId: EVENT_ID,
      tenantId: 'ten-1',
    })
  })

  it.each([
    ['no body fields', {}],
    ['an event id that is not a uuid', { tenantSlug: 'viadal', eventId: 'evt-1' }],
    ['an empty tenant slug', { tenantSlug: '', eventId: EVENT_ID }],
  ])('rejects %s with 400', async (_, body) => {
    expect((await post(body)).status).toBe(400)
    expect(signTournamentToken).not.toHaveBeenCalled()
  })

  it('refuses someone who is not an official of the tenant', async () => {
    vi.mocked(getOfficialTenant).mockResolvedValue(null)

    expect((await post({ tenantSlug: 'viadal', eventId: EVENT_ID })).status).toBe(403)
    expect(signTournamentToken).not.toHaveBeenCalled()
  })

  // ADR-0005 §5.3: admins pass the official surfaces by role, without a roster row.
  it('refuses an admin without a roster row', async () => {
    vi.mocked(getOfficialTenant).mockResolvedValue({ ...tenant, officialId: null })

    expect((await post({ tenantSlug: 'viadal', eventId: EVENT_ID })).status).toBe(403)
    expect(signTournamentToken).not.toHaveBeenCalled()
  })

  it('refuses a standard tenant before looking anything else up', async () => {
    vi.mocked(getOfficialTenant).mockResolvedValue({ ...tenant, tier: 'standard' })

    const res = await post({ tenantSlug: 'viadal', eventId: EVENT_ID })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'tier_without_tournaments' })
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
    expect(signTournamentToken).not.toHaveBeenCalled()
  })

  it('refuses an official who is not on this event', async () => {
    sessionClient({ membership: null, official: { name: 'Anna Berg' } })

    const res = await post({ tenantSlug: 'viadal', eventId: EVENT_ID })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'not_on_event' })
    expect(checkTournamentTokenRateLimit).not.toHaveBeenCalled()
    expect(signTournamentToken).not.toHaveBeenCalled()
  })

  it('answers 429 with Retry-After when the official is over the limit', async () => {
    vi.mocked(checkTournamentTokenRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
    })

    const res = await post({ tenantSlug: 'viadal', eventId: EVENT_ID })

    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('42')
    expect(signTournamentToken).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the rate limit cannot be checked', async () => {
    vi.mocked(checkTournamentTokenRateLimit).mockRejectedValue(new Error('rate limit check failed'))

    expect((await post({ tenantSlug: 'viadal', eventId: EVENT_ID })).status).toBe(503)
    expect(signTournamentToken).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when this environment has no key or issuer', async () => {
    vi.mocked(signTournamentToken).mockResolvedValue(null)

    expect((await post({ tenantSlug: 'viadal', eventId: EVENT_ID })).status).toBe(503)
  })

  it('fails closed with 503 when the key is malformed', async () => {
    vi.mocked(signTournamentToken).mockRejectedValue(new Error('must be a P-256 private JWK'))

    expect((await post({ tenantSlug: 'viadal', eventId: EVENT_ID })).status).toBe(503)
  })
})

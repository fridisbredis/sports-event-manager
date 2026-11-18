import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { GET } from './route'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const SECRET = 'engine-secret-for-tests'

type Answer = { data: unknown; error: unknown }

/**
 * A service client answering each table with the given result, recording the
 * columns selected and every filter, so a test can check what was asked for.
 */
function serviceClient(answers: Record<string, Answer>) {
  const calls: Record<string, { select?: string; filters: [string, string, unknown][] }> = {}
  const client = {
    from: vi.fn((table: string) => {
      calls[table] = { filters: [] }
      const answer = answers[table] ?? { data: null, error: null }
      const builder = {
        select: (columns: string) => {
          calls[table].select = columns
          return builder
        },
        eq: (column: string, value: unknown) => {
          calls[table].filters.push(['eq', column, value])
          return builder
        },
        in: (column: string, value: unknown) => {
          calls[table].filters.push(['in', column, value])
          return builder
        },
        order: () => builder,
        maybeSingle: () => Promise.resolve(answer),
        then: (resolve: (value: Answer) => unknown) => Promise.resolve(answer).then(resolve),
      }
      return builder
    }),
  }
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never)
  return calls
}

function get(eventId: string, authorization?: string) {
  return GET(
    new NextRequest(`http://localhost/api/internal/events/${eventId}/officials`, {
      headers: authorization ? { Authorization: authorization } : {},
    }),
    { params: Promise.resolve({ eventId }) }
  )
}

const event = { data: { tenant_id: 'ten-1' }, error: null }
const memberships = { data: [{ official_id: 'off-1' }, { official_id: 'off-2' }], error: null }
const confirmed = {
  data: [
    {
      id: 'off-1',
      name: 'Anna Berg',
      avatar_url: 'https://storage.test/avatars/ten-1/off-1/1.jpg',
    },
    { id: 'off-2', name: 'Bo Ek', avatar_url: null },
  ],
  error: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TOURNAMENT_ENGINE_SECRET', SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/internal/events/[eventId]/officials', () => {
  it("lists the event's confirmed officials as id, display name and avatar URL, uncached", async () => {
    serviceClient({ events: event, official_events: memberships, officials: confirmed })

    const res = await get(EVENT_ID, `Bearer ${SECRET}`)

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({
      officials: [
        {
          id: 'off-1',
          displayName: 'Anna Berg',
          avatarUrl: 'https://storage.test/avatars/ten-1/off-1/1.jpg',
        },
        { id: 'off-2', displayName: 'Bo Ek', avatarUrl: null },
      ],
    })
  })

  it('sends an empty avatar URL as no picture', async () => {
    serviceClient({
      events: event,
      official_events: { data: [{ official_id: 'off-1' }], error: null },
      officials: { data: [{ id: 'off-1', name: 'Anna Berg', avatar_url: '' }], error: null },
    })

    const res = await get(EVENT_ID, `Bearer ${SECRET}`)

    expect(await res.json()).toEqual({
      officials: [{ id: 'off-1', displayName: 'Anna Berg', avatarUrl: null }],
    })
  })

  // Service role has no RLS behind it: the handler is the only scoping layer.
  it("scopes every query to the event's tenant and asks for confirmed officials only", async () => {
    const calls = serviceClient({
      events: event,
      official_events: memberships,
      officials: confirmed,
    })

    await get(EVENT_ID, `Bearer ${SECRET}`)

    expect(calls.official_events.filters).toEqual([
      ['eq', 'event_id', EVENT_ID],
      ['eq', 'tenant_id', 'ten-1'],
    ])
    expect(calls.officials.filters).toEqual([
      ['in', 'id', ['off-1', 'off-2']],
      ['eq', 'tenant_id', 'ten-1'],
      ['eq', 'invite_status', 'confirmed'],
    ])
  })

  it('never reads a phone number or email address', async () => {
    const calls = serviceClient({
      events: event,
      official_events: memberships,
      officials: confirmed,
    })

    await get(EVENT_ID, `Bearer ${SECRET}`)

    expect(calls.officials.select).toBe('id, name, avatar_url')
  })

  it('answers an empty list for an event without officials, without querying officials', async () => {
    const calls = serviceClient({ events: event, official_events: { data: [], error: null } })

    const res = await get(EVENT_ID, `Bearer ${SECRET}`)

    expect(await res.json()).toEqual({ officials: [] })
    expect(calls.officials).toBeUndefined()
  })

  it.each([
    ['no Authorization header', undefined],
    ['a wrong secret', 'Bearer not-the-secret'],
    ['the secret without Bearer', SECRET],
    ['a longer value starting with the secret', `Bearer ${SECRET}x`],
  ])('refuses %s with 401 before touching the database', async (_, authorization) => {
    serviceClient({ events: event })

    const res = await get(EVENT_ID, authorization)

    expect(res.status).toBe(401)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('fails closed when the secret is not configured', async () => {
    vi.stubEnv('TOURNAMENT_ENGINE_SECRET', '')
    serviceClient({ events: event })

    expect((await get(EVENT_ID, 'Bearer ')).status).toBe(401)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('rejects an event id that is not a uuid', async () => {
    expect((await get('abc', `Bearer ${SECRET}`)).status).toBe(400)
  })

  it('answers 404 for an event that does not exist', async () => {
    serviceClient({ events: { data: null, error: null } })

    expect((await get(EVENT_ID, `Bearer ${SECRET}`)).status).toBe(404)
  })

  it.each(['events', 'official_events', 'officials'])(
    'answers 500, not an empty list, when the %s lookup fails',
    async (table) => {
      const failure = { data: null, error: { message: 'boom' } }
      serviceClient({
        events: event,
        official_events: memberships,
        officials: confirmed,
        [table]: failure,
      })

      expect((await get(EVENT_ID, `Bearer ${SECRET}`)).status).toBe(500)
    }
  )
})

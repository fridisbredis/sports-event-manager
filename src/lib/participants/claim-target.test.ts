import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { loadClaimTarget } from './claim-target'

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const TOKEN = '0b8a3c3e-6f1d-4c55-9a43-0f5e2b7d9a11'
const PARTICIPANT = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = 'event-1'
const TENANT_ID = 'tenant-1'

type Result = { data: unknown; error: unknown }

function builder(result: Result) {
  const b: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of ['select', 'eq', 'is']) b[m] = vi.fn(() => b)
  b.maybeSingle = vi.fn(() => Promise.resolve(result))
  return b
}

function client(event: Result, participant?: Result) {
  const events = builder(event)
  const parts = builder(participant ?? { data: null, error: null })
  const from = vi.fn((table: string) => (table === 'events' ? events : parts))
  return { service: { from } as unknown as SupabaseClient<Database>, from, parts }
}

function eventRow(status = 'published', tier = 'premium') {
  return {
    data: {
      id: EVENT_ID,
      tenant_id: TENANT_ID,
      name: 'Viadal 2026',
      logo_url: null,
      status,
      tenants: { tier, color_palette: null },
    },
    error: null,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('loadClaimTarget (CLAIM-02)', () => {
  it('is closed before the participant is even looked up', async () => {
    const c = client(eventRow('draft'))

    const result = await loadClaimTarget(c.service, TOKEN, PARTICIPANT)

    expect(result.kind).toBe('closed')
    expect(c.from).not.toHaveBeenCalledWith('participants')
  })

  it('reads the participant by id AND the token’s event and tenant, offered rows only', async () => {
    const c = client(eventRow(), {
      data: { id: PARTICIPANT, bib: '101', name: 'Lisa Nord', user_id: null },
      error: null,
    })

    const result = await loadClaimTarget(c.service, TOKEN, PARTICIPANT)

    expect(c.parts.eq).toHaveBeenCalledWith('id', PARTICIPANT)
    expect(c.parts.eq).toHaveBeenCalledWith('event_id', EVENT_ID)
    expect(c.parts.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(c.parts.is).toHaveBeenCalledWith('withdrawn_at', null)
    expect(c.parts.is).toHaveBeenCalledWith('hidden_at', null)
    expect(result).toEqual({
      kind: 'open',
      event: expect.objectContaining({ name: 'Viadal 2026' }),
      eventId: EVENT_ID,
      tenantId: TENANT_ID,
      // user_id is reduced to a flag and never leaves.
      participant: { id: PARTICIPANT, bib: '101', name: 'Lisa Nord', claimed: false },
    })
  })

  it('is not_found for a participant outside the event, exactly like an unknown id', async () => {
    const c = client(eventRow(), { data: null, error: null })

    expect(await loadClaimTarget(c.service, TOKEN, PARTICIPANT)).toEqual({ kind: 'not_found' })
  })

  it('is not_found for a malformed participant id without querying it', async () => {
    const c = client(eventRow())

    expect(await loadClaimTarget(c.service, TOKEN, 'nope')).toEqual({ kind: 'not_found' })
    expect(c.from).not.toHaveBeenCalledWith('participants')
  })

  it('marks a row someone has claimed', async () => {
    const c = client(eventRow(), {
      data: { id: PARTICIPANT, bib: '101', name: 'Lisa Nord', user_id: 'someone' },
      error: null,
    })

    const result = await loadClaimTarget(c.service, TOKEN, PARTICIPANT)

    expect(result).toMatchObject({ kind: 'open', participant: { claimed: true } })
  })
})

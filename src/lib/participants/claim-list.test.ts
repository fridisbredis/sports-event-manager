import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { loadClaimList, isClaimToken } from './claim-list'

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const TOKEN = '0b8a3c3e-6f1d-4c55-9a43-0f5e2b7d9a11'
const EVENT_ID = 'event-1'
const TENANT_ID = 'tenant-1'

type Result = { data: unknown; error: unknown }

// A PostgREST builder stand-in that records every filter it is given, so the
// tests can assert on WHICH rows were asked for, not only on what came back.
function builder(result: Result) {
  const calls: Array<[string, ...unknown[]]> = []
  const b: Record<string, unknown> = { calls }
  for (const m of ['select', 'eq', 'is', 'order', 'range']) {
    b[m] = vi.fn((...args: unknown[]) => {
      calls.push([m, ...args])
      return m === 'range' ? Promise.resolve(result) : b
    })
  }
  b.maybeSingle = vi.fn(() => Promise.resolve(result))
  return b as Record<string, ReturnType<typeof vi.fn>> & { calls: typeof calls }
}

function client(event: Result, participants?: Result) {
  const events = builder(event)
  const parts = builder(participants ?? { data: [], error: null })
  const from = vi.fn((table: string) => (table === 'events' ? events : parts))
  return {
    service: { from } as unknown as SupabaseClient<Database>,
    from,
    events,
    parts,
  }
}

function eventRow(status: string, tier: string) {
  return {
    data: {
      id: EVENT_ID,
      tenant_id: TENANT_ID,
      name: 'Viadal 2026',
      logo_url: 'https://x.supabase.co/storage/v1/object/public/logos/a.png',
      status,
      tenants: { tier, color_palette: null },
    },
    error: null,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('isClaimToken', () => {
  it('accepts a uuid and rejects anything else', () => {
    expect(isClaimToken(TOKEN)).toBe(true)
    expect(isClaimToken('viadal-2026')).toBe(false)
    expect(isClaimToken(`${TOKEN}' or 1=1`)).toBe(false)
  })
})

describe('loadClaimList (CLAIM-01)', () => {
  it('returns not_found for a malformed token without querying anything', async () => {
    const c = client(eventRow('published', 'premium'))

    expect(await loadClaimList(c.service, 'not-a-token')).toEqual({ kind: 'not_found' })
    expect(c.from).not.toHaveBeenCalled()
  })

  it('looks the event up by claim_token and returns not_found when none matches', async () => {
    const c = client({ data: null, error: null })

    expect(await loadClaimList(c.service, TOKEN)).toEqual({ kind: 'not_found' })
    expect(c.events.eq).toHaveBeenCalledWith('claim_token', TOKEN)
    expect(c.from).not.toHaveBeenCalledWith('participants')
  })

  it.each([
    ['draft', 'premium'],
    ['archived', 'professional'],
    // Stored as published from before a downgrade: still closed (N36).
    ['published', 'standard'],
  ])(
    'is closed for status %s on %s, with name and logo but no participant query',
    async (status, tier) => {
      const c = client(eventRow(status, tier))

      const result = await loadClaimList(c.service, TOKEN)

      expect(result.kind).toBe('closed')
      expect(result).toMatchObject({ event: { name: 'Viadal 2026' } })
      expect(result).not.toHaveProperty('participants')
      expect(c.from).not.toHaveBeenCalledWith('participants')
    }
  )

  it('reads participants only for the token’s own event and tenant', async () => {
    const c = client(eventRow('published', 'premium'), { data: [], error: null })

    await loadClaimList(c.service, TOKEN)

    expect(c.parts.eq).toHaveBeenCalledWith('event_id', EVENT_ID)
    expect(c.parts.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(c.parts.is).toHaveBeenCalledWith('withdrawn_at', null)
    expect(c.parts.is).toHaveBeenCalledWith('hidden_at', null)
    // Nothing beyond what the page shows is even selected (L29).
    expect(c.parts.select).toHaveBeenCalledWith('id, bib, name, user_id')
  })

  it('exposes only id, bib, name and a claimed flag, sorted by bib numerically', async () => {
    const c = client(eventRow('published', 'professional'), {
      data: [
        { id: 'c', bib: '1000', name: 'Nils Ahl', user_id: null },
        { id: 'a', bib: '99', name: 'Lisa Nord', user_id: 'user-1' },
        { id: 'b', bib: null, name: 'Anna Ek', user_id: null },
        { id: 'd', bib: null, name: null, user_id: null },
      ],
      error: null,
    })

    const result = await loadClaimList(c.service, TOKEN)

    expect(result).toEqual({
      kind: 'open',
      event: {
        name: 'Viadal 2026',
        logoUrl: 'https://x.supabase.co/storage/v1/object/public/logos/a.png',
        palette: expect.any(String),
      },
      participants: [
        { id: 'a', bib: '99', name: 'Lisa Nord', claimed: true },
        { id: 'c', bib: '1000', name: 'Nils Ahl', claimed: false },
        { id: 'b', bib: null, name: 'Anna Ek', claimed: false },
      ],
    })
  })

  it('throws on a query error rather than rendering an empty list (F-REL-10)', async () => {
    const c = client(eventRow('published', 'premium'), {
      data: null,
      error: { message: 'boom', code: 'XX000' },
    })

    await expect(loadClaimList(c.service, TOKEN)).rejects.toMatchObject({ message: 'boom' })
  })
})

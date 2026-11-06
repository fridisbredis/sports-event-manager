import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant, hasAdminScreens } from '@/lib/auth/tenant'
import { listMemberEvents } from './official-event'

vi.mock('react', async (orig) => ({
  ...(await orig<typeof import('react')>()),
  // No request scope in a unit test: run the function every time.
  cache: <T>(fn: T) => fn,
}))

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getOfficialTenant: vi.fn(),
  hasAdminScreens: vi.fn(),
}))

type Row = Record<string, unknown>

// A PostgREST builder that records its filters and answers from per-table
// rows, applying eq / in / neq so the test checks what is actually asked for.
function fakeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = tables[table] ?? []
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] === val)), builder),
        neq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] !== val)), builder),
        in: (col: string, vals: unknown[]) => (
          (rows = rows.filter((r) => vals.includes(r[col]))),
          builder
        ),
        order: () => builder,
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      }
      return builder
    },
  }
}

const event = (id: string, start: string | null, status = 'published') => ({
  id,
  name: id,
  start_date: start,
  end_date: start,
  status,
  tenant_id: 't1',
})

// N35 (L5): the picker's list — official memberships and participant entries
// of one account, with the role(s) held in each event.
describe('listMemberEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getOfficialTenant).mockResolvedValue({
      id: 't1',
      slug: 'viadal',
      color_palette: 'default',
      tier: 'professional',
      is_active: true,
      officialId: 'o1',
    })
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'u1' } as never)
    vi.mocked(hasAdminScreens).mockResolvedValue(false)
  })

  function withData(tables: Record<string, Row[]>) {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeClient(tables) as never)
  }

  it('marks an official-only event as official and openable — unchanged for officials', async () => {
    withData({
      official_events: [{ official_id: 'o1', event_id: 'a', seen_at: '2026-01-01' }],
      events: [event('a', '2026-06-01')],
      participants: [],
    })
    expect(await listMemberEvents('viadal')).toEqual([
      expect.objectContaining({ id: 'a', roles: ['official'], canOpen: true, isNew: false }),
    ])
  })

  it('lists an official in one event and a participant in another, latest first', async () => {
    withData({
      official_events: [{ official_id: 'o1', event_id: 'a', seen_at: '2026-01-01' }],
      events: [event('a', '2026-06-01'), event('b', '2027-06-01'), event('c', '2025-06-01')],
      participants: [
        { tenant_id: 't1', user_id: 'u1', event_id: 'b' },
        { tenant_id: 't1', user_id: 'someone-else', event_id: 'c' },
      ],
    })
    expect(await listMemberEvents('viadal')).toEqual([
      expect.objectContaining({ id: 'b', roles: ['participant'], canOpen: false }),
      expect.objectContaining({ id: 'a', roles: ['official'], canOpen: true }),
    ])
  })

  it('gives both roles to an official who is also entered in the same event', async () => {
    withData({
      official_events: [{ official_id: 'o1', event_id: 'a', seen_at: null }],
      events: [event('a', '2026-06-01')],
      participants: [{ tenant_id: 't1', user_id: 'u1', event_id: 'a' }],
    })
    expect(await listMemberEvents('viadal')).toEqual([
      expect.objectContaining({
        id: 'a',
        roles: ['official', 'participant'],
        canOpen: true,
        isNew: true,
      }),
    ])
  })

  it('leaves out an archived event the person was a participant in', async () => {
    withData({
      official_events: [],
      events: [event('old', '2024-06-01', 'archived')],
      participants: [{ tenant_id: 't1', user_id: 'u1', event_id: 'old' }],
    })
    expect(await listMemberEvents('viadal')).toEqual([])
  })

  it('is empty when the caller has no access to the tenant', async () => {
    vi.mocked(getOfficialTenant).mockResolvedValue(null)
    withData({})
    expect(await listMemberEvents('viadal')).toEqual([])
  })
})

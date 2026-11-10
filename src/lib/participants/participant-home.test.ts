import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadParticipantHome } from './participant-home'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getEventInfoCached, type EventInfoCached } from '@/lib/events/event-info-cached'
import type { ResolvedParticipantTenant } from '@/lib/auth/tenant'

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/events/event-info-cached', () => ({ getEventInfoCached: vi.fn() }))

type Rows = Record<string, unknown[]>

// A thenable query builder: every filter returns itself, awaiting it yields
// the table's rows, maybeSingle() the first one. Records which tables were
// read so a test can assert a query was NOT made.
function fakeClient(rows: Rows, reads: string[] = []) {
  return {
    from(table: string) {
      reads.push(table)
      const result = { data: rows[table] ?? [], error: null }
      const builder: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => resolve(result),
        maybeSingle: () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null }),
      }
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) builder[m] = () => builder
      return builder
    },
  }
}

const stage = (id: string, name: string, position: number, stage_type = 'race') => ({
  id,
  name,
  stage_type,
  position,
  stage_date: null,
  start_time: null,
  end_time: null,
  venue: null,
  results_url: null,
})

function info(status: string, stages: EventInfoCached['stages']): EventInfoCached {
  return {
    event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null, status },
    stages,
    info_sections: [],
  }
}

const tenant: ResolvedParticipantTenant = {
  id: 't1',
  slug: 'viadal',
  color_palette: 'default',
  tier: 'premium',
  is_active: true,
  entries: [{ participantId: 'p1', eventId: 'e1' }],
}

const participantRow = {
  id: 'p1',
  event_id: 'e1',
  bib: '101',
  category: 'W40',
  race_results_url: 'https://example.test/101',
}

describe('loadParticipantHome', () => {
  beforeEach(() => vi.resetAllMocks())

  it('gives a runner in two Race stages two cards, in the admin’s order', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      fakeClient({
        participants: [participantRow],
        participant_stages: [
          { participant_id: 'p1', stage_id: 's2' },
          { participant_id: 'p1', stage_id: 's1' },
        ],
      }) as never
    )
    vi.mocked(getEventInfoCached).mockResolvedValue(
      info('published', [
        stage('s2', 'Stage 2', 1),
        stage('s1', '6dagars', 0),
        stage('s3', 'Other', 2),
      ])
    )

    const { events } = await loadParticipantHome(tenant)

    expect(events).toEqual([
      {
        eventId: 'e1',
        name: 'Viadal 2026',
        open: true,
        bib: '101',
        category: 'W40',
        raceResultsUrl: 'https://example.test/101',
        stages: [
          { id: 's1', name: '6dagars' },
          { id: 's2', name: 'Stage 2' },
        ],
      },
    ])
  })

  it('leaves out a linked stage that is not a Race stage', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      fakeClient({
        participants: [participantRow],
        participant_stages: [
          { participant_id: 'p1', stage_id: 's1' },
          { participant_id: 'p1', stage_id: 'expo' },
        ],
      }) as never
    )
    vi.mocked(getEventInfoCached).mockResolvedValue(
      info('published', [stage('s1', '6dagars', 0), stage('expo', 'Expo', 1, 'non_race')])
    )

    const { events } = await loadParticipantHome(tenant)

    expect(events[0].stages).toEqual([{ id: 's1', name: '6dagars' }])
  })

  it('marks a draft event closed and does not read its announcements', async () => {
    const reads: string[] = []
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      fakeClient(
        {
          participants: [participantRow],
          participant_stages: [],
          announcements: [{ body: 'x', published_at: '2026-11-10T08:15:00Z' }],
        },
        reads
      ) as never
    )
    vi.mocked(getEventInfoCached).mockResolvedValue(info('draft', [stage('s1', '6dagars', 0)]))

    const { events, latestAnnouncement } = await loadParticipantHome(tenant)

    expect(events[0].open).toBe(false)
    expect(latestAnnouncement).toBeNull()
    expect(reads).not.toContain('announcements')
  })

  it('keeps a published event closed on a tier without the participant side', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      fakeClient({ participants: [participantRow], participant_stages: [] }) as never
    )
    vi.mocked(getEventInfoCached).mockResolvedValue(info('published', []))

    const { events } = await loadParticipantHome({ ...tenant, tier: 'standard' })

    expect(events[0].open).toBe(false)
  })

  it('returns the newest participant announcement of an open event', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      fakeClient({
        participants: [participantRow],
        participant_stages: [],
        announcements: [{ body: 'Start moved to 12:30', published_at: '2026-11-10T08:15:00Z' }],
      }) as never
    )
    vi.mocked(getEventInfoCached).mockResolvedValue(info('published', []))

    const { latestAnnouncement } = await loadParticipantHome(tenant)

    expect(latestAnnouncement).toEqual({
      body: 'Start moved to 12:30',
      publishedAt: '2026-11-10T08:15:00Z',
    })
  })

  it('throws instead of showing no stages when a read fails', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      from: (table: string) => {
        const result =
          table === 'participant_stages'
            ? { data: null, error: new Error('boom') }
            : { data: [participantRow], error: null }
        const builder: Record<string, unknown> = {
          then: (resolve: (v: unknown) => unknown) => resolve(result),
        }
        for (const m of ['select', 'eq', 'in', 'order', 'limit']) builder[m] = () => builder
        return builder
      },
    } as never)
    vi.mocked(getEventInfoCached).mockResolvedValue(info('published', []))

    await expect(loadParticipantHome(tenant)).rejects.toThrow('boom')
  })
})

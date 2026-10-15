import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchOfficialDetail } from './official-detail'
import { logger } from '@/lib/logger'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const TENANT = '11111111-1111-1111-1111-111111111111'
const OFFICIAL = '22222222-2222-2222-2222-222222222222'

/**
 * A query builder that records its filters and resolves to one canned result
 * per table, so a test can assert both what was asked for and what came back.
 */
function makeClient(results: Record<string, { data?: unknown; error?: unknown }>) {
  const calls: Record<string, Record<string, unknown>> = {}

  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {}
    calls[table] = filters

    const builder: Record<string, unknown> = {}
    builder.select = vi.fn(() => builder)
    builder.eq = vi.fn((col: string, val: unknown) => {
      filters[col] = val
      return builder
    })
    builder.not = vi.fn((col: string, op: string) => {
      filters[`not:${col}`] = op
      return builder
    })
    builder.order = vi.fn((col: string) => {
      filters['order'] = col
      return builder
    })
    builder.range = vi.fn(() => Promise.resolve(results[table] ?? { data: [] }))
    return builder
  })

  return { client: { from } as never, calls }
}

function slot(start: string, end: string, wsId: string | null, wsName: string | null) {
  return {
    timeslot_start: start,
    timeslot_end: end,
    workstation_id: wsId,
    workstations: wsId ? { id: wsId, name: wsName } : null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchOfficialDetail — shifts', () => {
  // The whole point of the module: the roster must agree with MYSCH-01 and
  // ACCT-01 on what counts as one shift. Three back-to-back hourly slots at
  // one work area are one shift, not three — this is B5's failure mode.
  it('folds back-to-back slots at one work area into a single shift', async () => {
    const { client } = makeClient({
      assignments: {
        data: [
          slot('2026-08-02T08:00:00Z', '2026-08-02T09:00:00Z', 'ws-1', 'Finish line'),
          slot('2026-08-02T09:00:00Z', '2026-08-02T10:00:00Z', 'ws-1', 'Finish line'),
          slot('2026-08-02T10:00:00Z', '2026-08-02T11:00:00Z', 'ws-1', 'Finish line'),
        ],
      },
    })

    const { shifts } = await fetchOfficialDetail(client, {
      tenantId: TENANT,
      officialId: OFFICIAL,
    })

    expect(shifts).toEqual([
      {
        start: '2026-08-02T08:00:00Z',
        end: '2026-08-02T11:00:00Z',
        workAreaName: 'Finish line',
      },
    ])
  })

  // Touching slots at DIFFERENT work areas must stay separate: merging them
  // on time alone would render one line claiming the official was in both.
  it('starts a new shift when the work area changes, even with no gap', async () => {
    const { client } = makeClient({
      assignments: {
        data: [
          slot('2026-08-02T08:00:00Z', '2026-08-02T09:00:00Z', 'ws-1', 'Finish line'),
          slot('2026-08-02T09:00:00Z', '2026-08-02T10:00:00Z', 'ws-2', 'Water station'),
        ],
      },
    })

    const { shifts } = await fetchOfficialDetail(client, {
      tenantId: TENANT,
      officialId: OFFICIAL,
    })

    expect(shifts).toHaveLength(2)
    expect(shifts[0].workAreaName).toBe('Finish line')
    expect(shifts[1].workAreaName).toBe('Water station')
  })

  // A break in the middle of a day at one station is two shifts, not one
  // span hiding the gap.
  it('breaks a shift on a gap at the same work area', async () => {
    const { client } = makeClient({
      assignments: {
        data: [
          slot('2026-08-02T08:00:00Z', '2026-08-02T09:00:00Z', 'ws-1', 'Finish line'),
          slot('2026-08-02T13:00:00Z', '2026-08-02T14:00:00Z', 'ws-1', 'Finish line'),
        ],
      },
    })

    const { shifts } = await fetchOfficialDetail(client, {
      tenantId: TENANT,
      officialId: OFFICIAL,
    })

    expect(shifts).toHaveLength(2)
    expect(shifts[0].end).toBe('2026-08-02T09:00:00Z')
    expect(shifts[1].start).toBe('2026-08-02T13:00:00Z')
  })

  // The filters are what keep one official's row from showing another
  // tenant's shifts, or unassigned placeholder rows.
  it('scopes the read to the tenant, the official, and assigned work-area rows', async () => {
    const { client, calls } = makeClient({ assignments: { data: [] } })

    await fetchOfficialDetail(client, { tenantId: TENANT, officialId: OFFICIAL })

    expect(calls.assignments).toMatchObject({
      tenant_id: TENANT,
      official_id: OFFICIAL,
      status: 'assigned',
      'not:workstation_id': 'is',
      order: 'timeslot_start',
    })
  })

  // F-REL-10: a failed read logs and degrades to empty rather than throwing
  // the whole roster to the error boundary.
  it('logs and returns no shifts when the read fails', async () => {
    const { client } = makeClient({
      assignments: { error: { message: 'boom' } },
    })

    const { shifts } = await fetchOfficialDetail(client, {
      tenantId: TENANT,
      officialId: OFFICIAL,
    })

    expect(shifts).toEqual([])
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('fetchOfficialDetail — time off', () => {
  it('returns periods with their reason and who recorded them', async () => {
    const { client } = makeClient({
      official_unavailability: {
        data: [
          {
            id: 'p-1',
            starts_at: '2026-08-01T00:00:00Z',
            ends_at: '2026-08-02T00:00:00Z',
            reason: 'Away',
            created_by_role: 'official',
          },
        ],
      },
    })

    const { timeOff } = await fetchOfficialDetail(client, {
      tenantId: TENANT,
      officialId: OFFICIAL,
    })

    expect(timeOff).toEqual([
      {
        id: 'p-1',
        startsAt: '2026-08-01T00:00:00Z',
        endsAt: '2026-08-02T00:00:00Z',
        reason: 'Away',
        createdByRole: 'official',
      },
    ])
  })

  it('scopes the read to the tenant and the official', async () => {
    const { client, calls } = makeClient({ official_unavailability: { data: [] } })

    await fetchOfficialDetail(client, { tenantId: TENANT, officialId: OFFICIAL })

    expect(calls.official_unavailability).toMatchObject({
      tenant_id: TENANT,
      official_id: OFFICIAL,
      order: 'starts_at',
    })
  })

  it('logs and returns no periods when the read fails', async () => {
    const { client } = makeClient({
      official_unavailability: { error: { message: 'boom' } },
    })

    const { timeOff } = await fetchOfficialDetail(client, {
      tenantId: TENANT,
      officialId: OFFICIAL,
    })

    expect(timeOff).toEqual([])
    expect(logger.error).toHaveBeenCalled()
  })

  // One read failing must not blank the other half of the panel.
  it('still returns shifts when only the time-off read fails', async () => {
    const { client } = makeClient({
      assignments: {
        data: [slot('2026-08-02T08:00:00Z', '2026-08-02T09:00:00Z', 'ws-1', 'Finish line')],
      },
      official_unavailability: { error: { message: 'boom' } },
    })

    const { shifts, timeOff } = await fetchOfficialDetail(client, {
      tenantId: TENANT,
      officialId: OFFICIAL,
    })

    expect(shifts).toHaveLength(1)
    expect(timeOff).toEqual([])
  })
})

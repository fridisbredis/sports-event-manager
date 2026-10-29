import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchDayCoverage } from './coverage'
import { logger } from '@/lib/logger'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const TENANT = '11111111-1111-1111-1111-111111111111'
const DAY = '2026-08-02'

const ANNA = 'a0000000-0000-0000-0000-000000000001'
const BO = 'b0000000-0000-0000-0000-000000000002'

const FINISH = { id: 'ws-finish', name: 'Finish line', color: '#1d5fae' }
const WATER = { id: 'ws-water', name: 'Water station', color: null }

/**
 * A query builder that records its filters and resolves to one canned result,
 * so a test can assert both what was asked for and what came back. The chain
 * ends on `.order()` here rather than `.range()` — fetchDayCoverage bounds by
 * day, not by row count.
 */
function makeClient(result: { data?: unknown; error?: unknown }) {
  const filters: Record<string, unknown> = {}
  let orderCount = 0

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
  builder.gte = vi.fn((col: string, val: unknown) => {
    filters[`gte:${col}`] = val
    return builder
  })
  builder.lt = vi.fn((col: string, val: unknown) => {
    filters[`lt:${col}`] = val
    return builder
  })
  // Resolves on the LAST order() in the chain, which is where the real query
  // ends. Two order() calls, so the first must keep returning the builder.
  builder.order = vi.fn((col: string) => {
    filters[`order:${orderCount++}`] = col
    return orderCount >= 2 ? Promise.resolve(result) : builder
  })

  return { client: { from: vi.fn(() => builder) } as never, filters }
}

function slot(
  start: string,
  end: string,
  wsId: string | null,
  officialId: string | null,
  officialName: string | null
) {
  return {
    timeslot_start: start,
    timeslot_end: end,
    workstation_id: wsId,
    official_id: officialId,
    officials: officialId ? { id: officialId, name: officialName } : null,
  }
}

const at = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchDayCoverage — folding', () => {
  // The same agreement OFF-01, MYSCH-01 and ACCT-01 already hold to: one
  // assignments row is one grid slot, and back-to-back slots are one shift.
  // B5 was these screens disagreeing about that.
  it('folds back-to-back slots at one work area into a single shift', async () => {
    const { client } = makeClient({
      data: [
        slot(at('07:00'), at('08:00'), FINISH.id, ANNA, 'Anna'),
        slot(at('08:00'), at('09:00'), FINISH.id, ANNA, 'Anna'),
        slot(at('09:00'), at('10:00'), FINISH.id, ANNA, 'Anna'),
      ],
    })

    const { areas } = await fetchDayCoverage(client, {
      tenantId: TENANT,
      eventId: 'event-1',
      day: DAY,
      workstations: [FINISH],
    })

    expect(areas[0].shifts).toEqual([
      { officialId: ANNA, officialName: 'Anna', start: at('07:00'), end: at('10:00') },
    ])
  })

  // The failure this module's per-person grouping exists to prevent: two
  // people's touching slots at one work area must not fold into one shift
  // attributed to whoever sorted first.
  it('keeps two officials apart when their slots touch at the same work area', async () => {
    const { client } = makeClient({
      data: [
        slot(at('09:00'), at('10:00'), FINISH.id, ANNA, 'Anna'),
        slot(at('10:00'), at('11:00'), FINISH.id, BO, 'Bo'),
      ],
    })

    const { areas } = await fetchDayCoverage(client, {
      tenantId: TENANT,
      eventId: 'event-1',
      day: DAY,
      workstations: [FINISH],
    })

    expect(areas[0].shifts).toEqual([
      { officialId: ANNA, officialName: 'Anna', start: at('09:00'), end: at('10:00') },
      { officialId: BO, officialName: 'Bo', start: at('10:00'), end: at('11:00') },
    ])
  })

  // A break in the middle of a day is information, not noise: a work area
  // staffed 07-09 and again 13-15 is unstaffed at 11, which is exactly what
  // this screen is for.
  it('breaks a run on a gap rather than hiding it inside one span', async () => {
    const { client } = makeClient({
      data: [
        slot(at('07:00'), at('08:00'), FINISH.id, ANNA, 'Anna'),
        slot(at('13:00'), at('14:00'), FINISH.id, ANNA, 'Anna'),
      ],
    })

    const { areas } = await fetchDayCoverage(client, {
      tenantId: TENANT,
      eventId: 'event-1',
      day: DAY,
      workstations: [FINISH],
    })

    expect(areas[0].shifts.map((s) => [s.start, s.end])).toEqual([
      [at('07:00'), at('08:00')],
      [at('13:00'), at('14:00')],
    ])
  })

  it('orders shifts by start, then by name', async () => {
    const { client } = makeClient({
      data: [
        slot(at('09:00'), at('10:00'), FINISH.id, BO, 'Bo'),
        slot(at('08:00'), at('09:00'), FINISH.id, ANNA, 'Anna'),
      ],
    })

    const { areas } = await fetchDayCoverage(client, {
      tenantId: TENANT,
      eventId: 'event-1',
      day: DAY,
      workstations: [FINISH],
    })

    expect(areas[0].shifts.map((s) => s.officialName)).toEqual(['Anna', 'Bo'])
  })
})

describe('fetchDayCoverage — work areas', () => {
  // The most important thing this view can show. An unstaffed work area that
  // simply vanished from the list would make a coverage gap invisible, which
  // is the opposite of the screen's purpose.
  it('includes a work area with nobody assigned', async () => {
    const { client } = makeClient({
      data: [slot(at('07:00'), at('08:00'), FINISH.id, ANNA, 'Anna')],
    })

    const { areas } = await fetchDayCoverage(client, {
      tenantId: TENANT,
      eventId: 'event-1',
      day: DAY,
      workstations: [FINISH, WATER],
    })

    expect(areas).toHaveLength(2)
    expect(areas[1]).toEqual({
      workstationId: WATER.id,
      name: WATER.name,
      color: null,
      shifts: [],
    })
  })

  it('keeps the work-area order the page passed in', async () => {
    const { client } = makeClient({ data: [] })

    const { areas } = await fetchDayCoverage(client, {
      tenantId: TENANT,
      eventId: 'event-1',
      day: DAY,
      workstations: [WATER, FINISH],
    })

    expect(areas.map((a) => a.name)).toEqual(['Water station', 'Finish line'])
  })

  it('ignores an assignment pointing at a work area not on the day', async () => {
    const { client } = makeClient({
      data: [slot(at('07:00'), at('08:00'), 'ws-gone', ANNA, 'Anna')],
    })

    const { areas } = await fetchDayCoverage(client, {
      tenantId: TENANT,
      eventId: 'event-1',
      day: DAY,
      workstations: [FINISH],
    })

    expect(areas[0].shifts).toEqual([])
  })
})

describe('fetchDayCoverage — query shape', () => {
  it('scopes to the tenant, the day, and assigned work-area rows only', async () => {
    const { client, filters } = makeClient({ data: [] })

    await fetchDayCoverage(client, {
      tenantId: TENANT,
      eventId: 'event-1',
      day: DAY,
      workstations: [FINISH],
    })

    expect(filters['tenant_id']).toBe(TENANT)
    expect(filters['status']).toBe('assigned')
    expect(filters['not:workstation_id']).toBe('is')
    // Half-open on the UTC day, matching SCHED-01's own fetch: a slot starting
    // exactly at the next midnight belongs to the following day.
    expect(filters['gte:timeslot_start']).toBe(`${DAY}T00:00:00.000Z`)
    expect(filters['lt:timeslot_start']).toBe('2026-08-03T00:00:00.000Z')
  })

  // The per-person folding below depends on this ordering: unordered rows
  // would interleave two people's slots and fold them together.
  it('orders by official then time, so one person’s slots stay contiguous', async () => {
    const { client, filters } = makeClient({ data: [] })

    await fetchDayCoverage(client, {
      tenantId: TENANT,
      eventId: 'event-1',
      day: DAY,
      workstations: [FINISH],
    })

    expect(filters['order:0']).toBe('official_id')
    expect(filters['order:1']).toBe('timeslot_start')
  })
})

describe('fetchDayCoverage — failure', () => {
  // "Nobody is assigned" and "the read failed" look identical on a screen
  // built to spot unstaffed work areas, so the caller is told which it was.
  it('reports ok:false and still lists the work areas when the read fails', async () => {
    const { client } = makeClient({ error: { message: 'boom' } })

    const { areas, ok } = await fetchDayCoverage(client, {
      tenantId: TENANT,
      eventId: 'event-1',
      day: DAY,
      workstations: [FINISH, WATER],
    })

    expect(ok).toBe(false)
    expect(areas.map((a) => a.name)).toEqual(['Finish line', 'Water station'])
    expect(areas.every((a) => a.shifts.length === 0)).toBe(true)
  })

  it('logs the failure rather than swallowing it (F-REL-10)', async () => {
    const { client } = makeClient({ error: { message: 'boom' } })

    await fetchDayCoverage(client, {
      tenantId: TENANT,
      eventId: 'event-1',
      day: DAY,
      workstations: [FINISH],
    })

    expect(logger.error).toHaveBeenCalledWith(
      'N18: day coverage failed to load',
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT, eventId: 'event-1', day: DAY })
    )
  })

  it('reports ok:true for a genuinely empty day', async () => {
    const { client } = makeClient({ data: [] })

    const { ok } = await fetchDayCoverage(client, {
      tenantId: TENANT,
      eventId: 'event-1',
      day: DAY,
      workstations: [FINISH],
    })

    expect(ok).toBe(true)
  })
})

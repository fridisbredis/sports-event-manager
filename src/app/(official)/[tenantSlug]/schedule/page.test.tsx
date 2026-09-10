import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SchedulePage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { ScheduleView } from './_components/schedule-view'
import { logger } from '@/lib/logger'
import { expectRangeCeiling, expectReadCeilingWarn } from '@/lib/db/bounded-read.test-helpers'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

// getOfficialTenant resolves the tenant only after the official-surface
// access check passes, so a null return means either "no such tenant" or
// "not authorized" — both are notFound() to the caller, by design.
vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getOfficialTenant: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn().mockResolvedValue((key: string) => key),
}))

vi.mock('./_components/schedule-view', () => ({
  ScheduleView: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'not', 'order', 'limit', 'range', 'gte', 'lt']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function findByType(node: unknown, target: unknown): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== 'object') return null
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (el.type === target) return el as { props: Record<string, unknown> }
  const children = el.props?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findByType(child, target)
      if (found) return found
    }
  } else if (children) {
    return findByType(children, target)
  }
  return null
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })

// Fixed so the "default to today" branch is deterministic. 2026-08-12 is a
// day present in DAY_ROWS below; 2026-08-13 is the other.
const TODAY = '2026-08-12'
const DAY_ROWS = [
  { timeslot_start: '2026-08-12T09:00:00Z' },
  { timeslot_start: '2026-08-12T13:00:00Z' },
  { timeslot_start: '2026-08-13T08:00:00Z' },
]

function noParams() {
  return Promise.resolve({})
}

function dayParam(day: string) {
  return Promise.resolve({ day })
}

function mockUser(userId: string | null, fromMock: ReturnType<typeof vi.fn> = vi.fn()) {
  vi.mocked(getCurrentUser).mockResolvedValue((userId ? { id: userId } : null) as never)
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)
}

function mockResolvedTenant(officialId: string | null = 'off-1') {
  vi.mocked(getOfficialTenant).mockResolvedValue({
    id: TENANT_ID,
    slug: 'viadal',
    color_palette: 'default',
    is_active: true,
    officialId,
  })
}

// The page issues two reads against `assignments`: the dates-only day list,
// then the windowed read for the selected day. Order matters — the second
// query's `?day=` is resolved from the first query's result.
function mockQueries(dayResult: unknown, windowResult: unknown = { data: [] }) {
  const dayBuilder = chain(dayResult)
  const windowBuilder = chain(windowResult)
  const fromMock = vi.fn().mockReturnValueOnce(dayBuilder).mockReturnValueOnce(windowBuilder)
  return { dayBuilder, windowBuilder, fromMock }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T10:00:00.000Z`))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SchedulePage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    const fromMock = vi.fn()
    mockUser(null, fromMock)

    await expect(SchedulePage({ params: PARAMS, searchParams: noParams() })).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(getOfficialTenant).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('calls notFound when getOfficialTenant denies access or the tenant is missing', async () => {
    mockUser('user-1')
    vi.mocked(getOfficialTenant).mockResolvedValue(null)

    await expect(SchedulePage({ params: PARAMS, searchParams: noParams() })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(getOfficialTenant).toHaveBeenCalledWith('viadal')
  })

  it('renders an empty assignments list when the user has no confirmed official row', async () => {
    // officialId is null: getOfficialTenant's access check (tenant_admin/
    // system_admin branch, or simply no confirmed row) found no officials row
    // to attach. The page must not query assignments at all in that case.
    mockResolvedTenant(null)
    const fromMock = vi.fn()
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS, searchParams: noParams() })

    expect(fromMock).not.toHaveBeenCalled()
    const view = findByType(result, ScheduleView)
    expect(view).not.toBeNull()
    expect(view!.props.assignments).toEqual([])
    expect(view!.props.days).toEqual([])
    expect(view!.props.selectedDay).toBeNull()
  })

  it('derives the day tabs from the official own shifts, deduplicated and sorted', async () => {
    // The whole point of option A: tabs come from the days this official
    // actually works, not from the event's date range. Two shifts on the 12th
    // must produce one tab, not two.
    mockResolvedTenant('off-1')
    const { fromMock } = mockQueries({ data: DAY_ROWS })
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS, searchParams: noParams() })

    const view = findByType(result, ScheduleView)
    expect(view!.props.days).toEqual(['2026-08-12', '2026-08-13'])
  })

  it('reads only timeslot_start for the day list, never the nested expansion', async () => {
    // This is what makes the extra round trip worth it (F-PERF-06): the day
    // list must not drag `workstations` -> `workstation_todos` along with it.
    mockResolvedTenant('off-1')
    const { dayBuilder, fromMock } = mockQueries({ data: DAY_ROWS })
    mockUser('user-1', fromMock)

    await SchedulePage({ params: PARAMS, searchParams: noParams() })

    expect(dayBuilder.select).toHaveBeenCalledWith('timeslot_start')
    const selectArg = (dayBuilder.select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(selectArg).not.toContain('workstation_todos')
  })

  it('windows the second read to the selected day with a half-open range', async () => {
    mockResolvedTenant('off-1')
    const { windowBuilder, fromMock } = mockQueries({ data: DAY_ROWS })
    mockUser('user-1', fromMock)

    await SchedulePage({ params: PARAMS, searchParams: dayParam('2026-08-13') })

    // Half-open, not `.lte` on 23:59:59 — a shift starting exactly at
    // midnight must belong to one day only.
    expect(windowBuilder.gte).toHaveBeenCalledWith('timeslot_start', '2026-08-13T00:00:00.000Z')
    expect(windowBuilder.lt).toHaveBeenCalledWith('timeslot_start', '2026-08-14T00:00:00.000Z')
  })

  it('defaults to today when today is one of the official days', async () => {
    mockResolvedTenant('off-1')
    const { fromMock } = mockQueries({ data: DAY_ROWS })
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS, searchParams: noParams() })

    const view = findByType(result, ScheduleView)
    expect(view!.props.selectedDay).toBe(TODAY)
  })

  it('falls back to the first day when today is not a day the official works', async () => {
    mockResolvedTenant('off-1')
    const { fromMock } = mockQueries({
      data: [
        { timeslot_start: '2026-09-01T09:00:00Z' },
        { timeslot_start: '2026-09-02T09:00:00Z' },
      ],
    })
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS, searchParams: noParams() })

    const view = findByType(result, ScheduleView)
    expect(view!.props.selectedDay).toBe('2026-09-01')
  })

  // Adversarial: a stale or hand-edited `?day=` must not select a day the
  // official has no shifts on. That would render an empty schedule which
  // reads exactly like the F-REL-10 failure this page is the sharp edge of.
  it('ignores a ?day= that is not one of the official days', async () => {
    mockResolvedTenant('off-1')
    const { windowBuilder, fromMock } = mockQueries({ data: DAY_ROWS })
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS, searchParams: dayParam('2027-01-01') })

    const view = findByType(result, ScheduleView)
    expect(view!.props.selectedDay).toBe(TODAY)
    expect(windowBuilder.gte).toHaveBeenCalledWith('timeslot_start', `${TODAY}T00:00:00.000Z`)
  })

  it('skips the windowed read entirely when the official has no shifts', async () => {
    mockResolvedTenant('off-1')
    const { fromMock } = mockQueries({ data: [] })
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS, searchParams: noParams() })

    // Only the day list ran — no day to window, so no second round trip.
    expect(fromMock).toHaveBeenCalledTimes(1)
    const view = findByType(result, ScheduleView)
    expect(view!.props.days).toEqual([])
    expect(view!.props.selectedDay).toBeNull()
    expect(view!.props.assignments).toEqual([])
  })

  it('passes the tenant slug through so the day links can be built', async () => {
    mockResolvedTenant('off-1')
    const { fromMock } = mockQueries({ data: DAY_ROWS })
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS, searchParams: noParams() })

    const view = findByType(result, ScheduleView)
    expect(view!.props.tenantSlug).toBe('viadal')
  })

  it('loads assignments scoped to the official and tenant on both reads', async () => {
    // officialId comes straight from getOfficialTenant — the page never
    // queries `officials` itself (F-PERF-07-style dedup with the access
    // check, which already ran this lookup under the service client).
    mockResolvedTenant('off-1')
    const assignments = [{ id: 'a-1', timeslot_start: '2026-08-12T09:00:00Z' }]
    const { dayBuilder, windowBuilder, fromMock } = mockQueries(
      { data: DAY_ROWS },
      { data: assignments }
    )
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS, searchParams: noParams() })

    expect(fromMock).toHaveBeenCalledWith('assignments')
    expect(fromMock).not.toHaveBeenCalledWith('officials')
    for (const builder of [dayBuilder, windowBuilder]) {
      expect(builder.eq).toHaveBeenCalledWith('official_id', 'off-1')
      expect(builder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
      expect(builder.eq).toHaveBeenCalledWith('status', 'assigned')
    }

    const view = findByType(result, ScheduleView)
    expect(view!.props.assignments).toEqual(assignments)
  })

  // Adversarial: nothing previously asserted that an assignments query error
  // actually propagates rather than being silently swallowed into an empty
  // list — which would be indistinguishable from "no assignments" to an
  // official checking their schedule on event day.
  it('throws when the day-list query errors, rather than rendering an empty schedule', async () => {
    mockResolvedTenant('off-1')
    const { fromMock } = mockQueries({ data: null, error: { message: 'boom' } })
    mockUser('user-1', fromMock)

    await expect(SchedulePage({ params: PARAMS, searchParams: noParams() })).rejects.toEqual({
      message: 'boom',
    })
  })

  it('throws when the windowed query errors, rather than rendering an empty day', async () => {
    mockResolvedTenant('off-1')
    const { fromMock } = mockQueries(
      { data: DAY_ROWS },
      { data: null, error: { message: 'window boom' } }
    )
    mockUser('user-1', fromMock)

    await expect(SchedulePage({ params: PARAMS, searchParams: noParams() })).rejects.toEqual({
      message: 'window boom',
    })
  })

  // Adversarial: officialId must scope both queries even when the tenant id
  // and official id happen to collide in shape (both plausible uuid-looking
  // strings) — pins that official_id and tenant_id are always two independent
  // .eq() calls, not a single combined filter satisfiable by either alone.
  it('filters by both official_id and tenant_id independently, not by either alone', async () => {
    mockResolvedTenant('off-1')
    const { dayBuilder, windowBuilder, fromMock } = mockQueries({ data: DAY_ROWS })
    mockUser('user-1', fromMock)

    await SchedulePage({ params: PARAMS, searchParams: noParams() })

    for (const builder of [dayBuilder, windowBuilder]) {
      const eqCalls = (builder.eq as ReturnType<typeof vi.fn>).mock.calls
      expect(eqCalls).toContainEqual(['official_id', 'off-1'])
      expect(eqCalls).toContainEqual(['tenant_id', TENANT_ID])
      expect(eqCalls).toContainEqual(['status', 'assigned'])
      expect(eqCalls.length).toBe(3)
    }
  })

  // Frida, PR #150: nothing in this file pinned the ceiling to the query.
  // `checkReadCeiling` is unit-tested in bounded-read.test.ts, but the wiring
  // on this page — the range argument, and the truncation of what actually
  // reaches ScheduleView — was covered only by the mock chain not crashing.
  it('bounds both reads, asking for one row past the ceiling (PERF-06)', async () => {
    mockResolvedTenant('off-1')
    const { dayBuilder, windowBuilder, fromMock } = mockQueries({ data: DAY_ROWS })
    mockUser('user-1', fromMock)

    await SchedulePage({ params: PARAMS, searchParams: noParams() })

    // 501 rows requested for a 500 ceiling: the extra row is what makes a
    // breach detectable instead of a silent truncation.
    expectRangeCeiling(dayBuilder, 500)
    expectRangeCeiling(windowBuilder, 500)
  })

  it('warns and truncates to the ceiling when the day-list ceiling is breached', async () => {
    mockResolvedTenant('off-1')
    // 501 rows on 501 distinct days, so the truncation is observable in the
    // day list the view receives rather than being absorbed by dedup.
    const overflow = Array.from({ length: 501 }, (_, i) => ({
      timeslot_start: new Date(Date.UTC(2026, 0, 1 + i, 9)).toISOString(),
    }))
    const { fromMock } = mockQueries({ data: overflow })
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS, searchParams: noParams() })

    // The warn context is what makes a breach actionable in the logs — a
    // truncated schedule with no tenant/official attached is unchaseable.
    expectReadCeilingWarn(vi.mocked(logger.warn), {
      ceiling: 500,
      page: '(official)/schedule#days',
      context: { tenantId: TENANT_ID, officialId: 'off-1' },
    })
    const view = findByType(result, ScheduleView)
    expect(view!.props.days).toHaveLength(500)
  })

  it('warns and truncates to the ceiling when the windowed ceiling is breached', async () => {
    mockResolvedTenant('off-1')
    const overflow = Array.from({ length: 501 }, (_, i) => ({
      id: `a-${i}`,
      timeslot_start: '2026-08-12T09:00:00Z',
    }))
    const { fromMock } = mockQueries({ data: DAY_ROWS }, { data: overflow })
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS, searchParams: noParams() })

    expectReadCeilingWarn(vi.mocked(logger.warn), {
      ceiling: 500,
      page: '(official)/schedule',
      context: { tenantId: TENANT_ID, officialId: 'off-1', day: TODAY },
    })
    const view = findByType(result, ScheduleView)
    expect(view!.props.assignments).toHaveLength(500)
  })

  it('does not warn when the row count sits exactly on the ceiling', async () => {
    mockResolvedTenant('off-1')
    const atCeiling = Array.from({ length: 500 }, (_, i) => ({
      id: `a-${i}`,
      timeslot_start: '2026-08-12T09:00:00Z',
    }))
    const { fromMock } = mockQueries({ data: DAY_ROWS }, { data: atCeiling })
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS, searchParams: noParams() })

    expect(logger.warn).not.toHaveBeenCalled()
    const view = findByType(result, ScheduleView)
    expect(view!.props.assignments).toHaveLength(500)
  })
})
